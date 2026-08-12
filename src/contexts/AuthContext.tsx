import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useAdmins } from "./AdminsContext";
import { useAudit } from "./AuditContext";
import { useAuthHistory } from "./AuthHistoryContext";
import { computeShiftWindow } from "./ShiftContext";
import type { UserRole, LoginEvent } from "./auth-types";

// Re-export so all existing imports of UserRole and LoginEvent from AuthContext keep working
export type { UserRole, LoginEvent };

interface AuthUser {
  username: string;
  role: UserRole;
  canSwitchWorkspaces?: boolean;
  adminId?: string | null;
  displayName?: string;
  loginAt?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  login: (username: string, password: string) => { ok: true; role: UserRole } | { ok: false; error: string };
  switchRole: (role: UserRole) => void;
  logout: () => void;
  history: LoginEvent[];
  clearHistory: () => void;
}

const STORAGE_KEY = "hotel_auth_user";

const CREDENTIALS: Record<string, { password: string; role: UserRole }> = {
  superuser: { password: "SaexatTestSuperuserpanel001", role: "superuser" },
  director: { password: "SaexatTestDirectorpanel002", role: "director" },
  admin: { password: "SaexatTestAdminpanel003", role: "admin" },
  manager: { password: "SaexatTestManagerpanel004", role: "manager" },
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { findByUsername } = useAdmins();
  const { log } = useAudit();
  const { history, pushHistory, clearHistory, flushHistory } = useAuthHistory();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as AuthUser) : null;
      // If this was an admin session and its shift boundary has already
      // passed (e.g. the tab was asleep or the machine was off through the
      // 06:00/18:00 cutoff), don't silently resurrect it — treat it as
      // logged out and record the closing event.
      if (parsed && parsed.role === "admin" && parsed.loginAt) {
        const shiftEnd = computeShiftWindow(new Date(parsed.loginAt)).end;
        if (new Date().getTime() >= shiftEnd.getTime()) {
          try {
            pushHistory({
              username: parsed.username,
              role: "admin",
              action: "logout",
              at: shiftEnd.toISOString(),
              adminId: parsed.adminId,
              displayName: parsed.displayName,
            });
            log({
              actor: { username: parsed.username, role: "admin", adminId: parsed.adminId ?? null },
              category: "auth",
              action: "auth.logout",
              summary: `${parsed.displayName ?? parsed.username} was automatically signed out (shift ended)`,
            });
          } catch { /* ignore */ }
          setUser(null);
          try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
          try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
          setReady(true);
          return;
        }
      }
      setUser(
        parsed
          ? {
              ...parsed,
              canSwitchWorkspaces:
                parsed.canSwitchWorkspaces || parsed.username === "superuser",
            }
          : null,
      );
      // Clean up any legacy persisted session from localStorage.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current session to sessionStorage
  useEffect(() => {
    if (user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, [user]);

  // Auto-logout record when the browser tab/window is closed
  useEffect(() => {
    if (typeof window === "undefined") return;
const handler = () => {
      if (!user) return;
      try {
        pushHistory({
          username: user.username,
          role: user.role,
          action: "logout",
          at: new Date().toISOString(),
          adminId: user.adminId,
          displayName: user.displayName,
        });
        flushHistory();
      } catch { /* ignore */ }
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
}, [user, pushHistory, flushHistory]);

  const login: AuthContextValue["login"] = useCallback(
    (username, password) => {
      const u = username.trim().toLowerCase();


      // 1) Try a registered admin first.
      const admin = findByUsername(u);
      if (admin && admin.password === password) {
        const at = new Date().toISOString();
        const next: AuthUser = {
          username: admin.username,
          role: "admin",
          adminId: admin.id,
          displayName: `${admin.name} ${admin.surname}`.trim(),
          loginAt: at,
        };
        setUser(next);
        pushHistory({
          username: next.username,
          role: "admin",
          action: "login",
          at,
          adminId: admin.id,
          displayName: next.displayName,
        });
        log({
          actor: { username: next.username, role: "admin", adminId: admin.id },
          category: "auth",
          action: "auth.login",
          summary: `${next.displayName} signed in`,
        });
        return { ok: true, role: "admin" };
      }

      // 2) Built-in master credentials.
      const entry = CREDENTIALS[u];
      if (!entry || entry.password !== password) {
        return { ok: false, error: "Invalid username or password" };
      }
      const at = new Date().toISOString();
      const next: AuthUser = {
        username: u,
        role: entry.role,
        displayName: u,
        canSwitchWorkspaces: entry.role === "superuser",
        loginAt: at,
      };
      setUser(next);
      pushHistory({
        username: u,
        role: entry.role,
        action: "login",
        at,
        displayName: u,
      });
      log({
        actor: { username: u, role: entry.role },
        category: "auth",
        action: "auth.login",
        summary: `${u} signed in`,
      });
      return { ok: true, role: entry.role };
    },
    [findByUsername, log, pushHistory],
  );

  const logout = useCallback(() => {
    if (user) {
      const at = new Date().toISOString();
      pushHistory({
        username: user.username,
        role: user.role,
        action: "logout",
        at,
        adminId: user.adminId,
        displayName: user.displayName,
      });
      log({
        actor: { username: user.username, role: user.role, adminId: user.adminId },
        category: "auth",
        action: "auth.logout",
        summary: `${user.displayName ?? user.username} signed out`,
      });
    }
    setUser(null);
  }, [user, log, pushHistory]);

  const switchRole = useCallback((role: UserRole) => {
    if (!user?.canSwitchWorkspaces) return;
    const next: AuthUser = {
      username: user.username,
      role,
      displayName: role,
      canSwitchWorkspaces: true,
    };
    setUser(next);
    log({
      actor: { username: user.username, role: user.role, adminId: user.adminId },
      category: "auth",
      action: "auth.role_switch",
      summary: `Switched workspace to ${role}`,
    });
  }, [user, log]);

  const value = useMemo(
    () => ({ user, ready, login, switchRole, logout, history, clearHistory }),
    [user, ready, login, switchRole, logout, history, clearHistory],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const ROLE_HOME = {
  superuser: "/superuser",
  director: "/director",
  admin: "/admin",
  manager: "/manager",
} as const satisfies Record<UserRole, string>;