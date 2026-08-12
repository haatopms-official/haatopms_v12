import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthHistory } from "@/contexts/AuthHistoryContext";
import { useAudit } from "@/contexts/AuditContext";
import { computeShiftWindow } from "@/contexts/ShiftContext";
import type { LoginEvent } from "@/contexts/auth-types";

const SWEEP_MS = 20_000;

/**
 * Automatically signs admins out at the shift change times (06:00 and 18:00
 * local time), and only admins — superuser, director and manager sessions
 * are never affected.
 *
 * Two mechanisms work together so the logout actually happens even if the
 * admin's own browser tab is closed, asleep, or force-killed before its
 * boundary:
 *
 * 1. A per-session timer, scheduled only while the admin's own tab is open,
 *    that calls `logout()` the moment their shift ends.
 * 2. A global housekeeping sweep, mounted unconditionally (any role, any
 *    page, including the login screen), that periodically scans the shared
 *    login history for ANY admin whose latest event is a `login` past its
 *    shift boundary with no matching `logout`, and closes it out. As long
 *    as *some* browser somewhere has the app open, every admin's session
 *    gets correctly ended at the boundary — not just their own tab.
 */
export function ShiftWatcher() {
  const { user, logout } = useAuth();
  const { history, pushHistory } = useAuthHistory();
  const { log } = useAudit();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1) Log the current admin out the moment their own shift boundary hits.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user) return;
    if (user.role !== "admin") return;

    const scheduleNext = () => {
      const now = new Date();
      const candidates = [6, 18].map((h) => {
        const d = new Date(now);
        d.setHours(h, 0, 0, 0);
        if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
        return d.getTime();
      });
      const nextAt = Math.min(...candidates);
      const delay = Math.max(1000, nextAt - now.getTime());
      timerRef.current = setTimeout(() => {
        logout();
      }, delay);
    };

    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [user, logout]);

  // 2) Global sweep — closes out every admin's stale login, in whichever
  // tab happens to be open, regardless of who (if anyone) is signed in
  // there. Runs immediately on mount and then every SWEEP_MS.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sweep = () => {
      const now = Date.now();
      const latest = new Map<string, LoginEvent>();
      for (const ev of history) {
        if (ev.role !== "admin") continue;
        const key = ev.adminId ?? ev.username;
        const prev = latest.get(key);
        if (!prev || new Date(ev.at).getTime() > new Date(prev.at).getTime()) {
          latest.set(key, ev);
        }
      }
      for (const e of latest.values()) {
        if (e.action !== "login") continue;
        const shiftEnd = computeShiftWindow(new Date(e.at)).end;
        if (now < shiftEnd.getTime()) continue; // still within this admin's shift

        // Stale login past its shift boundary with no logout recorded —
        // the admin's own tab must have closed, slept, or been force-shut
        // before it could log itself out. Close it out here instead.
        pushHistory({
          username: e.username,
          role: "admin",
          action: "logout",
          at: shiftEnd.toISOString(),
          adminId: e.adminId,
          displayName: e.displayName,
        });
        log({
          actor: { username: e.username, role: "admin", adminId: e.adminId ?? null },
          category: "auth",
          action: "auth.logout",
          summary: `${e.displayName ?? e.username} was automatically signed out (shift ended)`,
        });
      }
    };

    sweep();
    const id = window.setInterval(sweep, SWEEP_MS);
    return () => window.clearInterval(id);
  }, [history, pushHistory, log]);

  return null;
}