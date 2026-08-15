import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatPrice, formatInputNumber, parseInputNumber } from '@/lib/formatPrice';

// One-time cleanup, module scope so it runs at most once per page load
// (not once per dialog open): wipes any leftover drafts from the old,
// unversioned "booking-draft:" key format written by earlier builds,
// before the isDirty gate existed. Without this they'd sit in the
// browser forever as harmless but permanent dead storage.
let legacyDraftsCleaned = false;
function cleanupLegacyDrafts() {
  if (legacyDraftsCleaned) return;
  legacyDraftsCleaned = true;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('booking-draft:')) toRemove.push(k);
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // best-effort only
  }
}

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { LogOut as LogOutIcon } from 'lucide-react';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Booking, type BookingStatus, BOOKING_STATUSES, isRoomDirty } from '@/types/hotel';
import { useBookingsContext } from '@/hooks/BookingsContext';
import {
  UserPlus, Edit, Trash2, Clock, CalendarDays, Users, Phone, Mail, StickyNote,
  MessageCircle, Send, Instagram, ClipboardSignature, Sparkles, ArrowRight,
  Sunrise, Moon, X, BedDouble, Check, DollarSign,
} from 'lucide-react';
import { useI18n } from '@/hooks/useI18n';
import { toast } from 'sonner';
import { differenceInCalendarDays, parseISO, format, addDays, isBefore, startOfDay } from 'date-fns';
import { HotelGuestAnketaModal } from './HotelGuestAnketaModal';
import { GuestDetailsWindow } from './GuestDetailsWindow';
import { DeleteBookingModal } from './DeleteBookingModal';
import { HotelDatePicker } from './HotelDatePicker';
import { validateContactBundle, isValidEmail, isValidPhone, isValidHandle } from '@/lib/contactValidation';
import { computePerNightRate, repriceSegments, sumSegments } from '@/lib/bookingPricing';
import { HotelReceiptModal } from './HotelReceiptModal';
import { Receipt } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useHotelGrid } from '@/hooks/HotelGridContext';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UnsavedCloseWarning } from './UnsavedCloseWarning';
import { useSharedNamespace } from '@/hooks/useSharedNamespace';


const nextDay = (iso: string) => format(addDays(parseISO(iso), 1), 'yyyy-MM-dd');
const prevDay = (iso: string) => format(addDays(parseISO(iso), -1), 'yyyy-MM-dd');

interface BookingDialogProps {
  open: boolean; onClose: () => void;
  onSave: (booking: Booking) => boolean | void;
  onUpdate?: (id: string, updates: Partial<Booking>) => boolean | void;
  onDelete?: (id: string) => void;
  roomNumber: number; checkIn: string; checkOut: string;
  editBooking?: Booking | null;
  bedIndex?: number;
  prefillName?: string;
  initialEarlyCheckin?: boolean;
  initialLateCheckout?: boolean;
  extraGuestSlots?: number;
  /** When true, renders the dialog as a read-only viewer:
   *  inputs / interactive controls are locked and the action buttons
   *  (Save / Update / Delete / lifecycle) are hidden. Used by Superuser
   *  analytics screens where bookings should be inspected but not modified. */
  readOnly?: boolean;
}

