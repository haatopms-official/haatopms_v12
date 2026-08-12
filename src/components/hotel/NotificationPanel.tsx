import { useCallback, useRef } from 'react';
import { Bell, X, AlertTriangle, LogIn, LogOut } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from '@tanstack/react-router';

/**
 * Resizable notification side panel. Renders whenever `panelOpen` is true
 * in NotificationsContext. Superuser sees the same visuals; only their
 * click-to-focus/close actions are still wired the same way (functional
 * inspection). Admin / manager use it as their live "action needed" queue.
 */
export function NotificationPanel() {
  const { panelOpen, closePanel, panelWidth, setPanelWidth, critical, requestFocusBooking } = useNotifications();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const asideRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number; latest: number } | null>(null);
  const draggingRef = useRef(false);

  // Imperative pointer-driven resize. We write the new width to the element
  // synchronously on every pointermove — no rAF throttle, no React state
  // flip, no context write, no localStorage write. That's what makes the
  // drag feel instantaneous. The final width is committed to context (and
  // localStorage) exactly once on pointerup.
  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const start = asideRef.current?.getBoundingClientRect().width ?? panelWidth;
    dragStateRef.current = { startX: e.clientX, startWidth: start, latest: start };
    draggingRef.current = true;
    if (asideRef.current) {
      asideRef.current.style.willChange = 'width';
      asideRef.current.style.transition = 'none';
    }
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* noop */ }

    const clampWidth = (w: number) => {
      const maxW = typeof window !== 'undefined' ? window.innerWidth - 200 : 800;
      return Math.max(280, Math.min(maxW, w));
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragStateRef.current;
      const el = asideRef.current;
      if (!d || !el) return;
      // Panel is docked on the right — dragging left grows the panel.
      const next = clampWidth(d.startWidth + (d.startX - ev.clientX));
      d.latest = next;
      el.style.width = `${next}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = dragStateRef.current;
      dragStateRef.current = null;
      draggingRef.current = false;
      if (asideRef.current) {
        asideRef.current.style.willChange = '';
        asideRef.current.style.transition = '';
      }
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      // Commit final width to context (and localStorage) exactly once.
      if (d) setPanelWidth(d.latest);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [panelWidth, setPanelWidth]);

  const handleGoToBooking = useCallback((bookingId: string) => {
    // Ensure we're on a route that shows the grid before focusing.
    const p = location.pathname;
    const onGrid = p === '/admin' || p === '/manager' || p === '/superuser' || p.startsWith('/admin') || p.startsWith('/manager') || p.startsWith('/superuser');
    requestFocusBooking(bookingId);
    if (!onGrid) {
      const dest = user?.role === 'admin' ? '/admin' : user?.role === 'manager' ? '/manager' : '/superuser';
      navigate({ to: dest });
    }
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.getElementById('hotel-main-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [location.pathname, navigate, requestFocusBooking, user?.role]);

  if (!panelOpen) return null;

  return (
    <aside
      ref={asideRef}
      className="fixed top-0 right-0 z-[60] h-screen bg-background/95 backdrop-blur-xl border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      style={{ width: Math.max(280, panelWidth || 380) }}
      aria-label="Notifications"
    >
      {/* Resize handle on the left edge — wide invisible hit area so the
          drag responds instantly the moment the pointer goes down, with a
          slim visible strip on top. */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        className="absolute left-[-4px] top-0 bottom-0 w-3 cursor-ew-resize select-none touch-none z-10"
        title="Drag to resize"
      >
        <div className="absolute left-1 top-0 bottom-0 w-1.5 bg-transparent hover:bg-primary/40 transition-colors" />
      </div>


      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-red-500/10 via-amber-500/5 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/15 text-red-600 ring-1 ring-red-500/30">
            <Bell className="h-4 w-4" />
            {critical.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-background">
                {critical.length}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black tracking-tight text-foreground truncate">Notifications</h2>
            <p className="text-[11px] text-muted-foreground truncate">
              {critical.length === 0 ? 'All problems resolved' : `${critical.length} critical alert${critical.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            // Any pulsating focus-glow that was triggered from this panel
            // must stop the moment the operator closes the dropdown, so a
            // subsequent click on the grid is never consumed by the
            // "click-anywhere-cancels-glow" listener instead of doing what
            // the operator meant to do.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('hotel:stop-focus-glow'));
            }
            closePanel();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close notifications"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {critical.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30 mb-4">
              <Bell className="h-7 w-7" />
            </div>
            <p className="text-sm font-bold text-foreground">All problems resolved</p>
            <p className="text-xs text-muted-foreground mt-1">
              No overdue check-ins or check-outs right now.
            </p>
          </div>
        ) : (
          critical.map((n) => {
            const Icon = n.kind === 'missed_checkin' ? LogIn : LogOut;
            return (
              <button
                key={n.id}
                onClick={() => handleGoToBooking(n.bookingId)}
                className="group w-full text-left rounded-xl border border-red-500/40 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/60 transition-all p-3 flex gap-3 shadow-sm hover:shadow-md"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white ring-1 ring-red-700/50 shadow">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-red-600">Critical</span>
                    <Icon className="h-3 w-3 text-red-600/70" />
                    <span className="text-[11px] font-bold text-foreground/80">{n.title}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-foreground/90">{n.detail}</p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-600 text-white text-[11px] font-black px-2 py-0.5 shadow group-hover:scale-105 transition-transform">
                      Room {n.roomNumber}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {n.guestName}
                    </span>
                    <span className="ml-auto text-[10px] text-red-600 font-bold">
                      Click to open in grid →
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
