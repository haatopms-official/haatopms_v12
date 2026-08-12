import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Booking, BookingSegment } from '@/types/hotel';

/**
 * Per-night rate for a room category, mirroring the auto-calc used in the
 * Edit/New booking modal so a split at drag-time produces the same numbers
 * the user would have seen creating a fresh booking in that category.
 */
export function computePerNightRate(
  categoryRates: Record<string, { resident?: number[]; nonResident?: number[] } | undefined>,
  categoryId: string,
  residency: 'resident' | 'nonResident',
  guestCount: number,
): number {
  if (!categoryId) return 0;
  const arr = (categoryRates[categoryId]?.[residency] ?? []) as number[];
  if (!arr || arr.length === 0) return 0;
  const n = Math.max(1, Number(guestCount) || 1);
  const clean = arr.map((x) => Math.max(0, Number(x) || 0));
  const fallback = clean[clean.length - 1] || clean[0] || 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += clean[i] ?? fallback;
  return total;
}

/** Nights count between two yyyy-MM-dd ISO dates (half-open). Never negative. */
export function nightsBetween(fromIso: string, toIso: string): number {
  try {
    return Math.max(0, differenceInCalendarDays(parseISO(toIso), parseISO(fromIso)));
  } catch {
    return 0;
  }
}

/**
 * Build a fresh segment from parameters. Rounds the leg price to a whole
 * number (matches existing price-input rounding in the app).
 */
export function buildSegment(params: {
  roomNumber: number;
  categoryId: string;
  from: string;
  to: string;
  guestCount: number;
  perNightRate: number;
}): BookingSegment {
  const nights = nightsBetween(params.from, params.to);
  const price = Math.round(nights * params.perNightRate);
  return {
    roomNumber: params.roomNumber,
    categoryId: params.categoryId,
    from: params.from,
    to: params.to,
    nights,
    guestCount: params.guestCount,
    perNightRate: params.perNightRate,
    price,
  };
}

/** Sum of segment prices, or 0 when there are no segments. */
export function sumSegments(segments?: BookingSegment[] | null): number {
  if (!segments || segments.length === 0) return 0;
  return segments.reduce((s, seg) => s + (Number(seg.price) || 0), 0);
}

/** Recalculate segment rates/prices from the current category price table. */
export function repriceSegments(
  segments: BookingSegment[] | null | undefined,
  categoryRates: Record<string, { resident?: number[]; nonResident?: number[] } | undefined>,
  residency: 'resident' | 'nonResident',
  guestCount: number,
): BookingSegment[] {
  if (!segments || segments.length === 0) return [];
  const guests = Math.max(1, Number(guestCount) || 1);
  return segments.map((seg) => buildSegment({
    roomNumber: seg.roomNumber,
    categoryId: seg.categoryId,
    from: seg.from,
    to: seg.to,
    guestCount: guests,
    perNightRate: computePerNightRate(categoryRates, seg.categoryId, residency, guests),
  }));
}

/**
 * Split (or extend) a booking's segments at `splitDate` when the guest is
 * moved into a room of a different category mid-stay. Returns null when the
 * split is a no-op (bad date bounds).
 *
 * Behavior:
 * - No existing segments: create two — original room from checkIn→splitDate,
 *   new room from splitDate→checkOut.
 * - Existing segments: clip the last segment to end at splitDate (recomputing
 *   its price) and append a new segment for the new room from splitDate→checkOut.
 */
