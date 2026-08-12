import { memo, useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

import { type Booking, BOOKING_STATUSES, formatGuestName } from '@/types/hotel';
import { Users, Info, Moon, Sunrise } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useI18n } from '@/hooks/useI18n';
import { useNotifications } from '@/contexts/NotificationsContext';

function isVisuallyCriticalNow(booking: Booking, now = new Date()): boolean {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  if (booking.status === 'booked' || booking.status === 'confirmed' || booking.status === 'pending') {
    const checkInDay = parseISO(booking.checkIn);
    checkInDay.setHours(0, 0, 0, 0);
    if (today < checkInDay) return false;

    const threshold = booking.checkInLateNight ? 23 * 60 : 11 * 60;
    return today > checkInDay || minutesNow >= threshold;
  }

  if (booking.status === 'in-house') {
    const checkOutDay = parseISO(booking.checkOut);
    checkOutDay.setHours(0, 0, 0, 0);
    if (today > checkOutDay) return true;
    if (today < checkOutDay) return false;
    // Red pulsating strip must appear the minute the wall-clock crosses
    // 10:59 for a standard check-out and 22:59 for a late check-out, and
    // stay on until the admin manually checks the guest out.
    const threshold = booking.checkOutHalfDay ? (22 * 60 + 59) : (10 * 60 + 59);
    return minutesNow >= threshold;
  }

  return false;
}

interface BookingBarProps {
  booking: Booking; leftPx: number; widthPx: number;
  onClick: (booking: Booking) => void;
  onResize?: (id: string, newCheckOut: string, halfDay: boolean) => void;
  canResize?: (id: string, newCheckOut: string, halfDay: boolean) => boolean;
  onResizeLeft?: (id: string, halfDay: boolean) => void;
  canResizeLeft?: (id: string, halfDay: boolean) => boolean;
  onResizeConflict?: () => void;
  /**
   * Middle-mouse (wheel button) drag-to-move: parent receives the booking +
   * the original MouseEvent and takes over global mousemove/mouseup to render
   * a ghost following the cursor and detect the drop target row.
   */
  onMoveStart?: (booking: Booking, e: React.MouseEvent) => void;
  dayWidthPx: number;
  /** True when the booking's checkout date is strictly before today. */
  isPast?: boolean;
}

type ResizeSide = 'right' | 'left' | null;

