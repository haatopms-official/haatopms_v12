import { useMemo, useState, useRef, useCallback, useEffect, memo, type CSSProperties } from 'react';
import { useSharedState } from '@/lib/hotel-sync';
import { createPortal } from 'react-dom';
import { addDays, subDays, format, differenceInCalendarDays, isSameDay, parseISO, startOfDay, isBefore } from 'date-fns';
import { BOOKING_STATUSES, type Booking, type BookingStatus, isRoomDirty } from '@/types/hotel';
import { useHotelGrid } from '@/hooks/HotelGridContext';
import { AddCategoryDialog, AddRoomDialog } from './HotelCategoryDialogs';
import { toast } from 'sonner';
import { BookingBar } from './BookingBar';
import { TimelineBottomScrollbar } from './TimelineBottomScrollbar';
import { splitBookingAt, sumSegments, computeSplitDateNow } from '@/lib/bookingPricing';
import { BookingDialog } from './BookingDialog';
import { useI18n } from '@/hooks/useI18n';
import { useAuth } from '@/contexts/AuthContext';
import { useAudit } from '@/contexts/AuditContext';
import { ChevronDown, ChevronRight, User, Users, CalendarCheck2, Plus, X, FolderPlus, DoorOpen, Trash2, AlertTriangle, Check, Tag } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

const HALF_COL_WIDTH = 40;
const DAY_WIDTH = HALF_COL_WIDTH * 2;
const ROW_HEIGHT = 44;
const PERSON_ROW_HEIGHT = 38;
const DEFAULT_LABEL_WIDTH = 440;
const INITIAL_PAST_DAYS = 14;
const INITIAL_FUTURE_DAYS = 45;
const LOAD_MORE_DAYS = 30;
const EDGE_THRESHOLD = 600;
const LEFT_ANCHORED_DAYS_BEFORE_TODAY = 2;
// Admin-only timeline restrictions: the grid opens with today positioned
// 2 days from the left edge. Superuser/manager keep unlimited scrolling.
const ADMIN_INITIAL_PAST_DAYS = 30;
const ADMIN_LEFT_OFFSET_DAYS = 2;

interface RoomGridProps {
  bookings: Booking[];
  conflictBookings?: Booking[];
  onAddBooking: (b: Booking) => void;
  onDeleteBooking: (id: string) => void;
  onUpdateBooking: (id: string, updates: Partial<Booking>) => void;
  /** When set, the grid will scroll to that booking and play a 5s glow. */
  focusBookingId?: string | null;
  /** Called once the focus has been consumed so the URL param can be cleared. */
  onFocusConsumed?: () => void;
  /** Width of the sticky category/room label column. Defaults to 440. */
  labelWidth?: number;
}

const PERSON_COUNTS: Record<string, number> = {
  'standard-double': 2, 'standard-twin': 2, 'standard-triple': 3,
  'standard-quadruple': 4, 'deluxe-twin': 2,
};

const DAY_LABELS_RU = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const DAY_LABELS_UZ = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
const CATEGORY_STATUS_ORDER: BookingStatus[] = ['pending', 'booked', 'in-house', 'checked-out', 'maintenance'];

const CategoryStatusStrip = memo(({ counts, lang }: { counts: Record<BookingStatus, number>; lang: string }) => (
  <div className="category-status-strip">
    {CATEGORY_STATUS_ORDER.map((status) => {
      const config = BOOKING_STATUSES[status];
      const count = counts[status] ?? 0;
      return (
        <div key={status} className={`category-status-chip${count === 0 ? ' is-empty' : ''}`} style={{ '--chip-color': config.color } as CSSProperties}>
          <span className="category-status-count">{count}</span>
          <span className="category-status-dot" />
          <span className="category-status-label">{config.label[lang as 'ru' | 'uz' | 'en']}</span>
        </div>
      );
    })}
  </div>
));
CategoryStatusStrip.displayName = 'CategoryStatusStrip';

const DayHeaderCell = memo(({ date, isToday, isPastDay, isWeekendDay, dayLabel, lang, isFirstOfMonth }: {
  date: Date; isToday: boolean; isPastDay: boolean; isWeekendDay: boolean; dayLabel: string; lang: string; isFirstOfMonth: boolean;
}) => (
  <div
    className={`day-header-cell relative flex flex-col items-center justify-center select-none ${isToday ? 'today-header-glow' : 'bg-card'}`}
    style={{ width: DAY_WIDTH, minWidth: DAY_WIDTH, height: 78, borderRight: '1px solid hsl(var(--grid-line-strong) / 0.5)', paddingTop: 2, paddingBottom: 12 }}
  >
    {/* Month ribbon on top of every date cell.
        First-of-month cells get a stronger pill so the eye can find
        month transitions instantly while every other cell still shows
        a subtle month tag for quick orientation. */}
    <span
      className={[
        'z-10 mb-1 inline-flex items-center justify-center rounded-full leading-none tracking-[0.14em] uppercase transition-colors',
        isFirstOfMonth
          ? 'px-1.5 py-[2px] text-[8px] font-black shadow-sm ring-1 ' +
            (isToday
              ? 'bg-white/25 text-white ring-white/40'
              : 'bg-primary/15 text-primary ring-primary/30')
          : 'px-1 py-[1px] text-[7.5px] font-bold ' +
            (isToday
              ? 'text-white/85'
              : isPastDay
                ? 'text-muted-foreground/45'
                : 'text-primary/55'),
      ].join(' ')}
    >
      {format(date, 'MMM')}
    </span>
    <span className={`text-[10px] font-extrabold uppercase leading-none z-10 tracking-wider ${isToday ? 'text-white' : isPastDay ? 'text-muted-foreground/50' : isWeekendDay ? 'text-destructive' : 'text-foreground/70'}`}>
      {dayLabel}
    </span>
    <span className={`text-[16px] font-black leading-tight z-10 mt-0.5 ${isToday ? 'text-white' : isPastDay ? 'text-muted-foreground/50' : 'text-foreground'}`}>
      {format(date, 'd')}
    </span>
    {isToday && (
      <span className="text-[7px] font-black uppercase tracking-wider text-white/90 z-10 mt-0.5">
        {lang === 'ru' ? 'Сегодня' : 'Bugun'}
      </span>
    )}
    <div
      className={`absolute bottom-0.5 left-0 right-0 z-10 flex items-center justify-center gap-2 text-[8px] font-bold leading-none pointer-events-none ${
        isToday ? 'text-white/95' : isPastDay ? 'text-muted-foreground/50' : 'text-foreground/55'
      }`}
    >
      <span className="flex items-center gap-[1px]">↑<span className="tabular-nums">12</span></span>
      <span className="flex items-center gap-[1px]">↓<span className="tabular-nums">14</span></span>
    </div>
  </div>
));
DayHeaderCell.displayName = 'DayHeaderCell';

/**
 * Static row background. Memoized purely on (height, totalWidth, todayIdx).
 * No `dates` array dependency — avoids re-renders when only the dates array
 * reference changes but todayIdx/length don't.
 */
const RowBackground = memo(({ height, totalWidth, todayOffset, totalDays }: {
  height: number; totalWidth: number; todayOffset: number; totalDays: number;
}) => (
  <div
    style={{
      width: totalWidth, height, position: 'absolute', top: 0, left: 0, pointerEvents: 'none',
      background: 'hsl(var(--card))',
      backgroundImage: [
        `repeating-linear-gradient(90deg, hsl(var(--grid-line-strong) / 0.55) 0px, hsl(var(--grid-line-strong) / 0.55) 1px, transparent 1px, transparent ${DAY_WIDTH}px)`,
        `repeating-linear-gradient(90deg, transparent 0px, transparent ${HALF_COL_WIDTH}px, hsl(var(--grid-line) / 0.3) ${HALF_COL_WIDTH}px, hsl(var(--grid-line) / 0.3) ${HALF_COL_WIDTH + 1}px, transparent ${HALF_COL_WIDTH + 1}px, transparent ${DAY_WIDTH}px)`,
      ].join(', '),
      backgroundSize: `${DAY_WIDTH}px ${height}px`,
    }}
  >
    {todayOffset >= 0 && todayOffset < totalDays && (
      <div
        className="today-column-glow"
        style={{
          position: 'absolute', left: todayOffset * DAY_WIDTH, top: 0,
          width: DAY_WIDTH, height,
          background: 'hsl(var(--primary-hsl) / 0.10)',
          borderLeft: '3px solid hsl(var(--primary-hsl) / 0.55)',
          borderRight: '3px solid hsl(var(--primary-hsl) / 0.55)',
        }}
      />
    )}
  </div>
));
RowBackground.displayName = 'RowBackground';

type DragSnapshot = { roomNumber: number; bedIndex?: number; startHalf: number; endHalf: number } | null;

type PersonNames = Record<number, Record<number, string>>;
type ExtraPersons = Record<number, number>;
type DeleteTarget =
  | { type: 'category'; id: string; label: string }
  | { type: 'room'; roomNumber: number }
  | { type: 'guest'; roomNumber: number; personIdx: number; isExtra: boolean };

type ChangeRoomMode = { booking: Booking; categoryId: string } | null;

const categoryDisplay = (cat: { label: Record<string, string>; short?: string }, lang: string) =>
  cat.short || cat.label[lang] || cat.label.en || '';

/**
 * Drag-overlay imperative API: parent updates this without React re-rendering
 * the grid. Internally uses CSS transforms for 60fps drag selection.
 */
interface DragOverlayHandle {
  show: (roomKey: string, startHalf: number, endHalf: number, height: number) => void;
  hide: () => void;
}

/* Single overlay element per row, positioned by ref. */
const RowDragOverlay = memo(({ rowKey, registerOverlay }: {
  rowKey: string; registerOverlay: (key: string, el: HTMLDivElement | null) => void;
}) => {
  return (
    <div
      ref={(el) => registerOverlay(rowKey, el)}
      className="drag-overlay-animate"
      style={{
        position: 'absolute', left: 0, top: 0, width: 0, height: 0,
        border: '1.5px dashed hsl(var(--primary-hsl) / 0.7)',
        borderRadius: 8, pointerEvents: 'none', zIndex: 2,
        display: 'none',
      }}
    />
  );
});
RowDragOverlay.displayName = 'RowDragOverlay';

interface RoomBars {
  byRoom: Map<number, { booking: Booking; leftPx: number; widthPx: number; isPast: boolean; isBlocker?: boolean }[]>;
  byBed: Map<string, { booking: Booking; leftPx: number; widthPx: number; isPast: boolean; isBlocker?: boolean }[]>;
}

/**
 * Pre-bucket bookings by room (and by room+bedIndex) in a single O(N) pass,
 * so per-row rendering is O(bars-in-row) instead of O(total-bookings).
 *
 * When a booking declares `additionalBeds`, blocker (red-stripe) items are
 * pushed onto each of those bed rows so other bookings cannot occupy them
 * for the same date range.
 */
function bucketBookings(
  bookings: Booking[],
  startDate: Date,
  totalDays: number,
  today: Date,
): RoomBars {
  const byRoom = new Map<number, { booking: Booking; leftPx: number; widthPx: number; isPast: boolean; isBlocker?: boolean }[]>();
  const byBed = new Map<string, { booking: Booking; leftPx: number; widthPx: number; isPast: boolean; isBlocker?: boolean }[]>();
  const totalPx = totalDays * DAY_WIDTH;
  for (const booking of bookings) {
    const bIn = parseISO(booking.checkIn);
    const bOut = parseISO(booking.checkOut);
    const startDayOffset = differenceInCalendarDays(bIn, startDate);
    const endDayOffset = differenceInCalendarDays(bOut, startDate);
    const earlyShift = booking.checkInHalfDay ? HALF_COL_WIDTH : 0;
    const startPx = Math.max(0, startDayOffset * DAY_WIDTH + HALF_COL_WIDTH - earlyShift);
    const halfExtra = booking.checkOutHalfDay ? HALF_COL_WIDTH : 0;
    const endPx = Math.min(totalPx, endDayOffset * DAY_WIDTH + HALF_COL_WIDTH + halfExtra);
    const w = endPx - startPx;
    if (w <= 0) continue;
    const isPast = isBefore(bOut, today);
    const item = { booking, leftPx: startPx, widthPx: w, isPast };
    if (booking.bedIndex === undefined) {
      const arr = byRoom.get(booking.roomNumber);
      if (arr) arr.push(item);
      else byRoom.set(booking.roomNumber, [item]);
    } else {
      const k = `${booking.roomNumber}:${booking.bedIndex}`;
      const arr = byBed.get(k);
      if (arr) arr.push(item);
      else byBed.set(k, [item]);
      // Blocker overlays for any additional bed slots this booking occupies.
      if (booking.additionalBeds && booking.additionalBeds.length) {
        for (const ab of booking.additionalBeds) {
          const kk = `${booking.roomNumber}:${ab}`;
          const blockerItem = { booking, leftPx: startPx, widthPx: w, isPast, isBlocker: true };
          const ar = byBed.get(kk);
          if (ar) ar.push(blockerItem);
          else byBed.set(kk, [blockerItem]);
        }
      }
    }
  }
  return { byRoom, byBed };
}