export function BookingDialog({
  open, onClose, onSave, onUpdate, onDelete, roomNumber, checkIn, checkOut, editBooking, bedIndex, prefillName,
  initialEarlyCheckin = false, initialLateCheckout = false, extraGuestSlots = 0, readOnly = false,
}: BookingDialogProps) {

  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { rooms, categories, categoryRates, setCategoryRate } = useHotelGrid();
  const { bookings: allBookings } = useBookingsContext();
  const isAdminOnly = user?.role === 'admin';
  const isManagerOnly = user?.role === 'manager';
  const isSuperuser = user?.role === 'superuser';
  const canBackdate = isSuperuser;
  const roomCategoryId = useMemo(() => rooms.find(r => r.number === roomNumber)?.category, [rooms, roomNumber]);
  const roomCategory = useMemo(() => categories.find(c => c.id === roomCategoryId), [categories, roomCategoryId]);
  const categoryMaxGuests = Math.max(1, roomCategory?.maxGuests ?? 1);
  const effectiveMaxGuests = Math.max(categoryMaxGuests, categoryMaxGuests + Math.max(0, extraGuestSlots));
  const [residency, setResidency] = useState<'resident' | 'nonResident'>(editBooking?.residency ?? 'resident');
  useEffect(() => { setResidency(editBooking?.residency ?? 'resident'); }, [editBooking, open]);
  const emptyArr = useMemo(() => Array.from({ length: categoryMaxGuests }, () => 0), [categoryMaxGuests]);
  const categoryRateObj = roomCategoryId
    ? (categoryRates[roomCategoryId] ?? { resident: emptyArr, nonResident: emptyArr })
    : { resident: emptyArr, nonResident: emptyArr };
  const categoryRateArr: number[] = (categoryRateObj[residency] ?? emptyArr) as number[];
  // Per-night room price = sum of per-guest prices for the first `guestCount` guests.
  const categoryLabel = useMemo(() => {
    const c = categories.find(c => c.id === roomCategoryId);
    return c ? c.short || c.label[lang] || c.label.en : '';
  }, [categories, roomCategoryId, lang]);
  const [managerRateInputs, setManagerRateInputs] = useState<string[]>([]);
  useEffect(() => {
    if (isManagerOnly) {
      setManagerRateInputs(
        Array.from({ length: categoryMaxGuests }, (_, i) => {
          const v = categoryRateArr[i];
          return v && v > 0 ? String(v) : '';
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagerOnly, roomCategoryId, residency, categoryMaxGuests, open]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [earlyCheckoutConfirm, setEarlyCheckoutConfirm] = useState<null | {
    safeOut: string;
    nextStatus: BookingStatus | null;
    /**
     * true  → the manual early check-out was pressed AFTER 12:00, so the
     *         booking bar occupies the SECOND half of the day cell (12:01+).
     * false → pressed at or before 12:00, occupies only the FIRST half.
     * Auto-derived from the moment the operator triggers early check-out.
     */
    halfDay: boolean;
    triggeredAt: string; // HH:mm — surfaced in the confirm dialog for context.
  }>(null);

  const [firstName, setFirstName] = useState('');
  const [warnOpen, setWarnOpen] = useState(false);
  const initialSnapshotRef = useRef<string>('');
  const latestSnapshotRef = useRef<string>('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestWhatsapp, setGuestWhatsapp] = useState('');
  const [guestTelegram, setGuestTelegram] = useState('');
  const [guestInstagram, setGuestInstagram] = useState('');
  const [guestCount, setGuestCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [inDate, setInDate] = useState(checkIn);
  const [outDate, setOutDate] = useState(checkOut);
  const [status, setStatus] = useState<BookingStatus>('booked');
  const [earlyCheckin, setEarlyCheckin] = useState(false);
  const [lateCheckout, setLateCheckout] = useState(false);
  const [price, setPrice] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paymentTiming, setPaymentTiming] = useState<'full_now' | 'half_now' | 'quarter_now' | 'after_checkout'>('full_now');
  /** Total amount (Общая сумма) — entered/locked by admin. */
  const [paymentAmount, setPaymentAmount] = useState('');
  /** Сумма к внесению — what the guest hands over right now. */
  const [paymentInput, setPaymentInput] = useState('');
  /** Installment history persisted on the booking. */
  const [payments, setPayments] = useState<NonNullable<Booking['payments']>>([]);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [receiptGlow, setReceiptGlow] = useState(false);
  const [fullyPaidOverlay, setFullyPaidOverlay] = useState(false);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const overlayTimerRef = useRef<number | null>(null);
  const triggerFullyPaidOverlay = useCallback(() => {
    if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
    setFullyPaidOverlay(true);
    overlayTimerRef.current = window.setTimeout(() => setFullyPaidOverlay(false), 5000);
  }, []);
  useEffect(() => () => {
    if (overlayTimerRef.current) window.clearTimeout(overlayTimerRef.current);
  }, []);
  const lastNameRef = useRef<HTMLInputElement | null>(null);
  const [surnameGlow, setSurnameGlow] = useState(false);
  useEffect(() => {
    if (!open) { setSurnameGlow(false); return; }
    const focusTimer = setTimeout(() => {
      lastNameRef.current?.focus();
      setSurnameGlow(true);
    }, 180);
    const offTimer = setTimeout(() => setSurnameGlow(false), 1600);
    return () => { clearTimeout(focusTimer); clearTimeout(offTimer); };
  }, [open]);
  const [anketaOpen, setAnketaOpen] = useState(false);
  const [guestDetailsOpen, setGuestDetailsOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const isCheckedOut = editBooking?.status === 'checked-out';

  useEffect(() => {
    if (editBooking) {
      // Prefer structured name fields (source of truth). Fall back to splitting
      // the legacy denormalized `guestName` ONLY for bookings created before
      // the split — and even then we put everything into firstName so we don't
      // silently scatter user input across surname/middle name.
      const hasStructured =
        editBooking.guestLastName !== undefined ||
        editBooking.guestFirstName !== undefined ||
        editBooking.guestMiddleName !== undefined;
      if (hasStructured) {
        setLastName(editBooking.guestLastName || '');
        setFirstName(editBooking.guestFirstName || '');
        setMiddleName(editBooking.guestMiddleName || '');
      } else {
        const raw = (editBooking.guestName || '').trim();
        setLastName('');
        setFirstName(raw);
        setMiddleName('');
      }
      setGuestPhone(editBooking.guestPhone);
      setGuestEmail(editBooking.guestEmail);
      setGuestWhatsapp(editBooking.guestWhatsapp || '');
      setGuestTelegram(editBooking.guestTelegram || '');
      setGuestInstagram(editBooking.guestInstagram || '');
      setGuestCount(editBooking.guestCount);
      setNotes(editBooking.notes);
      setInDate(editBooking.checkIn);
      setOutDate(editBooking.checkOut);
      setStatus(editBooking.status);
      setEarlyCheckin(!!editBooking.checkInHalfDay);
      setLateCheckout(!!editBooking.checkOutHalfDay);
      setPrice(editBooking.price !== undefined ? String(editBooking.price) : '');
      setPaymentType(editBooking.paymentType || 'cash');
      setPaymentTiming(editBooking.paymentTiming || 'full_now');
      setPaymentAmount(editBooking.paymentAmount !== undefined ? String(editBooking.paymentAmount) : (editBooking.price !== undefined ? String(editBooking.price) : ''));
      setPayments(Array.isArray(editBooking.payments) ? editBooking.payments : []);
      setPaymentInput('');
      setPaymentConfirmed(!!editBooking.paymentConfirmed);
    } else {
      // For new bookings, drop the prefill into firstName as a single token —
      // never split by spaces (would corrupt multi-word names like "baxtiyor ogli").
      setFirstName((prefillName || '').trim());
      setMiddleName('');
      setLastName('');
      setGuestPhone(''); setGuestEmail('');
      setGuestWhatsapp(''); setGuestTelegram(''); setGuestInstagram('');
      // Clamp the seeded check-in to today for non-superuser roles so a stale
      // cell click cannot produce a booking starting before the current date.
      // Superusers are allowed to back-date bookings.
      const todayLocal = startOfDay(new Date());
      const seedIn = !canBackdate && checkIn && isBefore(parseISO(checkIn), todayLocal) ? format(todayLocal, 'yyyy-MM-dd') : checkIn;
      const seedOutBase = checkOut && parseISO(checkOut) <= parseISO(seedIn) ? format(addDays(parseISO(seedIn), 1), 'yyyy-MM-dd') : checkOut;
      setGuestCount(1); setNotes(''); setInDate(seedIn); setOutDate(seedOutBase); setStatus('booked');
      setEarlyCheckin(initialEarlyCheckin);
      setLateCheckout(initialLateCheckout);
      setPrice('');
      setPaymentType('cash');
      setPaymentTiming('full_now');
      setPaymentAmount('');
      setPaymentInput('');
      setPayments([]);
      setPaymentConfirmed(false);
    }
  }, [editBooking, checkIn, checkOut, open, prefillName, initialEarlyCheckin, initialLateCheckout]);

  // ─────────── Live sync of the surname/name/middle-name fields with the
  // shared passport record (backed by the same `hotel_app_state` engine that
  // Guest Details and the Anketa modal use). This makes edits made in Guest
  // Details (Паспортные данные) appear here in the main filling area
  // immediately, and vice versa — the three panels always show the same
  // canonical name.
  const { map: passportMap, setRecord: setPassportRecord } = useSharedNamespace('passports', 'sayohat-passport-changed');
  const passportSlice = editBooking
    ? (passportMap[editBooking.id] as Record<string, string> | undefined)
    : undefined;
  const pLast = (passportSlice?.lastName ?? '').toString();
  const pFirst = (passportSlice?.firstName ?? '').toString();
  const pMiddle = (passportSlice?.middleName ?? '').toString();

  // Passport → main fields. Non-empty passport values overwrite locals so
  // saving in Guest Details is reflected here without reopening the dialog.
  useEffect(() => {
    if (!open || !editBooking) return;
    if (pLast.trim() && pLast !== lastName) setLastName(pLast);
    if (pFirst.trim() && pFirst !== firstName) setFirstName(pFirst);
    if (pMiddle.trim() && pMiddle !== middleName) setMiddleName(pMiddle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editBooking?.id, pLast, pFirst, pMiddle]);

  // Main fields → passport. Push edits made here into the shared record so
  // Guest Details and Anketa see them the next time they read.
  useEffect(() => {
    if (!open || !editBooking) return;
    const current = (passportMap[editBooking.id] as Record<string, string> | undefined) || {};
    const nl = lastName.trim();
    const nf = firstName.trim();
    const nm = middleName.trim();
    if ((current.lastName ?? '') === nl
      && (current.firstName ?? '') === nf
      && (current.middleName ?? '') === nm) return;
    setPassportRecord(editBooking.id, { ...current, lastName: nl, firstName: nf, middleName: nm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editBooking?.id, lastName, firstName, middleName]);

  const dayDiff = inDate && outDate ? differenceInCalendarDays(parseISO(outDate), parseISO(inDate)) : 0;
  const todayISO = format(startOfDay(new Date()), 'yyyy-MM-dd');
  // Block past dates in the check-in picker for admin/manager. Superusers may
  // back-date bookings (analytics / retroactive entries).
  const minCheckIn = canBackdate ? undefined : todayISO;
  const halfAdj = (earlyCheckin ? 0.5 : 0) + (lateCheckout ? 0.5 : 0);
  const nightsDisplay = dayDiff + halfAdj;
  const checkInTime = earlyCheckin ? '08:00' : '14:00';
  const checkOutTime = lateCheckout ? '24:00' : '12:00';

  const fullName = useMemo(
    () => [lastName.trim(), firstName.trim(), middleName.trim()].filter(Boolean).join(' '),
    [lastName, firstName, middleName],
  );
  const initials = useMemo(() => {
    const a = (firstName.trim()[0] || '').toUpperCase();
    const b = (lastName.trim()[0] || '').toUpperCase();
    return (a + b) || (a || '•');
  }, [firstName, lastName]);
  const guestMultiplier = Math.max(1, Number(guestCount) || 1);
  // Per-night room price = guest count × the category's per-guest prices.
  const perNightRate = useMemo(() => {
    if (!roomCategoryId) return 0;
    return computePerNightRate(categoryRates, roomCategoryId, residency, guestMultiplier);
  }, [categoryRates, roomCategoryId, residency, guestMultiplier]);
  // Hold-and-drop segments: when an in-house booking was moved mid-stay to a
  // different category, the receipt/payment total must be the SUM of each leg
  // (nights lived in old category × old per-night rate) + (nights in new
  // category × new per-night rate). Each segment already stores its snapshotted
  // per-night rate and price, so we just sum them.
  const segmentsList = useMemo(
    () => repriceSegments(editBooking?.segments, categoryRates, residency, guestMultiplier),
    [editBooking?.segments, categoryRates, residency, guestMultiplier],
  );
  const hasSegments = segmentsList.length > 0;
  const segmentsTotal = hasSegments ? sumSegments(segmentsList) : 0;
  const segmentCategoryLabel = useCallback((catId: string) => {
    const c = categories.find(cc => cc.id === catId);
    return c ? (c.short || c.label[lang] || c.label.en) : catId;
  }, [categories, lang]);
  const computedPaymentTotal = hasSegments
    ? segmentsTotal
    : (perNightRate > 0 ? Math.round(nightsDisplay * perNightRate) : 0);
  const paymentTypeLabel = ({ cash: 'Наличные', card: 'Карта', transfer: 'Перечисление' } as const)[paymentType];
  const paymentTimingLabel = ({ full_now: '100% сразу', half_now: '50% сразу', quarter_now: '25% сразу', after_checkout: 'После выезда' } as const)[paymentTiming];
  /** Effective total — what we compare paid sum against. Live-recomputes when guest count or rate changes. */
  const effectiveTotal = useMemo(() => {
    if (hasSegments) return segmentsTotal;
    if (computedPaymentTotal > 0) return computedPaymentTotal;
    const parsed = Number(paymentAmount);
    if (paymentAmount.trim() && Number.isFinite(parsed) && parsed > 0) return Math.max(0, parsed);
    if (editBooking?.price !== undefined) return editBooking.price;
    const p = Number(price);
    return price.trim() && Number.isFinite(p) ? Math.max(0, p) : 0;
  }, [hasSegments, segmentsTotal, paymentAmount, editBooking?.price, computedPaymentTotal, price]);
  const paidSum = useMemo(() => payments.reduce((s, p) => s + (Number(p.amount) || 0), 0), [payments]);
  const remainingAmount = Math.max(0, effectiveTotal - paidSum);
  const isFullyPaid = effectiveTotal > 0 && paidSum >= effectiveTotal;
  // Keep `paymentConfirmed` synced with payment progress (no overlay side-effects here —
  // the "Полностью оплачено" overlay is fired exactly once, from the Оплатить click handler,
  // at the moment the booking transitions to fully paid).
  useEffect(() => {
    setPaymentConfirmed(isFullyPaid);
  }, [isFullyPaid]);
  const displayedPaymentAmount = effectiveTotal > 0
    ? String(effectiveTotal)
    : (paymentAmount.trim() || price.trim() || (computedPaymentTotal ? String(computedPaymentTotal) : '0'));

  const currentSnapshot = useMemo(
    () => JSON.stringify({
      residency,
      firstName,
      lastName,
      middleName,
      guestPhone,
      guestEmail,
      guestWhatsapp,
      guestTelegram,
      guestInstagram,
      guestCount,
      notes,
      inDate,
      outDate,
      status,
      earlyCheckin,
      lateCheckout,
      price,
      paymentType,
      paymentTiming,
      paymentAmount,
      paymentInput,
      payments,
      paymentConfirmed,
    }),
    [residency, firstName, lastName, middleName, guestPhone, guestEmail, guestWhatsapp, guestTelegram, guestInstagram, guestCount, notes, inDate, outDate, status, earlyCheckin, lateCheckout, price, paymentType, paymentTiming, paymentAmount, paymentInput, payments, paymentConfirmed],
  );
  latestSnapshotRef.current = currentSnapshot;

  // isDirty must be computed here, BEFORE the local-draft block below,
  // because that block references it (both directly and inside a hook
  // dependency array). Declaring `isDirty` further down the file — as a
  // previous edit mistakenly did — caused a genuine JS temporal-dead-zone
  // crash ("Cannot access 'isDirty' before initialization") on every
  // render, which is what took the whole page down. initialSnapshotRef is
  // updated by the effect further below; reading it here is safe since
  // refs don't have a TDZ.
  const isDirty = open && initialSnapshotRef.current !== '' && currentSnapshot !== initialSnapshotRef.current;

  // ---------------- LOCAL DRAFT (crash/refresh safety net) ----------------
  // Requirement: nothing is written to the database while the user is
  // typing — only on Save. But if the tab is closed/crashes/refreshes
  // mid-edit, the in-progress text should not be lost. So while the dialog
  // is open we mirror the draft into localStorage (never to Supabase), and
  // on open we restore from it if present. The draft is deleted the moment
  // a real save succeeds, or when the user explicitly discards changes.
  const draftKey = useMemo(
    // v2: versioned prefix. Older builds (before the isDirty gate existed)
    // could have written a stale draft under the old "booking-draft:" key
    // for this same booking — that old entry has no reliable way to be
    // told apart from a real unsaved draft just by comparing content, so
    // instead we simply stop reading that old key namespace entirely by
    // moving to "booking-draft-v2:". Old leftover entries become orphaned
    // and are never looked at again, which is what actually stops the
    // "restored a draft" toast from firing on a booking nobody is
    // currently mid-edit on.
    () => `booking-draft-v2:${editBooking?.id ?? `new:${roomNumber}:${bedIndex ?? 'x'}`}`,
    [editBooking?.id, roomNumber, bedIndex],
  );
  const draftRestoredRef = useRef(false);

  useEffect(() => { cleanupLegacyDrafts(); }, []);

  // Restore a pending draft once, right after the dialog opens and the
  // normal booking fields have hydrated (same timing as the baseline effect
  // below), so the draft always wins over the freshly-loaded booking data.
  // IMPORTANT: only restore (and only toast) if the draft actually differs
  // from what was just freshly loaded — otherwise a harmless leftover draft
  // (e.g. written once by mistake, or from before this guard existed) would
  // re-trigger the "restored a draft" toast every single time this booking
  // is opened, even with nothing actually unsaved. That was the bug.
  useEffect(() => {
    if (!open) { draftRestoredRef.current = false; return; }
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      if (raw === latestSnapshotRef.current) {
        // draft is identical to the freshly-loaded booking — nothing was
        // ever actually unsaved, just clean up the stale entry and stop.
        window.localStorage.removeItem(draftKey);
        return;
      }
      const draft = JSON.parse(raw) as Partial<{
        residency: 'resident' | 'nonResident'; firstName: string; lastName: string; middleName: string;
        guestPhone: string; guestEmail: string; guestWhatsapp: string; guestTelegram: string; guestInstagram: string;
        guestCount: number; notes: string; inDate: string; outDate: string; status: BookingStatus;
        earlyCheckin: boolean; lateCheckout: boolean; price: string;
        paymentType: string; paymentTiming: string; paymentAmount: string; paymentInput: string;
      }>;
      if (draft.residency !== undefined) setResidency(draft.residency);
      if (draft.firstName !== undefined) setFirstName(draft.firstName);
      if (draft.lastName !== undefined) setLastName(draft.lastName);
      if (draft.middleName !== undefined) setMiddleName(draft.middleName);
      if (draft.guestPhone !== undefined) setGuestPhone(draft.guestPhone);
      if (draft.guestEmail !== undefined) setGuestEmail(draft.guestEmail);
      if (draft.guestWhatsapp !== undefined) setGuestWhatsapp(draft.guestWhatsapp);
      if (draft.guestTelegram !== undefined) setGuestTelegram(draft.guestTelegram);
      if (draft.guestInstagram !== undefined) setGuestInstagram(draft.guestInstagram);
      if (draft.guestCount !== undefined) setGuestCount(draft.guestCount);
      if (draft.notes !== undefined) setNotes(draft.notes);
      if (draft.inDate !== undefined) setInDate(draft.inDate);
      if (draft.outDate !== undefined) setOutDate(draft.outDate);
      if (draft.status !== undefined) setStatus(draft.status);
      if (draft.earlyCheckin !== undefined) setEarlyCheckin(draft.earlyCheckin);
      if (draft.lateCheckout !== undefined) setLateCheckout(draft.lateCheckout);
      if (draft.price !== undefined) setPrice(draft.price);
      if (draft.paymentType !== undefined) setPaymentType(draft.paymentType as typeof paymentType);
      if (draft.paymentTiming !== undefined) setPaymentTiming(draft.paymentTiming as typeof paymentTiming);
      if (draft.paymentAmount !== undefined) setPaymentAmount(draft.paymentAmount);
      if (draft.paymentInput !== undefined) setPaymentInput(draft.paymentInput);
      toast.message(lang === 'ru' ? 'Восстановлен несохранённый черновик' : 'Restored an unsaved draft');
    } catch {
      // corrupt/old draft — ignore it silently
      window.localStorage.removeItem(draftKey);
    }
  }, [open, draftKey, lang]);

  // Mirror field changes into localStorage ONLY (never to the server) —
  // but ONLY once the user has actually changed something (isDirty).
  // Writing unconditionally on every open (the old behavior) created a
  // fresh no-op draft for every booking you merely looked at, which is
  // what caused the restore-toast above to fire on every single open.
  useEffect(() => {
    if (!open || !isDirty) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, currentSnapshot);
      } catch {
        // localStorage full/unavailable — draft safety net is best-effort only
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, isDirty, draftKey, currentSnapshot]);

  const clearDraft = useCallback(() => {
    try { window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, [draftKey]);
  // -------------- END LOCAL DRAFT --------------

  const rebaselineSnapshotSoon = useCallback(() => {
    window.setTimeout(() => {
      initialSnapshotRef.current = latestSnapshotRef.current;
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) {
      setWarnOpen(false);
      initialSnapshotRef.current = '';
      return;
    }
    setWarnOpen(false);
    const timer = window.setTimeout(() => {
      initialSnapshotRef.current = latestSnapshotRef.current;
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, editBooking?.id]);

  const requestClose = useCallback(() => {
    if (!readOnly && isDirty) {
      setWarnOpen(true);
      return;
    }
    // Nothing unsaved (isDirty is false) — safe to also wipe any leftover
    // draft for this booking so it can't resurrect a stale toast next open.
    try { window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
    onClose();
  }, [isDirty, onClose, readOnly, draftKey]);

  const handleSave = (statusOverride?: BookingStatus, overrides?: { checkOut?: string; checkOutHalfDay?: boolean }) => {
    if (!fullName || !inDate || !outDate) return;
    const effectiveOutForValidation = overrides?.checkOut ?? outDate;
    const dayDiffEffective = differenceInCalendarDays(parseISO(effectiveOutForValidation), parseISO(inDate));
    if (dayDiffEffective <= 0) {
      toast.error(lang === 'ru' ? 'Дата выезда должна быть позже даты заезда' : "Chiqish sanasi kirish sanasidan keyin bo'lishi kerak");
      return;
    }
    const contactError = validateContactBundle({ phone: guestPhone, whatsapp: guestWhatsapp, email: guestEmail, telegram: guestTelegram, instagram: guestInstagram });
    if (contactError) {
      toast.error(contactError.message);
      return;
    }
    // Snap a brand-new booking's check-in forward to today if it somehow
    // ended up earlier — this prevents off-by-one bookings being persisted.
    let effectiveIn = inDate;
    let effectiveOut = overrides?.checkOut ?? outDate;
    const effectiveLateCheckout = overrides?.checkOutHalfDay ?? lateCheckout;
    if (!editBooking && !canBackdate) {
      const todayLocal = startOfDay(new Date());
      if (isBefore(parseISO(effectiveIn), todayLocal)) {
        const shift = differenceInCalendarDays(todayLocal, parseISO(effectiveIn));
        effectiveIn = format(todayLocal, 'yyyy-MM-dd');
        effectiveOut = format(addDays(parseISO(effectiveOut), shift), 'yyyy-MM-dd');
        setInDate(effectiveIn);
        setOutDate(effectiveOut);
      }
    }
    const finalStatus = statusOverride ?? status;
    const nameFields = {
      guestLastName: lastName.trim(),
      guestFirstName: firstName.trim(),
      guestMiddleName: middleName.trim(),
    };
    const parsedPrice = Number(price);
    const manualPrice = price.trim() && Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : undefined;
    const parsedPayment = Number(paymentAmount);
    const cleanPaymentAmount = effectiveTotal > 0
      ? effectiveTotal
      : (paymentAmount.trim() && Number.isFinite(parsedPayment) ? Math.max(0, parsedPayment) : undefined);
    // Admin auto-calculates from the current category rate, but only for NEW bookings.
    // Existing bookings keep their snapshotted price so a later manager rate change
    // does not retroactively rewrite past/current bookings.
    const adminTotal = perNightRate > 0 ? Math.round(nightsDisplay * perNightRate) : undefined;
    const cleanPrice = isAdminOnly
      ? (effectiveTotal > 0 ? effectiveTotal : (editBooking?.price !== undefined ? editBooking.price : adminTotal))
      : isManagerOnly
        ? (effectiveTotal > 0 ? effectiveTotal : editBooking?.price)
        : manualPrice;
    if (editBooking && onUpdate) {
      const ok = onUpdate(editBooking.id, {
        guestName: fullName, ...nameFields,
        guestPhone, guestEmail, guestWhatsapp, guestTelegram, guestInstagram,
        guestCount, checkIn: effectiveIn, checkOut: effectiveOut, notes, status: finalStatus,
        checkInHalfDay: earlyCheckin, checkOutHalfDay: effectiveLateCheckout, price: cleanPrice,
        paymentType, paymentTiming, paymentAmount: cleanPaymentAmount, paymentConfirmed,
        payments, residency, ...(hasSegments ? { segments: segmentsList, price: segmentsTotal, paymentAmount: segmentsTotal } : {}),
        paymentConfirmedAt: paymentConfirmed ? (editBooking.paymentConfirmedAt || new Date().toISOString()) : undefined,
      });
      if (ok === false) return;
    } else {
      const ok = onSave({
        id: crypto.randomUUID(), roomNumber, guestName: fullName, ...nameFields,
        guestPhone, guestEmail,
        guestWhatsapp, guestTelegram, guestInstagram, guestCount,
        checkIn: effectiveIn, checkOut: effectiveOut, notes, status: finalStatus, price: cleanPrice,
        paymentType, paymentTiming, paymentAmount: cleanPaymentAmount, paymentConfirmed,
        payments, residency,
        // Manually created from inside the admin/superuser/manager panel → always 'offline'.
        bookingChannel: (user?.role === 'admin' || user?.role === 'superuser' || user?.role === 'manager') ? 'offline' : 'offline',
        paymentConfirmedAt: paymentConfirmed ? new Date().toISOString() : undefined,
        createdAt: new Date().toISOString(),
        ...(bedIndex !== undefined ? { bedIndex } : {}),
        ...(earlyCheckin ? { checkInHalfDay: true } : {}),
        ...(lateCheckout ? { checkOutHalfDay: true } : {}),
      });
      if (ok === false) return;
    }
    toast.success(t('bookingSaved'));
    rebaselineSnapshotSoon();
    clearDraft();
    onClose();
  };


  const handleDelete = () => {
    if (!editBooking) return;
    setDeleteOpen(true);
  };

  const isEditing = !!editBooking;
  const statusCfg = BOOKING_STATUSES[status];
  const titleLabel = isEditing ? t('editBooking') : t('newBooking');

  // Pretty human date strings for the hero
  const inHuman = inDate ? safeFormat(inDate, 'EEE, d MMM') : '';
  const outHuman = outDate ? safeFormat(outDate, 'EEE, d MMM') : '';
  const guestDetails = {
    bookingId: editBooking?.id,
    fullName,
    initials,
    roomNumber,
    bedIndex,
    statusLabel: statusCfg.label[lang],
    statusColor: statusCfg.color,
    guestLastName: lastName,
    guestFirstName: firstName,
    guestMiddleName: middleName,
    guestPhone,
    guestEmail,
    guestWhatsapp,
    guestTelegram,
    guestInstagram,
    guestCount,
    inHuman,
    outHuman,
    nightsDisplay,
    checkInTime,
    checkOutTime,
    paymentTypeLabel,
    paymentTimingLabel,
    paymentAmount: displayedPaymentAmount,
    paymentConfirmed,
    notes,
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && requestClose()}>
      <DialogContent
        className="sm:max-w-[940px] w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-hidden p-0 border-0 bg-transparent shadow-none [&>button.absolute]:hidden"
      >
        <VisuallyHidden>
          <DialogTitle>Booking</DialogTitle>
          <DialogDescription>Create or edit a booking</DialogDescription>
        </VisuallyHidden>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(2px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative flex max-h-[calc(100dvh-1.5rem)] min-h-0 flex-col overflow-hidden rounded-[28px] bg-card ring-1 ring-foreground/10 shadow-[0_50px_120px_-30px_rgba(15,15,40,0.55)]"
        >
          {/* ─────── HERO ─────── */}
          <div className="relative overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background: `radial-gradient(120% 140% at 0% 0%, ${statusCfg.color}26 0%, transparent 55%),
                             radial-gradient(120% 140% at 100% 0%, hsl(var(--primary) / 0.18) 0%, transparent 55%),
                             linear-gradient(180deg, hsl(var(--primary) / 0.06), transparent)`,
              }}
            />
            <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
            <div aria-hidden className="absolute -left-20 top-10 h-48 w-48 rounded-full blur-3xl" style={{ background: `${statusCfg.color}33` }} />

            <div className="relative px-6 pt-3 pb-3">
              <div className="flex items-start gap-3">
                {/* Initials avatar */}
                <div
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-black tracking-tight text-primary-foreground shadow-md shadow-primary/30"
                  style={{ background: `linear-gradient(135deg, hsl(var(--primary)) 0%, ${statusCfg.color} 100%)` }}
                >
                  <span className="drop-shadow-sm">{initials}</span>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card ring-2 ring-card text-[9px]"
                    title={statusCfg.label[lang]}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: statusCfg.color }} />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-primary/80">
                    {titleLabel}
                  </p>
                  <h2 className="font-display mt-0.5 truncate text-[16px] font-black leading-tight text-foreground">
                    {fullName || (lang === 'ru' ? 'Новый гость' : lang === 'uz' ? 'Yangi mehmon' : 'New guest')}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 ring-1 ring-border/60 backdrop-blur">
                      <BedDouble className="h-3 w-3 text-primary" />
                      {t('room')} {roomNumber}
                      {bedIndex !== undefined && (
                        <span className="ml-1 rounded-md bg-primary/15 px-1.5 py-px text-[9px] font-black uppercase text-primary">
                          #{bedIndex + 1}
                        </span>
                      )}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 backdrop-blur"
                      style={{
                        background: `${statusCfg.color}1f`,
                        color: statusCfg.color,
                        borderColor: `${statusCfg.color}40`,
                      }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusCfg.color }} />
                      {statusCfg.label[lang]}
                    </span>
                    {dayDiff > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 font-black uppercase tracking-wider text-primary ring-1 ring-primary/25">
                        {Number.isInteger(nightsDisplay) ? nightsDisplay : nightsDisplay.toFixed(1)} {t('nightsShort')}
                      </span>
                    )}
                    {(earlyCheckin || lateCheckout) && (
                      <>
                        {earlyCheckin && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-500/30">
                            <Sunrise className="h-3 w-3" /> {t('earlyBadge')}
                          </span>
                        )}
                        {lateCheckout && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700 ring-1 ring-amber-500/30">
                            <Moon className="h-3 w-3" /> {t('lateBadge')}
                          </span>
                        )}
                      </>
                    )}
                    {/* Guest origin — auto-detected, NOT user-clickable.
                        Manual creates by admin/superuser/manager => 'offline'. */}
                    {(() => {
                      const channel: 'online' | 'offline' = editBooking?.bookingChannel
                        ?? ((user?.role === 'admin' || user?.role === 'superuser' || user?.role === 'manager') ? 'offline' : 'offline');
                      const isOnline = channel === 'online';
                      const onlineLabel = lang === 'ru' ? 'Онлайн' : lang === 'uz' ? 'Onlayn' : 'Online';
                      const offlineLabel = lang === 'ru' ? 'Офлайн' : lang === 'uz' ? 'Oflayn' : 'Offline';
                      const guestTitle = lang === 'ru' ? 'Гость' : lang === 'uz' ? 'Mehmon' : 'Guest';
                      return (
                        <span
                          title={guestTitle}
                          aria-label={guestTitle}
                          className="group/ch inline-flex items-center gap-1 rounded-full bg-background/80 p-[3px] ring-1 ring-border/70 shadow-sm backdrop-blur select-none"
                          style={{ cursor: 'default' }}
                        >
                          <span
                            aria-disabled
                            tabIndex={-1}
                            className={`pointer-events-none inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${isOnline ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-[0_2px_8px_-2px_rgba(14,165,233,0.55)] ring-1 ring-sky-600/40 scale-[1.02]' : 'text-muted-foreground/60 opacity-70'}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]' : 'bg-sky-500/30'}`} />
                            {onlineLabel}
                          </span>
                          <span
                            aria-disabled
                            tabIndex={-1}
                            className={`pointer-events-none inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${!isOnline ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-[0_2px_8px_-2px_rgba(15,23,42,0.6)] ring-1 ring-slate-900/50 scale-[1.02]' : 'text-muted-foreground/60 opacity-70'}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${!isOnline ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]' : 'bg-slate-500/30'}`} />
                            {offlineLabel}
                          </span>
                        </span>
                      );
                    })()}
                  </div>

                  {(inHuman || outHuman) && (
                    <div className="mt-2 flex items-center gap-2 text-[12px] font-semibold tabular-nums text-foreground/80">
                      <span>{inHuman} <span className="text-muted-foreground/70">· {checkInTime}</span></span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
                      <span>{outHuman} <span className="text-muted-foreground/70">· {checkOutTime}</span></span>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {editBooking && !readOnly && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={lang === 'ru' ? 'Сменить комнату' : lang === 'uz' ? 'Xonani almashtirish' : 'Change room'}
                          title={lang === 'ru' ? 'Сменить комнату' : lang === 'uz' ? 'Xonani almashtirish' : 'Change room'}
                          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-[12px] font-bold text-foreground backdrop-blur transition hover:border-primary/50 hover:text-primary"
                        >
                          <BedDouble className="h-3.5 w-3.5" />
                          <span>{lang === 'ru' ? 'Сменить комнату' : lang === 'uz' ? 'Xonani almashtirish' : 'Change room'}</span>
                          <ChevronDown className="h-3 w-3 opacity-70" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64 p-1.5">
                        <div className="px-2 pt-1 pb-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                          {lang === 'ru' ? 'Выберите категорию' : lang === 'uz' ? 'Kategoriyani tanlang' : 'Pick category'}
                        </div>
                        <div className="max-h-72 overflow-y-auto flex flex-col">
                          {categories.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                window.dispatchEvent(new CustomEvent('hotel:change-room', {
                                  detail: { bookingId: editBooking.id, categoryId: c.id },
                                }));
                                onClose();
                              }}
                              className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold text-foreground hover:bg-accent"
                            >
                              <span className="truncate">{c.label[lang] || c.label.en}</span>
                              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider text-muted-foreground">
                                {c.short}
                              </span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  <button
                    onClick={requestClose}
                    aria-label="Close"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground backdrop-blur transition hover:border-destructive/40 hover:text-destructive hover:rotate-90"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>

          {/* ─────── BODY ─────── */}
          <div className={`relative min-h-0 flex-1 overflow-y-auto px-7 py-5 space-y-5 ${readOnly ? '[&_input]:pointer-events-none [&_textarea]:pointer-events-none [&_button]:pointer-events-none [&_select]:pointer-events-none [&_[role=combobox]]:pointer-events-none [&_[role=button]]:pointer-events-none' : ''}`}>





            {/* 1. GUEST IDENTITY — top */}
            <Section
              icon={<UserPlus className="h-3.5 w-3.5" />}
              label={lang === 'ru' ? 'ФИО гостя' : lang === 'uz' ? 'Mehmon F.I.O.' : 'Guest full name'}
              accent={statusCfg.color}
            >
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                <Field label={t('lastName')}>
                  <Input ref={lastNameRef} value={lastName} onChange={e => setLastName(e.target.value)} placeholder={t('lastNamePlaceholder')} className={`h-11 rounded-xl bg-background text-sm font-semibold transition-shadow duration-500 ${surnameGlow ? 'ring-2 ring-primary/70 shadow-[0_0_0_4px_hsl(var(--primary-hsl)/0.18),0_0_24px_hsl(var(--primary-hsl)/0.45)]' : ''}`} />
                </Field>
                <Field label={t('firstName')} required>
                  <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder={t('firstNamePlaceholder')} className="h-11 rounded-xl bg-background text-sm font-semibold" />
                </Field>
                <Field label={t('middleName')}>
                  <Input value={middleName} onChange={e => setMiddleName(e.target.value)} placeholder={t('middleNamePlaceholder')} className="h-11 rounded-xl bg-background text-sm font-semibold" />
                </Field>
              </div>
              <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setResidency('resident')}
                  className={`h-10 rounded-lg text-xs font-black uppercase tracking-wider transition ${residency === 'resident' ? 'bg-emerald-500 text-white shadow' : 'bg-background text-muted-foreground hover:bg-emerald-500/10'}`}
                >
                  {lang === 'ru' ? 'Резидент' : 'Resident'}
                </button>
                <button
                  type="button"
                  onClick={() => setResidency('nonResident')}
                  className={`h-10 rounded-lg text-xs font-black uppercase tracking-wider transition ${residency === 'nonResident' ? 'bg-amber-500 text-white shadow' : 'bg-background text-muted-foreground hover:bg-amber-500/10'}`}
                >
                  {lang === 'ru' ? 'Нерезидент' : 'Non-resident'}
                </button>
              </div>
            </Section>

            {/* 2. STAY WINDOW (full width) — combines period + timing boxes */}
            <Section
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label={lang === 'ru' ? 'Период проживания' : lang === 'uz' ? 'Yashash davri' : 'Stay window'}
              accent={statusCfg.color}
              right={
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                  {`${checkInTime} → ${checkOutTime}`}
                </span>
              }
            >
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  <DateField
                    label={t('checkIn')}
                    accent="emerald"
                    value={inDate}
                    min={minCheckIn}
                    onChange={(v) => { setInDate(v); if (v && outDate && parseISO(outDate) <= parseISO(v)) setOutDate(nextDay(v)); }}
                  />
                  <DateField
                    label={t('checkOut')}
                    accent="rose"
                    value={outDate}
                    min={inDate ? nextDay(inDate) : (canBackdate ? undefined : todayISO)}
                    onChange={(v) => { setOutDate(v); if (v && inDate && parseISO(v) <= parseISO(inDate)) setInDate(prevDay(v)); }}
                  />
                  <Field label={t('guests')} icon={<Users className="h-3 w-3 text-primary/70" />}>
                     <Input
                       type="number" min={1} max={effectiveMaxGuests}
                       value={guestCount}
                       onChange={e => {
                         const n = Number(e.target.value);
                         if (!Number.isFinite(n)) return;
                         setGuestCount(Math.max(1, Math.min(effectiveMaxGuests, Math.floor(n))));
                       }}
                       className="h-10 rounded-xl bg-background tabular-nums"
                     />
                  </Field>
                  {isAdminOnly ? (
                    <Field
                      label={lang === 'ru' ? 'Итого к оплате' : lang === 'uz' ? "To'lov jami" : 'Total to pay'}
                      icon={<DollarSign className="h-3 w-3 text-emerald-500" />}
                    >
                      {(() => {
                        // Hold-and-drop bookings: render a per-segment breakdown so
                        // admin sees exactly how many nights were lived in each
                        // category and at which rate. Grand total = sum of legs.
                        if (hasSegments) {
                          return (
                            <div className="relative rounded-xl border border-emerald-200/60 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/80 via-background to-emerald-50/40 dark:from-emerald-950/40 dark:via-background dark:to-emerald-950/20 px-3 py-2 flex flex-col gap-1 overflow-hidden">
                              {segmentsList.map((seg, i) => (
                                <div key={`seg-${i}`} className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
                                  <span className="font-medium uppercase tracking-wider text-emerald-600/80 dark:text-emerald-400/80 truncate">
                                    {seg.nights} × {formatPrice(seg.perNightRate)} · {segmentCategoryLabel(seg.categoryId)} · #{seg.roomNumber}
                                  </span>
                                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                    {formatPrice(seg.price)}
                                  </span>
                                </div>
                              ))}
                              <div className="mt-1 flex items-center justify-between border-t border-emerald-300/40 pt-1 text-[11px] tabular-nums">
                                <span className="font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                  {lang === 'ru' ? 'Итого' : lang === 'uz' ? 'Jami' : 'Total'}
                                </span>
                                <span className="font-black text-sm text-emerald-700 dark:text-emerald-300">
                                  {formatPrice(segmentsTotal)}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        // Total to pay = nights × sum(per-guest prices for booked guests).
                        const total = Math.round(nightsDisplay * perNightRate);
                        return (
                          <div className="relative h-10 rounded-xl border border-emerald-200/60 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/80 via-background to-emerald-50/40 dark:from-emerald-950/40 dark:via-background dark:to-emerald-950/20 px-3 flex items-center justify-between overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-300/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                            <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600/80 dark:text-emerald-400/80 tabular-nums">
                              {guestMultiplier} × {nightsDisplay} × {formatPrice(perNightRate / guestMultiplier)}
                            </span>
                            <span className="font-bold text-sm text-emerald-700 dark:text-emerald-300 tabular-nums">
                              {formatPrice(total)}
                            </span>
                          </div>
                        );
                      })()}
                    </Field>
                  ) : isManagerOnly ? (
                    <Field
                      label={lang === 'ru' ? `Цена/гость · ${categoryLabel}` : lang === 'uz' ? `Narx/mehmon · ${categoryLabel}` : `Rate/guest · ${categoryLabel}`}
                      icon={<DollarSign className="h-3 w-3 text-emerald-500" />}
                    >
                      <div className="flex flex-col gap-1.5">
                        {Array.from({ length: categoryMaxGuests }).map((_, i) => (
                          <div key={`mgr-rate-${i}`} className="flex items-center gap-2">
                            <span className="min-w-[58px] text-[10px] font-bold uppercase tracking-wider text-emerald-600/80">
                              {lang === 'ru' ? `Гость ${i + 1}` : lang === 'uz' ? `Mehmon ${i + 1}` : `Guest ${i + 1}`}
                            </span>
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={formatInputNumber(managerRateInputs[i] ?? '')}
                              onChange={e => {
                                const raw = parseInputNumber(e.target.value);
                                setManagerRateInputs(prev => {
                                  const next = prev.slice();
                                  while (next.length < categoryMaxGuests) next.push('');
                                  next[i] = raw;
                                  if (roomCategoryId) {
                                    const arr = next.map(v => {
                                      const n = Number(v);
                                      return Number.isFinite(n) ? Math.max(0, n) : 0;
                                    });
                                    setCategoryRate(roomCategoryId, { resident: arr, nonResident: arr });
                                  }
                                  return next;
                                });
                              }}
                              placeholder="0"
                              className="h-9 rounded-xl bg-background tabular-nums"
                            />
                          </div>
                        ))}
                      </div>
                    </Field>
                  ) : (
                    <Field label={lang === 'ru' ? 'Цена' : lang === 'uz' ? 'Narx' : 'Price'} icon={<DollarSign className="h-3 w-3 text-emerald-500" />}>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={formatInputNumber(price)}
                        onChange={e => setPrice(parseInputNumber(e.target.value))}
                        placeholder="0"
                        className="h-10 rounded-xl bg-background tabular-nums"
                      />
                    </Field>
                  )}
                </div>

                {!isAdminOnly && (
                  <Field label={t('status')} icon={<span className="h-2 w-2 rounded-full" style={{ background: statusCfg.color }} />}>
                    <Select value={status} onValueChange={(v) => setStatus(v as BookingStatus)}>
                      <SelectTrigger className="h-10 rounded-xl bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {(Object.entries(BOOKING_STATUSES) as [BookingStatus, typeof BOOKING_STATUSES[BookingStatus]][])
                          .filter(([key]) => key !== 'confirmed')
                          .map(([key, cfg]) => (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ background: cfg.color }} />
                              <span className="font-medium">{cfg.label[lang]}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                {/* Time-of-day boxes (formerly under "Время заселения") */}
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  <TimingSegment
                    label={t('arrivalTiming')}
                    icon={<Sunrise className="h-3 w-3 text-emerald-500" />}
                    value={earlyCheckin ? 'early' : 'standard'}
                    onChange={(v) => setEarlyCheckin(v === 'early')}
                    options={[
                      { value: 'early', label: t('earlyOption'), time: '08:00', accent: 'emerald' },
                      { value: 'standard', label: t('standardOption'), time: '14:00', accent: 'neutral' },
                    ]}
                  />
                  <TimingSegment
                    label={t('departureTiming')}
                    icon={<Moon className="h-3 w-3 text-amber-500" />}
                    value={lateCheckout ? 'late' : 'standard'}
                    onChange={(v) => setLateCheckout(v === 'late')}
                    options={[
                      { value: 'standard', label: t('standardOption'), time: '12:00', accent: 'neutral' },
                      { value: 'late', label: t('lateOption'), time: '24:00', accent: 'amber' },
                    ]}
                  />
                </div>
              </div>
            </Section>

            <div ref={paymentSectionRef} className="relative">
            <Section
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label={lang === 'ru' ? 'Данные об оплате' : lang === 'uz' ? "To'lov ma'lumotlari" : 'Payment details'}
              accent={paymentConfirmed ? '#10B981' : statusCfg.color}
              right={
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${paymentConfirmed ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/25' : 'bg-primary/10 text-primary ring-1 ring-primary/20'}`}>
                  {paymentConfirmed ? (lang === 'ru' ? 'Подтверждено' : 'Confirmed') : (lang === 'ru' ? 'Ожидает' : 'Pending')}
                </span>
              }
            >
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
                <Field label={lang === 'ru' ? 'Тип оплаты' : 'Payment type'}>
                  <Select value={paymentType} onValueChange={(v) => setPaymentType(v as typeof paymentType)}>
                    <SelectTrigger className="h-10 rounded-xl bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="cash">Наличные</SelectItem>
                      <SelectItem value="card">Карта</SelectItem>
                      <SelectItem value="transfer">Перечисление</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={lang === 'ru' ? 'Внесённая сумма' : 'Amount paid now'}>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={paymentType === 'transfer' ? '' : formatInputNumber(paymentInput)}
                    onChange={e => setPaymentInput(parseInputNumber(e.target.value))}
                    placeholder="0"
                    disabled={isFullyPaid || paymentType === 'transfer'}
                    className="h-10 rounded-xl bg-background tabular-nums disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </Field>
                <Field label={lang === 'ru' ? 'Оставшаяся сумма' : 'Remaining'}>
                  <div className={`flex h-10 items-center justify-end rounded-xl border border-input bg-muted/40 px-3 text-sm font-bold tabular-nums ${paymentType === 'transfer' ? 'opacity-60' : ''}`}>
                    {formatPrice(remainingAmount)}
                  </div>
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isFullyPaid}
                    onClick={() => {
                      if (effectiveTotal <= 0) {
                        toast.error(lang === 'ru' ? 'Укажите общую сумму' : 'Set total amount first');
                        return;
                      }
                      // For "Перечисление" the inputs are inactive — pay the full remaining in one go.
                      // For cash/card use the manually entered amount, capped at remaining.
                      let capped: number;
                      if (paymentType === 'transfer') {
                        if (remainingAmount <= 0) return;
                        capped = remainingAmount;
                      } else {
                        const amt = Number(paymentInput);
                        if (!Number.isFinite(amt) || amt <= 0) {
                          toast.error(lang === 'ru' ? 'Введите сумму' : "Enter amount");
                          return;
                        }
                        capped = Math.min(amt, remainingAmount);
                      }
                      const nextPayments = [...payments, { amount: capped, at: new Date().toISOString(), method: paymentType }];
                      setPayments(nextPayments);
                      setPaymentInput('');
                      const nextPaid = nextPayments.reduce((s, p) => s + p.amount, 0);
                      const justFullyPaid = nextPaid >= effectiveTotal;
                      if (justFullyPaid) {
                        setPaymentConfirmed(true);
                        setReceiptGlow(true);
                        window.setTimeout(() => setReceiptGlow(false), 5000);
                        // Fire the "Полностью оплачено" overlay exactly once — at the moment
                        // the booking transitions to fully paid.
                        triggerFullyPaidOverlay();
                      }
                      // Auto-save the payment immediately when editing an existing booking
                      if (editBooking?.id && onUpdate) {
                        onUpdate(editBooking.id, {
                          payments: nextPayments,
                          paymentType,
                          paymentAmount: effectiveTotal,
                          price: effectiveTotal,
                          ...(hasSegments ? { segments: segmentsList } : {}),
                          paymentConfirmed: justFullyPaid,
                          paymentConfirmedAt: justFullyPaid
                            ? (editBooking.paymentConfirmedAt || new Date().toISOString())
                            : editBooking.paymentConfirmedAt,
                        });
                        rebaselineSnapshotSoon();
                      }
                    }}
                    className="h-10 w-full gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 text-white shadow-md shadow-emerald-500/25 hover:from-emerald-500 hover:to-emerald-500 md:w-auto disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {lang === 'ru' ? 'Оплатить' : lang === 'uz' ? "To'lash" : 'Pay'}
                  </Button>
                </div>
              </div>
            </Section>
              <AnimatePresence>
                {fullyPaidOverlay && (
                  <motion.div
                    key="fully-paid-overlay"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.25 }}
                    className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-emerald-500/95 text-white shadow-2xl shadow-emerald-500/40 ring-2 ring-emerald-300"
                  >
                    <div className="flex flex-col items-center gap-2 px-6 text-center">
                      <Check className="h-10 w-10" />
                      <span className="text-lg font-black uppercase tracking-[0.18em]">
                        {lang === 'ru' ? 'Полностью оплачено' : lang === 'uz' ? "To'liq to'langan" : 'Fully paid'}
                      </span>
                      <span className="text-sm font-bold tabular-nums opacity-90">
                        {formatPrice(paidSum)} / {formatPrice(effectiveTotal)}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>



            {/* 3. CONTACT METHODS — always-open standalone card */}
            <section className="group/section relative rounded-2xl border border-border/60 bg-gradient-to-b from-background to-muted/20 shadow-sm transition-shadow hover:shadow-md overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: `${statusCfg.color}1f`, color: statusCfg.color }}
                >
                  <Phone className="h-3.5 w-3.5" />
                </span>
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-foreground/75">
                  {t('contactMethods')}
                </span>
                {(guestPhone || guestWhatsapp || guestEmail || guestTelegram || guestInstagram) && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                    {[guestPhone, guestWhatsapp, guestEmail, guestTelegram, guestInstagram].filter(Boolean).length}
                  </span>
                )}
              </div>
              <div className="px-4 pb-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t('phone')} icon={<Phone className="h-3 w-3 text-primary/70" />}>
                    <Input value={guestPhone} onChange={e => setGuestPhone(e.target.value.slice(0, 20))} maxLength={20} inputMode="tel" placeholder="+998 90 123 45 67" aria-invalid={!isValidPhone(guestPhone)} className={`h-9 rounded-xl bg-background ${!isValidPhone(guestPhone) ? 'border-destructive/60 focus-visible:ring-destructive/40' : ''}`} />
                  </Field>
                  <Field label={t('whatsapp')} icon={<MessageCircle className="h-3 w-3 text-emerald-500" />}>
                    <Input value={guestWhatsapp} onChange={e => setGuestWhatsapp(e.target.value.slice(0, 20))} maxLength={20} inputMode="tel" placeholder="+998 90 123 45 67" aria-invalid={!isValidPhone(guestWhatsapp)} className={`h-9 rounded-xl bg-background ${!isValidPhone(guestWhatsapp) ? 'border-destructive/60 focus-visible:ring-destructive/40' : ''}`} />
                  </Field>
                  <Field label={t('email')} icon={<Mail className="h-3 w-3 text-primary/70" />}>
                    <Input type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value.slice(0, 80))} maxLength={80} placeholder="email@example.com" aria-invalid={!isValidEmail(guestEmail)} className={`h-9 rounded-xl bg-background ${!isValidEmail(guestEmail) ? 'border-destructive/60 focus-visible:ring-destructive/40' : ''}`} />
                  </Field>
                  <Field label={t('telegram')} icon={<Send className="h-3 w-3 text-sky-500" />}>
                    <Input value={guestTelegram} onChange={e => setGuestTelegram(e.target.value.slice(0, 32))} maxLength={32} placeholder={t('telegramPlaceholder')} aria-invalid={!isValidHandle(guestTelegram)} className={`h-9 rounded-xl bg-background ${!isValidHandle(guestTelegram) ? 'border-destructive/60 focus-visible:ring-destructive/40' : ''}`} />
                  </Field>
                  <Field label={t('instagram')} icon={<Instagram className="h-3 w-3 text-pink-500" />}>
                    <Input value={guestInstagram} onChange={e => setGuestInstagram(e.target.value.slice(0, 32))} maxLength={32} placeholder={t('instagramPlaceholder')} aria-invalid={!isValidHandle(guestInstagram)} className={`h-9 rounded-xl bg-background ${!isValidHandle(guestInstagram) ? 'border-destructive/60 focus-visible:ring-destructive/40' : ''}`} />
                  </Field>
                </div>
              </div>
            </section>

            {/* 4. NOTES — always-open standalone card */}
            <section className="group/section relative rounded-2xl border border-border/60 bg-gradient-to-b from-background to-muted/20 shadow-sm transition-shadow hover:shadow-md overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: `${statusCfg.color}1f`, color: statusCfg.color }}
                >
                  <StickyNote className="h-3.5 w-3.5" />
                </span>
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-foreground/75">
                  {t('notes')}
                </span>
                {notes && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                    {notes.length}
                  </span>
                )}
              </div>
              <div className="px-4 pb-4">
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t('specialRequests')}
                  rows={3}
                  className="rounded-xl resize-none bg-background"
                />
              </div>
            </section>


          </div>

          {/* ─────── FOOTER ─────── */}
          <div className="relative flex items-center justify-between gap-3 border-t border-border/60 bg-background/70 px-7 py-4 backdrop-blur">
            <div className="flex items-center gap-2">
              {isEditing && !readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  className="gap-1.5 rounded-xl border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />{t('delete')}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGuestDetailsOpen(true)}
                className="guest-details-cta gap-1.5 overflow-hidden rounded-xl border-primary/35 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Guest Details
              </Button>
              {isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAnketaOpen(true)}
                  className="gap-1.5 rounded-xl border-primary/35 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                >
                  <ClipboardSignature className="h-3.5 w-3.5" />
                  {t('openAnketa')}
                </Button>
              )}
              {isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setReceiptOpen(true); setReceiptGlow(false); }}
                  className={`gap-1.5 rounded-xl border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500 hover:text-white transition-shadow ${receiptGlow ? 'receipt-glow ring-2 ring-emerald-400/70' : ''}`}
                >
                  <Receipt className="h-3.5 w-3.5" />
                  {lang === 'ru' ? 'Квитанция' : lang === 'uz' ? 'Kvitansiya' : 'Receipt'}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={requestClose} className="rounded-xl">
                {t('cancel')}
              </Button>
              {readOnly ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground ring-1 ring-border/60">
                  Read-only
                </span>
              ) : isAdminOnly ? (() => {
                // Admin lifecycle (per screenshots 1–4):
                //   booked/confirmed/pending → Заселить (green)   → in-house
                //   in-house                  → Выселить (grey)    → checked-out
                //   checked-out               → Грязный (red)      → dirty
                //   dirty                     → Убрано (grey)      → cleaned
                //   cleaned                   → terminal (disabled)
                // Plus: cannot Заселить into a room that still has a `dirty`
                // booking — housekeeping must mark it Убрано first.
                const current = isEditing ? status : 'new';
                let nextStatus: BookingStatus | null = 'booked';
                let label = lang === 'ru' ? 'Забронировать' : lang === 'uz' ? 'Band qilish' : 'Book';
                let buttonClass = 'bg-gradient-to-r from-primary to-primary/85 text-primary-foreground shadow-md shadow-primary/30 hover:from-primary hover:to-primary hover:shadow-lg hover:shadow-primary/40';
                let disabled = !firstName.trim() || !inDate || !outDate;
                let blockedReason: string | null = null;
                if (isEditing) {
                  if (current === 'booked' || current === 'confirmed' || current === 'pending') {
                    nextStatus = 'in-house';
                    label = lang === 'ru' ? 'Заселить' : lang === 'uz' ? 'Joylashtirish' : 'Check In';
                    buttonClass = 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30 hover:from-emerald-500 hover:to-emerald-500 hover:shadow-lg hover:shadow-emerald-500/40';
                    if (inDate) {
                      const now = new Date();
                      const todayStart = startOfDay(now);
                      const ciDate = parseISO(inDate);
                      if (isBefore(todayStart, ciDate)) {
                        // Booking's check-in day hasn't arrived yet.
                        disabled = true;
                        blockedReason = lang === 'ru'
                          ? 'День заезда ещё не наступил'
                          : lang === 'uz' ? "Kirish kuni hali kelmadi" : "Check-in day hasn't arrived";
                      } else if (!isBefore(todayStart, ciDate) && !isBefore(ciDate, todayStart)) {
                        // Same day: enforce time-of-day rules for admin.
                        const minutes = now.getHours() * 60 + now.getMinutes();
                        if (earlyCheckin) {
                          // Early check-in: allowed only before 12:00.
                          if (minutes > 12 * 60) {
                            disabled = true;
                            blockedReason = lang === 'ru'
                              ? 'Ранний заезд разрешён только до 12:00'
                              : lang === 'uz' ? 'Erta kirish faqat 12:00 gacha' : 'Early check-in only allowed before 12:00';
                          }
                        } else {
                          // Regular check-in: from 12:01 onward.
                          if (minutes <= 12 * 60) {
                            disabled = true;
                            blockedReason = lang === 'ru'
                              ? 'Обычный заезд с 12:01 (до 14:00)'
                              : lang === 'uz' ? "Oddiy kirish 12:01 dan (14:00 gacha)" : 'Regular check-in starts at 12:01';
                          }
                        }
                      }
                    }
                    if (editBooking && isRoomDirty(roomNumber, allBookings.filter((b) => b.id !== editBooking.id))) {
                      disabled = true;
                      blockedReason = lang === 'ru' ? 'Комната не убрана' : lang === 'uz' ? 'Xona tozalanmagan' : 'Room is not cleaned';
                    }
                  } else if (current === 'in-house') {
                    // Skip the explicit 'checked-out' stage — checking out
                    // immediately marks the room as dirty, removing the
                    // separate "Грязный" lifecycle button.
                    nextStatus = 'dirty';
                    label = lang === 'ru' ? 'Выселить' : lang === 'uz' ? 'Chiqarish' : 'Check Out';
                    buttonClass = 'bg-gradient-to-r from-gray-500 to-gray-600 text-white shadow-md shadow-gray-500/30 hover:from-gray-500 hover:to-gray-500';
                  } else if (current === 'checked-out' || current === 'dirty') {
                    // Legacy "checked-out" bookings fall through here so the
                    // operator can still mark the room as cleaned without
                    // ever seeing the removed "Грязный" button.
                    nextStatus = 'cleaned';
                    label = lang === 'ru' ? 'Убрано' : lang === 'uz' ? 'Tozalangan' : 'Cleaned';
                    buttonClass = 'bg-gradient-to-r from-gray-500 to-gray-600 text-white shadow-md shadow-gray-500/30 hover:from-gray-500 hover:to-gray-500';
                  } else if (current === 'cleaned') {
                    nextStatus = null;
                    label = lang === 'ru' ? 'Убрано' : lang === 'uz' ? 'Tozalangan' : 'Cleaned';
                    buttonClass = 'bg-gray-300 text-gray-600';
                    disabled = true;
                  }
                }
                const handleCycle = () => {
                  // When the operator presses "Выселить" (in-house → dirty)
                  // and the guest is checking out earlier than the planned
                  // check-out date, snap the booking's check-out to today so
                  // the timeline bar shrinks to the current day automatically.
                  let checkoutOverride: { checkOut?: string; checkOutHalfDay?: boolean } | undefined;
                  if (nextStatus === 'dirty' && current === 'in-house') {
                    const now = new Date();
                    const todayStr = format(startOfDay(now), 'yyyy-MM-dd');
                    if (outDate && todayStr < outDate) {
                      // Early check-out — require explicit admin confirmation
                      // through the themed AlertDialog (not native confirm()).
                      const inDateStr = inDate || todayStr;
                      const safeOut = todayStr > inDateStr ? todayStr : format(addDays(parseISO(inDateStr), 1), 'yyyy-MM-dd');
                      // Split-cell logic: before 12:00 → first half of the
                      // day cell (halfDay=false). At/after 12:01 → second
                      // half (halfDay=true), so the bar visually ends in
                      // the correct half of the check-out day.
                      const minutesNow = now.getHours() * 60 + now.getMinutes();
                      const halfDay = minutesNow > 12 * 60; // strictly after 12:00
                      const hh = String(now.getHours()).padStart(2, '0');
                      const mm = String(now.getMinutes()).padStart(2, '0');
                      setEarlyCheckoutConfirm({ safeOut, nextStatus, halfDay, triggeredAt: `${hh}:${mm}` });
                      return;
                    }
                  }
                  if (nextStatus) setStatus(nextStatus);
                  handleSave(nextStatus ?? undefined, checkoutOverride);
                };

                return (
                  <Button
                    size="sm"
                    onClick={handleCycle}
                    disabled={disabled}
                    title={blockedReason ?? undefined}
                    className={`gap-1.5 rounded-xl px-5 transition disabled:opacity-50 ${buttonClass}`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                );
              })() : (
                <Button
                  size="sm"
                  onClick={() => handleSave()}
                  disabled={!firstName.trim() || !inDate || !outDate}
                  className="gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary/85 px-5 shadow-md shadow-primary/30 transition hover:from-primary hover:to-primary hover:shadow-lg hover:shadow-primary/40 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t('save')}
                </Button>
              )}
            </div>

          </div>
        </motion.div>
      </DialogContent>

      <HotelGuestAnketaModal
        open={anketaOpen}
        onClose={() => setAnketaOpen(false)}
        booking={editBooking ?? null}
      />
      <HotelReceiptModal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        booking={editBooking ?? null}
        guestFullName={fullName}
        roomNumber={roomNumber}
        nights={nightsDisplay}
        checkInTime={checkInTime}
        checkOutTime={checkOutTime}
        paymentTypeLabel={paymentTypeLabel}
        paymentTimingLabel={paymentTimingLabel}
        paymentAmount={displayedPaymentAmount}
        categoryLabel={categoryLabel}
        payments={payments}
        totalAmount={effectiveTotal}
      />
      <GuestDetailsWindow open={guestDetailsOpen} onClose={() => setGuestDetailsOpen(false)} guest={guestDetails} />
      <DeleteBookingModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        booking={editBooking ?? null}
        onConfirm={(id) => {
          onDelete?.(id);
          setDeleteOpen(false);
          onClose();
        }}
      />

      <UnsavedCloseWarning
        open={warnOpen}
        onCancel={() => setWarnOpen(false)}
        onSave={() => {
          setWarnOpen(false);
          handleSave();
        }}
        onDiscard={() => {
          setWarnOpen(false);
          initialSnapshotRef.current = latestSnapshotRef.current;
          clearDraft();
          onClose();
        }}
        title={t('unsavedTitle')}
        message={t('unsavedMessage')}
        cancelLabel={t('unsavedKeep')}
        saveLabel={t('unsavedSave')}
        discardLabel={t('unsavedDiscard')}
        saveDisabled={!fullName || !inDate || !outDate}
      />

      <AlertDialog
        open={earlyCheckoutConfirm !== null}
        onOpenChange={(o) => { if (!o) setEarlyCheckoutConfirm(null); }}
      >
        <AlertDialogContent className="max-w-md overflow-hidden rounded-2xl border border-primary/25 bg-card/95 p-0 shadow-2xl shadow-primary/20 backdrop-blur-xl">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent"
            />
            <div className="relative flex flex-col gap-4 p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/40 ring-1 ring-primary/40">
                  <LogOutIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <AlertDialogHeader className="space-y-1.5 text-left">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                      {lang === 'ru' ? 'Ранний выезд' : lang === 'uz' ? 'Erta chiqish' : 'Early check-out'}
                    </div>
                    <AlertDialogTitle className="text-lg font-semibold leading-tight">
                      {lang === 'ru'
                        ? 'Оформить ранний выезд гостя?'
                        : lang === 'uz'
                          ? 'Mehmonni erta chiqarasizmi?'
                          : 'Check the guest out early?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
                      {lang === 'ru'
                        ? 'Дата выезда ещё не наступила. Система автоматически укоротит бронирование до сегодняшнего дня.'
                        : lang === 'uz'
                          ? 'Chiqish sanasi hali kelmadi. Tizim bandlovni bugungi kunga qadar avtomatik qisqartiradi.'
                          : "The scheduled check-out date hasn't arrived yet. The booking will be shortened to today automatically."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                </div>
              </div>

              {earlyCheckoutConfirm && (
                <div className="rounded-xl border border-primary/20 bg-background/60 px-3.5 py-2.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium uppercase tracking-wider text-muted-foreground">
                      {lang === 'ru' ? 'Новая дата выезда' : lang === 'uz' ? 'Yangi chiqish sanasi' : 'New check-out'}
                    </span>
                    <span className="font-semibold text-foreground">
                      {format(parseISO(earlyCheckoutConfirm.safeOut), 'dd.MM.yyyy')} · {earlyCheckoutConfirm.triggeredAt}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium uppercase tracking-wider text-muted-foreground">
                      {lang === 'ru' ? 'Половина ячейки' : lang === 'uz' ? 'Katak yarmi' : 'Cell half'}
                    </span>
                    <span className="font-semibold text-foreground">
                      {earlyCheckoutConfirm.halfDay
                        ? (lang === 'ru' ? '2-я (после 12:00)' : lang === 'uz' ? '2-yarmi (12:00 dan keyin)' : '2nd (after 12:00)')
                        : (lang === 'ru' ? '1-я (до 12:00)' : lang === 'uz' ? '1-yarmi (12:00 gacha)' : '1st (before 12:00)')}
                    </span>
                  </div>
                </div>
              )}

              <AlertDialogFooter className="mt-1 gap-2 sm:gap-2">
                <AlertDialogCancel className="rounded-xl border-border/60 bg-background/70 hover:bg-background">
                  {lang === 'ru' ? 'Отмена' : lang === 'uz' ? 'Bekor qilish' : 'Cancel'}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-xl bg-gradient-to-r from-primary to-primary/85 text-primary-foreground shadow-md shadow-primary/30 hover:from-primary hover:to-primary hover:shadow-lg hover:shadow-primary/40"
                  onClick={() => {
                    const pending = earlyCheckoutConfirm;
                    setEarlyCheckoutConfirm(null);
                    if (!pending) return;
                    setOutDate(pending.safeOut);
                    setLateCheckout(pending.halfDay);
                    if (pending.nextStatus) setStatus(pending.nextStatus);
                    handleSave(pending.nextStatus ?? undefined, { checkOut: pending.safeOut, checkOutHalfDay: pending.halfDay });
                  }}
                >
                  {lang === 'ru' ? 'Выселить' : lang === 'uz' ? 'Chiqarish' : 'Check out'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/* ────────────────────────────  Helpers  ──────────────────────────── */

function safeFormat(iso: string, pattern: string) {
  try { return format(parseISO(iso), pattern); } catch { return ''; }
}

interface SectionProps {
  icon: React.ReactNode;
  label: string;
  accent: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ icon, label, accent, right, children }: SectionProps) {
  return (
    <section
      className="group/section relative rounded-2xl border border-border/60 bg-gradient-to-b from-background to-muted/20 p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <header className="mb-3 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/80"
          style={{ background: `${accent}1f`, color: accent }}
        >
          {icon}
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-foreground/75">
          {label}
        </span>
        {right && <div className="ml-auto">{right}</div>}
      </header>
      {children}
    </section>
  );
}

interface FieldProps {
  label: string;
  icon?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, icon, required, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

/* Segmented timing control */
interface TimingSegmentProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; time: string; accent: 'emerald' | 'amber' | 'neutral' }[];
}

function TimingSegment({ label, icon, value, onChange, options }: TimingSegmentProps) {
  const accentClasses: Record<string, string> = {
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-500/30',
    amber: 'from-amber-500 to-amber-600 shadow-amber-500/30',
    neutral: 'from-foreground/85 to-foreground/65 shadow-foreground/20',
  };
  return (
    <div className="rounded-xl border border-border/60 bg-card p-2">
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/40 p-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`relative flex flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all duration-200 ${
                active
                  ? `bg-gradient-to-br ${accentClasses[opt.accent]} text-white shadow-md scale-[1.02]`
                  : 'text-muted-foreground hover:bg-background hover:text-foreground'
              }`}
            >
              <span>{opt.label}</span>
              <span className={`text-[9px] font-bold tabular-nums ${active ? 'text-white/90' : 'text-muted-foreground/70'}`}>
                {opt.time}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Polished themed date picker with floating label */
interface DateFieldProps {
  label: string;
  value: string;
  min?: string;
  accent: 'emerald' | 'rose';
  onChange: (v: string) => void;
}

function DateField({ label, value, min, accent, onChange }: DateFieldProps) {
  return (
    <HotelDatePicker
      label={label}
      value={value}
      min={min}
      onChange={onChange}
      required
      className={accent === 'emerald' ? 'hover:border-emerald-500/45 focus:ring-emerald-500/25' : 'hover:border-rose-500/45 focus:ring-rose-500/25'}
    />
  );
}