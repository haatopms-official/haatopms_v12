import { useCallback, useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { getHotelState, setHotelState, type HotelStateKey } from '@/lib/hotel-state.functions';
import { supabase } from '@/integrations/supabase/client';

export type RecordMap = Record<string, Record<string, unknown>>;

const memCache: Record<string, RecordMap> = {};

export function useSharedNamespace(key: HotelStateKey, eventName: string) {
  const getShared = useServerFn(getHotelState);
  const setShared = useServerFn(setHotelState);

  const [map, setMap] = useState<RecordMap>(() => memCache[key] ?? {});
  const mapRef = useRef<RecordMap>(memCache[key] ?? {});
  const writeTimer = useRef<number | null>(null);
  // ids this tab edited very recently — protected from being overwritten by
  // an in-flight remote snapshot (last-writer-wins per FIELD GROUP, not per table)
  const recentEdits = useRef<Record<string, number>>({});
  const LOCAL_WINDOW_MS = 700;

  useEffect(() => { mapRef.current = map; }, [map]);

  const applyRemote = useCallback((remote: RecordMap) => {
    const now = Date.now();
    const local = mapRef.current;
    const merged: RecordMap = { ...remote };
    // keep only the slices this tab just typed into
    Object.keys(recentEdits.current).forEach((id) => {
      if (now - recentEdits.current[id] < LOCAL_WINDOW_MS) {
        if (local[id]) merged[id] = local[id];
      } else {
        delete recentEdits.current[id];
      }
    });
    if (JSON.stringify(merged) === JSON.stringify(local)) return;
    mapRef.current = merged;
    memCache[key] = merged;
    setMap(merged);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventName));
  }, [eventName, key]);

  // cross-instance (same tab)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onLocal = () => {
      const fresh = memCache[key];
      if (fresh && fresh !== mapRef.current) { mapRef.current = fresh; setMap(fresh); }
    };
    window.addEventListener(eventName, onLocal);
    return () => window.removeEventListener(eventName, onLocal);
  }, [eventName, key]);

  // pull from cloud: on mount, on realtime event, on tab focus, and a 3s safety poll
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const pull = async () => {
      try {
        const row = await getShared({ data: { key } });
        if (cancelled || !row) return;
        applyRemote(((row.stateData as RecordMap) ?? {}));
      } catch { /* offline — retry next tick */ }
    };

    void pull();

    const channel = supabase
      .channel(`hotel_app_state:${key}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_app_state', filter: `state_key=eq.${key}` },
        () => { void pull(); },
      )
      .subscribe();

    const onFocus = () => { void pull(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const id = window.setInterval(pull, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [getShared, key, applyRemote]);

  const setRecord = useCallback((id: string, data: Record<string, unknown>) => {
    const next = { ...mapRef.current, [id]: data };
    mapRef.current = next;
    memCache[key] = next;
    recentEdits.current[id] = Date.now();
    setMap(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(eventName));
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
      writeTimer.current = window.setTimeout(() => {
        void setShared({ data: { key, stateData: mapRef.current } }).catch(() => {});
      }, 200);
    }
  }, [setShared, key, eventName]);

  return { map, setRecord };
}