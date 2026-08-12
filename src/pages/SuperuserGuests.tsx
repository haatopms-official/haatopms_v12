import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  UsersRound,
  Globe2,
  Building2,
  CalendarRange,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Bot,
  BedDouble,
  ChevronDown,
  DollarSign,
  Activity,
  Search,
  Download,
  Crown,
  CreditCard,
  CalendarDays,
  Repeat,
  Percent,
  Clock,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import {
  parseISO,
  format,
  isWithinInterval,
  startOfDay,
  endOfDay,
  subDays,
  subMonths,
  eachDayOfInterval,
  differenceInCalendarDays,
  getDay,
} from "date-fns";

import { HotelNavbar } from "@/components/hotel/HotelNavbar";
import { BookingDialog } from "@/components/hotel/BookingDialog";
import { useBookingsContext } from "@/hooks/BookingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { formatGuestName, ROOM_CATEGORIES, type Booking, type RoomCategory } from "@/types/hotel";



type ChannelKind = "offline" | "online-natural" | "online-admin";
type ScopeTab = "offline" | "online";
type OnlineSide = "natural" | "admin";

const PRESETS: { id: string; label: string; days: number | "1m" | "3m" | "6m" | "1y" }[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "14d", label: "Last 14 days", days: 14 },
  { id: "1m", label: "Last month", days: "1m" },
  { id: "3m", label: "Last 3 months", days: "3m" },
  { id: "6m", label: "Last 6 months", days: "6m" },
  { id: "1y", label: "Last year", days: "1y" },
];

function rangeFromPreset(preset: (typeof PRESETS)[number]): { from: Date; to: Date } {
  const to = endOfDay(new Date());
  let from: Date;
  if (typeof preset.days === "number") from = startOfDay(subDays(to, preset.days - 1));
  else if (preset.days === "1m") from = startOfDay(subMonths(to, 1));
  else if (preset.days === "3m") from = startOfDay(subMonths(to, 3));
  else if (preset.days === "6m") from = startOfDay(subMonths(to, 6));
  else from = startOfDay(subMonths(to, 12));
  return { from, to };
}

