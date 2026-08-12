import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

interface Props {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  labelWidth: number;
  todayContentPx: number;
  onDragStateChange?: (dragging: boolean) => void;
  onEdgeRequest?: (direction: 'past' | 'future') => void;
}

const MIN_THUMB_WIDTH = 56;       // floor — never disappears
const MAX_THUMB_WIDTH_RATIO = 0.3; // at today
const EDGE_AUTOSCROLL_STEP = 32;
const EDGE_REQUEST_INTERVAL_MS = 180;
const PROXIMITY_RANGE_PX = 4000;   // distance over which thumb breathes

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeInOut = (t: number) => t * t * (3 - 2 * t);

export function TimelineBottomScrollbar({
  scrollRef,
  labelWidth,
  todayContentPx,
  onDragStateChange,
  onEdgeRequest,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ scrollLeft: 0, scrollWidth: 1, clientWidth: 1 });
  const [trackWidth, setTrackWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const activeDragRef = useRef(false);

  /** Thumb width breathes by distance from today (in pixels), not by ratio of content. */
  const computeThumbWidth = useCallback((scrollLeft: number, clientWidth: number) => {
    const viewport = Math.max(1, clientWidth - labelWidth);
    const viewportCenter = scrollLeft + viewport / 2;
    const distance = Math.abs(viewportCenter - todayContentPx);
    const proximity = clamp(1 - distance / PROXIMITY_RANGE_PX, 0, 1);
    const eased = easeInOut(proximity);
    const maxWidth = Math.max(MIN_THUMB_WIDTH + 40, Math.round(trackWidth * MAX_THUMB_WIDTH_RATIO));
    const width = MIN_THUMB_WIDTH + (maxWidth - MIN_THUMB_WIDTH) * eased;
    return Math.round(Math.max(MIN_THUMB_WIDTH, Math.min(trackWidth - 8, width)));
  }, [labelWidth, todayContentPx, trackWidth]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el || activeDragRef.current) return;
    setMetrics({ scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };
    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) ro.observe(inner);
    window.addEventListener('resize', schedule);
    return () => {
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, measure]);

  useLayoutEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    ro.observe(trackRef.current);
    setTrackWidth(trackRef.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const viewport = Math.max(1, metrics.clientWidth - labelWidth);
  const maxScroll = Math.max(1, metrics.scrollWidth - metrics.clientWidth);
  const liveThumbWidth = trackWidth > 0 ? computeThumbWidth(metrics.scrollLeft, metrics.clientWidth) : MIN_THUMB_WIDTH;
  const maxThumbLeft = Math.max(0, trackWidth - liveThumbWidth - 8);
  const liveThumbLeft = clamp((metrics.scrollLeft / maxScroll) * maxThumbLeft, 0, maxThumbLeft);

  const onThumbPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !trackRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    activeDragRef.current = true;
    setDragging(true);
    onDragStateChange?.(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // Pure position mapping (Excel-style): the pointer's horizontal delta
    // from the drag anchor is translated directly to a scrollLeft delta
    // via the current track/scroll ratio. No accumulated integration →
    // no drift, no "teleport", no freeze at the edges.
    let pointerX = e.clientX;
    const startPointerX = e.clientX;
    // Anchor in *content* space (scrollLeft) at drag start; when the grid
    // prepends past days beneath us, we shift this anchor by the same
    // amount so the pointer keeps mapping to the same visual position.
    let anchorScroll = el.scrollLeft;
    let lastScrollWidth = el.scrollWidth;
    let raf = 0;
    let lastEdgeReqAt = 0;

    const writeThumb = (left: number, width: number) => {
      if (!thumbRef.current) return;
      thumbRef.current.style.width = `${width}px`;
      thumbRef.current.style.transform = `translate3d(${left + 4}px, -50%, 0)`;
    };

    const requestEdge = (dir: 'past' | 'future') => {
      const now = performance.now();
      if (now - lastEdgeReqAt < EDGE_REQUEST_INTERVAL_MS) return;
      lastEdgeReqAt = now;
      onEdgeRequest?.(dir);
    };

    const tick = () => {
      if (!activeDragRef.current) return;

      // Compensate for past-prepend: if scrollWidth grew AND scrollLeft
      // jumped forward by (roughly) the same amount, the grid inserted
      // days on the LEFT. Anchor forward by that delta so the pointer
      // mapping stays visually stable — no teleport under the cursor.
      const widthDelta = el.scrollWidth - lastScrollWidth;
      if (widthDelta > 0) {
        // Heuristic: if scrollLeft moved forward by >= widthDelta * 0.5,
        // it was a prepend. Otherwise it was an append (scrollLeft stays).
        const scrollLeftMovedForwardApprox =
          el.scrollLeft - (anchorScroll + (pointerX - startPointerX) * 0); // placeholder
        // Simpler + reliable: detect prepend by comparing scrollLeft to
        // what we last commanded. If it jumped by widthDelta, shift the
        // anchor forward by widthDelta so the pointer -> scroll mapping
        // is preserved. We know the last commanded value because we set
        // it below on the previous frame.
        if (scrollLeftMovedForwardApprox >= widthDelta * 0.5) {
          anchorScroll += widthDelta;
        }
      }

      const trackLen = trackRef.current?.getBoundingClientRect().width ?? trackWidth;
      const maxScrollNow = Math.max(1, el.scrollWidth - el.clientWidth);
      const liveWidth = computeThumbWidth(anchorScroll + (pointerX - startPointerX) * (maxScrollNow / Math.max(1, trackLen - MIN_THUMB_WIDTH - 8)), el.clientWidth);
      const usableTrack = Math.max(1, trackLen - liveWidth - 8);

      // Pointer delta since drag start → scroll delta via current ratio.
      const pointerDelta = pointerX - startPointerX;
      const scrollDelta = pointerDelta * (maxScrollNow / usableTrack);
      let target = anchorScroll + scrollDelta;

      // Past edge: if the pointer wants to go before day 0, ask the grid
      // to prepend more past days. Clamp scroll to 0 until they arrive
      // (next frame we'll compensate via the widthDelta path above).
      if (target < 0) {
        requestEdge('past');
        target = 0;
      }
      // Future edge: same idea, but always safe because the grid can
      // extend the future without shifting scrollLeft.
      if (target > maxScrollNow) {
        requestEdge('future');
        target = maxScrollNow;
      }

      el.scrollLeft = target;

      const visualLeft = clamp((target / maxScrollNow) * usableTrack, 0, usableTrack);
      writeThumb(visualLeft, liveWidth);

      lastScrollWidth = el.scrollWidth;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => { ev.preventDefault(); pointerX = ev.clientX; };
    const up = (ev: PointerEvent) => {
      activeDragRef.current = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (thumbRef.current) {
        thumbRef.current.style.width = '';
        thumbRef.current.style.transform = '';
      }
      setMetrics({ scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      setDragging(false);
      onDragStateChange?.(false);
      try { (e.target as HTMLElement).releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [scrollRef, trackWidth, computeThumbWidth, onDragStateChange, onEdgeRequest]);

  const onTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current) return;
    const el = scrollRef.current;
    if (!el || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - liveThumbWidth / 2;
    const usable = Math.max(1, trackWidth - liveThumbWidth - 8);
    const clamped = clamp(x, 0, usable);
    const target = (clamped / usable) * (el.scrollWidth - el.clientWidth);
    el.scrollTo({ left: target, behavior: 'smooth' });
  }, [scrollRef, liveThumbWidth, trackWidth]);

  useEffect(() => () => { activeDragRef.current = false; onDragStateChange?.(false); }, [onDragStateChange]);

  const hidden = metrics.scrollWidth <= viewport + labelWidth + 4;

  return (
    <div
      className="sticky bottom-0 z-40 flex w-full select-none border-t border-border/40 bg-gradient-to-b from-background/70 to-background backdrop-blur-md"
      style={{
        height: 24,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 200ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ width: labelWidth }} className="shrink-0" />
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative flex-1 cursor-pointer"
        style={{ touchAction: 'none' }}
      >
        <div
          className="absolute left-1 right-1 top-1/2 -translate-y-1/2 rounded-full bg-muted/60 ring-1 ring-border/60"
          style={{
            height: hovered || dragging ? 10 : 6,
            transition: dragging ? 'none' : 'height 140ms ease',
          }}
        />
        <div
          ref={thumbRef}
          onPointerDown={onThumbPointerDown}
          role="scrollbar"
          aria-orientation="horizontal"
          aria-valuenow={Math.round((metrics.scrollLeft / maxScroll) * 100) || 0}
          className="absolute top-1/2 cursor-grab rounded-full bg-gradient-to-b from-primary to-primary/80 shadow-md ring-1 ring-primary/40 active:cursor-grabbing"
          style={{
            left: 0,
            transform: `translate3d(${liveThumbLeft + 4}px, -50%, 0)`,
            width: liveThumbWidth,
            height: hovered || dragging ? 14 : 10,
            transition: dragging
              ? 'none'
              : 'width 260ms cubic-bezier(.22,.61,.36,1), transform 180ms cubic-bezier(.22,.61,.36,1), height 160ms ease, box-shadow 160ms ease',
            boxShadow: dragging || hovered
              ? '0 4px 14px -2px color-mix(in oklab, hsl(var(--primary)) 55%, transparent)'
              : '0 2px 6px -1px color-mix(in oklab, hsl(var(--primary)) 30%, transparent)',
            touchAction: 'none',
            willChange: dragging ? 'transform, width' : 'transform',
          }}
        />
      </div>
    </div>
  );
}
