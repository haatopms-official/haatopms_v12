import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { Booking, ROOM_CATEGORIES, RoomCategory, generateRooms } from '@/types/hotel';

/** Room number -> category id (101..105 = standard-double, 201.. = standard-twin, ...) */
const ROOM_TO_CATEGORY = new Map<number, RoomCategory>(
  generateRooms().map((r) => [r.number, r.category] as const),
);

export function categoryLabel(catId: string | undefined): string {
  const cat = ROOM_CATEGORIES.find((c) => c.id === catId);
  return cat ? cat.label.en : (catId ?? '');
}

export function categoryOfRoom(room: number | undefined): string {
  if (!room) return '';
  return categoryLabel(ROOM_TO_CATEGORY.get(room));
}

function nightsOf(from: string, to: string): number {
  try {
    return Math.max(1, differenceInCalendarDays(parseISO(to), parseISO(from)));
  } catch {
    return 1;
  }
}

/** "101" or "101(3d) -- 204(3d)" */
export function buildRoomNumberCell(b: Booking): string {
  const segs = b.segments ?? [];
  if (segs.length > 1) {
    return segs
      .map((s) => `${s.roomNumber}(${s.nights || nightsOf(s.from, s.to)}d)`)
      .join(' -- ');
  }
  return String(b.roomNumber ?? '');
}

/** "Standard Double" or "Standard Double(3d) -- Deluxe Twin(3d)" */
export function buildCategoryCell(b: Booking): string {
  const segs = b.segments ?? [];
  if (segs.length > 1) {
    return segs
      .map((s) => {
        const label = categoryLabel(s.categoryId) || categoryOfRoom(s.roomNumber);
        return `${label}(${s.nights || nightsOf(s.from, s.to)}d)`;
      })
      .join(' -- ');
  }
  return categoryOfRoom(b.roomNumber);
}

/** "Kambaraliyev Azizbek" */
export function buildFamNam(b: Booking): string {
  const parts = [b.guestLastName, b.guestFirstName, b.guestMiddleName]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' ') : (b.guestName ?? '').trim();
}

/** "11.02.2026 - 15.02.2026" */
export function buildResidement(b: Booking): string {
  const fmt = (iso: string) => {
    try { return format(parseISO(iso), 'dd.MM.yyyy'); } catch { return iso; }
  };
  return `${fmt(b.checkIn)} - ${fmt(b.checkOut)}`;
}

export interface BookingRow {
  booking_uid: string;
  no?: number;
  bkng_id?: string;
  fam_nam: string;
  guest_last_name: string;
  guest_first_name: string;
  guest_middle_name: string;
  category: string;
  room_number: string;
  room_current: number | null;
  guests: number;
  residement: string;
  check_in_date: string;
  check_out_date: string;
  check_in: 'early' | 'standard';
  check_out: 'late' | 'standard';
  status: Booking['status'];
  payload: Booking;
  updated_by?: string | null;
}

/** Booking (frontend) -> bookings row (Supabase) */
export function bookingToRow(b: Booking, updatedBy?: string): BookingRow {
  return {
    booking_uid: String(b.id),
    fam_nam: buildFamNam(b),
    guest_last_name: (b.guestLastName ?? '').trim(),
    guest_first_name: (b.guestFirstName ?? '').trim(),
    guest_middle_name: (b.guestMiddleName ?? '').trim(),
    category: buildCategoryCell(b),
    room_number: buildRoomNumberCell(b),
    room_current: Number(b.roomNumber) || null,
    guests: Number(b.guestCount) || 1,
    residement: buildResidement(b),
    check_in_date: b.checkIn,
    check_out_date: b.checkOut,
    check_in: b.checkInHalfDay ? 'early' : 'standard',
    check_out: b.checkOutHalfDay ? 'late' : 'standard',
    status: b.status,
    payload: b,
    updated_by: updatedBy ?? null,
  };
}

/** bookings row (Supabase) -> Booking (frontend) */
export function rowToBooking(row: Record<string, unknown>): Booking {
  const payload = (row['payload'] ?? {}) as Partial<Booking>;
  return {
    ...(payload as Booking),
    id: String(row['booking_uid']),
    roomNumber: Number(payload.roomNumber ?? row['room_current'] ?? 0),
    guestCount: Number(payload.guestCount ?? row['guests'] ?? 1),
    checkIn: String(payload.checkIn ?? row['check_in_date']),
    checkOut: String(payload.checkOut ?? row['check_out_date']),
    status: (payload.status ?? row['status']) as Booking['status'],
    guestName: payload.guestName ?? String(row['fam_nam'] ?? ''),
    guestLastName: payload.guestLastName ?? String(row['guest_last_name'] ?? ''),
    guestFirstName: payload.guestFirstName ?? String(row['guest_first_name'] ?? ''),
    guestMiddleName: payload.guestMiddleName ?? String(row['guest_middle_name'] ?? ''),
    checkInHalfDay: payload.checkInHalfDay ?? row['check_in'] === 'early',
    checkOutHalfDay: payload.checkOutHalfDay ?? row['check_out'] === 'late',
  } as Booking;
}