export default function SuperuserGuests() {
  const { bookings, addBooking, updateBooking, removeBooking } = useBookingsContext();
  const { events: auditEvents } = useAudit();
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);


  const [presetId, setPresetId] = useState<string>("1m");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [scope, setScope] = useState<ScopeTab>("offline");
  const [onlineSide, setOnlineSide] = useState<OnlineSide>("natural");
  const [query, setQuery] = useState("");

  const range = useMemo(() => {
    if (customFrom && customTo) {
      const f = startOfDay(parseISO(customFrom));
      const t = endOfDay(parseISO(customTo));
      if (f.getTime() <= t.getTime()) return { from: f, to: t };
    }
    const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[2];
    return rangeFromPreset(preset);
  }, [presetId, customFrom, customTo]);

  // Map bookingId -> creator role (from audit log)
  const creatorByBookingId = useMemo(() => {
    const map = new Map<string, { role: string; username: string; at: string }>();
    for (const ev of auditEvents) {
      if (ev.action !== "booking.created") continue;
      const id = (ev.details as { bookingId?: string } | undefined)?.bookingId;
      if (!id) continue;
      if (!map.has(id)) map.set(id, { role: ev.actor.role, username: ev.actor.username, at: ev.at });
    }
    return map;
  }, [auditEvents]);

  function classify(b: Booking): ChannelKind {
    const channel = b.bookingChannel ?? "offline";
    if (channel === "offline") return "offline";
    const creator = creatorByBookingId.get(b.id);
    // Admin online = online booking that was created by an internal staff role
    if (creator && (creator.role === "admin" || creator.role === "superuser" || creator.role === "manager" || creator.role === "director")) {
      return "online-admin";
    }
    return "online-natural";
  }

  // Use booking checkIn date as the "guest event" anchor.
  const inRange = useMemo(() => {
    return bookings.filter((b) => {
      try {
        const d = startOfDay(parseISO(b.checkIn));
        return isWithinInterval(d, { start: range.from, end: range.to });
      } catch {
        return false;
      }
    });
  }, [bookings, range]);

  const classified = useMemo(() => {
    return inRange.map((b) => ({ b, kind: classify(b) }));
  }, [inRange, creatorByBookingId]);

  const totals = useMemo(() => {
    let offline = 0,
      onlineNatural = 0,
      onlineAdmin = 0,
      guestsOffline = 0,
      guestsOnlineN = 0,
      guestsOnlineA = 0,
      revenueOffline = 0,
      revenueOnlineN = 0,
      revenueOnlineA = 0,
      nightsOffline = 0,
      nightsOnlineN = 0,
      nightsOnlineA = 0;
    for (const { b, kind } of classified) {
      const guests = Math.max(1, b.guestCount || 1);
      const nights = Math.max(1, differenceInCalendarDays(parseISO(b.checkOut), parseISO(b.checkIn)));
      const rev = b.price ?? b.paymentAmount ?? 0;
      if (kind === "offline") {
        offline++;
        guestsOffline += guests;
        revenueOffline += rev;
        nightsOffline += nights;
      } else if (kind === "online-natural") {
        onlineNatural++;
        guestsOnlineN += guests;
        revenueOnlineN += rev;
        nightsOnlineN += nights;
      } else {
        onlineAdmin++;
        guestsOnlineA += guests;
        revenueOnlineA += rev;
        nightsOnlineA += nights;
      }
    }
    const online = onlineNatural + onlineAdmin;
    const total = offline + online;
    return {
      total,
      offline,
      online,
      onlineNatural,
      onlineAdmin,
      guestsOffline,
      guestsOnlineN,
      guestsOnlineA,
      guestsOnline: guestsOnlineN + guestsOnlineA,
      guestsTotal: guestsOffline + guestsOnlineN + guestsOnlineA,
      revenueOffline,
      revenueOnlineN,
      revenueOnlineA,
      revenueTotal: revenueOffline + revenueOnlineN + revenueOnlineA,
      nightsOffline,
      nightsOnlineN,
      nightsOnlineA,
    };
  }, [classified]);

  // ── Previous period (same length, immediately before `range`) for comparison
  const prevRange = useMemo(() => {
    const len = differenceInCalendarDays(range.to, range.from) + 1;
    const to = endOfDay(subDays(range.from, 1));
    const from = startOfDay(subDays(to, len - 1));
    return { from, to };
  }, [range]);

  const prevTotals = useMemo(() => {
    let guests = 0, bookings_ = 0, revenue = 0;
    for (const b of bookings) {
      try {
        const d = startOfDay(parseISO(b.checkIn));
        if (!isWithinInterval(d, { start: prevRange.from, end: prevRange.to })) continue;
        bookings_++;
        guests += Math.max(1, b.guestCount || 1);
        revenue += b.price ?? b.paymentAmount ?? 0;
      } catch { /* skip */ }
    }
    return { guests, bookings: bookings_, revenue };
  }, [bookings, prevRange]);

  const deltaPct = (curr: number, prev: number) =>
    prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);

  // ── Weekday pattern (Sun..Sat) for radar chart
  const weekdayPattern = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const rows = names.map((d) => ({ day: d, offline: 0, natural: 0, admin: 0, total: 0 }));
    for (const { b, kind } of classified) {
      try {
        const idx = getDay(parseISO(b.checkIn));
        const g = Math.max(1, b.guestCount || 1);
        rows[idx].total += g;
        if (kind === "offline") rows[idx].offline += g;
        else if (kind === "online-natural") rows[idx].natural += g;
        else rows[idx].admin += g;
      } catch { /* skip */ }
    }
    return rows;
  }, [classified]);

  // ── Top rooms by guest volume
  const topRooms = useMemo(() => {
    const map = new Map<number, { room: number; guests: number; bookings: number; revenue: number }>();
    for (const { b } of classified) {
      const r = map.get(b.roomNumber) ?? { room: b.roomNumber, guests: 0, bookings: 0, revenue: 0 };
      r.guests += Math.max(1, b.guestCount || 1);
      r.bookings += 1;
      r.revenue += b.price ?? b.paymentAmount ?? 0;
      map.set(b.roomNumber, r);
    }
    return Array.from(map.values())
      .sort((a, b) => b.guests - a.guests)
      .slice(0, 8);
  }, [classified]);

  // ── Room category breakdown
  const categoryBreakdown = useMemo(() => {
    const cats: Record<RoomCategory, { id: RoomCategory; label: string; guests: number; bookings: number }> =
      ROOM_CATEGORIES.reduce((acc, c) => {
        acc[c.id] = { id: c.id, label: c.short, guests: 0, bookings: 0 };
        return acc;
      }, {} as Record<RoomCategory, { id: RoomCategory; label: string; guests: number; bookings: number }>);
    for (const { b } of classified) {
      const floor = Math.floor(b.roomNumber / 100);
      const cat = ROOM_CATEGORIES[Math.min(Math.max(floor - 1, 0), ROOM_CATEGORIES.length - 1)];
      if (!cat) continue;
      const row = cats[cat.id];
      row.guests += Math.max(1, b.guestCount || 1);
      row.bookings += 1;
    }
    return Object.values(cats);
  }, [classified]);

  // ── Payment method breakdown (cash / card / transfer / unpaid)
  const paymentBreakdown = useMemo(() => {
    const buckets = { cash: 0, card: 0, transfer: 0, unpaid: 0 };
    for (const { b } of classified) {
      if (b.paymentType === "cash") buckets.cash += b.price ?? b.paymentAmount ?? 0;
      else if (b.paymentType === "card") buckets.card += b.price ?? b.paymentAmount ?? 0;
      else if (b.paymentType === "transfer") buckets.transfer += b.price ?? b.paymentAmount ?? 0;
      else buckets.unpaid += b.price ?? b.paymentAmount ?? 0;
    }
    return [
      { name: "Cash", value: buckets.cash, color: "hsl(150 70% 45%)" },
      { name: "Card", value: buckets.card, color: "hsl(220 85% 55%)" },
      { name: "Transfer", value: buckets.transfer, color: "hsl(280 80% 60%)" },
      { name: "Unrecorded", value: buckets.unpaid, color: "hsl(220 15% 70%)" },
    ];
  }, [classified]);

  // ── Status distribution
  const statusBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const { b } of classified) {
      map.set(b.status, (map.get(b.status) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [classified]);

  // ── Repeat guests (by normalized name)
  const repeatGuests = useMemo(() => {
    const map = new Map<string, { name: string; stays: number; guests: number; revenue: number; lastSeen: string }>();
    for (const { b } of classified) {
      const name = formatGuestName(b).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const row = map.get(key) ?? { name, stays: 0, guests: 0, revenue: 0, lastSeen: b.checkIn };
      row.stays += 1;
      row.guests += Math.max(1, b.guestCount || 1);
      row.revenue += b.price ?? b.paymentAmount ?? 0;
      if (b.checkIn > row.lastSeen) row.lastSeen = b.checkIn;
      map.set(key, row);
    }
    return Array.from(map.values())
      .filter((r) => r.stays > 1)
      .sort((a, b) => b.stays - a.stays || b.revenue - a.revenue)
      .slice(0, 6);
  }, [classified]);

  // (cumulativeSeries is declared after dailySeries below)


  // ── Average length of stay
  const avgStay = useMemo(() => {
    if (!classified.length) return 0;
    const total = classified.reduce((sum, { b }) => {
      try {
        return sum + Math.max(1, differenceInCalendarDays(parseISO(b.checkOut), parseISO(b.checkIn)));
      } catch {
        return sum;
      }
    }, 0);
    return total / classified.length;
  }, [classified]);


  const dailySeries = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const map = new Map<string, { date: string; offline: number; natural: number; admin: number }>();
    for (const d of days) {
      const key = format(d, "yyyy-MM-dd");
      map.set(key, { date: key, offline: 0, natural: 0, admin: 0 });
    }
    for (const { b, kind } of classified) {
      const key = b.checkIn.slice(0, 10);
      const row = map.get(key);
      if (!row) continue;
      const guests = Math.max(1, b.guestCount || 1);
      if (kind === "offline") row.offline += guests;
      else if (kind === "online-natural") row.natural += guests;
      else row.admin += guests;
    }
    return Array.from(map.values()).map((r) => ({
      ...r,
      label: format(parseISO(r.date), days.length > 60 ? "MMM d" : "MMM d"),
    }));
  }, [classified, range]);

  const cumulativeSeries = useMemo(() => {
    let running = 0;
    return dailySeries.map((d) => {
      running += d.offline + d.natural + d.admin;
      return { label: d.label, cumulative: running };
    });
  }, [dailySeries]);


  const pieData = useMemo(
    () => [
      { name: "Offline", value: totals.guestsOffline, color: "hsl(265 85% 55%)" },
      { name: "Online · Natural", value: totals.guestsOnlineN, color: "hsl(190 90% 45%)" },
      { name: "Online · Admin", value: totals.guestsOnlineA, color: "hsl(330 85% 55%)" },
    ],
    [totals],
  );

  // History rows for selected scope
  const historyRows = useMemo(() => {
    let rows = classified;
    if (scope === "offline") rows = rows.filter((r) => r.kind === "offline");
    else if (scope === "online" && onlineSide === "natural")
      rows = rows.filter((r) => r.kind === "online-natural");
    else rows = rows.filter((r) => r.kind === "online-admin");

    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const name = formatGuestName(r.b).toLowerCase();
        return (
          name.includes(q) ||
          String(r.b.roomNumber).includes(q) ||
          (r.b.guestPhone || "").toLowerCase().includes(q) ||
          (r.b.guestEmail || "").toLowerCase().includes(q)
        );
      });
    }
    return rows.sort((a, b) => (a.b.checkIn < b.b.checkIn ? 1 : -1));
  }, [classified, scope, onlineSide, query]);

  const fmtMoney = (n: number) => `${n.toLocaleString("en-US")} UZS`;

  const exportCsv = () => {
    const headers = ["Channel", "Guest", "Room", "Check-in", "Check-out", "Nights", "Guests", "Status", "Phone", "Email", "Price"];
    const lines = [headers.join(",")];
    for (const { b, kind } of classified) {
      const nights = (() => {
        try { return Math.max(1, differenceInCalendarDays(parseISO(b.checkOut), parseISO(b.checkIn))); } catch { return 1; }
      })();
      const cells = [
        kind,
        formatGuestName(b),
        String(b.roomNumber),
        b.checkIn,
        b.checkOut,
        String(nights),
        String(b.guestCount || 1),
        b.status,
        b.guestPhone || "",
        b.guestEmail || "",
        String(b.price ?? b.paymentAmount ?? 0),
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guests-${format(range.from, "yyyy-MM-dd")}_${format(range.to, "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-fuchsia-50/30 to-sky-50/40">
      <HotelNavbar totalRooms={0} viewMode="tiles" onViewModeChange={() => {}} />

      <main className="flex-1 px-4 sm:px-8 py-8 max-w-7xl w-full mx-auto">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[hsl(265_85%_55%)] text-xs font-bold tracking-widest uppercase">
              <UsersRound className="h-3.5 w-3.5" />
              Guests analytics
            </div>
            <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-slate-900">
              Guest flow dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500 max-w-2xl">
              Full picture of every guest that came through the property — broken down by offline check-ins and
              online arrivals (natural channels vs. admin-entered online bookings). All data is sourced live from
              the booking grid.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur px-3 py-2 shadow-sm">
            <CalendarRange className="h-4 w-4 text-[hsl(265_85%_55%)]" />
            <span className="text-xs font-bold text-slate-600 tabular-nums">
              {format(range.from, "MMM d, yyyy")} → {format(range.to, "MMM d, yyyy")}
            </span>
          </div>

          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[hsl(265_85%_55%)] to-[hsl(280_85%_55%)] px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-fuchsia-500/30 hover:opacity-95 transition"
            title="Export current period as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </header>




        {/* Date range controls */}
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => {
              const active = presetId === p.id && !(customFrom && customTo);
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setPresetId(p.id);
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    active
                      ? "bg-gradient-to-r from-[hsl(265_85%_55%)] to-[hsl(280_85%_55%)] text-white shadow-md shadow-fuchsia-500/30"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-[hsl(265_85%_55%)] focus:ring-2 focus:ring-[hsl(265_85%_55%)]/20"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-[hsl(265_85%_55%)] focus:ring-2 focus:ring-[hsl(265_85%_55%)]/20"
                />
              </label>
              {(customFrom || customTo) && (
                <button
                  onClick={() => {
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

        {/* KPI cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <KpiCard
            label="Total guests"
            value={totals.guestsTotal}
            sub={`${totals.total} bookings`}
            icon={UsersRound}
            tint="from-[hsl(265_85%_55%)] to-[hsl(280_85%_55%)]"
            delta={deltaPct(totals.guestsTotal, prevTotals.guests)}
          />
          <KpiCard
            label="Offline guests"
            value={totals.guestsOffline}
            sub={`${totals.offline} bookings · ${totals.nightsOffline} nights`}
            icon={Building2}
            tint="from-[hsl(200_85%_50%)] to-[hsl(220_85%_55%)]"
          />
          <KpiCard
            label="Online guests"
            value={totals.guestsOnline}
            sub={`Natural ${totals.onlineNatural} · Admin ${totals.onlineAdmin}`}
            icon={Globe2}
            tint="from-[hsl(190_90%_45%)] to-[hsl(170_85%_45%)]"
          />
          <KpiCard
            label="Total revenue"
            value={fmtMoney(totals.revenueTotal)}
            sub={`Offline ${fmtMoney(totals.revenueOffline)} · Online ${fmtMoney(totals.revenueOnlineN + totals.revenueOnlineA)}`}
            icon={DollarSign}
            tint="from-[hsl(330_85%_55%)] to-[hsl(15_90%_55%)]"
            mono
            delta={deltaPct(totals.revenueTotal, prevTotals.revenue)}
          />
          <KpiCard
            label="Total bookings"
            value={totals.total}
            sub={`vs ${prevTotals.bookings} previous period`}
            icon={CalendarDays}
            tint="from-[hsl(45_95%_55%)] to-[hsl(30_95%_55%)]"
            delta={deltaPct(totals.total, prevTotals.bookings)}
          />
          <KpiCard
            label="Avg length of stay"
            value={`${avgStay.toFixed(1)} nights`}
            sub="Per booking in range"
            icon={Clock}
            tint="from-[hsl(170_85%_45%)] to-[hsl(195_85%_50%)]"
          />
          <KpiCard
            label="Online share"
            value={totals.guestsTotal ? `${Math.round((totals.guestsOnline / totals.guestsTotal) * 100)}%` : "—"}
            sub="Of all guests"
            icon={Percent}
            tint="from-[hsl(280_85%_55%)] to-[hsl(330_85%_55%)]"
          />
          <KpiCard
            label="Repeat guests"
            value={repeatGuests.length}
            sub="Unique guests with 2+ stays"
            icon={Repeat}
            tint="from-[hsl(15_90%_55%)] to-[hsl(45_90%_55%)]"
          />
        </section>


        {/* Charts */}
        <section className="grid gap-4 lg:grid-cols-3 mb-6">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-black tracking-tight text-slate-900">Daily guest arrivals</h3>
                <p className="text-xs text-slate-500">Guests per day, split by channel</p>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                trend
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gOffline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(265 85% 55%)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(265 85% 55%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gNatural" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(190 90% 45%)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(190 90% 45%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gAdmin" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(330 85% 55%)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(330 85% 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="offline" name="Offline" stroke="hsl(265 85% 55%)" fill="url(#gOffline)" strokeWidth={2} />
                  <Area type="monotone" dataKey="natural" name="Online · Natural" stroke="hsl(190 90% 45%)" fill="url(#gNatural)" strokeWidth={2} />
                  <Area type="monotone" dataKey="admin" name="Online · Admin" stroke="hsl(330 85% 55%)" fill="url(#gAdmin)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Channel mix</h3>
            <p className="text-xs text-slate-500 mb-3">Share of total guests</p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1.5">
              {pieData.map((p) => {
                const pct = totals.guestsTotal ? Math.round((p.value / totals.guestsTotal) * 100) : 0;
                return (
                  <li key={p.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                      {p.name}
                    </span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {p.value} <span className="text-slate-400 font-medium">({pct}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Revenue + comparison */}
        <section className="grid gap-4 lg:grid-cols-3 mb-6">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Bookings vs Guests vs Nights</h3>
            <p className="text-xs text-slate-500 mb-3">Per channel — for the selected range</p>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    {
                      name: "Offline",
                      Bookings: totals.offline,
                      Guests: totals.guestsOffline,
                      Nights: totals.nightsOffline,
                    },
                    {
                      name: "Online · Natural",
                      Bookings: totals.onlineNatural,
                      Guests: totals.guestsOnlineN,
                      Nights: totals.nightsOnlineN,
                    },
                    {
                      name: "Online · Admin",
                      Bookings: totals.onlineAdmin,
                      Guests: totals.guestsOnlineA,
                      Nights: totals.nightsOnlineA,
                    },
                  ]}
                  margin={{ left: -10, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Bookings" fill="hsl(265 85% 55%)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Guests" fill="hsl(190 90% 45%)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Nights" fill="hsl(330 85% 55%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-fuchsia-50/40 p-5 shadow-sm flex flex-col">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Quick insights</h3>
            <p className="text-xs text-slate-500 mb-4">For the selected period</p>
            <ul className="space-y-3 text-sm flex-1">
              <Insight
                icon={Activity}
                label="Avg guests / booking"
                value={
                  totals.total ? (totals.guestsTotal / totals.total).toFixed(2) : "—"
                }
              />
              <Insight
                icon={BedDouble}
                label="Total room nights"
                value={String(totals.nightsOffline + totals.nightsOnlineN + totals.nightsOnlineA)}
              />
              <Insight
                icon={Sparkles}
                label="Online share"
                value={
                  totals.guestsTotal
                    ? `${Math.round((totals.guestsOnline / totals.guestsTotal) * 100)}%`
                    : "—"
                }
              />
              <Insight
                icon={Bot}
                label="Admin-entered online"
                value={
                  totals.online
                    ? `${Math.round((totals.onlineAdmin / Math.max(1, totals.online)) * 100)}% of online`
                    : "—"
                }
              />
              <Insight
                icon={DollarSign}
                label="Avg revenue / guest"
                value={
                  totals.guestsTotal
                    ? fmtMoney(Math.round(totals.revenueTotal / totals.guestsTotal))
                    : "—"
                }
                mono
              />
            </ul>
          </div>
        </section>

        {/* Advanced analytics: weekday radar + cumulative growth */}
        <section className="grid gap-4 lg:grid-cols-3 mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Weekday pattern</h3>
            <p className="text-xs text-slate-500 mb-3">Busiest arrival days, by channel</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={weekdayPattern} outerRadius="75%">
                  <PolarGrid stroke="hsl(220 14% 88%)" />
                  <PolarAngleAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(220 14% 35%)", fontWeight: 700 }} />
                  <PolarRadiusAxis tick={{ fontSize: 9, fill: "hsl(220 9% 55%)" }} />
                  <Radar name="Offline" dataKey="offline" stroke="hsl(265 85% 55%)" fill="hsl(265 85% 55%)" fillOpacity={0.25} />
                  <Radar name="Natural" dataKey="natural" stroke="hsl(190 90% 45%)" fill="hsl(190 90% 45%)" fillOpacity={0.25} />
                  <Radar name="Admin" dataKey="admin" stroke="hsl(330 85% 55%)" fill="hsl(330 85% 55%)" fillOpacity={0.25} />
                  <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Cumulative guest growth</h3>
            <p className="text-xs text-slate-500 mb-3">Running total of arriving guests across the period</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeSeries}>
                  <CartesianGrid stroke="hsl(220 14% 90%)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(220 14% 40%)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(220 14% 40%)" }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="cumulative" stroke="hsl(265 85% 55%)" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Top rooms + Room categories + Payment breakdown */}
        <section className="grid gap-4 lg:grid-cols-3 mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Top rooms</h3>
            <p className="text-xs text-slate-500 mb-3">Highest guest volume in range</p>
            <ul className="space-y-2">
              {topRooms.length === 0 && <li className="text-xs text-slate-400">No data in range.</li>}
              {topRooms.map((r, i) => {
                const max = topRooms[0]?.guests || 1;
                const pct = Math.round((r.guests / max) * 100);
                return (
                  <li key={r.room} className="group">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-500">{i + 1}</span>
                        Room {r.room}
                      </span>
                      <span className="tabular-nums text-slate-500">{r.guests}g · {r.bookings}b</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-[hsl(265_85%_55%)] to-[hsl(330_85%_55%)]" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm flex flex-col">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Room categories</h3>
            <p className="text-xs text-slate-500 mb-3">Guests grouped by floor/category</p>
            <div className="flex-1 min-h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryBreakdown}
                  layout="vertical"
                  margin={{ top: 4, right: 28, bottom: 4, left: 4 }}
                  barCategoryGap={6}
                >
                  <CartesianGrid stroke="hsl(220 14% 90%)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(220 14% 40%)" }} />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={110}
                    tick={{ fontSize: 10, fill: "hsl(220 14% 35%)", fontWeight: 700 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <Tooltip cursor={{ fill: "hsl(220 14% 95%)" }} />
                  <Bar dataKey="guests" radius={[0, 6, 6, 0]} fill="hsl(265 85% 55%)" label={{ position: "right", fontSize: 10, fill: "hsl(220 14% 30%)", fontWeight: 700 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>


          <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Payment methods</h3>
            <p className="text-xs text-slate-500 mb-3">Revenue split by payment type</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {paymentBreakdown.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toLocaleString("en-US")} UZS`} />
                  <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Status breakdown + Repeat guests */}
        <section className="grid gap-4 lg:grid-cols-3 mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Booking status</h3>
            <p className="text-xs text-slate-500 mb-3">Distribution across statuses</p>
            <div className="space-y-2">
              {statusBreakdown.length === 0 && <div className="text-xs text-slate-400">No data.</div>}
              {statusBreakdown.map((s) => {
                const tot = statusBreakdown.reduce((a, b) => a + b.value, 0) || 1;
                const pct = Math.round((s.value / tot) * 100);
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                      <span className="capitalize">{s.name.replace(/-/g, " ")}</span>
                      <span className="tabular-nums text-slate-500">{s.value} · {pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-[hsl(190_90%_45%)] to-[hsl(265_85%_55%)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
            <h3 className="text-sm font-black tracking-tight text-slate-900">Top repeat guests</h3>
            <p className="text-xs text-slate-500 mb-3">Guests who came back more than once in range</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-bold">Guest</th>
                    <th className="py-2 pr-3 font-bold text-center">Stays</th>
                    <th className="py-2 pr-3 font-bold text-center">Guests</th>
                    <th className="py-2 pr-3 font-bold text-right">Revenue</th>
                    <th className="py-2 pr-3 font-bold text-right">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {repeatGuests.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-slate-400">No repeat guests in this range.</td></tr>
                  )}
                  {repeatGuests.map((r) => (
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-bold text-slate-800">{r.name}</td>
                      <td className="py-2 pr-3 text-center tabular-nums">{r.stays}</td>
                      <td className="py-2 pr-3 text-center tabular-nums">{r.guests}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{fmtMoney(r.revenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{format(parseISO(r.lastSeen), "MMM d, yyyy")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Guest history */}

        <section className="rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-black tracking-tight text-slate-900">Guest history</h3>
              <p className="text-xs text-slate-500">
                Every guest in this period — from the live booking grid. Switch sides to filter.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, room, phone…"
                  className="w-60 rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-xs font-semibold outline-none focus:border-[hsl(265_85%_55%)] focus:ring-2 focus:ring-[hsl(265_85%_55%)]/20"
                />
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
                {(
                  [
                    { id: "offline", label: "Offline", icon: Building2 },
                    { id: "online", label: "Online", icon: Globe2 },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setScope(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                      scope === t.id
                        ? "bg-white text-[hsl(265_85%_45%)] shadow"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {scope === "online" && (
            <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold">
              {(
                [
                  { id: "natural", label: "Natural online", icon: Sparkles, color: "text-cyan-600" },
                  { id: "admin", label: "Admin online", icon: Bot, color: "text-fuchsia-600" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOnlineSide(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                    onlineSide === t.id
                      ? "bg-gradient-to-r from-[hsl(265_85%_55%)] to-[hsl(280_85%_55%)] text-white shadow"
                      : `${t.color} hover:bg-slate-50`
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {historyRows.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-12 text-center">
              <UsersRound className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-2 text-sm font-bold text-slate-700">No guests in this period</p>
              <p className="text-xs text-slate-500">Try a wider date range or a different channel.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold">Guest</th>
                      <th className="px-3 py-2 text-left font-bold">Room</th>
                      <th className="px-3 py-2 text-left font-bold">Stay</th>
                      <th className="px-3 py-2 text-left font-bold">Guests</th>
                      <th className="px-3 py-2 text-left font-bold">Channel</th>
                      <th className="px-3 py-2 text-left font-bold">Contact</th>
                      <th className="px-3 py-2 text-right font-bold">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((row, idx) => {
                      const { b, kind } = row;
                      const creator = creatorByBookingId.get(b.id);
                      const nights = Math.max(
                        1,
                        differenceInCalendarDays(parseISO(b.checkOut), parseISO(b.checkIn)),
                      );
                      return (
                        <motion.tr
                          key={b.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18, delay: Math.min(idx * 0.01, 0.3) }}
                          onClick={() => setSelectedBooking(b)}
                          className="border-t border-slate-100 hover:bg-fuchsia-50/30 transition-colors cursor-pointer"
                          title="Open booking details"
                        >

                          <td className="px-3 py-2.5">
                            <div className="font-bold text-slate-900">{formatGuestName(b) || "—"}</div>
                            {b.notes && (
                              <div className="text-[11px] text-slate-500 line-clamp-1">{b.notes}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                              <BedDouble className="h-3 w-3" />
                              {b.roomNumber}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600 tabular-nums">
                            <div>
                              {format(parseISO(b.checkIn), "MMM d")} →{" "}
                              {format(parseISO(b.checkOut), "MMM d, yyyy")}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {nights} night{nights === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-bold text-slate-800 tabular-nums">
                            {b.guestCount || 1}
                          </td>
                          <td className="px-3 py-2.5">
                            <ChannelBadge kind={kind} creator={creator?.username} />
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-500">
                            <div>{b.guestPhone || "—"}</div>
                            <div className="text-slate-400">{b.guestEmail || ""}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-bold text-slate-900 tabular-nums">
                            {b.price ? fmtMoney(b.price) : b.paymentAmount ? fmtMoney(b.paymentAmount) : "—"}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>

      <BookingDialog
        open={selectedBooking != null}
        onClose={() => setSelectedBooking(null)}
        onSave={(b) => { const ok = addBooking(b); if (ok !== false) setSelectedBooking(null); return ok; }}
        onUpdate={updateBooking}
        onDelete={(id) => { removeBooking(id); setSelectedBooking(null); }}
        roomNumber={selectedBooking?.roomNumber ?? 0}
        checkIn={selectedBooking?.checkIn ?? format(new Date(), "yyyy-MM-dd")}
        checkOut={selectedBooking?.checkOut ?? format(new Date(), "yyyy-MM-dd")}
        editBooking={selectedBooking}
        bedIndex={selectedBooking?.bedIndex}
        readOnly
      />

    </div>
  );
}


function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tint,
  mono,
  delta,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  mono?: boolean;
  delta?: number;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/90 backdrop-blur p-5 shadow-sm"
    >
      <div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${tint} opacity-20 blur-2xl`} />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br ${tint} text-white shadow-md`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className={`mt-3 text-2xl font-black text-slate-900 ${mono ? "tabular-nums text-xl" : ""}`}>{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        {sub && <div className="text-[11px] text-slate-500 flex-1 truncate">{sub}</div>}
        {typeof delta === "number" && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
              up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
            title="vs previous period"
          >
            {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {up ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
    </motion.div>
  );
}


function Insight({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white/70 px-3 py-2">
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(265_85%_55%)]/10 to-[hsl(280_85%_55%)]/10 text-[hsl(265_85%_45%)]">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </span>
      <span className={`text-sm font-black text-slate-900 ${mono ? "tabular-nums" : ""}`}>{value}</span>
    </li>
  );
}

function ChannelBadge({ kind, creator }: { kind: ChannelKind; creator?: string }) {
  if (kind === "offline") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
        <Building2 className="h-3 w-3" />
        Offline
      </span>
    );
  }
  if (kind === "online-natural") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-700">
        <Sparkles className="h-3 w-3" />
        Online · Natural
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-700">
      <Bot className="h-3 w-3" />
      Online · Admin{creator ? ` (${creator})` : ""}
    </span>
  );
}

// Avoid unused-imports warning for ChevronDown (kept for parity with sibling pages).
void ChevronDown;
