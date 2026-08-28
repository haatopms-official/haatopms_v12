import React, { createContext, useContext, useMemo, useCallback } from 'react';
import { Booking } from '@/types/hotel';
import { useBookings } from './useBookings';
import { useAudit } from '@/contexts/AuditContext';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/contexts/AuthContext';


type Ctx = {
  bookings: Booking[];
  addBooking: (b: Booking) => boolean;
  removeBooking: (id: string) => void;
  removeBookings: (ids: string[]) => void;
  purgeRooms: (roomNumbers: number[]) => void;
  purgeTarget: (target: { rooms?: number[]; categoryId?: string | null }) => void;
  updateBooking: (id: string, updates: Partial<Booking>) => boolean;
};

const BookingsContext = createContext<Ctx | null>(null);

export const BookingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const inner = useBookings();
  const { log } = useAudit();
  const { user } = useAuth();
  const actor = useMemo(
    () => ({
      username: user?.email || user?.name || 'system',
      role: (user?.role ?? 'admin') as UserRole,
    }),
    [user?.email, user?.name, user?.role],
  );



  const addBooking = useCallback(
    (b: Booking) => {
      const ok = inner.addBooking(b);
      if (ok) {
        log({
          actor,
          category: 'booking',
          action: 'booking.created',
          summary: `Created booking for room ${b.roomNumber} (${b.guestName || 'Guest'})`,
          details: { bookingId: b.id, roomNumber: b.roomNumber, status: b.status },
        });
      }
      return ok;
    },
    [inner, log, actor],
  );

  const removeBooking = useCallback(
    (id: string) => {
      const target = inner.bookings.find((b) => b.id === id);
      inner.removeBooking(id);
      if (target) {
        log({
          actor,
          category: 'booking',
          action: 'booking.deleted',
          summary: `Deleted booking ${id} (room ${target.roomNumber})`,
          details: { bookingId: id, roomNumber: target.roomNumber },
        });
      }
    },
    [inner, log, actor],
  );

  const removeBookings = useCallback(
    (ids: string[]) => {
      if (!ids || ids.length === 0) return;
      const idSet = new Set(ids);
      const targets = inner.bookings.filter((b) => idSet.has(b.id));
      inner.removeBookings(ids);
      log({
        actor,
        category: 'booking',
        action: 'bookings.bulk_deleted',
        summary: `Bulk deleted ${targets.length} booking(s)`,
        details: { deletedIds: ids, count: targets.length },
      });
    },
    [inner, log, actor],
  );

  const purgeRooms = useCallback(
    (roomNumbers: number[]) => {
      if (!roomNumbers || roomNumbers.length === 0) return;
      const numSet = new Set(roomNumbers.map(Number));
      const targets = inner.bookings.filter((b) => numSet.has(Number(b.roomNumber)));
      inner.purgeRooms(roomNumbers);
      log({
        actor,
        category: 'system',
        action: 'bookings.purged_by_room',
        summary: `Hard-wiped ${targets.length} booking(s) from room(s) ${roomNumbers.join(', ')}`,
        details: {
          roomNumbers,
          deletedCount: targets.length,
          deletedBookingIds: targets.map((b) => b.id),
          statuses: targets.map((b) => b.status),
        },
      });
    },
    [inner, log, actor],
  );

  const purgeTarget = useCallback(
    (target: { rooms?: number[]; categoryId?: string | null }) => {
      const nums = Array.from(
        new Set((target.rooms ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n))),
      );
      const catId = (target.categoryId ?? '').trim() || null;
      if (nums.length === 0 && !catId) return;

      const numSet = new Set(nums);
      const targets = inner.bookings.filter(
        (b) =>
          numSet.has(Number(b.roomNumber)) ||
          (catId !== null && String((b as unknown as { categoryId?: string }).categoryId ?? '') === catId),
      );

      inner.purgeTarget({ rooms: nums, categoryId: catId });

      log({
        actor,
        category: 'system',
        action: 'bookings.purged_hard',
        summary: `Hard-wiped ${targets.length} booking(s) · rooms [${nums.join(', ') || '—'}] · category ${catId ?? '—'}`,
        details: {
          roomNumbers: nums,
          categoryId: catId,
          deletedCount: targets.length,
          deletedBookingIds: targets.map((b) => b.id),
          statuses: targets.map((b) => b.status),
        },
      });
    },
    [inner, log, actor],
  );

  const updateBooking = useCallback(
    (id: string, updates: Partial<Booking>) => {
      const ok = inner.updateBooking(id, updates);
      if (ok) {
        log({
          actor,
          category: 'booking',
          action: 'booking.updated',
          summary: `Updated booking ${id}`,
          details: { bookingId: id, updates },
        });
      }
      return ok;
    },
    [inner, log, actor],
  );

  const value = useMemo<Ctx>(
    () => ({
      bookings: inner.bookings,
      addBooking,
      removeBooking,
      removeBookings,
      purgeRooms,
      purgeTarget,
      updateBooking,
    }),
    [inner.bookings, addBooking, removeBooking, removeBookings, purgeRooms, purgeTarget, updateBooking],
  );

  return <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>;
};

export const useBookingsContext = () => {
  const ctx = useContext(BookingsContext);
  if (!ctx) {
    throw new Error('useBookingsContext must be used within a BookingsProvider');
  }
  return ctx;
};