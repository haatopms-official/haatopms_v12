import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Users,
  DollarSign,
  Search,
  BedDouble,
  CalendarDays,
  Globe2,
  Building2,
  Bot,
  Crown,
  MapPin,
} from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";

import { HotelNavbar } from "@/components/hotel/HotelNavbar";
import { BookingDialog } from "@/components/hotel/BookingDialog";
import { useBookingsContext } from "@/hooks/BookingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { formatGuestName, type Booking } from "@/types/hotel";
import { formatPrice } from "@/lib/formatPrice";

type ChannelFilter = "all" | "offline" | "online-natural" | "online-admin";

const FILTERS: { id: ChannelFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "offline", label: "Offline" },
  { id: "online-natural", label: "Online · Natural" },
  { id: "online-admin", label: "Online · Admin" },
];

export default function SuperuserBookingsHistory() {
  const { bookings, addBooking, updateBooking, removeBooking } = useBookingsContext();
  const { events } = useAudit();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Booking | null>(null);

  const goToGrid = (id: string) => {
    setSelected(null);
    navigate({ to: "/superuser", search: { focus: id } as never });
  };


  // Map bookingId -> creator info from audit log (covers actions taken by
  // superuser, admin, manager, director — any signed-in staff).
  const creatorByBookingId = useMemo(() => {
    const map = new Map<string, { role: string; username: string; at: string }>();
    for (const ev of events ?? []) {
      if (ev.action !== "booking.created") continue;
      const id = (ev.details as { bookingId?: string } | undefined)?.bookingId;
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, { role: ev.actor.role, username: ev.actor.username, at: ev.at });
      }
    }
    return map;
  }, [events]);

  const STAFF_ROLES = new Set(["admin", "superuser", "manager", "director"]);

  const classified = useMemo(() => {
    return bookings.map((b) => {
      const creator = creatorByBookingId.get(b.id);
      const channel: "offline" | "online-natural" | "online-admin" =
        b.bookingChannel === "online"
          ? creator && STAFF_ROLES.has(creator.role)
            ? "online-admin"
            : "online-natural"
          : "offline";
      return { booking: b, channel, creator };
    });
  }, [bookings, creatorByBookingId]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified
      .filter((c) => (filter === "all" ? true : c.channel === filter))
      .filter((c) => {
        if (!q) return true;
        const name = formatGuestName(c.booking).toLowerCase();
        return (
          name.includes(q) ||
          String(c.booking.roomNumber).includes(q) ||
          (c.booking.guestPhone ?? "").toLowerCase().includes(q) ||
          (c.booking.guestEmail ?? "").toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.booking.checkIn).getTime() -
          new Date(a.booking.checkIn).getTime(),
      );
  }, [classified, filter, query]);

  const totals = useMemo(() => {
    let totalBookings = 0;
    let totalGuests = 0;
    let totalRevenue = 0;
    let totalNights = 0;
    for (const { booking: b } of filtered) {
      totalBookings += 1;
      totalGuests += b.guestCount ?? 0;
      totalRevenue += b.price ?? b.paymentAmount ?? 0;
      try {
        const nights = Math.max(
          0,
          differenceInCalendarDays(parseISO(b.checkOut), parseISO(b.checkIn)),
        );
        totalNights += nights;
      } catch {
        /* ignore */
      }
    }
    return { totalBookings, totalGuests, totalRevenue, totalNights };
  }, [filtered]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <HotelNavbar totalRooms={0} viewMode="tiles" onViewModeChange={() => {}} />

      <div className="mx-auto w-full max-w-[1500px] px-5 py-6 space-y-6">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 p-7 text-white shadow-2xl"
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
          <div className="relative flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                  <BookOpen className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/80">
                    Superuser · Records
                  </p>
                  <h1 className="font-display text-2xl font-black leading-tight">
                    Booking history
                  </h1>
                </div>
              </div>
              <p className="mt-3 max-w-xl text-sm text-white/85">
                Read-only log of every booking ever recorded in the grid —
                offline, natural online, and admin-created online — with totals
                for guests, bookings and revenue.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 min-w-[420px]">
              <SummaryTile
                label="Total bookings"
                value={totals.totalBookings.toLocaleString("ru-RU")}
                Icon={BookOpen}
              />
              <SummaryTile
                label="Total guests"
                value={totals.totalGuests.toLocaleString("ru-RU")}
                Icon={Users}
              />
              <SummaryTile
                label="Total revenue"
                value={formatPrice(totals.totalRevenue)}
                Icon={DollarSign}
                suffix="UZS"
              />
            </div>
          </div>
        </motion.div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    active
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guest, room, phone, email…"
              className="h-9 w-72 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {filtered.length} record{filtered.length === 1 ? "" : "s"} ·{" "}
            {totals.totalNights} night{totals.totalNights === 1 ? "" : "s"}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Channel</th>
                  <th className="px-4 py-3 text-left">Guest</th>
                  <th className="px-4 py-3 text-left">Room</th>
                  <th className="px-4 py-3 text-left">Check-in</th>
                  <th className="px-4 py-3 text-left">Check-out</th>
                  <th className="px-4 py-3 text-right">Nights</th>
                  <th className="px-4 py-3 text-right">Guests</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Created by</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Action</th>

                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-4 py-12 text-center text-sm text-slate-400"
                    >
                      No bookings match the current filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ booking: b, channel, creator }) => {
                    const nights = (() => {
                      try {
                        return Math.max(
                          0,
                          differenceInCalendarDays(
                            parseISO(b.checkOut),
                            parseISO(b.checkIn),
                          ),
                        );
                      } catch {
                        return 0;
                      }
                    })();
                    const rev = b.price ?? b.paymentAmount ?? 0;
                    return (
                      <motion.tr
                        key={b.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        whileHover={{ backgroundColor: "rgba(99,102,241,0.05)" }}
                        onClick={() => setSelected(b)}
                        className="cursor-pointer border-t border-slate-100 transition"
                      >
                        <td className="px-4 py-3">
                          <ChannelBadge channel={channel} />
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {formatGuestName(b) || (
                            <span className="text-slate-400 italic">
                              No name
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                            <BedDouble className="h-3 w-3" />
                            {b.roomNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3 w-3 text-slate-400" />
                            {format(parseISO(b.checkIn), "dd MMM yyyy")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {format(parseISO(b.checkOut), "dd MMM yyyy")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-700">
                          {nights}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-700">
                          {b.guestCount ?? 0}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {creator ? (
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs font-bold text-slate-800">
                                {creator.username}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                {creator.role}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {channel === "online-natural" ? "Guest (web)" : "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">
                          {formatPrice(rev)}{" "}
                          <span className="text-[10px] font-semibold text-slate-400">
                            UZS
                          </span>
                        </td>
                        <td
                          className="px-4 py-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => goToGrid(b.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-sm transition hover:shadow-md hover:brightness-110"
                            title="Highlight this booking on the main grid"
                          >
                            <MapPin className="h-3 w-3" />
                            Show
                          </button>
                        </td>
                      </motion.tr>

                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <BookingDialog
        open={selected != null}
        onClose={() => setSelected(null)}
        onSave={(b) => {
          const ok = addBooking(b);
          if (ok !== false) setSelected(null);
          return ok;
        }}
        onUpdate={updateBooking}
        onDelete={(id) => {
          removeBooking(id);
          setSelected(null);
        }}
        roomNumber={selected?.roomNumber ?? 0}
        checkIn={selected?.checkIn ?? format(new Date(), "yyyy-MM-dd")}
        checkOut={selected?.checkOut ?? format(new Date(), "yyyy-MM-dd")}
        editBooking={selected}
        bedIndex={selected?.bedIndex}
        readOnly
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  Icon,
  suffix,
}: {
  label: string;
  value: string;
  Icon: typeof BookOpen;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/15 p-3 ring-1 ring-white/20 backdrop-blur">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-white/80">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 font-display text-lg font-black leading-tight tabular-nums">
        {value}
        {suffix ? (
          <span className="ml-1 text-[10px] font-bold text-white/70">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: "offline" | "online-natural" | "online-admin" }) {
  if (channel === "offline") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
        <Building2 className="h-3 w-3" /> Offline
      </span>
    );
  }
  if (channel === "online-natural") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
        <Globe2 className="h-3 w-3" /> Natural
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
      <Bot className="h-3 w-3" /> Admin
      <Crown className="h-3 w-3 opacity-80" />
    </span>
  );
}
