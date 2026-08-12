import { format, parseISO } from 'date-fns';
import { Booking } from '@/types/hotel';

const digits = (v?: string) => (v ?? '').replace(/\D/g, '');
const at = (v?: string) => {
  const s = (v ?? '').trim();
  return s && !s.startsWith('@') ? `@${s}` : s;
};

export const fio = (b: Booking) =>
  [b.guestLastName, b.guestFirstName, b.guestMiddleName]
    .map((p) => (p ?? '').trim()).filter(Boolean).join(' ') || (b.guestName ?? '').trim();

export const residentType = (b: Booking): 'рез' | 'нерез' =>
  String((b as any).residency ?? '').toLowerCase().startsWith('res') ? 'рез' : 'нерез';

export const checkInKind = (b: Booking): 'ранний' | 'стандарт' =>
  b.checkInHalfDay || (b as any).checkInLateNight ? 'ранний' : 'стандарт';

export const checkOutKind = (b: Booking): 'поздний' | 'стандарт' =>
  b.checkOutHalfDay ? 'поздний' : 'стандарт';

export const paymentType = (b: Booking): 'нал' | 'карта' | 'перевод' => {
  const m = String((b as any).payments?.at?.(-1)?.method ?? '').toLowerCase();
  if (m.includes('card')) return 'карта';
  if (m.includes('transfer') || m.includes('bank')) return 'перевод';
  return 'нал';
};

export const totalAmount = (b: Booking): number => {
  const paid = ((b as any).payments ?? []).reduce(
    (s: number, p: any) => s + (Number(p?.amount) || 0), 0);
  return Number((b as any).price) || paid || 0;
};

export const guestKind = (b: Booking): 'офф' | 'онлайн' => {
  const c = String((b as any).bookingChannel ?? '').toLowerCase();
  return !c || c.includes('walk') || c.includes('off') ? 'офф' : 'онлайн';
};

/** payload for public.upsert_guest(...) */
export const guestArgs = (b: Booking) => ({
  p_fio: fio(b),
  p_tel: digits((b as any).phone),
  p_whats: digits((b as any).whatsapp ?? (b as any).phone),
  p_email: ((b as any).email ?? '').trim(),
  p_telega: at((b as any).telegram),
  p_inst: at((b as any).instagram),
  p_kind: guestKind(b),
});

export interface BookingRow {
  booking_uid: string;
  main_id: string;
  resident_type: 'рез' | 'нерез';
  stay_from: string;
  stay_to: string;
  guests_count: number;
  check_in: 'ранний' | 'стандарт';
  check_out: 'поздний' | 'стандарт';
  amount: number;
  payment_type: 'нал' | 'карта' | 'перевод';
  notes: string;
  room_number: string;
  room_current: number | null;
  category: string;
  status: Booking['status'];
  payload: Booking;
  updated_by?: string | null;
}

export function bookingToRow(b: Booking, mainId: string, updatedBy?: string): BookingRow {
  return {
    booking_uid: String(b.id),
    main_id: mainId,
    resident_type: residentType(b),
    stay_from: b.checkIn,
    stay_to: b.checkOut,
    guests_count: Number(b.guestCount) || 1,
    check_in: checkInKind(b),
    check_out: checkOutKind(b),
    amount: totalAmount(b),
    payment_type: paymentType(b),
    notes: String((b as any).notes ?? ''),
    room_number: String(b.roomNumber ?? ''),
    room_current: Number(b.roomNumber) || null,
    category: String((b as any).categoryId ?? ''),
    status: b.status,
    payload: b,
    updated_by: updatedBy ?? null,
  };
}

export function rowToBooking(row: Record<string, any>): Booking {
  const payload = (row.payload ?? {}) as Partial<Booking>;
  return {
    ...(payload as Booking),
    id: String(row.booking_uid),
    guestCount: Number(payload.guestCount ?? row.guests_count ?? 1),
    checkIn: String(payload.checkIn ?? row.stay_from),
    checkOut: String(payload.checkOut ?? row.stay_to),
    status: (payload.status ?? row.status) as Booking['status'],
    guestName: payload.guestName ?? String(row.guests?.fio ?? ''),
    roomNumber: Number(payload.roomNumber ?? row.room_current ?? 0),
    checkInHalfDay: payload.checkInHalfDay ?? row.check_in === 'ранний',
    checkOutHalfDay: payload.checkOutHalfDay ?? row.check_out === 'поздний',
  } as Booking;
}

export const sheetDate = (iso: string) => {
  try { return format(parseISO(iso), 'dd.MM.yy'); } catch { return iso; }
};