import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { differenceInCalendarDays, isBefore, parseISO, startOfDay } from 'date-fns';
import { useBookingsContext } from '@/hooks/BookingsContext';

export type CriticalKind = 'missed_checkin' | 'missed_checkout';

export interface CriticalNotification {
  id: string;
  bookingId: string;
  roomNumber: number;
  guestName: string;
  kind: CriticalKind;
  scheduledISO: string;
  overdueMinutes: number;
  title: string;
  detail: string;
}

interface NotificationsCtx {
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  panelWidth: number;
  setPanelWidth: (w: number) => void;
  critical: CriticalNotification[];
  criticalBookingIds: Set<string>;
  criticalCount: number;
  focusBookingRequest: string | null;
  requestFocusBooking: (id: string) => void;
  clearFocusRequest: () => void;
}

const Ctx = createContext<NotificationsCtx | null>(null);

function localGetNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 280 ? n : fallback;
  } catch {
    return fallback;
  }
}
function localGetBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { bookings } = useBookingsContext();
  const [panelOpen, setPanelOpen] = useState<boolean>(() => localGetBool('notif.panel.open', false));
  const [panelWidth, _setPanelWidth] = useState<number>(() => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 0;
    const preferred = winW > 0 ? Math.round(winW / 4) : 380;
    return localGetNumber('notif.panel.width', Math.max(380, preferred));
  });
  const [focusBookingRequest, setFocusBookingRequest] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    // Align the ticker to the next wall-clock minute boundary so criticality
    // (e.g. missed check-in after 10:59) flips right when the minute changes,
    // not up to 30 s later. After the first aligned tick we fall back to a
    // steady 60 s interval anchored on that boundary.
    let intervalId: number | null = null;
    const now0 = new Date();
    const msToNextMinute = 60_000 - (now0.getSeconds() * 1000 + now0.getMilliseconds());
    const timeoutId = window.setTimeout(() => {
      setNow(new Date());
      intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    }, Math.max(250, msToNextMinute));
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem('notif.panel.open', panelOpen ? '1' : '0'); } catch { /* noop */ }
  }, [panelOpen]);

  const setPanelWidth = useCallback((w: number) => {
    const clamped = Math.max(280, Math.min(typeof window !== 'undefined' ? window.innerWidth - 200 : 800, w));
    _setPanelWidth(clamped);
    try { window.localStorage.setItem('notif.panel.width', String(clamped)); } catch { /* noop */ }
  }, []);

  const critical = useMemo<CriticalNotification[]>(() => {
    const today = startOfDay(now);
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const out: CriticalNotification[] = [];
    for (const b of bookings) {
      // Missed check-in: booking is still in a pre-arrival state but scheduled check-in has passed.
      if (b.status === 'booked' || b.status === 'confirmed' || b.status === 'pending') {
        const ci = startOfDay(parseISO(b.checkIn));
        // The red critical strip + pulsation must appear ONLY after the wall-
        // clock crosses 10:59 on the scheduled check-in day and stay in place
        // until the admin checks the guest in. Late-night arrivals keep their
        // dedicated 22:59 deadline. Early/half-day arrivals follow the same
        // 10:59 threshold as regular bookings.
        const threshold = b.checkInLateNight ? 23 * 60 : 11 * 60;
        const ciReached = !isBefore(today, ci); // today >= check-in day
        const daysLate = ciReached ? differenceInCalendarDays(today, ci) : 0;
        // On the check-in day itself the threshold must be crossed. On any
        // subsequent day the booking is unambiguously overdue and the red
        // strip / pulsation must stay on continuously until the admin checks
        // the guest in — including through the small hours of the next day.
        const pastThresholdToday = daysLate > 0 || minutesNow >= threshold;
        let overdue = false;
        let overdueMinutes = 0;
        if (ciReached && pastThresholdToday) {
          overdue = true;
          overdueMinutes = daysLate * 24 * 60 + (minutesNow - threshold);
        }


        if (overdue) {
          out.push({
            id: `ci_${b.id}`,
            bookingId: b.id,
            roomNumber: b.roomNumber,
            guestName: (b.guestName || '').trim() || `#${b.roomNumber}`,
            kind: 'missed_checkin',
            scheduledISO: b.checkIn,
            overdueMinutes,
            title: 'Missed check-in',
            detail: `Room ${b.roomNumber} — scheduled check-in on ${b.checkIn} (${b.checkInLateNight ? 'after 22:59 late-night' : 'after 10:59'}) has passed but the guest has not been checked in yet.`,
          });
        }
      }
      // Missed check-out: guest is still in-house but scheduled check-out has passed.
      if (b.status === 'in-house') {
        const co = parseISO(b.checkOut);
        let overdue = false;
        let overdueMinutes = 0;
        if (isBefore(co, today)) {
          overdue = true;
          overdueMinutes = differenceInCalendarDays(today, co) * 24 * 60 + minutesNow;
        } else if (!isBefore(today, co) && !isBefore(co, today)) {
          // Red critical strip + pulsation for check-out must appear the
          // minute the wall-clock crosses 10:59 for a standard check-out and
          // 22:59 for a late check-out, and must stay on until an admin
          // manually checks the guest out. These thresholds are one minute
          // before the actual deadline so the strip pulses right at the
          // designated moment (10:59 / 22:59) and continues indefinitely.
          const threshold = b.checkOutHalfDay ? (22 * 60 + 59) : (10 * 60 + 59);
          if (minutesNow >= threshold) {
            overdue = true;
            overdueMinutes = minutesNow - threshold;
          }
        }
        if (overdue) {
          out.push({
            id: `co_${b.id}`,
            bookingId: b.id,
            roomNumber: b.roomNumber,
            guestName: (b.guestName || '').trim() || `#${b.roomNumber}`,
            kind: 'missed_checkout',
            scheduledISO: b.checkOut,
            overdueMinutes,
            title: 'Missed check-out',
            detail: `Room ${b.roomNumber} — scheduled check-out on ${b.checkOut} (${b.checkOutHalfDay ? 'after 22:59 late' : 'after 10:59'}) has passed but the guest has not been checked out yet.`,
          });
        }
      }
    }
    out.sort((a, b) => b.overdueMinutes - a.overdueMinutes);
    return out;
  }, [bookings, now]);

  const criticalBookingIds = useMemo(() => new Set(critical.map((c) => c.bookingId)), [critical]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);
  const requestFocusBooking = useCallback((id: string) => setFocusBookingRequest(id), []);
  const clearFocusRequest = useCallback(() => setFocusBookingRequest(null), []);

  const value = useMemo<NotificationsCtx>(() => ({
    panelOpen, openPanel, closePanel, togglePanel,
    panelWidth, setPanelWidth,
    critical, criticalBookingIds, criticalCount: critical.length,
    focusBookingRequest, requestFocusBooking, clearFocusRequest,
  }), [panelOpen, openPanel, closePanel, togglePanel, panelWidth, setPanelWidth, critical, criticalBookingIds, focusBookingRequest, requestFocusBooking, clearFocusRequest]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifications must be used within NotificationsProvider');
  return v;
}
