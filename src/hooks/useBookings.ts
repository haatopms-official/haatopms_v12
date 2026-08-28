import { useCallback, useEffect, useRef, useState } from 'react';
import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { isEditing, onEditorsClosed } from '@/lib/editingGate';
import { Booking } from '@/types/hotel';
import { supabase } from '@/integrations/supabase/client';
import { bookingToRow, guestArgs, rowToBooking } from '@/lib/sheetMapper';
import { useI18n } from './useI18n';

/* ---------------- overlap detection (unchanged logic) ---------------- */
function bookingHalfSpan(b: Booking): [number, number] {
  const base = startOfDay(parseISO('2000-01-01'));
  const inDay = differenceInCalendarDays(parseISO(b.checkIn), base);
  const outDay = differenceInCalendarDays(parseISO(b.checkOut), base);
  return [2 * inDay + 1 - (b.checkInHalfDay ? 1 : 0), 2 * outDay + 1 + (b.checkOutHalfDay ? 1 : 0)];
}

function bookingsConflict(a: Booking, b: Booking): boolean {
  if (a.id === b.id) return false;
  if (a.roomNumber !== b.roomNumber) return false;
  const roomWide =
    a.status === 'maintenance' || b.status === 'maintenance' ||
    a.bedIndex === undefined || b.bedIndex === undefined;
  if (!roomWide) {
    const aBeds = new Set<number>([a.bedIndex as number, ...(a.additionalBeds ?? [])]);
    const bBeds = new Set<number>([b.bedIndex as number, ...(b.additionalBeds ?? [])]);
    let overlap = false;
    for (const bed of aBeds) if (bBeds.has(bed)) { overlap = true; break; }
    if (!overlap) return false;
  }
  const [aS, aE] = bookingHalfSpan(a);
  const [bS, bE] = bookingHalfSpan(b);
  return aS < bE && bS < aE;
}

function findConflict(list: Booking[], candidate: Booking) {
  return list.find((b) => bookingsConflict(b, candidate));
}