export const BookingBar = memo(function BookingBar({ booking, leftPx, widthPx, onClick, onResize, canResize, onResizeLeft, canResizeLeft, onResizeConflict, onMoveStart, dayWidthPx, isPast }: BookingBarProps) {
  const { lang, t } = useI18n();
  const { criticalBookingIds } = useNotifications();
  const isCritical = criticalBookingIds.has(booking.id) && isVisuallyCriticalNow(booking);
  const config = BOOKING_STATUSES[booking.status];
  const checkInDate = parseISO(booking.checkIn);
  const checkOutDate = parseISO(booking.checkOut);
  const baseDayDiff = differenceInCalendarDays(checkOutDate, checkInDate);
  // Effective nights as halves (1 half = 0.5 day). +1 half if booking carries half-day extension.
  const baseHalfNights = baseDayDiff * 2 + (booking.checkOutHalfDay ? 1 : 0) + (booking.checkInHalfDay ? 1 : 0);
  const showGuestCount = widthPx > 240;
  const showNights = widthPx > 280;
  const showDates = widthPx > 90;
  const showFullDates = widthPx > 160;

  const [resizing, setResizing] = useState<ResizeSide>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [previewLeft, setPreviewLeft] = useState<number | null>(null);
  const [previewLate, setPreviewLate] = useState<boolean>(!!booking.checkOutHalfDay);
  const [previewEarly, setPreviewEarly] = useState<boolean>(!!booking.checkInHalfDay);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const startLeft = useRef(0);
  const finalLateRef = useRef<boolean>(!!booking.checkOutHalfDay);
  const finalEarlyRef = useRef<boolean>(!!booking.checkInHalfDay);
  const finalCheckOutRef = useRef<string>(booking.checkOut);
  // rAF-throttled pointer position to avoid setState per mousemove (perf opt).
  const rafIdRef = useRef<number | null>(null);
  const pendingDxRef = useRef(0);
  const movedRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const beginResize = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!onResize) return;
    // Corner drag is disabled after the booking has been checked out
    // (status transitioned to checked-out / dirty / cleaned) — its dates
    // are frozen and represent history.
    if (booking.status === 'checked-out' || booking.status === 'dirty' || booking.status === 'cleaned') return;
    // Right-edge drag is disabled when the check-out date is already in
    // the past — the operator may not rewrite a completed stay.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (parseISO(booking.checkOut) < today) return;
    setResizing('right');
    startX.current = e.clientX;
    startWidth.current = widthPx;
    finalLateRef.current = !!booking.checkOutHalfDay;
    finalCheckOutRef.current = booking.checkOut;
    setPreviewLate(!!booking.checkOutHalfDay);
    movedRef.current = false;
  }, [onResize, widthPx, booking.checkOutHalfDay, booking.checkOut, booking.status]);

  const beginResizeLeft = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!onResizeLeft) return;
    // Same freeze as the right edge for post-checkout bookings.
    if (booking.status === 'checked-out' || booking.status === 'dirty' || booking.status === 'cleaned') return;
    // Block left-edge drag when the check-in date is already in the past.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(booking.checkIn) < today) return;
    setResizing('left');
    startX.current = e.clientX;
    startWidth.current = widthPx;
    startLeft.current = leftPx;
    finalEarlyRef.current = !!booking.checkInHalfDay;
    setPreviewEarly(!!booking.checkInHalfDay);
    movedRef.current = false;
  }, [onResizeLeft, widthPx, leftPx, booking.checkInHalfDay, booking.checkIn, booking.status]);

  useEffect(() => {
    if (!resizing) return;
    const halfWidth = dayWidthPx / 2;
    const flush = () => {
      rafIdRef.current = null;
      const dx = pendingDxRef.current;
      if (resizing === 'right') {
        // RIGHT-side drag: unlimited half-cell extension/shortening. Odd half = late checkout.
        const threshold = halfWidth * 0.45;
        const baseHalves = baseDayDiff * 2 + (booking.checkOutHalfDay ? 1 : 0) + (booking.checkInHalfDay ? 1 : 0);
        const movedHalves = Math.trunc((dx + (dx >= 0 ? threshold : -threshold)) / halfWidth);
        const nextHalves = Math.max(1, baseHalves + movedHalves);
        const checkInHalfOffset = booking.checkInHalfDay ? 1 : 0;
        const stayHalvesAfterCheckInDate = Math.max(1, nextHalves - checkInHalfOffset);
        const dayDelta = Math.floor(stayHalvesAfterCheckInDate / 2);
        const nextLate = stayHalvesAfterCheckInDate % 2 === 1;
        finalLateRef.current = nextLate;
        finalCheckOutRef.current = format(addDays(parseISO(booking.checkIn), Math.max(1, dayDelta)), 'yyyy-MM-dd');
        setPreviewLate(nextLate);
        setPreviewWidth(Math.max(halfWidth, startWidth.current + movedHalves * halfWidth));
      } else {
        // LEFT-side drag: allow smooth travel between the two valid edge states.
        // Normal check-in: drag left up to half a cell.
        // Early check-in already active: drag right up to half a cell back to normal.
        const startedEarly = !!booking.checkInHalfDay;
        const minDx = startedEarly ? 0 : -halfWidth;
        const maxDx = startedEarly ? halfWidth : 0;
        const clampedDx = Math.min(maxDx, Math.max(minDx, dx));
        const earlyProgress = startedEarly
          ? 1 - clampedDx / halfWidth
          : -clampedDx / halfWidth;
        const earlyShift = earlyProgress >= 0.5;

        finalEarlyRef.current = earlyShift;
        setPreviewEarly(earlyShift);
        setPreviewLeft(startLeft.current + clampedDx);
        setPreviewWidth(startWidth.current - clampedDx);
      }
    };
    const onMove = (e: MouseEvent) => {
      pendingDxRef.current = e.clientX - startX.current;
      if (Math.abs(pendingDxRef.current) >= halfWidth * 0.45) movedRef.current = true;
      if (rafIdRef.current == null) rafIdRef.current = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (rafIdRef.current != null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; flush(); }
      const side = resizing;
      if (movedRef.current) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 200);
      }
      setResizing(null);
      if (side === 'right') {
        const late = finalLateRef.current;
        const checkOut = finalCheckOutRef.current;
        if (onResize && movedRef.current && (late !== !!booking.checkOutHalfDay || checkOut !== booking.checkOut)) {
          if (canResize && !canResize(booking.id, checkOut, late)) {
            onResizeConflict?.();
            setPreviewWidth(null);
            setPreviewLeft(null);
            setPreviewLate(!!booking.checkOutHalfDay);
            setPreviewEarly(!!booking.checkInHalfDay);
            return;
          }
          onResize(booking.id, checkOut, late);
        }
      } else if (side === 'left') {
        const early = finalEarlyRef.current;
        if (onResizeLeft && movedRef.current && early !== !!booking.checkInHalfDay) {
          if (canResizeLeft && !canResizeLeft(booking.id, early)) {
            onResizeConflict?.();
            setPreviewWidth(null);
            setPreviewLeft(null);
            setPreviewLate(!!booking.checkOutHalfDay);
            setPreviewEarly(!!booking.checkInHalfDay);
            return;
          }
          onResizeLeft(booking.id, early);
        }
      }
      setPreviewWidth(null);
      setPreviewLeft(null);
      setPreviewLate(!!booking.checkOutHalfDay);
      setPreviewEarly(!!booking.checkInHalfDay);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };
  }, [resizing, dayWidthPx, onResize, canResize, onResizeLeft, canResizeLeft, onResizeConflict, booking.id, booking.checkIn, booking.checkInHalfDay, booking.checkOut, booking.checkOutHalfDay, baseDayDiff]);

  const effectiveLeft = previewLeft ?? leftPx;
  const effectiveWidth = previewWidth ?? widthPx;
  const effectiveLate = resizing === 'right' ? previewLate : !!booking.checkOutHalfDay;
  const effectiveEarly = resizing === 'left' ? previewEarly : !!booking.checkInHalfDay;
  const effectiveHalfNights = baseDayDiff * 2 + (effectiveLate ? 1 : 0) + (effectiveEarly ? 1 : 0);
  // Display nights label: keep integer feel (round up halves).
  const effectiveNightsLabel = effectiveHalfNights / 2;

  // Both РАННИЙ and ПОЗДНИЙ can coexist — they are independent positional flags
  // tied to which half of the start/end cell the booking edge sits in.
  const isLate = effectiveLate;
  const isEarly = effectiveEarly;
  const lateLabel = t('lateBadge');
  const earlyLabel = t('earlyBadge');

  // Freeze corner-drag affordances once the booking has been checked out
  // (dirty/checked-out/cleaned) or when the corresponding date already
  // sits before today. Hiding the handles removes the visible grabber so
  // the operator gets a plain pointer, matching the disabled behaviour.
  const isFrozenStatus = booking.status === 'checked-out' || booking.status === 'dirty' || booking.status === 'cleaned';
  const todayForHandles = new Date(); todayForHandles.setHours(0, 0, 0, 0);
  const leftHandleDisabled = isFrozenStatus || parseISO(booking.checkIn) < todayForHandles;
  const rightHandleDisabled = isFrozenStatus || parseISO(booking.checkOut) < todayForHandles;

  const handleBarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressNextClickRef.current) {
      e.preventDefault();
      suppressNextClickRef.current = false;
      return;
    }
    if (!resizing) onClick(booking);
  };

  // ── Custom hover popover (replaces radix Tooltip for guaranteed reliability) ──
  const barRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);

  const computePopPos = useCallback(() => {
    const node = barRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const POP_W = 300;
    const POP_H_EST = 220;
    const margin = 12;
    const placeAbove = r.top > POP_H_EST + margin;
    const top = placeAbove ? r.top - margin : r.bottom + margin;
    let left = r.left + r.width / 2 - POP_W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - POP_W - 8));
    setPopPos({ top, left, placeAbove });
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (resizing) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      computePopPos();
      setHovered(true);
    }, 140);
  }, [resizing, computePopPos]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHovered(false), 80);
  }, []);

  useEffect(() => () => { if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current); }, []);
  useEffect(() => { if (resizing) setHovered(false); }, [resizing]);
  useLayoutEffect(() => {
    if (!hovered) return;
    // rAF-throttle scroll/resize recomputation so we never reflow the popover
    // multiple times per frame (which caused the "corner freeze/jitter" the
    // user saw when hovering near the timeline edges).
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; computePopPos(); });
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hovered, computePopPos]);


  const bar = (
    <div
      ref={barRef}
      onMouseDown={(e) => {
        // Middle mouse button initiates booking move (drag-to-relocate).
        // Whether past bookings are movable is decided by the parent (superuser
        // is allowed to move any booking regardless of date/status).
        if (e.button === 1 && onMoveStart) {
          e.preventDefault();
          e.stopPropagation();
          onMoveStart(booking, e);
          return;
        }
        e.stopPropagation();
      }}
      onAuxClick={(e) => {
        // Suppress middle-click default scroll-anchor behavior on the bar.
        if (e.button === 1) { e.preventDefault(); e.stopPropagation(); }
      }}
      onClick={handleBarClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-booking-id={booking.id}
      className={`group/bar absolute top-[5px] bottom-[5px] rounded-xl cursor-pointer booking-bar booking-premium-surface
        text-[11px] font-semibold text-primary-foreground flex items-stretch overflow-hidden
        animate-slide-in border backdrop-blur-[2px] transition-[transform,box-shadow] duration-200 ease-out
        hover:-translate-y-[2px]
        ${isPast ? 'border-solid border-gray-500 bg-gray-400 opacity-60 grayscale' : `${config.border} ${config.bg} ${config.opacity}`}
        ${isCritical ? 'booking-critical-alert' : ''}
        ${resizing ? 'ring-2 ring-primary/70 shadow-2xl scale-y-[1.04]' : ''}`}
      style={{
        left: `${effectiveLeft}px`,
        width: `${Math.max(effectiveWidth - 2, 8)}px`,
        transition: resizing ? 'none' : 'left 140ms cubic-bezier(0.2,0.9,0.4,1.1), width 140ms cubic-bezier(0.2,0.9,0.4,1.1), transform 200ms ease-out, box-shadow 220ms ease-out',
        backgroundImage: !isPast
          ? 'linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 45%, rgba(0,0,0,0.18) 100%)'
          : undefined,
      }}
    >
      {/* Hover sheen */}
      {!isPast && <span aria-hidden className="booking-bar-sheen" />}

      {isEarly && (
        <span aria-hidden className="booking-early-strip absolute left-0 top-0 bottom-0 w-[7px] z-[1]" />
      )}
      {isLate && (
        <span aria-hidden className="booking-late-strip absolute right-0 top-0 bottom-0 w-[7px] z-[1]" />
      )}

      <div className="relative z-[2] flex min-w-0 flex-1 items-center gap-1.5 px-3">
        <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 text-[11px] leading-none ring-1 ring-primary-foreground/30">
          {config.icon}
        </span>
        {isEarly && (
          <span
            className="booking-early-badge shrink-0 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full ring-1 animate-fade-in-up"
            title={`${t('earlyCheckinTitle')} · ${earlyLabel} · 08:00`}
            aria-label={`${earlyLabel} 08:00`}
          >
          <Sunrise className="h-3 w-3" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[11.5px] font-normal tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
          {formatGuestName(booking)}
        </span>
        {isLate && (
          <span
            className="booking-late-badge shrink-0 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full ring-1 animate-fade-in-up"
            title={`${t('lateCheckoutTitle')} · ${lateLabel} · 24:00`}
            aria-label={`${lateLabel} 24:00`}
          >
            <Moon className="h-3 w-3" />
          </span>
        )}
        {showGuestCount && (
          <span className="flex items-center gap-0.5 shrink-0 opacity-90 text-[9.5px] tabular-nums bg-black/15 rounded-md px-1.5 py-[2px]">
            <Users className="h-2.5 w-2.5" />{booking.guestCount}
          </span>
        )}
        {showNights && (
          <span className="shrink-0 opacity-90 text-[9.5px] font-bold tabular-nums bg-black/15 rounded-md px-1.5 py-[2px]">
            {Number.isInteger(effectiveNightsLabel) ? effectiveNightsLabel : effectiveNightsLabel.toFixed(1)}
            {t('nightsLetter')}
          </span>
        )}

        {/* Quick-info action — appears on hover */}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleBarClick}
          title={t('detailedInfo') ?? 'Detailed information'}
          aria-label={t('detailedInfo') ?? 'Detailed information'}
          className="shrink-0 ml-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-white/20 text-white/95 ring-1 ring-white/40 opacity-0 group-hover/bar:opacity-100 hover:bg-white/35 hover:scale-110 transition-all duration-150"
        >
          <Info className="h-3 w-3" />
        </button>
      </div>

      {onResizeLeft && !leftHandleDisabled && (
        <div
          onMouseDown={beginResizeLeft}
          onClick={(e) => e.stopPropagation()}
          title={t('dragToEarly')}
          className="absolute top-0 left-0 h-full w-3 cursor-ew-resize flex items-center justify-center bg-gradient-to-r from-black/20 to-transparent opacity-0 group-hover/bar:opacity-100 transition-opacity z-[3]"
        >
          <div className="h-7 w-[3px] rounded-full bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
        </div>
      )}

      {onResize && !rightHandleDisabled && (
        <div
          onMouseDown={beginResize}
          onClick={(e) => e.stopPropagation()}
          title={t('dragToExtend')}
          className="absolute top-0 right-0 h-full w-3 cursor-ew-resize flex items-center justify-center bg-gradient-to-l from-black/20 to-transparent opacity-0 group-hover/bar:opacity-100 transition-opacity z-[3]"
        >
          <div className="h-7 w-[3px] rounded-full bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
        </div>
      )}
    </div>
  );

  const popover = popPos && hovered && typeof document !== 'undefined'
    ? createPortal(
        <div
          key="booking-hover-pop"
          style={{
            position: 'fixed',
            top: popPos.placeAbove ? undefined : popPos.top,
            bottom: popPos.placeAbove ? window.innerHeight - popPos.top : undefined,
            left: popPos.left,
            width: 300,
            zIndex: 9999,
            // Popover is informational only — disabling pointer events stops
            // the cursor from re-entering the popover and re-triggering the
            // enter/leave loop that produced the "corner tweak/freeze".
            pointerEvents: 'none',
            willChange: 'transform, opacity',
            transformOrigin: popPos.placeAbove ? 'bottom center' : 'top center',
            animation: 'booking-pop-in 140ms cubic-bezier(0.2,0.9,0.4,1.05) both',
          }}
          className="rounded-2xl shadow-2xl"
        >
            <div
              className="relative rounded-2xl border bg-popover p-0 overflow-hidden"
              style={{ borderColor: `${config.color}40` }}
            >
              {/* Top color stripe */}
              <div
                className="h-1.5 w-full"
                style={{ background: `linear-gradient(90deg, ${config.color}, ${config.color}aa)` }}
              />
              <div className="p-3.5 space-y-2">
                {/* Header: name + status pill */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[15px] font-black leading-tight text-foreground truncate">
                      {formatGuestName(booking) || (lang === 'ru' ? 'Гость' : lang === 'uz' ? 'Mehmon' : 'Guest')}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-0.5">
                      {t('room')} {booking.roomNumber}
                    </p>
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1"
                    style={{
                      background: `${config.color}1a`,
                      color: config.color,
                      borderColor: `${config.color}40`,
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.color }} />
                    {config.label[lang]}
                  </span>
                </div>

                {/* Guest origin — auto-detected, display only */}
                {(() => {
                  const channel: 'online' | 'offline' = booking.bookingChannel ?? 'offline';
                  const isOnline = channel === 'online';
                  const onlineLabel = lang === 'ru' ? 'Онлайн' : lang === 'uz' ? 'Onlayn' : 'Online';
                  const offlineLabel = lang === 'ru' ? 'Офлайн' : lang === 'uz' ? 'Oflayn' : 'Offline';
                  const guestLabel = lang === 'ru' ? 'Гость' : lang === 'uz' ? 'Mehmon' : 'Guest';
                  return (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        {guestLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 p-[2px] ring-1 ring-border/60 shadow-sm select-none">
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${isOnline ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-[0_1px_4px_-1px_rgba(14,165,233,0.6)] ring-1 ring-sky-600/40' : 'text-muted-foreground/60 opacity-70'}`}>
                          <span className={`h-1 w-1 rounded-full ${isOnline ? 'bg-white' : 'bg-sky-500/30'}`} />
                          {onlineLabel}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${!isOnline ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-[0_1px_4px_-1px_rgba(15,23,42,0.6)] ring-1 ring-slate-900/50' : 'text-muted-foreground/60 opacity-70'}`}>
                          <span className={`h-1 w-1 rounded-full ${!isOnline ? 'bg-white' : 'bg-slate-500/30'}`} />
                          {offlineLabel}
                        </span>
                      </span>
                    </div>
                  );
                })()}


                {/* Stay window */}
                <div className="rounded-xl bg-muted/40 px-2.5 py-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-foreground tabular-nums">
                      {booking.checkIn} <span className="text-muted-foreground font-medium">{booking.checkInHalfDay ? '08:00' : '14:00'}</span>
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-bold text-foreground tabular-nums">
                      {booking.checkOut} <span className="text-muted-foreground font-medium">{booking.checkOutHalfDay ? '24:00' : '12:00'}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-black text-primary">
                      {Number.isInteger(baseHalfNights / 2) ? baseHalfNights / 2 : (baseHalfNights / 2).toFixed(1)} {t('nightsWord')}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                      <Users className="h-3 w-3" /> {booking.guestCount} {t('guestsWord')}
                    </span>
                    <div className="flex gap-1">
                      {booking.checkInHalfDay && (
                        <span className="inline-flex items-center rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">
                          {t('earlyBadge')}
                        </span>
                      )}
                      {booking.checkOutHalfDay && (
                        <span className="inline-flex items-center rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700">
                          {t('lateBadge')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contacts */}
                {(booking.guestPhone || booking.guestEmail) && (
                  <div className="space-y-0.5 text-[11px]">
                    {booking.guestPhone && (
                      <p className="flex items-center gap-1.5 text-foreground/80">
                        <span className="text-primary/70">📞</span>
                        <span className="font-semibold tabular-nums">{booking.guestPhone}</span>
                      </p>
                    )}
                    {booking.guestEmail && (
                      <p className="flex items-center gap-1.5 text-foreground/80 truncate">
                        <span className="text-primary/70">✉</span>
                        <span className="font-semibold truncate">{booking.guestEmail}</span>
                      </p>
                    )}
                  </div>
                )}

                {booking.notes && (
                  <p className="text-[11px] text-muted-foreground italic border-t border-border/40 pt-2 leading-snug">
                    "{booking.notes}"
                  </p>
                )}
              </div>
            </div>
        </div>,
        document.body,
      )
    : null;


  return (
    <>
      {bar}
      {popover}
    </>
  );
});