export function splitBookingAt(params: {
  booking: Booking;
  splitDate: string;
  newRoomNumber: number;
  newCategoryId: string;
  oldCategoryId: string;
  residency: 'resident' | 'nonResident';
  categoryRates: Record<string, { resident?: number[]; nonResident?: number[] } | undefined>;
}): BookingSegment[] | null {
  const { booking, splitDate, newRoomNumber, newCategoryId, oldCategoryId, residency, categoryRates } = params;
  const checkIn = booking.checkIn;
  const checkOut = booking.checkOut;
  if (!checkIn || !checkOut) return null;
  // Clamp split date strictly inside [checkIn, checkOut] so both legs have >= 1 night.
  const maxSplitDays = nightsBetween(checkIn, checkOut) - 1;
  if (maxSplitDays < 1) return null;
  const splitNights = nightsBetween(checkIn, splitDate);
  const clampedNights = Math.min(Math.max(splitNights, 1), maxSplitDays);
  const boundary = (() => {
    const d = parseISO(checkIn);
    d.setDate(d.getDate() + clampedNights);
    return d.toISOString().slice(0, 10);
  })();

  const guestCount = Math.max(1, booking.guestCount || 1);
  const existing = booking.segments ? [...booking.segments] : null;

  const rateFor = (categoryId: string) => computePerNightRate(categoryRates, categoryId, residency, guestCount);

  const newSegment = buildSegment({
    roomNumber: newRoomNumber,
    categoryId: newCategoryId,
    from: boundary,
    to: checkOut,
    guestCount,
    perNightRate: rateFor(newCategoryId),
  });

  if (!existing) {
    const oldSegment = buildSegment({
      roomNumber: booking.roomNumber,
      categoryId: oldCategoryId,
      from: checkIn,
      to: boundary,
      guestCount,
      perNightRate: rateFor(oldCategoryId),
    });
    return [oldSegment, newSegment];
  }

  const clipped: BookingSegment[] = [];
  for (const seg of existing) {
    if (seg.to <= boundary) {
      clipped.push(buildSegment({
        roomNumber: seg.roomNumber,
        categoryId: seg.categoryId,
        from: seg.from,
        to: seg.to,
        guestCount,
        perNightRate: rateFor(seg.categoryId),
      }));
      continue;
    }
    if (seg.from >= boundary) continue;
    clipped.push(buildSegment({
      roomNumber: seg.roomNumber,
      categoryId: seg.categoryId,
      from: seg.from,
      to: boundary,
      guestCount,
      perNightRate: rateFor(seg.categoryId),
    }));
  }
  clipped.push(newSegment);
  return clipped;
}

/**
 * Compute the split-boundary date for a mid-stay room/category change based
 * on the current local time.
 *
 * Rule: after 11:59 (i.e. >= 12:00 noon) the current calendar day counts as
 * a fully consumed stay-day, so the boundary rolls forward to tomorrow.
 * Before noon it stays on today (guest hasn't consumed today yet).
 *
 * Early check-in / late check-out flags shift the threshold on the
 * relevant edge day:
 *  - checkInHalfDay + today == checkIn  → threshold moves to 08:00 (guest
 *    already arrived early, so day counts from 08:00 onward).
 *  - checkOutHalfDay + today == checkOut → threshold moves to 18:00 (late
 *    check-out; day still counted until the extended noon+ window).
 *
 * The returned date is always clamped inside (checkIn, checkOut) — the
 * split needs at least one night on each side. `splitBookingAt` also
 * clamps, this just keeps the rollover consistent with what the UI shows.
 */
export function computeSplitDateNow(booking: {
  checkIn: string;
  checkOut: string;
  checkInHalfDay?: boolean;
  checkOutHalfDay?: boolean;
}, now: Date = new Date()): string {
  const todayIso = format(now, 'yyyy-MM-dd');
  const hour = now.getHours() + now.getMinutes() / 60;

  // Default rollover threshold: noon.
  let threshold = 12;
  if (booking.checkInHalfDay && todayIso === booking.checkIn) threshold = 8;
  else if (booking.checkOutHalfDay && todayIso === booking.checkOut) threshold = 18;

  let boundary = todayIso;
  if (hour >= threshold) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    boundary = format(d, 'yyyy-MM-dd');
  }

  // Clamp inside (checkIn, checkOut) so both legs get >= 1 night.
  if (boundary <= booking.checkIn) {
    const d = parseISO(booking.checkIn);
    d.setDate(d.getDate() + 1);
    boundary = format(d, 'yyyy-MM-dd');
  }
  if (boundary >= booking.checkOut) {
    const d = parseISO(booking.checkOut);
    d.setDate(d.getDate() - 1);
    boundary = format(d, 'yyyy-MM-dd');
  }
  return boundary;
}