/* ---------------- Supabase-backed bookings with Guest Linking ---------------- */
export function useBookings() {
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const listRef = useRef<Booking[]>([]);
  listRef.current = bookings;

  const applyLocal = useCallback((next: Booking[]) => {
    setBookings(next);
    listRef.current = next;
  }, []);

  // Helper write function: resolves/creates the guest first, then writes the stay
  const persistBooking = useCallback(async (b: Booking, updatedBy?: string) => {
    // 1) link/create the person in the MAIN table
    const { data: mainId, error: gErr } = await supabase.rpc('upsert_guest', guestArgs(b));
    if (gErr) throw gErr;

    // 2) write the stay, referencing the main table
    const { error: bErr } = await supabase
      .from('bookings')
      .upsert(bookingToRow(b, mainId as string, updatedBy), { onConflict: 'booking_uid' });
    if (bErr) throw bErr;
  }, []);

  // 1) initial load — join the main table so contacts come along.
  const fetchSeqRef = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    const { data, error } = await supabase
      .from('bookings')
      .select('*, guests:main_id ( main_id, fio, tel, whats, email, telega, inst, guest_kind )')
      .order('no', { ascending: true });
    if (error) { console.error('[bookings] load', error); return; }
    if (seq !== fetchSeqRef.current) return; // drop stale result
    applyLocal((data ?? []).map((r) => rowToBooking(r as Record<string, unknown>)));
  }, [applyLocal]);

  // Debounced trigger: defers refetches while a dialog/editor is open
  const reloadTimerRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const scheduleReload = useCallback(() => {
    if (isEditing()) { pendingRef.current = true; return; }
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void reload();
    }, 300);
  }, [reload]);

  // Flush whatever was deferred as soon as all open dialogs close
  useEffect(() => onEditorsClosed(() => {
    if (pendingRef.current) { pendingRef.current = false; void reload(); }
  }), [reload]);

  useEffect(() => { void reload(); }, [reload]);

  // 2) realtime — subscribe to changes on both bookings and guests tables
  useEffect(() => {
    const ch = supabase
      .channel('sheet-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, scheduleReload)
      .subscribe();

    return () => {
      if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
      void supabase.removeChannel(ch);
    };
  }, [scheduleReload]);

  // 3) refetch when the tab regains focus (deferred if editing)
  useEffect(() => {
    const onFocus = () => {
      if (isEditing()) { pendingRef.current = true; return; }
      void reload();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload]);

  /* ---------------- mutations (optimistic + server write) ---------------- */
  const addBooking = useCallback((booking: Booking) => {
    if (findConflict(listRef.current, booking)) {
      toast.error(t('overlapError'));
      return false;
    }
    applyLocal([...listRef.current, booking]);
    void (async () => {
      try {
        await persistBooking(booking);
      } catch (error) {
        console.error('[bookings] insert', error);
        toast.error('Save failed — reloading');
        void reload();
      }
    })();
    return true;
  }, [applyLocal, persistBooking, reload, t]);

  const updateBooking = useCallback((id: string, updates: Partial<Booking>) => {
    const target = listRef.current.find((b) => b.id === id);
    if (!target) return false;
    const candidate: Booking = { ...target, ...updates };
    if (findConflict(listRef.current, candidate)) {
      toast.error(t('overlapError'));
      return false;
    }
    applyLocal(listRef.current.map((b) => (b.id === id ? candidate : b)));
    void (async () => {
      try {
        await persistBooking(candidate);
      } catch (error) {
        console.error('[bookings] update', error);
        toast.error('Update failed — reloading');
        void reload();
      }
    })();
    return true;
  }, [applyLocal, persistBooking, reload, t]);

  const removeBooking = useCallback((id: string) => {
    applyLocal(listRef.current.filter((b) => b.id !== id));
    void (async () => {
      const { error } = await supabase.from('bookings').delete().eq('booking_uid', id);
      if (error) {
        console.error('[bookings] delete', error);
        void reload();
      }
    })();
  }, [applyLocal, reload]);

  const removeBookings = useCallback(
    (ids: string[]) => {
      if (!ids || ids.length === 0) return;
      const idSet = new Set(ids);
      applyLocal(listRef.current.filter((booking) => !idSet.has(booking.id)));
      void (async () => {
        const { error } = await supabase
          .from('bookings')
          .delete()
          .in('booking_uid', ids);
        if (error) {
          console.error('[bookings] bulk delete', error);
          toast.error('Booking deletion failed — reloading');
          void reload();
        }
      })();
    },
    [applyLocal, reload],
  );

   /**
   * HARD PURGE of a delete target (a set of room numbers and/or a category id).
   * Deletes EVERY booking that belongs to it — every status (ожидание,
   * забронировано, проживает, выехал, обслуживание, грязный, убрано), past or
   * future, visible or filtered out, even rows this client never loaded — from
   * local state AND from public.bookings, and drops guests left with no stays.
   */
  const purgeTarget = useCallback(
    (target: { rooms?: number[]; categoryId?: string | null }) => {
      const nums = Array.from(
        new Set((target.rooms ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n))),
      );
      const catId = (target.categoryId ?? '').trim() || null;
      if (nums.length === 0 && !catId) return;

      const numSet = new Set(nums);
      const hits = (b: Booking) =>
        numSet.has(Number(b.roomNumber)) ||
        (catId !== null && String((b as unknown as { categoryId?: string }).categoryId ?? '') === catId);

      // 1) optimistic local wipe → every card and every chip drops instantly
      const victims = listRef.current.filter(hits);
      applyLocal(listRef.current.filter((b) => !hits(b)));

      // 2) atomic server-side hard delete
      void (async () => {
        const { error } = await supabase.rpc('purge_hotel_target', {
          p_rooms: nums,
          p_category: catId,
        });

        if (error) {
          console.error('[bookings] purge_hotel_target', error);
          // Fallback for a DB where the migration is not applied yet:
          // exact deletes only — never a LIKE pattern.
          if (nums.length) {
            const { error: e1 } = await supabase.from('bookings').delete().in('room_current', nums);
            if (e1) console.error('[bookings] purge by room_current', e1);
          }
          if (catId) {
            const { error: e2 } = await supabase.from('bookings').delete().eq('category', catId);
            if (e2) console.error('[bookings] purge by category', e2);
          }
          const ids = victims.map((b) => b.id);
          if (ids.length) {
            const { error: e3 } = await supabase.from('bookings').delete().in('booking_uid', ids);
            if (e3) console.error('[bookings] purge by booking_uid', e3);
          }
        }

        // 3) always resync so nothing can silently survive
        await reload();
      })();
    },
    [applyLocal, reload],
  );

  /** Back-compat wrapper — old call sites keep working. */
  const purgeRooms = useCallback(
    (roomNumbers: number[]) => purgeTarget({ rooms: roomNumbers }),
    [purgeTarget],
  );

return {
    bookings,
    selectedBooking,
    setSelectedBooking,
    isLoading,
    error,
    addBooking,
    updateBooking,
    deleteBooking,
    purgeTarget,
  };
} // <-- Ensure this closing curly brace for the useBookings function is present