import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { HotelNavbar } from "@/components/hotel/HotelNavbar";
import { HotelSummaryCards, type SummaryFilter } from "@/components/hotel/HotelSummaryCards";
import { HotelStatusFilter } from "@/components/hotel/HotelStatusFilter";
import { HotelRoomGrid } from "@/components/hotel/HotelRoomGrid";
import { HotelRoomTileGrid } from "@/components/hotel/HotelRoomTileGrid";
import { BookingDialog } from "@/components/hotel/BookingDialog";
import { useBookingsContext } from "@/hooks/BookingsContext";
import { useHotelGrid } from "@/hooks/HotelGridContext";
import { useI18n } from "@/hooks/useI18n";
import { useNotifications } from "@/contexts/NotificationsContext";
import { type Booking } from "@/types/hotel";
import { startOfDay, parseISO, isWithinInterval, format, addDays } from "date-fns";

/**
 * Shared dashboard body — same workspace UI used by superuser (with navbar)
 * and by Manager (inside its own layout, navbar provided by Manager).
 */
export function HotelDashboardBody({
  showNavbar = true,
  showFooter = true,
  viewMode: controlledViewMode,
  onViewModeChange,
}: {
  showNavbar?: boolean;
  showFooter?: boolean;
  viewMode?: "tiles" | "timeline";
  onViewModeChange?: (mode: "tiles" | "timeline") => void;
}) {
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const isAdminRoute = pathname.startsWith("/admin");
  const {
    bookings: rawBookings,
    addBooking,
    removeBooking,
    removeBookings,
    purgeRooms,
    purgeTarget,
    updateBooking,
  } = useBookingsContext();

  const { rooms, categories } = useHotelGrid();

  const existingCategoryIds = useMemo(
    () => new Set(categories.map((c) => c.id)),
    [categories],
  );

  // Set of room numbers that still exist in the grid.
  const existingRoomNumbers = useMemo(
    () => new Set(rooms.map((r) => Number(r.number))),
    [rooms],
  );

  /**
   * The ONLY list the whole dashboard is allowed to see. A booking whose room
   * (or whose whole category) was deleted is not part of the hotel anymore, so
   * it must not appear in any grid, tile, chip or summary card.
   */
  const bookings = useMemo(
    () =>
      rawBookings.filter((b) => {
        if (!existingRoomNumbers.has(Number(b.roomNumber))) return false;
        const catId = String((b as unknown as { categoryId?: string }).categoryId ?? '');
        if (catId !== '' && !existingCategoryIds.has(catId)) return false;
        return true;
      }),
    [rawBookings, existingRoomNumbers, existingCategoryIds],
  );

  /**
   * SELF-HEALING SWEEP: any booking left over from a room/category that no
   * longer exists gets hard-deleted from Supabase, so it can never come back
   * and can never interfere again. Runs once the grid has hydrated.
   */
  const sweptRef = useRef<string>('');
  useEffect(() => {
    if (rooms.length === 0) return;                 // grid not hydrated yet
    const orphans = rawBookings.filter((b) => {
      const roomGone = !existingRoomNumbers.has(Number(b.roomNumber));
      const catId = String((b as unknown as { categoryId?: string }).categoryId ?? '');
      const catGone = catId !== '' && !existingCategoryIds.has(catId);
      return roomGone || catGone;
    });
    if (orphans.length === 0) return;
    const key = orphans.map((b) => b.id).sort().join('|');
    if (sweptRef.current === key) return;           // don't loop
    sweptRef.current = key;
    removeBookings(orphans.map((b) => b.id));
  }, [rawBookings, rooms, existingRoomNumbers, existingCategoryIds, removeBookings]);

  const [internalViewMode, setInternalViewMode] = useState<"tiles" | "timeline">("timeline");
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = useCallback(
    (next: "tiles" | "timeline" | ((prev: "tiles" | "timeline") => "tiles" | "timeline")) => {
      const resolved = typeof next === "function" ? (next as (p: "tiles" | "timeline") => "tiles" | "timeline")(viewMode) : next;
      if (onViewModeChange) onViewModeChange(resolved);
      if (controlledViewMode === undefined) setInternalViewMode(resolved);
    },
    [controlledViewMode, onViewModeChange, viewMode],
  );
  const [statusFilter, setStatusFilter] = useState<SummaryFilter>("all");
  const [editRoomNumber, setEditRoomNumber] = useState<number | null>(null);
  const [editBookingId, setEditBookingId] = useState<string | null>(null);
  const [focusBookingId, setFocusBookingId] = useState<string | null>(null);
  const { focusBookingRequest, clearFocusRequest } = useNotifications();

  useEffect(() => {
    if (!focusBookingRequest) return;
    setFocusBookingId(focusBookingRequest);
    setViewMode("timeline");
    clearFocusRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBookingRequest]);

  const handleSummarySelect = useCallback((filter: SummaryFilter) => {
    setStatusFilter(filter);
    setViewMode("tiles");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document
          .getElementById("hotel-main-grid")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [setViewMode]);

  useEffect(() => {
    if (focusBookingId) setViewMode("timeline");
  }, [focusBookingId, setViewMode]);

  // Reset to the main (timeline) grid whenever the navbar logo dispatches `workspace:reset`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setStatusFilter("all");
      setViewMode("timeline");
      window.requestAnimationFrame(() => {
        document
          .getElementById("hotel-main-grid")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    window.addEventListener("workspace:reset", handler);
    return () => window.removeEventListener("workspace:reset", handler);
  }, [setViewMode]);

  // Bridge the "hotel:change-room" custom event from the BookingDialog
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (ev: Event) => {
      if (viewMode === "timeline") return;
      const detail = (ev as CustomEvent).detail;
      setViewMode("timeline");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("hotel:change-room", { detail }));
        });
      });
    };
    window.addEventListener("hotel:change-room", handler);
    return () => window.removeEventListener("hotel:change-room", handler);
  }, [viewMode, setViewMode]);

  // Accept `?focus=<bookingId>` from external entry points
  useEffect(() => {
    const params = new URLSearchParams(
      typeof search === "string"
        ? search
        : new URLSearchParams(search as Record<string, string>).toString(),
    );
    const id = params.get("focus");
    if (!id) return;
    setFocusBookingId(id);
    setViewMode("timeline");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document
          .getElementById("hotel-main-grid")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    navigate({ to: pathname, search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleFocusConsumed = useCallback(() => {
    setFocusBookingId(null);
  }, []);

  const goToBookingOnGrid = useCallback((bookingId: string) => {
    setViewMode("timeline");
    setFocusBookingId(bookingId);
  }, [setViewMode]);

  const handleAddBooking = useCallback((b: Booking) => {
    const ok = addBooking(b);
    if (ok) setStatusFilter((prev) => (prev !== "all" && prev !== b.status ? "all" : prev));
    return ok;
  }, [addBooking]);

  const handleUpdateBooking = useCallback((id: string, updates: Partial<Booking>) => {
    const ok = updateBooking(id, updates);
    if (ok && updates.status) {
      setStatusFilter((prev) => (prev !== "all" && prev !== updates.status ? "all" : prev));
    }
    return ok;
  }, [updateBooking]);

  const handleEditRoom = useCallback((roomNumber: number) => {
    setEditBookingId(null);
    setEditRoomNumber(roomNumber);
  }, []);

  const handleEditBooking = useCallback((bookingId: string) => {
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return;
    setEditBookingId(bookingId);
    setEditRoomNumber(b.roomNumber);
  }, [bookings]);

  const editingBooking = useMemo<Booking | null>(() => {
    if (editBookingId) return bookings.find((b) => b.id === editBookingId) ?? null;
    if (editRoomNumber == null) return null;
    const today = startOfDay(new Date());
    return (
      bookings.find(
        (b) =>
          b.roomNumber === editRoomNumber &&
          isWithinInterval(today, { start: parseISO(b.checkIn), end: parseISO(b.checkOut) }),
      ) ?? null
    );
  }, [editBookingId, editRoomNumber, bookings]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: bookings.length };
    bookings.forEach((booking) => {
      c[booking.status] = (c[booking.status] || 0) + 1;
    });
    return c;
  }, [bookings]);

  const summary = useMemo(() => {
    const inHouse = counts["in-house"] || 0;
    const booked = counts.booked || 0;
    const confirmed = counts.confirmed || 0;
    const pending = counts.pending || 0;
    const maintenance = counts.maintenance || 0;
    const checkedOut = counts["checked-out"] || 0;
    const occupiedRooms = new Set(
      bookings
        .filter((b) => ["in-house", "booked", "confirmed", "pending", "maintenance"].includes(b.status))
        .map((b) => Number(b.roomNumber)),
    ).size;

  return {
      total: rooms.length,
      available: Math.max(0, rooms.length - occupiedRooms),
      confirmed,
      pending,
      booked,
      inHouse,
      checkedOut,
      maintenance,
    };
  }, [counts, rooms, bookings]);

  const filteredBookings = useMemo(() => {
    if (statusFilter === "all") return bookings;
    return bookings.filter((booking) => booking.status === statusFilter);
  }, [bookings, statusFilter]);

  return (
    <>
      {showNavbar && (
        <HotelNavbar totalRooms={rooms.length} viewMode={viewMode} onViewModeChange={setViewMode} />
      )}
      <HotelSummaryCards {...summary} activeFilter={statusFilter} onSelect={handleSummarySelect} />
      <div className="px-4">
        <HotelStatusFilter activeFilter={statusFilter} onFilterChange={setStatusFilter} counts={counts} />
      </div>
      <main id="hotel-main-grid" className="flex min-h-0 flex-1 flex-col px-4 pb-2 scroll-mt-4 transition-[opacity] duration-300">
        {viewMode === "timeline" ? (
          <HotelRoomGrid
            bookings={filteredBookings}
            conflictBookings={bookings}
            onAddBooking={handleAddBooking}
            onDeleteBooking={removeBooking}
            onDeleteBookings={removeBookings}
            onPurgeRooms={purgeRooms}
            onPurgeTarget={purgeTarget}
            onUpdateBooking={handleUpdateBooking}
            focusBookingId={focusBookingId}
            onFocusConsumed={handleFocusConsumed}
            labelWidth={isAdminRoute ? 320 : undefined}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HotelRoomTileGrid
              rooms={rooms}
              bookings={bookings}
              activeFilter={statusFilter}
              selectedDate={new Date()}
              onEditRoom={handleEditRoom}
              onShowOnGrid={goToBookingOnGrid}
              onEditBooking={handleEditBooking}
            />
          </div>
        )}
      </main>
      <BookingDialog
        open={editRoomNumber != null}
        onClose={() => { setEditRoomNumber(null); setEditBookingId(null); }}
        onSave={(b) => { const ok = handleAddBooking(b); if (ok !== false) { setEditRoomNumber(null); setEditBookingId(null); } return ok; }}
        onUpdate={handleUpdateBooking}
        onDelete={removeBooking}
        roomNumber={editRoomNumber ?? 0}
        checkIn={editingBooking?.checkIn ?? format(new Date(), "yyyy-MM-dd")}
        checkOut={editingBooking?.checkOut ?? format(addDays(new Date(), 1), "yyyy-MM-dd")}
        editBooking={editingBooking}
      />
      {showFooter && (
        <footer className="footer-animate shrink-0 px-4 py-2 text-center text-[11px] text-muted-foreground">
          {t("copyright")}
        </footer>
      )}
    </>
  );
}

function HotelDashboard() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <HotelDashboardBody />
    </div>
  );
}

export default HotelDashboard;