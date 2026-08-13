import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || 'https://nftthpqwicinmqtddypk.supabase.co') as string;
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_fKpKizxmtJK1inMfzWI10g_PoMpiIhv') as string;

export type HotelStateKey = 'bookings' | 'grid' | 'admins' | 'audit' | 'auth-history' | 'guests';

interface Row<T> { state_data: T; version: number; updated_at: string }

const FLUSH_MS = 150;

// Same channel-dedup guard as useSharedNamespace.ts: supabase-js reuses the
// same channel object for a repeated topic string, so if this hook is ever
// mounted twice for the same key at once (double-mount, fast refresh, a
// second consumer added later) the 2nd `.on()` would throw on an
// already-subscribed channel. Route every instance through one registry.
type ChannelEntry = { channel: ReturnType<typeof supabase.channel>; refCount: number; listeners: Set<(payload: any) => void> };
const channelRegistry: Record<string, ChannelEntry> = {};

function subscribeToKey(key: string, onChange: (payload: any) => void): () => void {
  let entry = channelRegistry[key];
  if (!entry) {
    const created: ChannelEntry = { channel: null as any, refCount: 0, listeners: new Set() };
    channelRegistry[key] = created;
    created.channel = supabase
      .channel(`hotel_app_state:${key}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_app_state', filter: `state_key=eq.${key}` },
        (payload: any) => { created.listeners.forEach((fn) => fn(payload)); },
      )
      .subscribe();
    entry = created;
  }
  entry.refCount += 1;
  entry.listeners.add(onChange);
  return () => {
    entry.listeners.delete(onChange);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      void supabase.removeChannel(entry.channel);
      delete channelRegistry[key];
    }
  };
}

/**
 * Shared, real-time, cross-user state backed by `public.hotel_app_state`.
 * - Initial value comes from the DB (or `initial` if row is empty).
 * - Every change in any browser is pushed to every other browser via Supabase Realtime.
 * - Concurrent writes are reconciled with a compare-and-swap RPC + retry.
 */
export function useSharedState<T>(key: HotelStateKey, initial: T) {
  const [data, setDataState] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const versionRef = useRef<number>(0);
  // The last state known to match `versionRef.current` on the server —
  // i.e. the confirmed base, *without* any of our not-yet-flushed local edits.
  const committedRef = useRef<T>(initial);
  // Queue of local edits made since the last successful flush. Kept as
  // updater functions (not a single precomputed value) so that, if the
  // server has moved on, we can *rebase* our edits onto the fresh server
  // state instead of blindly overwriting whatever another user just wrote.
  const pendingUpdatersRef = useRef<Array<(prev: T) => T>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localEchoRef = useRef<number>(0); // ignore realtime for our own writes
  const flushingRef = useRef<boolean>(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: row, error } = await (supabase as any)
        .from('hotel_app_state')
        .select('state_data, version')
        .eq('state_key', key)
        .maybeSingle();
      if (cancelled) return;
      if (!error && row) {
        versionRef.current = Number(row.version) || 0;
        committedRef.current = row.state_data as T;
        setDataState(row.state_data as T);
      } else {
        // Seed row so realtime UPDATEs work for everyone
        const { data: seeded } = await (supabase as any)
          .rpc('hotel_app_state_cas', { p_key: key, p_expected_version: 0, p_state_data: initial as any })
          .select()
          .maybeSingle();
        if (seeded) {
          versionRef.current = Number((seeded as any).version) || 1;
          committedRef.current = ((seeded as any).state_data as T) ?? initial;
        }
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Realtime subscription
  useEffect(() => {
    const unsubscribe = subscribeToKey(key, (payload: any) => {
      const row = (payload.new ?? payload.old) as Row<T> | null;
      if (!row) return;
      const v = Number(row.version) || 0;
      if (v <= versionRef.current) return;
      if (localEchoRef.current && v === localEchoRef.current) {
        localEchoRef.current = 0;
        versionRef.current = v;
        committedRef.current = row.state_data as T;
        return;
      }
      versionRef.current = v;
      committedRef.current = row.state_data as T;
      // If we have local edits not yet confirmed by the server, keep them —
      // reapply them on top of the fresh server state instead of discarding
      // them (this is what previously made deletes/creates "flip back").
      if (pendingUpdatersRef.current.length > 0) {
        let next = row.state_data as T;
        for (const fn of pendingUpdatersRef.current) next = fn(next);
        setDataState(next);
      } else {
        setDataState(row.state_data as T);
      }
    });
    return unsubscribe;
  }, [key]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return; // avoid overlapping flushes
    if (pendingUpdatersRef.current.length === 0) return;
    flushingRef.current = true;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const updaters = pendingUpdatersRef.current;
        if (updaters.length === 0) return;
        const expected = versionRef.current;
        // Always rebase on the last known-committed server state, then
        // replay every queued local edit on top of it in order.
        let candidate = committedRef.current;
        for (const fn of updaters) candidate = fn(candidate);

        const { data: rows, error } = await (supabase as any).rpc('hotel_app_state_cas', {
          p_key: key,
          p_expected_version: expected,
          p_state_data: candidate as any,
        });
        if (error) { console.error('[hotel-sync] cas error', error); return; }
        const row = Array.isArray(rows) ? (rows[0] as Row<T> | undefined) : (rows as Row<T> | null);
        if (!row) return;
        const newV = Number(row.version) || 0;

        if (newV === expected + 1) {
          // Success: the edits we just sent are now the committed base.
          // Only remove the updaters we actually flushed — more may have
          // been queued while this request was in flight.
          pendingUpdatersRef.current = pendingUpdatersRef.current.slice(updaters.length);
          versionRef.current = newV;
          committedRef.current = candidate;
          localEchoRef.current = newV;
          if (pendingUpdatersRef.current.length === 0) return;
          continue; // more edits queued mid-flight — flush those too
        }

        // CAS lost: someone else wrote first. Adopt their state as the new
        // committed base and retry by reapplying *our* queued edits on top
        // of it, so neither side's change is silently dropped.
        versionRef.current = newV;
        committedRef.current = row.state_data as T;
      }
      // Ran out of retries — surface the best-effort merged state locally so
      // the UI doesn't stay stuck showing an unsent local edit forever, and
      // try again shortly.
      if (pendingUpdatersRef.current.length > 0) {
        let next = committedRef.current;
        for (const fn of pendingUpdatersRef.current) next = fn(next);
        setDataState(next);
        flushTimerRef.current = setTimeout(() => { void flush(); }, FLUSH_MS * 4);
      }
    } finally {
      flushingRef.current = false;
    }
  }, [key]);


const setData = useCallback((updater: T | ((prev: T) => T)) => {
    const fn: (prev: T) => T = typeof updater === 'function' ? (updater as (p: T) => T) : () => updater;
    pendingUpdatersRef.current.push(fn);
    setDataState((prev) => fn(prev));
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => { void flush(); }, FLUSH_MS);
  }, [flush]);

  // Best-effort SYNCHRONOUS-DISPATCH flush for page-unload moments (tab/
  // browser closing). Regular fetches get killed mid-flight when the page
  // unloads; a `keepalive` fetch is specifically exempted from that and is
  // allowed to finish in the background. Used for things like "record this
  // admin's logout" that must not be silently dropped on close.
  const flushNow = useCallback(() => {
    if (pendingUpdatersRef.current.length === 0) return;
    let candidate = committedRef.current;
    for (const fn of pendingUpdatersRef.current) candidate = fn(candidate);
    try {
      void fetch(`${SUPABASE_URL}/rest/v1/rpc/hotel_app_state_cas`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          p_key: key,
          p_expected_version: versionRef.current,
          p_state_data: candidate,
        }),
      });
    } catch { /* best effort only */ }
  }, [key]);

  return { data, setData, ready, flushNow } as const;
}