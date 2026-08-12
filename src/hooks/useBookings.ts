import { useCallback, useEffect, useRef, useState } from 'react';
import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { Booking } from '@/types/hotel';
import { supabase } from '@/integrations/supabase/client';
import { bookingToRow, rowToBooking } from '@/lib/bookingsMapper';
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

/* ---------------- Supabase-backed bookings ---------------- */
export function useBookings() {
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const listRef = useRef<Booking[]>([]);
  listRef.current = bookings;

  const applyLocal = useCallback((next: Booking[]) => {
    setBookings(next);
    listRef.current = next;
  }, []);

  // 1) initial load from Supabase
  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('no', { ascending: true });
    if (error) { console.error('[bookings] load', error); return; }
    applyLocal((data ?? []).map((r) => rowToBooking(r as Record<string, unknown>)));
  }, [applyLocal]);

  useEffect(() => { void reload(); }, [reload]);

  // 2) realtime — every INSERT/UPDATE/DELETE from ANY user/browser/IP
  useEffect(() => {
    const channel = supabase
      .channel('public:bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, (payload) => {
        const list = listRef.current;
        if (payload.eventType === 'DELETE') {
          const uid = String((payload.old as Record<string, unknown>)?.['booking_uid'] ?? '');
          applyLocal(list.filter((b) => b.id !== uid));
          return;
        }
        const row = payload.new as Record<string, unknown>;
        const incoming = rowToBooking(row);
        const idx = list.findIndex((b) => b.id === incoming.id);
        applyLocal(idx === -1
          ? [...list, incoming]
          : list.map((b) => (b.id === incoming.id ? incoming : b)));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [applyLocal]);

  // 3) refetch when the tab regains focus (covers dropped sockets)
  useEffect(() => {
    const onFocus = () => { void reload(); };
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
      const { error } = await supabase.from('bookings').insert(bookingToRow(booking));
      if (error) {
        console.error('[bookings] insert', error);
        toast.error('Save failed — reloading');
        void reload();
      }
    })();
    return true;
  }, [applyLocal, reload, t]);

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
      const { error } = await supabase
        .from('bookings')
        .update(bookingToRow(candidate))
        .eq('booking_uid', id);
      if (error) {
        console.error('[bookings] update', error);
        toast.error('Update failed — reloading');
        void reload();
      }
    })();
    return true;
  }, [applyLocal, reload, t]);

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

  return { bookings, addBooking, removeBooking, updateBooking };
}