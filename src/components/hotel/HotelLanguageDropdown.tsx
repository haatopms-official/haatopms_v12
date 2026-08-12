import { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useI18n, type Lang } from '@/hooks/useI18n';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type LangDef = { code: Lang; cc: string; name: string; short: string };

const LANGS: LangDef[] = [
  { code: 'ru', cc: 'ru', name: 'Русский', short: 'RU' },
  { code: 'uz', cc: 'uz', name: "O'zbek", short: 'UZ' },
  { code: 'en', cc: 'gb', name: 'English', short: 'EN' },
];

// Preload every flag image once at module load so the first time the user
// opens the dropdown the flags are already sitting in the browser cache.
// Previously the popover would fire three cold network requests every time
// it opened, which is what made the menu feel laggy across every role.
if (typeof window !== 'undefined') {
  for (const l of LANGS) {
    const img1 = new Image();
    img1.decoding = 'sync';
    img1.src = `https://flagcdn.com/w40/${l.cc}.png`;
    const img2 = new Image();
    img2.decoding = 'sync';
    img2.src = `https://flagcdn.com/w80/${l.cc}.png`;
  }
}

/**
 * Renders a country flag as an <img> from the flagcdn CDN.
 */
function Flag({ cc, className }: { cc: string; className?: string }) {
  return (
    <img
      src={`https://flagcdn.com/w40/${cc}.png`}
      srcSet={`https://flagcdn.com/w80/${cc}.png 2x`}
      width={20}
      height={15}
      alt=""
      aria-hidden="true"
      loading="eager"
      decoding="sync"
      className={`inline-block rounded-[2px] object-cover shadow-sm ${className ?? ''}`}
      style={{ width: '1.25rem', height: '0.9rem' }}
      draggable={false}
    />
  );
}

/**
 * Language switcher for the hotel navbar.
 *
 * Uses a Radix Popover (via shadcn) so the menu is rendered through a portal
 * directly under <body> with z-index 50+. This guarantees the dropdown floats
 * above the timeline grid, sticky headers, and booking bars — fixing the
 * "dropdown hides behind table" bug from the original implementation.
 */
export function HotelLanguageDropdown() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGS.find(l => l.code === lang)!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-xl bg-white/10 backdrop-blur-sm px-2.5 py-2 text-sm font-semibold text-white border border-white/15 hover:bg-white/20 hover:border-white/25 transition-colors duration-150 group whitespace-nowrap"
          aria-label={current.name}
          title={current.name}
        >
          <Flag cc={current.cc} />
          <span className="font-bold tracking-wide">{current.short}</span>
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform duration-150"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[100] min-w-[220px] rounded-xl bg-card border border-border shadow-2xl overflow-hidden p-0"
        style={{ willChange: 'transform, opacity' }}
      >
        <div>
          {LANGS.map((l) => {
            const active = lang === l.code;
            return (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setOpen(false); }}
                className={`relative flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors duration-100
                  ${active ? 'bg-primary/10 text-primary font-bold' : 'text-foreground hover:bg-muted/70'}`}
              >
                <Flag cc={l.cc} className="!w-7 !h-5" />
                <span>{l.name}</span>
                {active && <Check className="ml-auto h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

