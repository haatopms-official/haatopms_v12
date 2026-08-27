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
 * HARD WIPE BY ROOM NUMBER.
 * Deletes EVERY booking that belongs to the given room numbers — every status
 * (ожидание, забронировано, проживает, выехал, обслуживание, грязный, убрано),
 * past or future, visible or filtered out, even rows the client never loaded.
 * Matches both `room_current` (int) and `room_number` (text, incl. "101(3d) -- 204(3d)").
 */
const purgeRooms = useCallback(
  (roomNumbers: number[]) => {
    const nums = Array.from(
      new Set((roomNumbers ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n))),
    );
    if (nums.length === 0) return;
    const numSet = new Set(nums);

    // 1) optimistic local wipe → every indicator drops instantly
    applyLocal(listRef.current.filter((b) => !numSet.has(Number(b.roomNumber))));

    // 2) server-side hard delete (no soft flag, row is gone forever)
    void (async () => {
      const { error: e1 } = await supabase
        .from('bookings')
        .delete()
        .in('room_current', nums);
      if (e1) console.error('[bookings] purge by room_current', e1);

      const { error: e2 } = await supabase
        .from('bookings')
        .delete()
        .in('room_number', nums.map(String));
      if (e2) console.error('[bookings] purge by room_number', e2);

      // multi-segment rows like "101(3d) -- 204(3d)"
      for (const n of nums) {
        const { error: e3 } = await supabase
          .from('bookings')
          .delete()
          .like('room_number', `%${n}%`);
        if (e3) console.error('[bookings] purge by room_number like', e3);
      }

      if (e1 || e2) void reload();
    })();
  },
  [applyLocal, reload],
);

return {
  bookings,
  addBooking,
  removeBooking,
  removeBookings,
  purgeRooms,
  updateBooking,
};
}



  return {
    bookings,
    addBooking,
    removeBooking,
    removeBookings,
    updateBooking,
  };
}
