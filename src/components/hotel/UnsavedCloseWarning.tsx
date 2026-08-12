import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave?: () => void;
  title: string;
  message: string;
  /** Retained for API compatibility; no longer rendered as a button. */
  cancelLabel?: string;
  discardLabel: string;
  saveLabel?: string;
  saveDisabled?: boolean;
};

/**
 * Animated, brand-aware "are you sure you want to close?" overlay.
 * Renders ON TOP of the parent dialog so it doesn't fight Radix's Dialog focus trap.
 *
 * UX: the "Продолжить редактирование" (cancel) action was removed per product
 * decision — the user can dismiss with the top-right ✕ or Escape, and choose
 * between Save or Discard as the two committed outcomes.
 */
export function UnsavedCloseWarning({
  open,
  onCancel,
  onDiscard,
  onSave,
  title,
  message,
  discardLabel,
  saveLabel,
  saveDisabled = false,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          data-unsaved-close-warning="true"
          className="fixed inset-0 z-[2147483000] flex items-center justify-center px-4 pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        >
          <motion.div
            className="absolute inset-0 bg-foreground/70 backdrop-blur-md"
            onClick={onCancel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              transition: { type: 'spring', stiffness: 340, damping: 26 },
            }}
            exit={{ opacity: 0, scale: 0.92, y: 12, transition: { duration: 0.15 } }}
            className="relative w-full max-w-[26rem] overflow-hidden rounded-3xl border border-destructive/20 bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-background/10"
          >
            {/* Ambient glow */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-destructive/25 blur-3xl"
              animate={{ scale: [1, 1.12, 1], opacity: [0.4, 0.65, 0.4] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -left-24 -bottom-24 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
              animate={{ scale: [1, 1.08, 1], opacity: [0.25, 0.45, 0.25] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
            />

            {/* Close button */}
            <button
              onClick={onCancel}
              aria-label="Close"
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground backdrop-blur transition hover:border-foreground/40 hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative px-7 pt-8 pb-6 text-center">
              <motion.div
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-destructive to-destructive/70 text-destructive-foreground shadow-lg shadow-destructive/40"
                initial={{ scale: 0.6, rotate: -8 }}
                animate={{
                  scale: 1,
                  rotate: [0, -6, 6, -4, 4, 0],
                }}
                transition={{ duration: 1, ease: 'easeOut' }}
              >
                <AlertTriangle className="h-8 w-8" />
              </motion.div>

              <h2 className="mt-5 font-display text-2xl font-black tracking-tight text-foreground">
                {title}
              </h2>
              <p className="mx-auto mt-2 max-w-[22rem] text-sm leading-relaxed text-muted-foreground">
                {message}
              </p>
            </div>

            <div className="relative flex flex-col-reverse gap-2 border-t border-border/60 bg-background/70 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-center">
              <Button
                variant="destructive"
                size="sm"
                onClick={onDiscard}
                className="w-full gap-1.5 rounded-xl shadow-md shadow-destructive/30 sm:flex-1"
              >
                <X className="h-3.5 w-3.5" /> {discardLabel}
              </Button>
              {onSave && (
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={saveDisabled}
                  className="w-full gap-1.5 rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/90 sm:flex-1"
                >
                  <Save className="h-3.5 w-3.5" /> {saveLabel}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