export function HotelRoomGrid({ bookings, conflictBookings = bookings, onAddBooking, onDeleteBooking, onUpdateBooking, focusBookingId, onFocusConsumed, labelWidth }: RoomGridProps) {
  const LABEL_WIDTH = labelWidth ?? DEFAULT_LABEL_WIDTH;
  const { t, lang } = useI18n();
  const { categories, rooms, categoryRates, removeCategory, removeRoom, setCategoryRate } = useHotelGrid();
  const { user } = useAuth();
  const { log: logAudit } = useAudit();
  const isManager = user?.role === 'manager';
  const isAdmin = user?.role === 'admin';
  const isSuperuser = user?.role === 'superuser';
  // Admin is restricted: cannot add/remove categories or rooms (only guests).
  const canManageStructure = !isAdmin;
  const canEditRate = user?.role === 'manager' || user?.role === 'superuser';
  const canSeeRate = canEditRate;
  const today = useMemo(() => startOfDay(new Date()), []);
  const [pastDays, setPastDays] = useState(isAdmin || isManager || isSuperuser ? ADMIN_INITIAL_PAST_DAYS : INITIAL_PAST_DAYS);
  const [futureDays, setFutureDays] = useState(INITIAL_FUTURE_DAYS);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [expandedRooms, setExpandedRooms] = useState<Record<number, boolean>>({});
  const [personNames, setPersonNames] = useState<PersonNames>({});
  const { data: extraPersons, setData: setExtraPersonsShared } = useSharedState<ExtraPersons>('guests', {});
  const setExtraPersons = useCallback(
    (updater: ExtraPersons | ((prev: ExtraPersons) => ExtraPersons)) => {
      setExtraPersonsShared(updater);
    },
    [setExtraPersonsShared],
  );
  // Auto-expand rooms that have extra guests added by any user/browser
  const [deletedPersonSlots, setDeletedPersonSlots] = useState<Record<number, Set<number>>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  // Two-step confirmation for superuser category deletion:
  //   step 1 = "there are bookings, they will all be wiped — continue?"
  //   step 2 = "this category is built into the system, only re-use it —
  //            really delete?"
  // Non-category deletes and non-superuser flows keep the single-step modal.
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  // When a superuser opens the delete dialog for a category that has no
  // bookings at all, skip the "bookings will be wiped" step and go straight
  // to the final "are you sure" prompt.
  useEffect(() => {
    if (!deleteTarget || deleteTarget.type !== 'category' || !isSuperuser) return;
    const catRoomNumbers = new Set(
      rooms.filter((r) => r.category === deleteTarget.id).map((r) => r.number),
    );
    const hasBookings = bookings.some((b) => catRoomNumbers.has(b.roomNumber));
    if (!hasBookings) setDeleteStep(2);
  }, [deleteTarget, isSuperuser, rooms, bookings]);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addRoomCategoryId, setAddRoomCategoryId] = useState<string | null>(null);
  const [rateEditCategoryId, setRateEditCategoryId] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState<string[]>([]);
  const [rateDraftNon, setRateDraftNon] = useState<string[]>([]);

  const toggleCategory = useCallback((catId: string) => {
    setCollapsedCategories(prev => ({ ...prev, [catId]: !prev[catId] }));
  }, []);
  const toggleRoomExpand = useCallback((roomNumber: number) => {
    setExpandedRooms(prev => ({ ...prev, [roomNumber]: !prev[roomNumber] }));
  }, []);
  const updatePersonName = useCallback((roomNumber: number, personIdx: number, name: string) => {
    setPersonNames(prev => ({ ...prev, [roomNumber]: { ...(prev[roomNumber] || {}), [personIdx]: name } }));
  }, []);
  const addExtraPerson = useCallback((roomNumber: number) => {
    setExtraPersons(prev => ({ ...prev, [roomNumber]: (prev[roomNumber] || 0) + 1 }));
    setExpandedRooms(prev => ({ ...prev, [roomNumber]: true }));
  }, [setExtraPersons]);
  const removeExtraPerson = useCallback((roomNumber: number, personIdx: number) => {
    setExtraPersons(prev => ({ ...prev, [roomNumber]: Math.max(0, (prev[roomNumber] || 0) - 1) }));
    setPersonNames(prev => {
      const copy = { ...(prev[roomNumber] || {}) };
      delete copy[personIdx];
      return { ...prev, [roomNumber]: copy };
    });
  }, [setExtraPersons]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'category') {
      // Superuser hard-delete flow: first press wipes every booking that
      // ever lived in any of this category's rooms, from every status list
      // (ожидают потверждения / забронированы / проживают / выехали / на
      // обслуживании / выехал обслуживание / грязный / убрано). Second
      // press then removes the category itself. Everything is written to
      // the audit / login history so the deletion is traceable.
      if (isSuperuser && deleteStep === 1) {
        const catRoomNumbers = new Set(
          rooms.filter((r) => r.category === deleteTarget.id).map((r) => r.number),
        );
        const affected = bookings.filter((b) => catRoomNumbers.has(b.roomNumber));
        // Wipe every affected booking regardless of status.
        affected.forEach((b) => {
          try { onDeleteBooking(b.id); } catch { /* ignore */ }
          try {
            logAudit({
              actor: {
                username: user?.username ?? 'superuser',
                role: (user?.role ?? 'superuser') as never,
                adminId: null,
              },
              category: 'booking',
              action: 'booking.deleted',
              summary:
                (lang === 'ru' ? 'Удалена бронь' : 'Booking deleted') +
                ` · ${lang === 'ru' ? 'номер' : 'room'} ${b.roomNumber} · ${b.status}`,
              details: {
                bookingId: b.id,
                roomNumber: b.roomNumber,
                status: b.status,
                checkIn: b.checkIn,
                checkOut: b.checkOut,
                reason: 'category-deleted',
                categoryId: deleteTarget.id,
                categoryLabel: deleteTarget.label,
              },
            });
          } catch { /* ignore */ }
        });
        // Summary entry so the login-history reader sees the wipe as one
        // event with every touched room number.
        try {
          logAudit({
            actor: {
              username: user?.username ?? 'superuser',
              role: (user?.role ?? 'superuser') as never,
              adminId: null,
            },
            category: 'system',
            action: 'category.bookings_wiped',
            summary:
              (lang === 'ru'
                ? `Удалены все бронирования категории "${deleteTarget.label}"`
                : `Wiped all bookings for category "${deleteTarget.label}"`) +
              ` · ${affected.length}`,
            details: {
              categoryId: deleteTarget.id,
              categoryLabel: deleteTarget.label,
              roomNumbers: Array.from(catRoomNumbers).sort((a, b) => a - b),
              deletedBookingIds: affected.map((b) => b.id),
              deletedCount: affected.length,
            },
          });
        } catch { /* ignore */ }
        // Advance to the second, "are you REALLY sure" prompt.
        setDeleteStep(2);
        return;
      }
      // Second press (superuser) or the legacy single-step flow: delete the
      // category. Also record the category removal itself.
      removeCategory(deleteTarget.id);
      try {
        logAudit({
          actor: {
            username: user?.username ?? 'superuser',
            role: (user?.role ?? 'superuser') as never,
            adminId: null,
          },
          category: 'system',
          action: 'category.deleted',
          summary:
            (lang === 'ru'
              ? `Категория удалена: ${deleteTarget.label}`
              : `Category deleted: ${deleteTarget.label}`),
          details: { categoryId: deleteTarget.id, categoryLabel: deleteTarget.label },
        });
      } catch { /* ignore */ }
      toast.success(lang === 'ru' ? `Категория удалена: ${deleteTarget.label}` : `Category deleted: ${deleteTarget.label}`);
    } else if (deleteTarget.type === 'room') {
      removeRoom(deleteTarget.roomNumber);
      toast.success(lang === 'ru' ? `Номер ${deleteTarget.roomNumber} удалён` : `Room ${deleteTarget.roomNumber} deleted`);
    } else if (deleteTarget.isExtra) {
      removeExtraPerson(deleteTarget.roomNumber, deleteTarget.personIdx);
      toast.success(lang === 'ru' ? 'Гость удалён' : 'Guest deleted');
    } else {
      setDeletedPersonSlots((prev) => {
        const next = new Set(prev[deleteTarget.roomNumber] ?? []);
        next.add(deleteTarget.personIdx);
        return { ...prev, [deleteTarget.roomNumber]: next };
      });
      setPersonNames((prev) => {
        const copy = { ...(prev[deleteTarget.roomNumber] || {}) };
        delete copy[deleteTarget.personIdx];
        return { ...prev, [deleteTarget.roomNumber]: copy };
      });
      toast.success(lang === 'ru' ? 'Гость удалён' : 'Guest deleted');
    }
    setDeleteTarget(null);
    setDeleteStep(1);
  }, [deleteTarget, deleteStep, isSuperuser, bookings, rooms, onDeleteBooking, logAudit, user, lang, removeCategory, removeRoom, removeExtraPerson]);

  const openRateEditor = useCallback((categoryId: string) => {
    setRateEditCategoryId(categoryId);
    const cur = categoryRates[categoryId];
    const cat = categories.find((c) => c.id === categoryId);
    const slots = Math.max(1, cat?.maxGuests ?? 1);
    const toDraft = (arr: number[] | undefined) =>
      Array.from({ length: slots }, (_, i) => {
        const v = arr?.[i];
        return v && v > 0 ? String(v) : '';
      });
    setRateDraft(toDraft(cur?.resident));
    setRateDraftNon(toDraft(cur?.nonResident));
  }, [categoryRates, categories]);

  const saveRate = useCallback(() => {
    if (!rateEditCategoryId) return;
    const cat = categories.find((c) => c.id === rateEditCategoryId);
    const slots = Math.max(1, cat?.maxGuests ?? 1);
    const toArr = (drafts: string[]) =>
      Array.from({ length: slots }, (_, i) => {
        const n = Number(String(drafts[i] ?? '').replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? Math.max(0, n) : 0;
      });
    setCategoryRate(rateEditCategoryId, { resident: toArr(rateDraft), nonResident: toArr(rateDraftNon) });
    toast.success(lang === 'ru' ? `Цена сохранена` : `Price saved`);
    setRateEditCategoryId(null);
    setRateDraft([]);
    setRateDraftNon([]);
  }, [lang, rateEditCategoryId, rateDraft, rateDraftNon, setCategoryRate, categories]);

  const startDate = useMemo(() => subDays(today, pastDays), [today, pastDays]);
  const totalDays = pastDays + futureDays;
  const dates = useMemo(() => Array.from({ length: totalDays }, (_, i) => addDays(startDate, i)), [startDate, totalDays]);
  const todayIdx = pastDays;
  const totalWidth = totalDays * DAY_WIDTH;
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollLeftRef = useRef<number | null>(null);
  const isPrependingPastRef = useRef(false);
  const pendingPastPrependDaysRef = useRef(0);
  // Pre-bucket bookings by row — single O(N) pass, recomputed only when bookings/dates change.
  const buckets = useMemo(
    () => bucketBookings(bookings, startDate, totalDays, today),
    [bookings, startDate, totalDays, today],
  );

  // ─── "FULL" room-row pills ────────────────────────────────────────────────
  // For each room, walk every half-day in the visible window and find
  // contiguous spans where every bed in the room is occupied (counting
  // maintenance, room-level bookings, and any `additionalBeds` blockers).
  // Those spans render as a single glowing pill on the room aggregate row,
  // which the user can click to open a dropdown of the underlying bookings.
  type FullRange = { startHalf: number; endHalf: number; bookingIds: string[] };
  const fullRangesByRoom = useMemo(() => {
    const result = new Map<number, FullRange[]>();
    const totalHalves = totalDays * 2;
    if (totalHalves <= 0) return result;
    const sd = dates[0];
    if (!sd) return result;
    const halfSpan = (b: Booking): [number, number] | null => {
      const startDay = differenceInCalendarDays(parseISO(b.checkIn), sd);
      const endDay = differenceInCalendarDays(parseISO(b.checkOut), sd);
      const startHalf = 2 * startDay + 1 - (b.checkInHalfDay ? 1 : 0);
      const endHalf = 2 * endDay + 1 + (b.checkOutHalfDay ? 1 : 0);
      return [startHalf, endHalf];
    };
    for (const room of rooms) {
      const cat = categories.find((c) => c.id === room.category);
      const personCount = PERSON_COUNTS[room.category] ?? cat?.maxGuests ?? 0;
      const totalBeds = personCount + (extraPersons[room.number] || 0);
      if (totalBeds < 1) continue;
      const occBeds: Set<number>[] = Array.from({ length: totalHalves }, () => new Set<number>());
      const occBks: Set<string>[] = Array.from({ length: totalHalves }, () => new Set<string>());
      for (const b of bookings) {
        if (b.roomNumber !== room.number) continue;
        const span = halfSpan(b);
        if (!span) continue;
        const beds: number[] = (b.status === 'maintenance' || b.bedIndex === undefined)
          ? Array.from({ length: totalBeds }, (_, i) => i)
          : [b.bedIndex as number, ...(b.additionalBeds ?? [])];
        const s = Math.max(0, span[0]);
        const e = Math.min(totalHalves, span[1]);
        for (let i = s; i < e; i++) {
          for (const bed of beds) occBeds[i].add(bed);
          occBks[i].add(b.id);
        }
      }
      const ranges: FullRange[] = [];
      let cur: { startHalf: number; endHalf: number; ids: Set<string> } | null = null;
      for (let i = 0; i < totalHalves; i++) {
        if (occBeds[i].size >= totalBeds) {
          if (!cur) cur = { startHalf: i, endHalf: i + 1, ids: new Set<string>() };
          else cur.endHalf = i + 1;
          for (const id of occBks[i]) cur.ids.add(id);
        } else if (cur) {
          ranges.push({ startHalf: cur.startHalf, endHalf: cur.endHalf, bookingIds: [...cur.ids] });
          cur = null;
        }
      }
      if (cur) ranges.push({ startHalf: cur.startHalf, endHalf: cur.endHalf, bookingIds: [...cur.ids] });
      if (ranges.length) result.set(room.number, ranges);
    }
    return result;
  }, [bookings, rooms, categories, extraPersons, totalDays, dates]);

  // Open state for the "Full" pill dropdown — key is `${roomNumber}:${startHalf}`.
  const [openFullKey, setOpenFullKey] = useState<string | null>(null);

  // Trigger the existing booking-focus-glow on every bar that belongs to a
  // booking in `ids`. Used when the user opens the Full-room dropdown or
  // clicks one of its rows.
  // Track all currently-glowing nodes so a global click can cancel every glow
  // immediately (feature: click-anywhere cancels the 3.5s focus glow).
  const activeGlowNodesRef = useRef<Set<HTMLElement>>(new Set());
  const activeFocusDoneRef = useRef<(() => void) | null>(null);
  const clearAllGlows = useCallback(() => {
    activeGlowNodesRef.current.forEach((node) => {
      node.classList.remove('booking-focus-glow');
      const prev = (node as HTMLElement & { _focusTimer?: number })._focusTimer;
      if (prev) window.clearTimeout(prev);
      (node as HTMLElement & { _focusTimer?: number })._focusTimer = undefined;
    });
    activeGlowNodesRef.current.clear();
    const finishFocus = activeFocusDoneRef.current;
    activeFocusDoneRef.current = null;
    finishFocus?.();
  }, []);
  const registerGlow = useCallback((node: HTMLElement, durationMs: number, onDone?: () => void) => {
    node.classList.remove('booking-focus-glow');
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    node.offsetWidth;
    node.classList.add('booking-focus-glow');
    activeGlowNodesRef.current.add(node);
    if (onDone) activeFocusDoneRef.current = onDone;
    const prev = (node as HTMLElement & { _focusTimer?: number })._focusTimer;
    if (prev) window.clearTimeout(prev);
    (node as HTMLElement & { _focusTimer?: number })._focusTimer = window.setTimeout(() => {
      node.classList.remove('booking-focus-glow');
      activeGlowNodesRef.current.delete(node);
      if (onDone && activeFocusDoneRef.current === onDone) {
        activeFocusDoneRef.current = null;
      }
      onDone?.();
    }, durationMs);
  }, []);
  useEffect(() => {
    const cancel = () => {
      if (activeGlowNodesRef.current.size > 0) clearAllGlows();
    };
    // Any explicit dropdown/panel close (notification panel, tile-grid
    // guest selector, etc.) dispatches `hotel:stop-focus-glow` so the
    // pulsation stops immediately and the next click on the grid isn't
    // swallowed by the "click-anywhere-cancels" listener below.
    const stopExplicit = () => clearAllGlows();
    window.addEventListener('mousedown', cancel, true);
    window.addEventListener('touchstart', cancel, true);
    window.addEventListener('hotel:stop-focus-glow', stopExplicit);
    return () => {
      window.removeEventListener('mousedown', cancel, true);
      window.removeEventListener('touchstart', cancel, true);
      window.removeEventListener('hotel:stop-focus-glow', stopExplicit);
    };
  }, [clearAllGlows]);

  const glowBookings = useCallback((ids: string[]) => {
    const root = scrollRef.current;
    if (!root) return;
    for (const id of ids) {
      const nodes = root.querySelectorAll<HTMLElement>(`[data-booking-id="${CSS.escape(id)}"]`);
      nodes.forEach((node) => registerGlow(node, 3500));
    }
  }, [registerGlow]);



  // Per-category status counts — auto-recomputes on add/delete/update.
  const categoryStatusCounts = useMemo(() => {
    const roomCat = new Map<number, string>();
    for (const r of rooms) roomCat.set(r.number, r.category);
    const out: Record<string, Record<BookingStatus, number>> = {};
    for (const c of categories) {
      out[c.id] = { confirmed: 0, pending: 0, booked: 0, 'in-house': 0, 'checked-out': 0, maintenance: 0, dirty: 0, cleaned: 0 };
    }
    for (const b of bookings) {
      const cat = roomCat.get(b.roomNumber);
      if (cat && out[cat]) out[cat][b.status] = (out[cat][b.status] ?? 0) + 1;
    }
    return out;
  }, [bookings, rooms, categories]);

  /* ──────────── Header drag-to-pan ─ direct listeners, zero React re-renders per move ──────────── */
  // Track whether the user is actively panning/dragging the timeline so we
  // can suppress the "load more days" prepend logic — otherwise growing the
  // past-window shifts scrollLeft while the user is still dragging and the
  // grid appears to teleport randomly.
  const isPanningRef = useRef(false);
  const isAppendingRef = useRef(false);
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    // Only respond to primary button
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startScroll = el.scrollLeft;

    let raf: number | null = null;
    let pendingX = startX;
    let hasDragged = false;
    const apply = () => {
      raf = null;
      const delta = pendingX - startX;
      if (!hasDragged && Math.abs(delta) < 4) return;
      if (!hasDragged) {
        hasDragged = true;
        el.classList.add('is-panning');
        isPanningRef.current = true;
      }
      const max = el.scrollWidth - el.clientWidth;
      const next = startScroll - delta;
      if (next >= max - EDGE_THRESHOLD && !isAppendingRef.current) {
        isAppendingRef.current = true;
        setFutureDays(prev => prev + LOAD_MORE_DAYS);
      }
      const clamped = Math.max(0, Math.min(max, next));
      el.scrollLeft = clamped;
      lastScrollLeftRef.current = clamped;
    };
    const move = (ev: MouseEvent) => {
      pendingX = ev.clientX;
      if (raf == null) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      if (raf != null) cancelAnimationFrame(raf);
      el.classList.remove('is-panning');
      isPanningRef.current = false;
      lastScrollLeftRef.current = el.scrollLeft;
      if (el.scrollLeft <= EDGE_THRESHOLD && !isPrependingPastRef.current) {
        isPrependingPastRef.current = true;
        pendingPastPrependDaysRef.current += LOAD_MORE_DAYS;
        setPastDays(prev => prev + LOAD_MORE_DAYS);
      }
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('mouseup', up);
  }, []);

  // Anchor: the scrollLeft at which TODAY's column is perfectly centered.
  const computeTodayScroll = useCallback((el: HTMLElement) => {
    const visibleWidth = Math.max(0, el.clientWidth - LABEL_WIDTH);
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const target = todayIdx * DAY_WIDTH - visibleWidth / 2 + DAY_WIDTH / 2;
    return Math.max(0, Math.min(max, target));
  }, [todayIdx, LABEL_WIDTH]);

  // Shared with the bottom scrollbar so the thumb can shrink by distance.
  const [centerScrollLeft, setCenterScrollLeft] = useState(0);
  const [todayResetNonce, setTodayResetNonce] = useState(0);

  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = computeTodayScroll(el);
    setCenterScrollLeft(next);
    setTodayResetNonce((n) => n + 1); // thumb snaps back to max width
    lastScrollLeftRef.current = next;
    el.scrollTo({ left: next, behavior: 'smooth' });
  }, [computeTodayScroll]);

  useEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (el) {
      const initialLeft = computeTodayScroll(el);
      el.scrollLeft = initialLeft;
      setCenterScrollLeft(initialLeft);
      lastScrollLeftRef.current = initialLeft;
      didInitialScroll.current = true;
    }
  }, [computeTodayScroll]);

  // Keep the anchor correct when the viewport resizes or the timeline grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recompute = () => setCenterScrollLeft(computeTodayScroll(el));
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener('resize', recompute);
    recompute();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [computeTodayScroll]);


  useEffect(() => {
    isAppendingRef.current = false;
  }, [futureDays]);

  useEffect(() => {
    const addedDays = pendingPastPrependDaysRef.current;
    if (addedDays <= 0) return;
    pendingPastPrependDaysRef.current = 0;
    isPrependingPastRef.current = false;
    const el = scrollRef.current;
    if (!el) return;
    const next = el.scrollLeft + addedDays * DAY_WIDTH;
    el.scrollLeft = next;
    lastScrollLeftRef.current = next;
  }, [pastDays]);

  /* ──────────── Focus a booking from URL param: scroll-into-view + glow ──────────── */
  useEffect(() => {
    if (!focusBookingId) return;
    const targetBooking = bookings.find((b) => b.id === focusBookingId);
    if (!targetBooking) return;

    // Make sure the row is actually rendered: un-collapse the category that
    // owns the room, and (when the booking is on a specific bed) expand the
    // room so the per-bed row exists in the DOM.
    const room = rooms.find((r) => r.number === targetBooking.roomNumber);
    if (room && collapsedCategories[room.category]) {
      setCollapsedCategories((prev) => ({ ...prev, [room.category]: false }));
    }
    if (targetBooking.bedIndex !== undefined && !expandedRooms[targetBooking.roomNumber]) {
      setExpandedRooms((prev) => ({ ...prev, [targetBooking.roomNumber]: true }));
    }

    // If the booking's check-in is far in the past, ensure we have enough past days loaded.
    const diff = differenceInCalendarDays(today, parseISO(targetBooking.checkIn));
    if (diff > pastDays - 3) {
      setPastDays((prev) => Math.max(prev, diff + LOAD_MORE_DAYS));
      // Wait for re-render before scrolling
      return;
    }

    // Defer two frames so DOM is laid out with up-to-date dates/buckets and
    // any newly-expanded rows have measured their final positions.
    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const node = el.querySelector<HTMLElement>(`[data-booking-id="${CSS.escape(focusBookingId)}"]`);
        if (!node) return;

        // Use live geometry (not inline style parsing) so we account for
        // anything the layout actually did — including per-bed sub-rows
        // rendered beneath the main booking bar.
        const elRect = el.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();

        // Horizontal: the sticky LABEL_WIDTH column overlays the left of
        // the scroller, so the actual visible content area starts at
        // scrollLeft + LABEL_WIDTH. Center the whole bar inside that
        // area — and if the bar is wider than the visible area, left-align
        // it just past the label with padding so the WHOLE booking is
        // visible instead of half-hidden under the sticky column.
        const visibleWidth = Math.max(1, el.clientWidth - LABEL_WIDTH);
        const EDGE_PAD_X = 32;
        const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
        // Node position in *content* coordinates (independent of current scrollLeft)
        const nodeLeftInContent = (nodeRect.left - elRect.left) + el.scrollLeft;
        const nodeWidth = nodeRect.width;
        let targetLeft: number;
        if (nodeWidth + EDGE_PAD_X * 2 >= visibleWidth) {
          targetLeft = nodeLeftInContent - LABEL_WIDTH - EDGE_PAD_X;
        } else {
          targetLeft = nodeLeftInContent - LABEL_WIDTH - (visibleWidth - nodeWidth) / 2;
        }
        targetLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft));

        // Vertical: the sticky bottom scrollbar (24px) overlays the bottom
        // of the scroller and the sticky day-header (~40px) overlays the
        // top, so the usable area is smaller than clientHeight. Center the
        // whole row inside that usable area so the entire booking (with
        // any per-bed rows below it) stays visible.
        const HEADER_H = 44;
        const BOTTOM_BAR_H = 24;
        const EDGE_PAD_Y = 12;
        const usableTop = HEADER_H + EDGE_PAD_Y;
        const usableBottom = el.clientHeight - BOTTOM_BAR_H - EDGE_PAD_Y;
        const usableH = Math.max(1, usableBottom - usableTop);
        const nodeTopInScroller = (nodeRect.top - elRect.top);
        const nodeH = nodeRect.height;
        let verticalDelta: number;
        if (nodeH >= usableH) {
          // Booking taller than the visible area — pin its top just under the header.
          verticalDelta = nodeTopInScroller - usableTop;
        } else {
          verticalDelta = nodeTopInScroller - (usableTop + (usableH - nodeH) / 2);
        }
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const targetTop = Math.max(0, Math.min(maxScrollTop, el.scrollTop + verticalDelta));

        el.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' });

        registerGlow(node, 3500, () => onFocusConsumed?.());

      });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [focusBookingId, bookings, rooms, pastDays, today, collapsedCategories, expandedRooms, onFocusConsumed, LABEL_WIDTH, registerGlow]);


  // rAF-throttled edge detection — avoids state churn on every scroll event.
  // Skip prepend/append while the user is actively panning the timeline so
  // we never shift scrollLeft underneath their cursor.
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      lastScrollLeftRef.current = el.scrollLeft;
      if (isPanningRef.current) return;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - EDGE_THRESHOLD) {
        setFutureDays(prev => prev + LOAD_MORE_DAYS);
      }
      // Keep extending the past as the user scrolls left — no hard limit for
      // superuser, admin, or manager grids.
      if (el.scrollLeft <= EDGE_THRESHOLD && !isPrependingPastRef.current) {
        isPrependingPastRef.current = true;
        pendingPastPrependDaysRef.current += LOAD_MORE_DAYS;
        setPastDays(prev => prev + LOAD_MORE_DAYS);
      }
    });
  }, []);

  const handleTimelineScrollbarDragState = useCallback((active: boolean) => {
    const el = scrollRef.current;
    isPanningRef.current = active;
    if (el) {
      el.classList.toggle('is-panning', active);
      if (!active) lastScrollLeftRef.current = el.scrollLeft;
    }
  }, []);

  const handleTimelineScrollbarEdgeRequest = useCallback((direction: 'past' | 'future') => {
    const el = scrollRef.current;
    if (!el) return;
    if (direction === 'future') {
      if (isAppendingRef.current) return;
      isAppendingRef.current = true;
      setFutureDays(prev => prev + LOAD_MORE_DAYS);
      return;
    }
    if (isPrependingPastRef.current) return;
    isPrependingPastRef.current = true;
    pendingPastPrependDaysRef.current += LOAD_MORE_DAYS;
    setPastDays(prev => prev + LOAD_MORE_DAYS);
  }, []);




  const preventNativeMiddleScroll = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  }, []);

  /* ────────────  Cell drag selection — REF-BASED, zero re-renders per pixel  ──────────── */
  const dragRef = useRef<{ roomKey: string; roomNumber: number; bedIndex?: number; height: number; startHalf: number; endHalf: number; invalid: boolean } | null>(null);
  const overlayElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const isDraggingRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);

  const registerOverlay = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) overlayElsRef.current.set(key, el);
    else overlayElsRef.current.delete(key);
  }, []);

  // Convert an existing booking into a [startHalf, endHalf) half-cell span on
  // the current dates window, accounting for early check-in / late checkout
  // half-cell extensions. Two bookings overlap iff their half-spans intersect.
  const bookingHalfSpan = useCallback((b: Booking): [number, number] | null => {
    const sd = datesRef.current[0];
    if (!sd) return null;
    const startDay = differenceInCalendarDays(parseISO(b.checkIn), sd);
    const endDay = differenceInCalendarDays(parseISO(b.checkOut), sd);
    const startHalf = 2 * startDay + 1 - (b.checkInHalfDay ? 1 : 0);
    const endHalf = 2 * endDay + 1 + (b.checkOutHalfDay ? 1 : 0);
    return [startHalf, endHalf];
  }, []);

  const rowsConflict = useCallback((a: Pick<Booking, 'roomNumber' | 'bedIndex' | 'status' | 'additionalBeds'>, b: Pick<Booking, 'roomNumber' | 'bedIndex' | 'status' | 'additionalBeds'>) => {
    if (a.roomNumber !== b.roomNumber) return false;
    const aRoomWide = a.status === 'maintenance' || a.bedIndex === undefined;
    const bRoomWide = b.status === 'maintenance' || b.bedIndex === undefined;
    if (aRoomWide || bRoomWide) return true;
    // Build the full bed-occupancy set for each side (primary bed + additional blocked beds).
    const aBeds = new Set<number>([a.bedIndex as number, ...(a.additionalBeds ?? [])]);
    const bBeds = new Set<number>([b.bedIndex as number, ...(b.additionalBeds ?? [])]);
    for (const x of aBeds) if (bBeds.has(x)) return true;
    return false;
  }, []);

  const hasBookingConflict = useCallback((candidate: Pick<Booking, 'roomNumber' | 'bedIndex' | 'status' | 'additionalBeds'>, startHalf: number, endHalf: number, excludeId?: string) => {
    return conflictBookingsRef.current.some((b) => {
      if (b.id === excludeId || !rowsConflict(candidate, b)) return false;
      const span = bookingHalfSpan(b);
      return !!span && span[0] < endHalf && span[1] > startHalf;
    });
  }, [bookingHalfSpan, rowsConflict]);

  const showOverlapError = useCallback(() => {
    toast.error(t('overlapError'));
  }, [t]);

  const computeDragOverlap = useCallback(() => {
    const d = dragRef.current;
    if (!d) return false;
    const startHalf = Math.min(d.startHalf, d.endHalf);
    const endHalfRaw = Math.max(d.startHalf, d.endHalf);
    const startDayIdx = Math.floor(startHalf / 2);
    let endDayIdx = Math.floor(endHalfRaw / 2);
    if (endDayIdx <= startDayIdx) endDayIdx = startDayIdx + 1;
    // New bookings always materialize as 14:00 → 12:00. Snap to the same
    // half-cells the final booking will occupy so the red preview matches
    // exactly what would actually be created.
    const newStartHalf = 2 * startDayIdx + 1;
    const newEndHalf = 2 * endDayIdx + 1;
    return hasBookingConflict({ roomNumber: d.roomNumber, bedIndex: d.bedIndex, status: 'confirmed' }, newStartHalf, newEndHalf);
  }, [hasBookingConflict]);

  const paintOverlay = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    const el = overlayElsRef.current.get(d.roomKey);
    if (!el) return;
    const minH = Math.min(d.startHalf, d.endHalf);
    const maxH = Math.max(d.startHalf, d.endHalf);
    const left = minH * HALF_COL_WIDTH;
    const width = (maxH - minH + 1) * HALF_COL_WIDTH;
    el.style.display = 'block';
    el.style.transform = `translate3d(${left}px, 0, 0)`;
    el.style.width = `${width}px`;
    el.style.height = `${d.height}px`;
    el.dataset.invalid = d.invalid ? 'true' : 'false';
  }, []);

  const hideAllOverlays = useCallback(() => {
    const d = dragRef.current;
    if (d) {
      const el = overlayElsRef.current.get(d.roomKey);
      if (el) { el.style.display = 'none'; el.dataset.invalid = 'false'; }
    }
  }, []);

  // Dialog state (set on mouseup commit only).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(101);
  const [selectedBedIndex, setSelectedBedIndex] = useState<number | undefined>(undefined);
  const [selectedPrefillName, setSelectedPrefillName] = useState<string>('');
  const [selectedCheckIn, setSelectedCheckIn] = useState(format(today, 'yyyy-MM-dd'));
  const [selectedCheckOut, setSelectedCheckOut] = useState(format(addDays(today, 2), 'yyyy-MM-dd'));
  const [selectedEarlyCheckin, setSelectedEarlyCheckin] = useState(false);
  const [selectedLateCheckout, setSelectedLateCheckout] = useState(false);
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [changeRoomMode, setChangeRoomMode] = useState<ChangeRoomMode>(null);
  const [changeHover, setChangeHover] = useState<{ roomNumber: number; bedIndex?: number; valid: boolean } | null>(null);
  const prevCollapsedRef = useRef<Record<string, boolean> | null>(null);
  const changeRoomModeRef = useRef<ChangeRoomMode>(null);
  changeRoomModeRef.current = changeRoomMode;

  // Stable refs for handlers used on each cell — avoid re-creating closures.
  const datesRef = useRef(dates);
  datesRef.current = dates;
  const totalDaysRef = useRef(totalDays);
  totalDaysRef.current = totalDays;
  const personNamesRef = useRef(personNames);
  personNamesRef.current = personNames;
  const bookingsRef = useRef(bookings);
  bookingsRef.current = bookings;
  const conflictBookingsRef = useRef(conflictBookings);
  conflictBookingsRef.current = conflictBookings;

  // Floating "N day(s)" tooltip that follows the cursor while drag-selecting a
  // booking range. Body-appended, transform-only updates for smooth animation.
  const dragTooltipRef = useRef<HTMLDivElement | null>(null);
  const ensureDragTooltip = useCallback(() => {
    if (dragTooltipRef.current) return dragTooltipRef.current;
    const el = document.createElement('div');
    el.className = 'drag-days-tooltip';
    el.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;padding:4px 10px;border-radius:9999px;background:hsl(222 47% 11% / 0.92);color:#fff;font-size:11px;font-weight:700;letter-spacing:0.02em;box-shadow:0 4px 14px rgba(0,0,0,.25);transform:translate3d(0,0,0);transition:opacity .12s ease;opacity:0;white-space:nowrap;';
    document.body.appendChild(el);
    dragTooltipRef.current = el;
    return el;
  }, []);
  const hideDragTooltip = useCallback(() => {
    const el = dragTooltipRef.current;
    if (el) el.style.opacity = '0';
  }, []);
  const paintDragTooltip = useCallback((clientX: number, clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const el = ensureDragTooltip();
    const minH = Math.min(d.startHalf, d.endHalf);
    const maxH = Math.max(d.startHalf, d.endHalf);
    const days = (maxH - minH + 1) / 2;
    const label = days === 1
      ? (lang === 'ru' ? '1 ночь' : lang === 'uz' ? '1 tun' : '1 night')
      : (lang === 'ru' ? `${days} ноч.` : lang === 'uz' ? `${days} tun` : `${days} nights`);
    el.textContent = label;
    // Offset to top-right of the cursor so it doesn't sit under the pointer.
    el.style.transform = `translate3d(${clientX + 14}px, ${clientY - 28}px, 0)`;
    el.style.opacity = '1';
    if (d.invalid) {
      el.style.background = 'hsl(0 72% 45% / 0.95)';
    } else {
      el.style.background = 'hsl(222 47% 11% / 0.92)';
    }
  }, [ensureDragTooltip, lang]);
  useEffect(() => {
    return () => {
      if (dragTooltipRef.current) {
        dragTooltipRef.current.remove();
        dragTooltipRef.current = null;
      }
    };
  }, []);

  const handleCellMouseDown = useCallback((roomNumber: number, bedIndex: number | undefined, height: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (changeRoomModeRef.current) {
      e.stopPropagation();
      hideAllOverlays();
      hideDragTooltip();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const halfIdx = Math.floor(x / HALF_COL_WIDTH);
    const roomKey = bedIndex === undefined ? `${roomNumber}` : `${roomNumber}:${bedIndex}`;
    isDraggingRef.current = true;
    dragRef.current = { roomKey, roomNumber, bedIndex, height, startHalf: halfIdx, endHalf: halfIdx, invalid: false };
    paintOverlay();
    paintDragTooltip(e.clientX, e.clientY);
  }, [paintOverlay, paintDragTooltip, hideAllOverlays, hideDragTooltip]);


  // Single window-level mousemove: handles drag for the active row.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragRef.current) return;
      if ((e.buttons & 1) === 0) {
        isDraggingRef.current = false;
        dragRef.current = null;
        hideAllOverlays();
        hideDragTooltip();
        return;
      }
      const el = overlayElsRef.current.get(dragRef.current.roomKey);
      if (!el || !el.parentElement) return;
      const rect = el.parentElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const halfIdx = Math.max(0, Math.min(Math.floor(x / HALF_COL_WIDTH), totalDaysRef.current * 2 - 1));
      if (dragRef.current.endHalf === halfIdx) {
        // Position-only tooltip update so it still follows the cursor.
        paintDragTooltip(e.clientX, e.clientY);
        return;
      }
      dragRef.current.endHalf = halfIdx;
      dragRef.current.invalid = computeDragOverlap();
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          paintOverlay();
        });
      }
      paintDragTooltip(e.clientX, e.clientY);
    };

    const onUp = () => {
      if (!isDraggingRef.current || !dragRef.current) {
        isDraggingRef.current = false;
        hideDragTooltip();
        return;
      }
      const d = dragRef.current;
      isDraggingRef.current = false;
      hideAllOverlays();
      hideDragTooltip();


      // INITIAL CREATION RULE: regardless of which half-cell the user
      // pressed/released on, a brand-new booking always starts at 14:00 of
      // the selected first day and ends at 12:00 of the selected last day.
      // Early check-in (08:00) and late checkout (24:00) are only available
      // AFTER the booking exists, by dragging its left/right edge — handled
      // in BookingBar via onResize / onResizeLeft.
      const startHalf = Math.min(d.startHalf, d.endHalf);
      const endHalf = Math.max(d.startHalf, d.endHalf);
      const startDayIdx = Math.floor(startHalf / 2);
      let endDayIdx = Math.floor(endHalf / 2);
      // Ensure at least one full night between check-in and check-out.
      if (endDayIdx <= startDayIdx) endDayIdx = startDayIdx + 1;
      const dts = datesRef.current;
      const checkInDate = dts[startDayIdx];
      const checkOutDate = dts[endDayIdx] ?? addDays(dts[startDayIdx], 1);
      dragRef.current = null;

      // Superuser and manager may create bookings in past dates without restriction.
      if (!isSuperuser && !isManager && isBefore(checkInDate, today)) {
        toast.error(t('pastBookingError'));
        return;
      }
      // Overlap guard: refuse drag-create that lands on (or even half-touches)
      // an existing booking in the same room/bed — uses half-cell precision
      // so adjacent bookings with early/late half-day extensions are caught.
      // Maintenance and whole-room bookings (bedIndex === undefined) block
      // every bed in that room.
      const newStartHalf = 2 * startDayIdx + 1;
      const newEndHalf = 2 * endDayIdx + 1;
      const overlaps = hasBookingConflict({ roomNumber: d.roomNumber, bedIndex: d.bedIndex, status: 'confirmed' }, newStartHalf, newEndHalf);
      if (overlaps) {
        showOverlapError();
        return;
      }
      setSelectedRoom(d.roomNumber);
      setSelectedBedIndex(d.bedIndex);
      setSelectedPrefillName(
        d.bedIndex !== undefined ? (personNamesRef.current[d.roomNumber]?.[d.bedIndex] || '') : ''
      );
      setSelectedCheckIn(format(checkInDate, 'yyyy-MM-dd'));
      setSelectedCheckOut(format(checkOutDate, 'yyyy-MM-dd'));
      // Force standard 14:00 → 12:00 window for any new booking.
      setSelectedEarlyCheckin(false);
      setSelectedLateCheckout(false);
      setEditBooking(null);
      setDialogOpen(true);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragRafRef.current != null) cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    };
  }, [today, t, paintOverlay, hideAllOverlays, computeDragOverlap, hasBookingConflict, showOverlapError, lang, paintDragTooltip, hideDragTooltip, isSuperuser, isManager]);

  /* ──────────── Booking move: middle-mouse drag-to-relocate ──────────── */
  type MoveGhost = {
    booking: Booking;
    width: number;
    height: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    targetRoom: number | null;
    targetBed: number | undefined;
    targetCheckIn: string | null;
    targetCheckOut: string | null;
    invalid: boolean;
    snapLeft: number | null;
    snapTop: number | null;
    snapWidth: number | null;
    snapHeight: number | null;
  };
  type MoveConfirm = {
    booking: Booking;
    targetRoom: number;
    targetBed: number | undefined;
    targetCheckIn: string;
    targetCheckOut: string;
  };
  const [moveGhost, setMoveGhost] = useState<MoveGhost | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<MoveConfirm | null>(null);
  const moveGhostRef = useRef<MoveGhost | null>(null);
  moveGhostRef.current = moveGhost;
  const moveActive = moveGhost != null;

  const handleBookingMoveStart = useCallback((booking: Booking, e: React.MouseEvent) => {
    // Superuser and manager are unrestricted: can drag any booking (past, in-house, dirty, maintenance...).
    if (!isSuperuser && !isManager) {
      if (isBefore(parseISO(booking.checkOut), today)) return; // past bookings: do not move
      // Admin can now drag in-house bookings too — but only vertically (enforced in the drag loop).
    }
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const ghost: MoveGhost = {
      booking,
      width: rect.width,
      height: rect.height,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      targetRoom: null,
      targetBed: undefined,
      targetCheckIn: null,
      targetCheckOut: null,
      invalid: false,
      snapLeft: null,
      snapTop: null,
      snapWidth: null,
      snapHeight: null,
    };
    setMoveGhost(ghost);
  }, [today, isSuperuser]);

  // Imperative ghost overlay handle — lets us move the ghost via CSS transforms
  // every frame without re-rendering the entire grid through React state.
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const ghostInvalidRef = useRef<boolean>(false);
  const ghostLabelRef = useRef<HTMLSpanElement | null>(null);

  // Global mousemove/mouseup for booking move.
  useEffect(() => {
    if (!moveActive) return;
    const original = moveGhostRef.current?.booking;
    if (!original) return;
    const nights = Math.max(1, differenceInCalendarDays(parseISO(original.checkOut), parseISO(original.checkIn)));

    // Latest pointer position; updated synchronously, consumed by rAF loop.
    let lastX = moveGhostRef.current?.x ?? 0;
    let lastY = moveGhostRef.current?.y ?? 0;
    let lastAppliedKey = ''; // key of last committed snap/target state
    let dirty = true;

    const applyGhostTransform = (left: number, top: number, width: number, height: number, invalid: boolean) => {
      const el = ghostElRef.current;
      if (!el) return;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.04) rotate(-0.6deg)`;
      if (invalid !== ghostInvalidRef.current) {
        ghostInvalidRef.current = invalid;
        el.dataset.invalid = invalid ? '1' : '0';
      }
    };

    const computeAndApply = () => {
      const ghost = moveGhostRef.current;
      if (!ghost) return;

      // ---- Edge auto-scroll: timeline (horizontal+vertical) AND window (vertical). ----
      // Wider trigger band + higher top speed than the previous version (which
      // felt sluggish) and an ease-out ramp so motion responds immediately when
      // the cursor crosses the edge instead of waiting for the quadratic build-up.
      const EDGE = 120;
      const MAX_SPEED = 60;
      const ramp = (dist: number) => {
        const f = Math.min(1, Math.max(0, dist) / EDGE);
        // Ease-out quad: f*(2-f) — responsive near the boundary, fast in the corner.
        return Math.ceil(f * (2 - f) * MAX_SPEED);
      };
      const scrollEl = scrollRef.current;
      if (scrollEl) {
        const r = scrollEl.getBoundingClientRect();
        let dx = 0;
        if (lastX < r.left + EDGE) dx = -ramp((r.left + EDGE) - lastX);
        else if (lastX > r.right - EDGE) dx = ramp(lastX - (r.right - EDGE));
        if (dx) { scrollEl.scrollLeft += dx; dirty = true; }
        // Vertical inside timeline scroller if it overflows — needed when the
        // category list extends past the visible grid area.
        if (scrollEl.scrollHeight > scrollEl.clientHeight) {
          let dy = 0;
          if (lastY < r.top + EDGE) dy = -ramp((r.top + EDGE) - lastY);
          else if (lastY > r.bottom - EDGE) dy = ramp(lastY - (r.bottom - EDGE));
          if (dy) { scrollEl.scrollTop += dy; dirty = true; }
        }
      }
      // Page-level vertical scroll: needed when the categories list extends
      // below the viewport (manager/admin/superuser dashboards).
      const vh = window.innerHeight;
      let wy = 0;
      if (lastY < EDGE) wy = -ramp(EDGE - lastY);
      else if (lastY > vh - EDGE) wy = ramp(lastY - (vh - EDGE));
      if (wy) {
        const before = window.scrollY;
        window.scrollBy(0, wy);
        if (window.scrollY !== before) dirty = true;
      }

      if (!dirty) return;
      dirty = false;

      // ---- Hit-test row under cursor ----
      const el = document.elementFromPoint(lastX, lastY);
      let row: HTMLElement | null = null;
      let cur: HTMLElement | null = el as HTMLElement | null;
      while (cur) {
        if (cur.dataset && cur.dataset.gridRow === 'true') { row = cur; break; }
        cur = cur.parentElement;
      }
      let targetRoom: number | null = null;
      let targetBed: number | undefined = undefined;
      let targetCheckIn: string | null = null;
      let targetCheckOut: string | null = null;
      let invalid = false;
      let snapLeft: number | null = null;
      let snapTop: number | null = null;
      let snapWidth: number | null = null;
      let snapHeight: number | null = null;
      if (row) {
        const rRoom = Number(row.dataset.roomNumber);
        const bedRaw = row.dataset.bedIndex ?? '';
        const rBed = bedRaw === '' ? undefined : Number(bedRaw);
        const rowRect = row.getBoundingClientRect();
        const dts = datesRef.current;
        let dayIdx: number;
        if (isAdmin) {
          // Admin: vertical-only movement. Lock the horizontal position to the
          // booking's original check-in day so dates never change during drag.
          dayIdx = Math.max(0, Math.min(totalDaysRef.current - 1,
            differenceInCalendarDays(parseISO(original.checkIn), dts[0])));
        } else {
          const x = lastX - rowRect.left - ghost.offsetX + HALF_COL_WIDTH;
          dayIdx = Math.max(0, Math.min(totalDaysRef.current - 1, Math.round(x / DAY_WIDTH)));
        }
        const ci = dts[dayIdx];
        const co = addDays(ci, nights);
        targetRoom = rRoom;
        targetBed = rBed;
        targetCheckIn = format(ci, 'yyyy-MM-dd');
        targetCheckOut = format(co, 'yyyy-MM-dd');
        // Superuser bypasses the past-date guard entirely.
        // Also skip the guard when dates aren't changing (vertical hold-and-drop
        // of an already-started / in-house booking to another room/category).
        const datesUnchanged = targetCheckIn === original.checkIn && targetCheckOut === original.checkOut;
        if (!isSuperuser && !isManager && !datesUnchanged && isBefore(ci, today)) invalid = true;

        if (!invalid) {
          const sh = 2 * dayIdx + 1 - (original.checkInHalfDay ? 1 : 0);
          const eh = 2 * (dayIdx + nights) + 1 + (original.checkOutHalfDay ? 1 : 0);
          if (hasBookingConflict({ roomNumber: rRoom, bedIndex: rBed, status: original.status }, sh, eh, original.id)) {
            invalid = true;
          }
        }
        const earlyShift = original.checkInHalfDay ? HALF_COL_WIDTH : 0;
        const halfExtra = original.checkOutHalfDay ? HALF_COL_WIDTH : 0;
        snapLeft = rowRect.left + dayIdx * DAY_WIDTH + HALF_COL_WIDTH - earlyShift;
        snapTop = rowRect.top;
        snapWidth = nights * DAY_WIDTH + earlyShift + halfExtra;
        snapHeight = rowRect.height;
      }

      // Apply position to the ghost element imperatively — no React rerender.
      const left = snapLeft != null ? snapLeft : lastX - ghost.offsetX;
      const top = snapTop != null ? snapTop : lastY - ghost.offsetY;
      const w = snapWidth != null ? snapWidth : ghost.width;
      const h = snapHeight != null ? snapHeight : ghost.height;
      applyGhostTransform(left, top, w, h, invalid);

      // Update label text only when target changes (cheap DOM mutation).
      const labelEl = ghostLabelRef.current;
      if (labelEl) {
        const txt = invalid
          ? (lang === 'ru' ? '✕ Невозможно разместить здесь' : '✕ Cannot drop here')
          : `↕ ${(original.guestName || '').trim() || (lang === 'ru' ? 'Бронирование' : 'Booking')}${targetCheckIn ? `   →  ${format(parseISO(targetCheckIn), 'dd MMM')}${targetRoom != null ? ` · #${targetRoom}` : ''}` : ''}`;
        if (labelEl.textContent !== txt) labelEl.textContent = txt;
      }

      // Mutate the ref so onUp/drop can read the current target. We deliberately
      // do NOT call setMoveGhost on every target change — re-rendering the
      // 1.5k-LOC grid at 60fps was the root cause of drag lag, especially while
      // edge auto-scroll fires every frame. The only React-visible thing that
      // matters during the drag is the invalid flag (ghost bg/border styling);
      // commit state only when it actually flips.
      const g = moveGhostRef.current;
      if (g) {
        g.targetRoom = targetRoom;
        g.targetBed = targetBed;
        g.targetCheckIn = targetCheckIn;
        g.targetCheckOut = targetCheckOut;
        g.snapLeft = snapLeft;
        g.snapTop = snapTop;
        g.snapWidth = snapWidth;
        g.snapHeight = snapHeight;
        g.invalid = invalid;
      }
      const invalidKey = invalid ? '1' : '0';
      if (invalidKey !== lastAppliedKey) {
        lastAppliedKey = invalidKey;
        setMoveGhost((prev) => prev ? { ...prev, invalid } : prev);
      }
    };

    // Single rAF pump: cheap when nothing changed (dirty flag short-circuits).
    let pumpId = 0;
    const pump = () => {
      computeAndApply();
      pumpId = requestAnimationFrame(pump);
    };
    pumpId = requestAnimationFrame(pump);

    const onMove = (e: MouseEvent) => {
      if ((e.buttons & 4) === 0) {
        setMoveGhost(null);
        return;
      }
      if (e.clientX !== lastX || e.clientY !== lastY) {
        lastX = e.clientX;
        lastY = e.clientY;
        dirty = true;
      }
    };

    const onScroll = () => { dirty = true; };

    const onUp = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const g = moveGhostRef.current;
      setMoveGhost(null);
      if (!g || g.targetRoom == null || !g.targetCheckIn || !g.targetCheckOut) return;
      if (
        g.targetRoom === original.roomNumber &&
        g.targetBed === original.bedIndex &&
        g.targetCheckIn === original.checkIn &&
        g.targetCheckOut === original.checkOut
      ) return;
      if (g.invalid) { toast.error(t('overlapError')); return; }
      moveResolvedRef.current = false;
      setMoveConfirm({
        booking: original,
        targetRoom: g.targetRoom,
        targetBed: g.targetBed,
        targetCheckIn: g.targetCheckIn,
        targetCheckOut: g.targetCheckOut,
      });
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoveGhost(null); };
    const onCancel = () => setMoveGhost(null);

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onCancel);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('mouseleave', onCancel);
    return () => {
      if (pumpId) cancelAnimationFrame(pumpId);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mouseleave', onCancel);
    };
  }, [moveActive, today, t, hasBookingConflict, lang, isAdmin, isSuperuser]);

  const moveResolvedRef = useRef(false);
  const confirmMove = useCallback(() => {
    if (!moveConfirm) return;
    const { booking, targetRoom, targetBed, targetCheckIn, targetCheckOut } = moveConfirm;

    // Hold-and-drop mid-stay category change: when an in-house booking is moved
    // to a room of a DIFFERENT category, split the
    // stay at today. Old room keeps the nights already lived, new room takes
    // the remaining nights; final price is the sum of both legs.
    const fromRoom = rooms.find((r) => r.number === booking.roomNumber);
    const toRoom = rooms.find((r) => r.number === targetRoom);
    const isCategoryChange = !!(fromRoom && toRoom && fromRoom.category !== toRoom.category);
    const todayIso = format(new Date(), 'yyyy-MM-dd');
    const canSplit =
      isCategoryChange &&
      booking.status === 'in-house' &&
      booking.checkIn < todayIso &&
      todayIso < booking.checkOut;

    if (canSplit && toRoom && fromRoom) {
      const originalSpan = bookingHalfSpan({ ...booking, roomNumber: targetRoom, bedIndex: targetBed, additionalBeds: undefined });
      if (originalSpan && hasBookingConflict({ roomNumber: targetRoom, bedIndex: targetBed, status: booking.status }, originalSpan[0], originalSpan[1], booking.id)) {
        toast.error(t('overlapError'));
        moveResolvedRef.current = true;
        setMoveConfirm(null);
        return;
      }
      const segments = splitBookingAt({
        booking,
        splitDate: computeSplitDateNow(booking),
        newRoomNumber: targetRoom,
        newCategoryId: toRoom.category,
        oldCategoryId: fromRoom.category,
        residency: (booking.residency ?? 'resident') as 'resident' | 'nonResident',
        categoryRates,
      });
      if (segments) {
        const total = sumSegments(segments);
        onUpdateBooking(booking.id, {
          roomNumber: targetRoom,
          bedIndex: targetBed,
          additionalBeds: undefined,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          segments,
          price: total,
          paymentAmount: total,
        });
        toast.success(lang === 'ru'
          ? `Категория изменена · ${segments.length} сегмента, итого ${total.toLocaleString('ru-RU')} сум`
          : `Category changed · ${segments.length} legs, total ${total.toLocaleString('en-US')} UZS`);
        moveResolvedRef.current = true;
        setMoveConfirm(null);
        return;
      }
    }

    onUpdateBooking(booking.id, {
      roomNumber: targetRoom,
      bedIndex: targetBed,
      checkIn: targetCheckIn,
      checkOut: targetCheckOut,
    });
    toast.success(lang === 'ru' ? 'Бронирование перемещено' : 'Booking moved');
    moveResolvedRef.current = true;
    setMoveConfirm(null);
  }, [moveConfirm, onUpdateBooking, lang, rooms, categoryRates, bookingHalfSpan, hasBookingConflict, t]);

  const cancelMove = useCallback(() => {
    if (moveResolvedRef.current) {
      moveResolvedRef.current = false;
      setMoveConfirm(null);
      return;
    }
    moveResolvedRef.current = true;
    setMoveConfirm(null);
    toast.message(lang === 'ru' ? 'Перемещение отменено' : 'Move cancelled');
  }, [lang]);

  const moveTargetRoomInfo = useMemo(() => {
    if (!moveConfirm) return null;
    const r = rooms.find((x) => x.number === moveConfirm.targetRoom);
    const c = r ? categories.find((cc) => cc.id === r.category) : null;
    return { room: r, category: c };
  }, [moveConfirm, rooms, categories]);

  const handleBookingClick = useCallback((booking: Booking) => {
    // While the operator is picking a free cell in change-room mode
    // (superuser / manager), clicking on any booking bar must NOT open the
    // fill-in dialog — the cursor is a plain "pointer" that only selects
    // a target. Admin keeps the historical behaviour.
    if (changeRoomModeRef.current && !isAdmin) {
      return;
    }
    setSelectedRoom(booking.roomNumber);
    setSelectedCheckIn(booking.checkIn);
    setSelectedCheckOut(booking.checkOut);
    setSelectedEarlyCheckin(!!booking.checkInHalfDay);
    setSelectedLateCheckout(!!booking.checkOutHalfDay);
    setEditBooking(booking);
    setDialogOpen(true);
  }, [isAdmin]);

  const handleResize = useCallback((id: string, newCheckOut: string, halfDay: boolean) => {
    onUpdateBooking(id, { checkOut: newCheckOut, checkOutHalfDay: halfDay });
  }, [onUpdateBooking]);
  const handleResizeLeft = useCallback((id: string, halfDay: boolean) => {
    onUpdateBooking(id, { checkInHalfDay: halfDay });
  }, [onUpdateBooking]);
  const canResize = useCallback((id: string, newCheckOut: string, halfDay: boolean) => {
    const booking = bookingsRef.current.find((b) => b.id === id);
    if (!booking) return true;
    const span = bookingHalfSpan({ ...booking, checkOut: newCheckOut, checkOutHalfDay: halfDay });
    return !span || !hasBookingConflict(booking, span[0], span[1], id);
  }, [bookingHalfSpan, hasBookingConflict]);
  const canResizeLeft = useCallback((id: string, halfDay: boolean) => {
    const booking = bookingsRef.current.find((b) => b.id === id);
    if (!booking) return true;
    const span = bookingHalfSpan({ ...booking, checkInHalfDay: halfDay });
    return !span || !hasBookingConflict(booking, span[0], span[1], id);
  }, [bookingHalfSpan, hasBookingConflict]);

  // Auto-route a new booking to whichever bed(s) are actually free.
  // - If the user dropped on a specific guest row whose bed is taken, but
  //   other beds in the same room are free for the chosen dates, the booking
  //   moves to the first available bed (the user is notified via toast).
  // - For guestCount > 1, additional free beds are reserved as blockers.
  // - If not enough free beds exist for the requested guest count, errors.
  const handleAddBookingWrapped = useCallback((b: Booking) => {
    if (b.status === 'maintenance') { onAddBooking(b); return; }
    const room = rooms.find((r) => r.number === b.roomNumber);
    if (!room) { onAddBooking(b); return; }
    const cat = categories.find((c) => c.id === room.category);
    const personCount = PERSON_COUNTS[room.category] ?? cat?.maxGuests ?? 0;
    const totalBeds = personCount + (extraPersons[room.number] || 0);
    if (totalBeds < 1) { onAddBooking(b); return; }
    const guestsNeeded = Math.max(1, b.guestCount || 1);
    const span = bookingHalfSpan(b);
    if (!span) { onAddBooking(b); return; }
    const [sh, eh] = span;
    // Search order: preferred bed first (if specified), then the rest ascending.
    const order: number[] = [];
    if (b.bedIndex !== undefined && b.bedIndex >= 0 && b.bedIndex < totalBeds) order.push(b.bedIndex);
    for (let i = 0; i < totalBeds; i++) if (i !== b.bedIndex) order.push(i);
    const free: number[] = [];
    for (const i of order) {
      if (!hasBookingConflict({ roomNumber: b.roomNumber, bedIndex: i, status: b.status }, sh, eh)) {
        free.push(i);
        if (free.length >= guestsNeeded) break;
      }
    }
    if (free.length < guestsNeeded) {
      toast.error(lang === 'ru'
        ? `Недостаточно свободных мест для ${guestsNeeded} ${guestsNeeded === 1 ? 'гостя' : 'гостей'} на выбранные даты`
        : `Not enough available beds for ${guestsNeeded} guest${guestsNeeded === 1 ? '' : 's'} on these dates`);
      return;
    }
    const [primary, ...rest] = free;
    if (b.bedIndex !== undefined && primary !== b.bedIndex) {
      toast.success(lang === 'ru'
        ? `Гость размещён на свободном месте №${primary + 1}`
        : `Guest placed on available bed #${primary + 1}`);
    }
    onAddBooking({ ...b, bedIndex: primary, additionalBeds: rest.length ? rest : undefined });
  }, [onAddBooking, rooms, categories, extraPersons, bookingHalfSpan, hasBookingConflict, lang]);

  // Wrap onUpdateBooking so that whenever an edit touches guest count, dates,
  // room or bed assignment, we recompute `additionalBeds` (the red-striped
  // blockers on the other guest rows). Dropping guestCount from 2 → 1 must
  // automatically clear the stripes; bumping 1 → 2 must auto-allocate another
  // free bed in the same room for the same dates so the stripes appear on it.
  // Applies uniformly to manager / admin / superuser panels.
  const handleUpdateBookingWrapped = useCallback((id: string, updates: Partial<Booking>) => {
    const reEvalKeys: (keyof Booking)[] = ['guestCount', 'checkIn', 'checkOut', 'checkInHalfDay', 'checkOutHalfDay', 'roomNumber', 'bedIndex', 'status'];
    const needsReEval = reEvalKeys.some((k) => k in updates);
    if (!needsReEval) {
      onUpdateBooking(id, updates);
      return;
    }
    const current = bookingsRef.current.find((b) => b.id === id);
    if (!current) { onUpdateBooking(id, updates); return; }
    const merged: Booking = { ...current, ...updates };
    // Maintenance & room-level entries (no bedIndex) don't carry additionalBeds.
    if (merged.bedIndex === undefined || merged.status === 'maintenance') {
      onUpdateBooking(id, updates);
      return;
    }
    const room = rooms.find((r) => r.number === merged.roomNumber);
    if (!room) { onUpdateBooking(id, updates); return; }
    const cat = categories.find((c) => c.id === room.category);
    const personCount = PERSON_COUNTS[room.category] ?? cat?.maxGuests ?? 0;
    const totalBeds = personCount + (extraPersons[merged.roomNumber] || 0);
    const guestsNeeded = Math.max(1, merged.guestCount || 1);
    if (guestsNeeded <= 1) {
      // Clear blockers — only the guest's own bed is occupied.
      onUpdateBooking(id, { ...updates, additionalBeds: undefined });
      return;
    }
    const span = bookingHalfSpan(merged);
    if (!span) { onUpdateBooking(id, updates); return; }
    const [sh, eh] = span;
    const extrasNeeded = guestsNeeded - 1;
    const extras: number[] = [];
    for (let i = 0; i < totalBeds && extras.length < extrasNeeded; i++) {
      if (i === merged.bedIndex) continue;
      if (!hasBookingConflict({ roomNumber: merged.roomNumber, bedIndex: i, status: merged.status }, sh, eh, id)) {
        extras.push(i);
      }
    }
    if (extras.length < extrasNeeded) {
      toast.error(lang === 'ru'
        ? `Недостаточно свободных мест для ${guestsNeeded} гостей на выбранные даты`
        : `Not enough available beds for ${guestsNeeded} guests on these dates`);
      return;
    }
    onUpdateBooking(id, { ...updates, additionalBeds: extras.length ? extras : undefined });
  }, [onUpdateBooking, rooms, categories, extraPersons, bookingHalfSpan, hasBookingConflict, lang]);


  const getDayLabel = useCallback((d: Date) => (lang === 'ru' ? DAY_LABELS_RU : DAY_LABELS_UZ)[d.getDay()], [lang]);
  const isTdy = useCallback((d: Date) => isSameDay(d, today), [today]);
  const isPast = useCallback((d: Date) => isBefore(d, today) && !isSameDay(d, today), [today]);
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  const monthStarts = useMemo(() => {
    const s = new Set<number>();
    dates.forEach((d, i) => { if (d.getDate() === 1) s.add(i); });
    s.add(0);
    return s;
  }, [dates]);

  /* ──────────── Change-room mode (from BookingDialog "Change room") ──────────── */
  // Compute the preview bar geometry once — the booking keeps its dates, so
  // left/width are identical on every candidate row.
  const changePreviewGeom = useMemo(() => {
    if (!changeRoomMode) return null;
    const b = changeRoomMode.booking;
    const bIn = parseISO(b.checkIn);
    const bOut = parseISO(b.checkOut);
    const startDayOffset = differenceInCalendarDays(bIn, startDate);
    const endDayOffset = differenceInCalendarDays(bOut, startDate);
    const earlyShift = b.checkInHalfDay ? HALF_COL_WIDTH : 0;
    const startPx = Math.max(0, startDayOffset * DAY_WIDTH + HALF_COL_WIDTH - earlyShift);
    const halfExtra = b.checkOutHalfDay ? HALF_COL_WIDTH : 0;
    const endPx = endDayOffset * DAY_WIDTH + HALF_COL_WIDTH + halfExtra;
    return { leftPx: startPx, widthPx: Math.max(0, endPx - startPx) };
  }, [changeRoomMode, startDate]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { bookingId?: string; categoryId?: string } | undefined;
      if (!detail?.bookingId || !detail?.categoryId) return;
      const b = bookingsRef.current.find((x) => x.id === detail.bookingId);
      if (!b) return;
      setChangeRoomMode({ booking: b, categoryId: detail.categoryId });
      toast.info(lang === 'ru' ? 'Наведите на свободную комнату и кликните' : lang === 'uz' ? 'Bo\u2018sh xonaga olib borib bosing' : 'Hover a free room and click');
    };
    window.addEventListener('hotel:change-room', handler as EventListener);
    return () => window.removeEventListener('hotel:change-room', handler as EventListener);
  }, [lang]);

  // Isolate the chosen category. For admins the historical behaviour is
  // preserved: all other categories are collapsed so only the target is
  // visible. For superuser & manager we keep every category expanded and
  // instead cover the non-target categories with a blurred red overlay
  // (rendered further below) so the operator still sees the whole grid
  // while being unable to interact with the wrong category.
  useEffect(() => {
    if (!changeRoomMode) {
      if (prevCollapsedRef.current !== null) {
        setCollapsedCategories(prevCollapsedRef.current);
        prevCollapsedRef.current = null;
      }
      setChangeHover(null);
      return;
    }
    const catId = changeRoomMode.categoryId;
    // Every role now uses the blur+lock focus experience: leave the target
    // category expanded (no auto-collapse of siblings). Locking only for
    // admin is enforced further below via `isChangeRoomLocked`.
    if (collapsedCategories[catId]) {
      if (prevCollapsedRef.current === null) {
        prevCollapsedRef.current = collapsedCategories;
      }
      setCollapsedCategories({ ...collapsedCategories, [catId]: false });
    }
    // Scroll the chosen category into view after layout updates.
    const raf = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector(`[data-category-id="${catId}"]`) as HTMLElement | null;
      if (!el) return;
      const top = el.offsetTop - 80;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeRoomMode, isAdmin]);

  // Admin-only scroll clamp during change-room mode. The operator can still
  // see the neighbouring blurred categories at the edges of the viewport,
  // but any scroll attempt beyond a small buffer snaps back — so admin
  // stays focused on the chosen category without losing awareness of the
  // rest of the grid.
  useEffect(() => {
    if (!changeRoomMode || !isAdmin) return;
    const container = scrollRef.current;
    if (!container) return;
    const BUFFER = 140; // px of blurred neighbours visible at each edge
    const HEADER = 80;  // sticky date header height compensation
    const computeBounds = () => {
      const el = container.querySelector(
        `[data-category-id="${changeRoomMode.categoryId}"]`,
      ) as HTMLElement | null;
      if (!el) return null;
      const top = Math.max(0, el.offsetTop - HEADER - BUFFER);
      const bottom = Math.max(
        top,
        el.offsetTop + el.offsetHeight - container.clientHeight + BUFFER,
      );
      return { top, bottom };
    };
    let bounds = computeBounds();
    const recompute = () => {
      bounds = computeBounds();
    };
    const onScroll = () => {
      if (!bounds) {
        bounds = computeBounds();
        if (!bounds) return;
      }
      const st = container.scrollTop;
      if (st < bounds.top) container.scrollTop = bounds.top;
      else if (st > bounds.bottom) container.scrollTop = bounds.bottom;
    };
    // Recompute after layout settles (collapsed siblings expanded, images).
    const raf = requestAnimationFrame(recompute);
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', recompute);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', recompute);
    };
  }, [changeRoomMode, isAdmin]);

  useEffect(() => {
    if (!changeRoomMode) return;
    const b = changeRoomMode.booking;
    const findRow = (target: EventTarget | null): HTMLElement | null => {
      let cur = target as HTMLElement | null;
      while (cur) {
        if (cur.dataset && cur.dataset.gridRow === 'true') return cur;
        cur = cur.parentElement;
      }
      return null;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChangeRoomMode(null); };
    const onMove = (e: MouseEvent) => {
      const row = findRow(e.target);
      if (!row) { setChangeHover(null); return; }
      const roomNumber = Number(row.dataset.roomNumber);
      if (!Number.isFinite(roomNumber)) { setChangeHover(null); return; }
      const room = rooms.find((r) => r.number === roomNumber);
      if (!room || room.category !== changeRoomMode.categoryId) {
        setChangeHover(null);
        return;
      }
      const bedRaw = row.dataset.bedIndex ?? '';
      const bedIndex = bedRaw === '' ? undefined : Number(bedRaw);
      const span = bookingHalfSpan(b);
      const valid = span
        ? !hasBookingConflict(
            { roomNumber, bedIndex, status: b.status, additionalBeds: b.additionalBeds },
            span[0], span[1], b.id,
          )
        : false;
      setChangeHover((prev) => {
        if (prev && prev.roomNumber === roomNumber && prev.bedIndex === bedIndex && prev.valid === valid) return prev;
        return { roomNumber, bedIndex, valid };
      });
    };
    const onClickCapture = (e: MouseEvent) => {
      const row = findRow(e.target);
      if (!row) return;
      const roomNumber = Number(row.dataset.roomNumber);
      if (!Number.isFinite(roomNumber)) return;
      const room = rooms.find((r) => r.number === roomNumber);
      if (!room) return;
      if (room.category !== changeRoomMode.categoryId) {
        toast.error(lang === 'ru' ? 'Комната не в выбранной категории' : lang === 'uz' ? 'Xona tanlangan kategoriyada emas' : 'Room is not in the selected category');
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (roomNumber === b.roomNumber) { setChangeRoomMode(null); return; }
      const span = bookingHalfSpan(b);
      if (!span) { setChangeRoomMode(null); return; }
      const bedRaw = row.dataset.bedIndex ?? '';
      const bedIndex = bedRaw === '' ? undefined : Number(bedRaw);
      const conflict = hasBookingConflict(
        { roomNumber, bedIndex, status: b.status, additionalBeds: b.additionalBeds },
        span[0], span[1], b.id,
      );
      if (conflict) {
        toast.error(t('overlapError'));
        e.preventDefault(); e.stopPropagation();
        return;
      }
      e.preventDefault(); e.stopPropagation();

      // Mid-stay category change: same rule as hold-and-drop confirmMove — if
      // the guest is currently in-house and the target category differs from
      // the current room, split the stay at today. Nights already lived keep
      // the OLD category price; remaining nights use the NEW category price.
      // Totals in Итого/Оставшаяся and the receipt read from `segments`.
      const fromRoom = rooms.find((r) => r.number === b.roomNumber);
      const toRoom = rooms.find((r) => r.number === roomNumber);
      const isCategoryChange = !!(fromRoom && toRoom && fromRoom.category !== toRoom.category);
      const todayIso = format(new Date(), 'yyyy-MM-dd');
      const canSplit =
        isCategoryChange &&
        b.status === 'in-house' &&
        b.checkIn < todayIso &&
        todayIso < b.checkOut;

      if (canSplit && toRoom && fromRoom) {
        const segments = splitBookingAt({
          booking: b,
          splitDate: computeSplitDateNow(b),
          newRoomNumber: roomNumber,
          newCategoryId: toRoom.category,
          oldCategoryId: fromRoom.category,
          residency: (b.residency ?? 'resident') as 'resident' | 'nonResident',
          categoryRates,
        });
        if (segments) {
          const total = sumSegments(segments);
          onUpdateBooking(b.id, {
            roomNumber,
            bedIndex,
            additionalBeds: undefined,
            segments,
            price: total,
            paymentAmount: total,
          });
          setChangeRoomMode(null);
          toast.success(lang === 'ru'
            ? `Категория изменена · ${segments.length} сегмента, итого ${total.toLocaleString('ru-RU')} сум`
            : lang === 'uz'
              ? `Kategoriya o‘zgartirildi · ${segments.length} qism, jami ${total.toLocaleString('ru-RU')} so‘m`
              : `Category changed · ${segments.length} legs, total ${total.toLocaleString('en-US')} UZS`);
          return;
        }
      }

      onUpdateBooking(b.id, { roomNumber, bedIndex });
      setChangeRoomMode(null);
      toast.success(lang === 'ru' ? 'Комната изменена' : lang === 'uz' ? 'Xona o\u2018zgartirildi' : 'Room changed');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, [changeRoomMode, rooms, bookingHalfSpan, hasBookingConflict, onUpdateBooking, t, lang, categoryRates]);

  // While the operator is picking the destination room, mark the body so
  // the CSS focus mode disables clicks on everything outside the main grid.
  // The grid itself stays fully interactive AND scrollable, so the user can
  // scroll through every category to compare options — only clicks outside
  // the grid are blocked. No blur / dimming is applied.
  useEffect(() => {
    if (!changeRoomMode) return;
    const body = document.body;
    body.classList.add('admin-change-room-focus');
    return () => {
      body.classList.remove('admin-change-room-focus');
    };
  }, [changeRoomMode]);




  return (
    <>
      {changeRoomMode && (
        <div data-change-room-banner="true" className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary px-5 py-2.5 text-primary-foreground shadow-2xl">
          <span className="text-[12px] font-black uppercase tracking-wider">
            {(lang === 'ru' ? 'Выберите свободную комнату' : lang === 'uz' ? 'Bo\u2018sh xonani tanlang' : 'Pick a free room')}
            {': '}
            <span className="opacity-90">
              {categories.find((c) => c.id === changeRoomMode.categoryId)?.label[lang] ||
                categories.find((c) => c.id === changeRoomMode.categoryId)?.label.en}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setChangeRoomMode(null)}
            className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider hover:bg-white/30"
          >
            {lang === 'ru' ? 'Отмена' : lang === 'uz' ? 'Bekor' : 'Cancel'} · ESC
          </button>
        </div>
      )}
      <div className="relative flex-1 min-h-0 flex flex-col">

        {!changeRoomMode && (
          <button
            type="button"
            onClick={scrollToToday}
            className="jump-today-btn group absolute top-3 right-5 z-30 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
            title={lang === 'ru' ? 'К сегодняшней дате' : 'Bugungi sanaga'}
          >
            <CalendarCheck2 className="h-3.5 w-3.5 transition-transform duration-500 group-hover:rotate-12" />
            {lang === 'ru' ? 'Сегодня' : 'Bugun'}
          </button>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onMouseDown={preventNativeMiddleScroll}
          onAuxClick={preventNativeMiddleScroll}
          className="timeline-scroll timeline-scroll--no-hbar flex-1 overflow-y-auto overflow-x-hidden select-none"
          style={{ contain: 'layout paint', willChange: 'scroll-position' }}
        >
          <div style={{ minWidth: totalWidth + LABEL_WIDTH }}>
            <div
              className={`timeline-date-header sticky top-0 z-40 flex bg-card ${changeRoomMode ? 'pointer-events-none opacity-90' : 'cursor-grab'}`}
              style={{ borderBottom: '2px solid hsl(var(--grid-line-bold))', background: 'hsl(var(--card))' }}
              onMouseDown={changeRoomMode ? undefined : handleHeaderMouseDown}
            >
              <div className="sticky left-0 z-30 shrink-0 bg-card flex items-center gap-2 px-3"
                style={{ width: LABEL_WIDTH, borderRight: '2px solid hsl(var(--grid-line-bold))', boxShadow: '4px 0 8px hsl(0 0% 0% / 0.06)' }}>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-foreground">{t('roomCategory')}</span>
                  <span className="text-[9px] text-muted-foreground font-semibold mt-0.5">
                    {lang === 'ru' ? 'Комната / Тип' : lang === 'uz' ? 'Xona / Turi' : 'Room / Type'}
                  </span>
                </div>
                {canManageStructure && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setAddCategoryOpen(true); }}
                  title={t('addCategory')}
                  className="add-control-fancy group inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-primary via-primary/90 to-primary/75 px-3 text-[10px] font-black uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/30 ring-1 ring-primary/40 hover:shadow-xl hover:shadow-primary/40 hover:scale-105 active:scale-95 transition-all"
                >
                  <FolderPlus className="h-3.5 w-3.5 transition-transform duration-300 group-hover:rotate-12" />
                  <span className="hidden xl:inline">{t('addCategory')}</span>
                </button>
                )}
              </div>
              <div className="flex">
                {dates.map((d, i) => (
                  <DayHeaderCell key={i} date={d} isToday={isTdy(d)} isPastDay={isPast(d)} isWeekendDay={isWeekend(d)}
                    dayLabel={getDayLabel(d)} lang={lang} isFirstOfMonth={monthStarts.has(i)} />
                ))}
              </div>
            </div>

            {categories.map(cat => {
              const catRooms = rooms.filter(r => r.category === cat.id);
              const isCollapsed = collapsedCategories[cat.id] ?? false;
              const personCount = PERSON_COUNTS[cat.id] ?? cat.maxGuests ?? 0;
              // In change-room mode, superuser/manager see all categories
              // but the ones that don't match the booking's category are
              // masked with a blurred red overlay and become non-interactive.
              // Change-room focus mode: blur + lock every non-target category.
              // Restricted to the admin panel per product requirement — other
              // roles keep full grid interactivity while picking the target.
              const isChangeRoomLocked =
                !!changeRoomMode &&
                cat.id !== changeRoomMode.categoryId;

              return (
                <div key={cat.id} data-category-id={cat.id} data-change-room-locked={isChangeRoomLocked ? 'true' : undefined} style={{ position: 'relative' }}>
                  {isChangeRoomLocked && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-auto absolute inset-0 z-30"
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onPointerMove={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onMouseUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onAuxClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      style={{
                        background: 'rgba(15, 23, 42, 0.35)',
                        backdropFilter: 'blur(10px) saturate(0.85)',
                        WebkitBackdropFilter: 'blur(10px) saturate(0.85)',
                        cursor: 'not-allowed',
                      }}
                    />
                  )}
                  <div
                    className="group/category flex cursor-pointer category-header hover:brightness-[1.02] transition-all"
                    style={{ borderTop: '2px solid hsl(var(--grid-line-bold))', borderBottom: '2px solid hsl(var(--primary-hsl) / 0.35)', background: 'linear-gradient(90deg, hsl(var(--primary-hsl) / 0.18) 0%, hsl(var(--primary-hsl) / 0.08) 60%, hsl(var(--primary-hsl) / 0.04) 100%)', height: 48 }}
                    onClick={() => toggleCategory(cat.id)}
                  >
                    <div className="sticky left-0 z-20 shrink-0 flex items-center gap-2.5 px-3 py-2 overflow-visible"
                      style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH, borderRight: '2px solid hsl(var(--grid-line-bold))', background: 'linear-gradient(90deg, hsl(var(--primary-hsl) / 0.22), hsl(var(--primary-hsl) / 0.14))', boxShadow: '4px 0 12px hsl(var(--primary-hsl) / 0.12)' }}>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/25">
                        {isCollapsed ? <ChevronRight className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1 overflow-visible">
                        <span className="text-[12px] font-extrabold text-foreground leading-tight block whitespace-normal break-words" title={cat.label[lang]}>
                          {categoryDisplay(cat, lang)}
                        </span>
                        <span className="text-[9px] text-muted-foreground font-semibold flex flex-wrap items-center gap-1 leading-tight">
                          <span className="uppercase tracking-wider text-primary/70 font-bold">{cat.short}</span>
                          <span className="opacity-60">·</span>
                          <span>{catRooms.length} {t('rooms')}</span>
                          {personCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-primary/80">
                              · <Users className="inline h-3 w-3" /> {personCount}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        {canEditRate ? (
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); openRateEditor(cat.id); }}
                            title={lang === 'ru' ? 'Цена за ночь' : 'Rate per night'}
                            className="inline-flex h-7 shrink-0 items-center rounded-full bg-emerald-500/12 px-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25 hover:bg-emerald-500 hover:text-white hover:ring-emerald-500 transition-colors"
                          >
                            {lang === 'ru' ? 'Цена' : 'Price'}
                          </button>
                        ) : null}
                        {canManageStructure && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setAddRoomCategoryId(cat.id); }}
                          title={t('addRoom')}
                          className="add-control-fancy inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card/95 text-primary ring-1 ring-primary/30 hover:bg-primary hover:text-primary-foreground transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        )}
                        {canManageStructure && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'category', id: cat.id, label: cat.label[lang] }); }}
                          title={lang === 'ru' ? 'Удалить категорию' : 'Delete category'}
                          className="delete-control-fancy flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card/90 text-destructive ring-1 ring-destructive/20 hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        )}
                      </div>
                    </div>
                    <div style={{ width: totalWidth, height: '100%', position: 'relative' }}>
                      <div
                        style={{ position: 'sticky', left: LABEL_WIDTH + 14, display: 'inline-flex', height: '100%', alignItems: 'center', paddingRight: 14, pointerEvents: 'auto', zIndex: 5 }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <CategoryStatusStrip counts={categoryStatusCounts[cat.id] ?? { confirmed: 0, pending: 0, booked: 0, 'in-house': 0, 'checked-out': 0, maintenance: 0 }} lang={lang} />
                      </div>
                    </div>
                  </div>

                  {!isCollapsed && catRooms.map((room) => {
                    const isExpanded = expandedRooms[room.number] ?? false;
                    const hasPersonRows = personCount >= 2;
                    const extra = extraPersons[room.number] || 0;
                    const totalPersons = personCount + extra;
                    const bars = buckets.byRoom.get(room.number) || [];
                    const roomKey = `${room.number}`;

                    return (
                      <div key={room.number} className={isExpanded ? 'person-section-expanded' : ''}>
                        <div className={`group/room flex grid-row ${isExpanded ? 'person-section-top-border' : ''}`}
                          style={{ borderBottom: '1px solid hsl(var(--grid-line))' }}>
                          <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-card px-2.5"
                            style={{ width: LABEL_WIDTH, borderRight: '2px solid hsl(var(--grid-line-bold))', boxShadow: '4px 0 8px hsl(0 0% 0% / 0.04)' }}>
                            {hasPersonRows ? (
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleRoomExpand(room.number); }}
                                className={`flex h-6 w-6 items-center justify-center rounded-lg transition-all duration-200 ${isExpanded ? 'bg-primary/20 shadow-sm' : 'hover:bg-primary/10'}`}
                                title={lang === 'ru' ? 'Показать кровати' : "Yotoqlarni ko'rsatish"}
                              >
                                <ChevronRight className={`h-3.5 w-3.5 text-primary/70 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                            ) : <div className="w-6" />}
                            <div className="relative flex h-7 w-9 items-center justify-center rounded-lg bg-primary/10 text-[12px] font-black text-primary">
                              {room.number}
                              <span
                                className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-card ${isRoomDirty(room.number, bookings) ? 'bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.85)] animate-pulse' : 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.55)]'}`}
                                title={isRoomDirty(room.number, bookings) ? (lang === 'ru' ? 'Грязный' : 'Dirty') : (lang === 'ru' ? 'Чистый' : 'Clean')}
                              />
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-[10px] font-bold text-foreground leading-tight truncate">
                                  {categoryDisplay(cat, lang)}
                              </span>
                              <span className="text-[9px] text-muted-foreground font-semibold truncate">{cat.short}</span>
                            </div>
                            {hasPersonRows && (
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); addExtraPerson(room.number); }}
                                title={lang === 'ru' ? 'Добавить гостя' : "Mehmon qo'shish"}
                                className="add-control-fancy flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20 hover:bg-primary hover:text-primary-foreground hover:scale-110 active:scale-95 transition-all duration-200 group"
                              >
                                <Plus className="h-3.5 w-3.5 group-hover:rotate-90 transition-transform duration-300" />
                              </button>
                            )}
                            {canManageStructure && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setDeleteTarget({ type: 'room', roomNumber: room.number }); }}
                              title={lang === 'ru' ? 'Удалить номер' : 'Delete room'}
                              className="delete-control-fancy flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 ring-1 ring-transparent transition-all hover:bg-destructive/15 hover:text-destructive hover:ring-destructive/25 hover:scale-105 active:scale-95"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            )}
                          </div>
                          <div
                            className="relative cursor-crosshair"
                            data-grid-row="true"
                            data-room-number={room.number}
                            data-bed-index={hasPersonRows ? 0 : ''}
                            style={{ width: totalWidth, height: ROW_HEIGHT, contain: 'layout paint' }}
                            onMouseDown={(e) => handleCellMouseDown(room.number, hasPersonRows ? 0 : undefined, ROW_HEIGHT, e)}
                          >
                            <RowBackground height={ROW_HEIGHT} totalWidth={totalWidth} todayOffset={todayIdx} totalDays={totalDays} />
                            <RowDragOverlay rowKey={hasPersonRows ? `${room.number}:0` : roomKey} registerOverlay={registerOverlay} />
                            {changeRoomMode && changePreviewGeom && changeHover?.roomNumber === room.number && (
                              <div
                                className="pointer-events-none absolute transition-opacity"
                                style={{
                                  left: changePreviewGeom.leftPx,
                                  width: changePreviewGeom.widthPx,
                                  top: 3,
                                  bottom: 3,
                                  zIndex: 4,
                                  borderRadius: 8,
                                  border: `2px dashed ${changeHover.valid ? 'hsl(var(--primary-hsl))' : 'hsl(var(--destructive))'}`,
                                  background: changeHover.valid
                                    ? 'hsl(var(--primary-hsl) / 0.22)'
                                    : 'hsl(var(--destructive) / 0.18)',
                                  boxShadow: changeHover.valid
                                    ? '0 0 0 3px hsl(var(--primary-hsl) / 0.15)'
                                    : '0 0 0 3px hsl(var(--destructive) / 0.12)',
                                }}
                              />
                            )}
                            {bars.map(({ booking, leftPx, widthPx, isPast: bp }) => (
                              <BookingBar
                                key={booking.id}
                                booking={booking}
                                leftPx={leftPx}
                                widthPx={widthPx}
                                onClick={handleBookingClick}
                                dayWidthPx={DAY_WIDTH}
                                isPast={bp}
                                onResize={handleResize}
                                canResize={canResize}
                                onResizeLeft={handleResizeLeft}
                                canResizeLeft={canResizeLeft}
                                onResizeConflict={showOverlapError}
                                onMoveStart={handleBookingMoveStart}
                              />
                            ))}
                            {hasPersonRows && (buckets.byBed.get(`${room.number}:0`) || []).map(({ booking, leftPx, widthPx, isPast: bp, isBlocker }) => (
                              isBlocker ? (
                                <div
                                  key={`blocker-room-${booking.id}`}
                                  className="booking-blocker-stripes"
                                  style={{
                                    position: 'absolute',
                                    left: leftPx,
                                    top: 6,
                                    width: widthPx,
                                    height: ROW_HEIGHT - 12,
                                    borderRadius: 6,
                                    pointerEvents: 'none',
                                    background: 'repeating-linear-gradient(135deg, rgba(136,19,55,0.55) 0 3px, rgba(136,19,55,0.04) 3px 9px)',
                                    border: '1px solid rgba(136,19,55,0.45)',
                                    boxShadow: 'none',
                                    opacity: bp ? 0.5 : 0.95,
                                  }}
                                  title={lang === 'ru' ? 'Занято бронированием' : 'Occupied by booking'}
                                />
                              ) : (
                                <BookingBar
                                  key={booking.id}
                                  booking={booking}
                                  leftPx={leftPx}
                                  widthPx={widthPx}
                                  onClick={handleBookingClick}
                                  dayWidthPx={DAY_WIDTH}
                                  isPast={bp}
                                  onResize={handleResize}
                                  canResize={canResize}
                                  onResizeLeft={handleResizeLeft}
                                  canResizeLeft={canResizeLeft}
                                  onResizeConflict={showOverlapError}
                                  onMoveStart={handleBookingMoveStart}
                                />
                              )
                            ))}
                          </div>
                        </div>

                        {hasPersonRows && isExpanded && (
                          <div className="person-section-body">
                            {Array.from({ length: totalPersons }, (_, pIdx) => {
                              if (pIdx === 0) return null;
                              if (deletedPersonSlots[room.number]?.has(pIdx)) return null;
                              const isExtra = pIdx >= personCount;
                              const personBars = buckets.byBed.get(`${room.number}:${pIdx}`) || [];
                              const bedKey = `${room.number}:${pIdx}`;
                              return (
                                <div key={pIdx} className="group/guest flex person-row-animate person-row-active person-row-hover"
                                  style={{ borderBottom: pIdx < totalPersons - 1 ? '1px solid hsl(var(--grid-line))' : 'none', animationDelay: `${pIdx * 60}ms` }}>
                                  <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 px-2.5 pl-12"
                                    style={{ width: LABEL_WIDTH, borderRight: '2px solid hsl(var(--grid-line-bold))', background: 'hsl(var(--grid-person-expanded-bg))', boxShadow: '4px 0 8px hsl(0 0% 0% / 0.03)' }}>
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full ${isExtra ? 'bg-primary/30' : 'bg-primary/20'}`}>
                                      <User className="h-3 w-3 text-primary/70" />
                                    </div>
                                    {(() => {
                                      const guestDirty = bookings.some((b) => b.roomNumber === room.number && b.bedIndex === pIdx && b.status === 'dirty');
                                      return (
                                        <span
                                          className={`h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-background ${guestDirty ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}
                                          title={guestDirty ? (lang === 'ru' ? 'Грязный' : 'Dirty') : (lang === 'ru' ? 'Чистый' : 'Clean')}
                                        />
                                      );
                                    })()}
                                    <input
                                      type="text"
                                      value={personNames[room.number]?.[pIdx] ?? ''}
                                      onChange={(e) => updatePersonName(room.number, pIdx, e.target.value.slice(0, 28))}
                                      placeholder={`${t('person')} ${pIdx + 1}`}
                                      maxLength={28}
                                      className="person-name-input text-[10px] font-bold text-muted-foreground/80 bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-muted-foreground/50 focus:text-foreground h-6 px-1.5 rounded-md transition-all duration-200 hover:bg-primary/5"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    {(isExtra || !isAdmin) ? (
                                      <button
                                        type="button"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'guest', roomNumber: room.number, personIdx: pIdx, isExtra }); }}
                                        title={lang === 'ru' ? 'Удалить гостя' : "Mehmonni olib tashlash"}
                                        className="delete-control-fancy flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 ring-1 ring-transparent transition-all hover:bg-destructive/15 hover:text-destructive hover:ring-destructive/25 hover:scale-105 active:scale-95"
                                      >
                                        {isExtra ? <X className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                                      </button>
                                    ) : (
                                      <span className="h-6 w-6 shrink-0" aria-hidden="true" />
                                    )}
                                  </div>
                                  <div
                                    className="relative cursor-crosshair"
                                    data-grid-row="true"
                                    data-room-number={room.number}
                                    data-bed-index={pIdx}
                                    style={{ width: totalWidth, height: PERSON_ROW_HEIGHT, contain: 'layout paint' }}
                                    onMouseDown={(e) => handleCellMouseDown(room.number, pIdx, PERSON_ROW_HEIGHT, e)}
                                  >
                                    <RowBackground height={PERSON_ROW_HEIGHT} totalWidth={totalWidth} todayOffset={todayIdx} totalDays={totalDays} />
                                    <RowDragOverlay rowKey={bedKey} registerOverlay={registerOverlay} />
                                    {personBars.map(({ booking, leftPx, widthPx, isPast: bp, isBlocker }) => (
                                      isBlocker ? (
                                        <div
                                          key={`blocker-${booking.id}-${pIdx}`}
                                          className="booking-blocker-stripes"
                                          style={{
                                            position: 'absolute',
                                            left: leftPx,
                                            top: 5,
                                            width: widthPx,
                                            height: PERSON_ROW_HEIGHT - 10,
                                            borderRadius: 6,
                                            pointerEvents: 'none',
                                            // Refined, restrained diagonal stripes — narrow, monochrome
                                            // crimson on near-transparent ground. Reads as "blocked"
                                            // without the previous candy-cane intensity.
                                            background: 'repeating-linear-gradient(135deg, rgba(136,19,55,0.55) 0 3px, rgba(136,19,55,0.04) 3px 9px)',
                                            border: '1px solid rgba(136,19,55,0.45)',
                                            boxShadow: 'none',
                                            opacity: bp ? 0.5 : 0.95,
                                          }}
                                          title={lang === 'ru' ? 'Занято бронированием' : 'Occupied by booking'}
                                        />
                                      ) : (
                                        <BookingBar
                                          key={booking.id}
                                          booking={booking}
                                          leftPx={leftPx}
                                          widthPx={widthPx}
                                          onClick={handleBookingClick}
                                          dayWidthPx={DAY_WIDTH}
                                          isPast={bp}
                                          onResize={handleResize}
                                          canResize={canResize}
                                          onResizeLeft={handleResizeLeft}
                                          canResizeLeft={canResizeLeft}
                                          onResizeConflict={showOverlapError}
                                          onMoveStart={handleBookingMoveStart}
                                        />
                                      )
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <TimelineBottomScrollbar
          scrollRef={scrollRef}
          labelWidth={LABEL_WIDTH}
          centerScrollLeft={centerScrollLeft}
          resetNonce={todayResetNonce}
          onDragStateChange={handleTimelineScrollbarDragState}
          onEdgeRequest={handleTimelineScrollbarEdgeRequest}
        />

      </div>

      <BookingDialog
        open={dialogOpen}
        onClose={() => { clearAllGlows(); setDialogOpen(false); setEditBooking(null); setSelectedBedIndex(undefined); setSelectedPrefillName(''); setSelectedEarlyCheckin(false); setSelectedLateCheckout(false); }}
        onSave={handleAddBookingWrapped}
        onUpdate={handleUpdateBookingWrapped}
        onDelete={onDeleteBooking}
        roomNumber={selectedRoom}
        checkIn={selectedCheckIn}
        checkOut={selectedCheckOut}
        editBooking={editBooking}
        bedIndex={selectedBedIndex}
        prefillName={selectedPrefillName}
        initialEarlyCheckin={selectedEarlyCheckin}
        initialLateCheckout={selectedLateCheckout}
        extraGuestSlots={extraPersons[selectedRoom] || 0}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteStep(1);
          }
        }}
      >
        <AlertDialogContent className="overflow-hidden rounded-2xl border-2 border-destructive/25 bg-card p-0 shadow-2xl">
          <div className="relative p-6">
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,hsl(var(--destructive)/0.16),transparent_38%),linear-gradient(135deg,hsl(var(--destructive)/0.08),transparent_52%)]" />
            <AlertDialogHeader className="relative gap-3 text-left">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/12 text-destructive ring-1 ring-destructive/25">
                <AlertTriangle className="h-6 w-6" />
              </div>
              {(() => {
                // Superuser + category delete uses a two-step confirmation.
                // Everything else keeps the original single prompt.
                const isCatSuperuser =
                  isSuperuser && deleteTarget?.type === 'category';
                if (isCatSuperuser && deleteTarget?.type === 'category') {
                  const catRoomNumbers = rooms
                    .filter((r) => r.category === deleteTarget.id)
                    .map((r) => r.number);
                  const affectedCount = bookings.filter((b) =>
                    catRoomNumbers.includes(b.roomNumber),
                  ).length;
                  if (deleteStep === 1) {
                    return (
                      <>
                        <AlertDialogTitle className="font-display text-xl font-black">
                          {lang === 'ru'
                            ? 'Действительно удалить категорию?'
                            : 'Really delete this category?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-sm font-medium leading-relaxed">
                          {lang === 'ru'
                            ? `В категории «${deleteTarget.label}» ${affectedCount === 1 ? 'есть 1 активное бронирование' : `есть ${affectedCount} активных бронирований`}. Если продолжить, ${affectedCount === 1 ? 'оно будет удалено' : 'все они будут удалены'} без возможности восстановления, а номера ${catRoomNumbers.join(', ') || '—'} будут записаны в историю входов.`
                            : `Category "${deleteTarget.label}" has ${affectedCount === 1 ? '1 active booking' : `${affectedCount} active bookings`}. If you continue, ${affectedCount === 1 ? 'it will be' : 'they will all be'} permanently deleted, and rooms ${catRoomNumbers.join(', ') || '—'} will be written to the login history.`}
                        </AlertDialogDescription>
                      </>
                    );
                  }
                  return (
                    <>
                      <AlertDialogTitle className="font-display text-xl font-black">
                        {lang === 'ru'
                          ? 'Точно удалить эту категорию?'
                          : 'Delete this category for real?'}
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-sm font-medium leading-relaxed">
                        {lang === 'ru'
                          ? `Эта категория уже встроена в систему — просто используйте её. Если вы всё равно нажмёте «Удалить», категория «${deleteTarget.label}» будет удалена окончательно.`
                          : `This category is already built into the system — just use it. If you still press "Delete", category "${deleteTarget.label}" will be removed for good.`}
                      </AlertDialogDescription>
                    </>
                  );
                }
                return (
                  <>
                    <AlertDialogTitle className="font-display text-xl font-black">
                      {lang === 'ru' ? 'Вы уверены?' : 'Are you sure?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm font-medium leading-relaxed">
                      {lang === 'ru'
                        ? 'После подтверждения выбранный элемент будет скрыт из сетки. Это действие нельзя отменить в этом окне.'
                        : 'After confirmation, the selected item will be hidden from the grid. This action cannot be undone here.'}
                    </AlertDialogDescription>
                  </>
                );
              })()}
            </AlertDialogHeader>
            <AlertDialogFooter className="relative mt-6 gap-2 sm:space-x-0">
              <AlertDialogCancel
                onClick={() => setDeleteStep(1)}
                className="rounded-xl border-border/70 bg-background/80 font-bold"
              >
                {t('cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Keep the dialog open when the superuser is on step 1 of
                  // the category-delete flow — the wipe runs, then the
                  // second warning shows in the same modal.
                  if (
                    isSuperuser &&
                    deleteTarget?.type === 'category' &&
                    deleteStep === 1
                  ) {
                    e.preventDefault();
                  }
                  confirmDelete();
                }}
                className="rounded-xl bg-destructive font-black text-destructive-foreground shadow-lg shadow-destructive/25 hover:bg-destructive/90"
              >
                {isSuperuser && deleteTarget?.type === 'category' && deleteStep === 1
                  ? (lang === 'ru' ? 'Удалить бронирования' : 'Delete bookings')
                  : t('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>


      <AlertDialog open={rateEditCategoryId !== null} onOpenChange={(open) => !open && setRateEditCategoryId(null)}>
        <AlertDialogContent
          className="overflow-hidden rounded-2xl border-2 border-primary/20 bg-card p-0 shadow-2xl"
          style={{
            maxWidth: `${Math.min(Math.max(1, categories.find((c) => c.id === rateEditCategoryId)?.maxGuests ?? 1), 4) * 260 + 48}px`,
          }}
        >
          <div className="relative p-6">
            <AlertDialogHeader className="text-left">
              <AlertDialogTitle className="font-display text-xl font-black">
                {lang === 'ru' ? 'Цена категории' : 'Category price'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {(() => {
                  const c = categories.find((x) => x.id === rateEditCategoryId);
                  return c ? categoryDisplay(c, lang) : '';
                })()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {(() => {
              const editingCat = categories.find((c) => c.id === rateEditCategoryId);
              const slots = Math.max(1, editingCat?.maxGuests ?? 1);
              const guestLabel = (i: number) =>
                lang === 'ru' ? `Гость ${i + 1}` : lang === 'uz' ? `Mehmon ${i + 1}` : `Guest ${i + 1}`;
              const updateAt = (
                setter: React.Dispatch<React.SetStateAction<string[]>>,
                idx: number,
                v: string,
              ) =>
                setter((prev) => {
                  const next = prev.slice();
                  while (next.length < slots) next.push('');
                  next[idx] = v.replace(/\D/g, '').slice(0, 18);
                  return next;
                });
              const fmt = (raw: string | undefined) =>
                raw ? Number(String(raw).replace(/\D/g, '')).toLocaleString('ru-RU') : '';
              const residentLabel = lang === 'ru' ? 'Резидент' : 'Resident';
              const nonResidentLabel = lang === 'ru' ? 'Нерезидент' : 'Non-resident';
              const cols = Math.min(slots, 4);
              const gridColsClass =
                cols >= 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                : cols === 3 ? 'grid-cols-1 sm:grid-cols-3'
                : cols === 2 ? 'grid-cols-1 sm:grid-cols-2'
                : 'grid-cols-1';
              return (
                <div className="mt-5 max-h-[60vh] overflow-y-auto pr-1">
                  <div className={`grid gap-3 ${gridColsClass}`}>
                    {Array.from({ length: slots }).map((_, i) => (
                      <div
                        key={`guest-${i}`}
                        className="min-w-0 rounded-2xl border border-border/70 bg-background/60 p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-black text-foreground">
                            {guestLabel(i)}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                            #{i + 1}
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          <div>
                            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                              {residentLabel}
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                              <span className="shrink-0 text-xs font-black text-emerald-500">сум</span>
                              <input
                                autoFocus={i === 0}
                                type="text"
                                inputMode="numeric"
                                value={fmt(rateDraft[i])}
                                onChange={(e) => updateAt(setRateDraft, i, e.target.value)}
                                className="h-9 w-full min-w-0 flex-1 bg-transparent text-sm font-black tabular-nums text-foreground outline-none"
                                placeholder="0"
                              />
                              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">UZS</span>
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600">
                              {nonResidentLabel}
                            </div>
                            <div className="flex min-w-0 items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                              <span className="shrink-0 text-xs font-black text-amber-500">сум</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={fmt(rateDraftNon[i])}
                                onChange={(e) => updateAt(setRateDraftNon, i, e.target.value)}
                                className="h-9 w-full min-w-0 flex-1 bg-transparent text-sm font-black tabular-nums text-foreground outline-none"
                                placeholder="0"
                              />
                              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">UZS</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <AlertDialogFooter className="mt-6 gap-2 sm:space-x-0">
              <AlertDialogCancel className="rounded-xl border-border/70 bg-background/80 font-bold">
                {t('cancel')}
              </AlertDialogCancel>
              <AlertDialogAction onClick={saveRate} className="rounded-xl bg-primary font-black text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90">
                <Check className="mr-1.5 h-4 w-4" /> {t('save')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AddCategoryDialog open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)} />
      <AddRoomDialog
        open={addRoomCategoryId !== null}
        onClose={() => setAddRoomCategoryId(null)}
        category={categories.find((c) => c.id === addRoomCategoryId) ?? null}
      />

      {/* Drag-to-move ghost overlay — positioned imperatively via refs to avoid per-frame React re-renders. */}
      {moveGhost && typeof document !== 'undefined' && createPortal(
        <div
          ref={(el) => {
            ghostElRef.current = el;
            if (el) {
              // Seed initial position so we don't see a (0,0) flash on mount.
              const g = moveGhostRef.current;
              if (g) {
                const left = g.snapLeft != null ? g.snapLeft : g.x - g.offsetX;
                const top = g.snapTop != null ? g.snapTop : g.y - g.offsetY;
                const w = g.snapWidth != null ? g.snapWidth : g.width;
                const h = g.snapHeight != null ? g.snapHeight : g.height;
                el.style.width = `${w}px`;
                el.style.height = `${h}px`;
                el.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.04) rotate(-0.6deg)`;
                el.dataset.invalid = g.invalid ? '1' : '0';
              }
            }
          }}
          data-invalid={moveGhost.invalid ? '1' : '0'}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            willChange: 'transform',
            pointerEvents: 'none',
            zIndex: 9999,
            borderRadius: 12,
            background: moveGhost.invalid
              ? 'linear-gradient(135deg, hsl(var(--destructive) / 0.85), hsl(var(--destructive) / 0.65))'
              : 'linear-gradient(135deg, hsl(var(--primary-hsl) / 0.85), hsl(var(--primary-hsl) / 0.6))',
            color: 'hsl(var(--primary-foreground))',
            border: moveGhost.invalid
              ? '2px solid hsl(var(--destructive))'
              : '2px solid hsl(var(--primary-hsl))',
            boxShadow: moveGhost.invalid
              ? '0 18px 40px -10px hsl(var(--destructive) / 0.55), 0 0 0 4px hsl(var(--destructive) / 0.18)'
              : '0 18px 40px -10px hsl(var(--primary-hsl) / 0.55), 0 0 0 4px hsl(var(--primary-hsl) / 0.18)',
            transition: 'background 120ms ease, border-color 120ms ease, box-shadow 160ms ease',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            fontSize: 12,
            fontWeight: 700,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(2px)',
          }}
        >
          <span
            ref={(el) => { ghostLabelRef.current = el; }}
            style={{ opacity: 0.95, textOverflow: 'ellipsis', overflow: 'hidden' }}
          >
            {moveGhost.invalid
              ? (lang === 'ru' ? '✕ Невозможно разместить здесь' : '✕ Cannot drop here')
              : `↕ ${(moveGhost.booking.guestName || '').trim() || (lang === 'ru' ? 'Бронирование' : 'Booking')}`}
          </span>
        </div>,
        document.body,
      )}

      {/* Move confirmation dialog */}
      <AlertDialog open={moveConfirm !== null} onOpenChange={(open) => { if (!open && moveConfirm) cancelMove(); }}>
        <AlertDialogContent className="overflow-hidden rounded-2xl border-2 border-primary/25 bg-card p-0 shadow-2xl">
          <div className="relative p-6">
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_0%,hsl(var(--primary-hsl)/0.16),transparent_38%),linear-gradient(135deg,hsl(var(--primary-hsl)/0.08),transparent_52%)]" />
            <AlertDialogHeader className="relative gap-3 text-left">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25">
                <CalendarCheck2 className="h-6 w-6" />
              </div>
              <AlertDialogTitle className="font-display text-xl font-black">
                {lang === 'ru' ? 'Переместить бронирование?' : 'Move booking?'}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium leading-relaxed">
                {moveConfirm && (
                  <>
                    {lang === 'ru' ? 'Гость: ' : 'Guest: '}
                    <span className="font-bold text-foreground">{moveConfirm.booking.guestName || '—'}</span>
                    <br />
                    <span className="text-muted-foreground">
                      {lang === 'ru' ? 'Из' : 'From'}: #{moveConfirm.booking.roomNumber}
                      {moveConfirm.booking.bedIndex !== undefined && ` · ${lang === 'ru' ? 'место' : 'bed'} ${moveConfirm.booking.bedIndex + 1}`}
                      {' · '}{moveConfirm.booking.checkIn} → {moveConfirm.booking.checkOut}
                    </span>
                    <br />
                    <span className="text-primary font-bold">
                      {lang === 'ru' ? 'В' : 'To'}: #{moveConfirm.targetRoom}
                      {moveConfirm.targetBed !== undefined && ` · ${lang === 'ru' ? 'место' : 'bed'} ${moveConfirm.targetBed + 1}`}
                      {moveTargetRoomInfo?.category && ` · ${categoryDisplay(moveTargetRoomInfo.category, lang)}`}
                      {' · '}{moveConfirm.targetCheckIn} → {moveConfirm.targetCheckOut}
                    </span>
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="relative mt-6 gap-2 sm:space-x-0">
              <AlertDialogCancel onClick={cancelMove} className="rounded-xl border-border/70 bg-background/80 font-bold">
                {lang === 'ru' ? 'Нет, вернуть' : 'No, snap back'}
              </AlertDialogCancel>
              <AlertDialogAction onClick={confirmMove} className="rounded-xl bg-primary font-black text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90">
                <Check className="mr-1.5 h-4 w-4" />
                {lang === 'ru' ? 'Да, переместить' : 'Yes, move'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
