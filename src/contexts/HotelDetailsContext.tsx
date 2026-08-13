import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface HotelDetails {
  logo: string;          // data URL or empty
  hotelName: string;
  companyName: string;
  inn: string;
  raschetnyiSchet: string;
  telephone: string;
  site: string;
  email: string;
}

const DEFAULTS: HotelDetails = {
  logo: '',
  hotelName: '',
  companyName: '',
  inn: '',
  raschetnyiSchet: '',
  telephone: '',
  site: '',
  email: '',
};

function fromRow(row: Record<string, unknown> | null): HotelDetails {
  if (!row) return DEFAULTS;
  return {
    logo: (row.logo as string) ?? '',
    hotelName: (row.hotel_name as string) ?? '',
    companyName: (row.company_name as string) ?? '',
    inn: (row.inn as string) ?? '',
    raschetnyiSchet: (row.raschetnyi_schet as string) ?? '',
    telephone: (row.telephone as string) ?? '',
    site: (row.site as string) ?? '',
    email: (row.email as string) ?? '',
  };
}

function toRow(d: HotelDetails) {
  return {
    id: 1,
    logo: d.logo,
    hotel_name: d.hotelName,
    company_name: d.companyName,
    inn: d.inn,
    raschetnyi_schet: d.raschetnyiSchet,
    telephone: d.telephone,
    site: d.site,
    email: d.email,
  };
}

interface Ctx {
  details: HotelDetails;
  setDetails: (patch: Partial<HotelDetails>) => void;
  reset: () => void;
  ready: boolean;
}

const HotelDetailsContext = createContext<Ctx | null>(null);

export function HotelDetailsProvider({ children }: { children: ReactNode }) {
  const [details, setState] = useState<HotelDetails>(DEFAULTS);
  const [ready, setReady] = useState(false);
  // set right before OUR OWN write's realtime echo comes back, so we don't
  // re-render from our own change a second time
  const localEcho = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('hotel_details')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data) setState(fromRow(data as Record<string, unknown>));
      setReady(true);
    })();

    const ch = supabase
      .channel('hotel_details_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_details', filter: 'id=eq.1' },
        (payload) => {
          if (localEcho.current) { localEcho.current = false; return; }
          const row = payload.new as Record<string, unknown> | undefined;
          if (row) setState(fromRow(row));
        },
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  // Only ever called once, when the user clicks "Сохранить" — see
  // HotelDetailsPage.tsx's handleSave(). This writes straight to
  // Supabase, and Realtime pushes it to every other open browser/device.
  const setDetails = useCallback((patch: Partial<HotelDetails>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      localEcho.current = true;
      void supabase
        .from('hotel_details')
        .upsert(toRow(next), { onConflict: 'id' })
        .then(({ error }) => {
          if (error) console.error('[hotel-details] save failed', error);
        });
      return next;
    });
  }, []);

  const reset = useCallback(() => { setDetails(DEFAULTS); }, [setDetails]);

  const value = useMemo(() => ({ details, setDetails, reset, ready }), [details, setDetails, reset, ready]);
  return <HotelDetailsContext.Provider value={value}>{children}</HotelDetailsContext.Provider>;
}

export function useHotelDetails() {
  const ctx = useContext(HotelDetailsContext);
  if (!ctx) throw new Error('useHotelDetails must be used within HotelDetailsProvider');
  return ctx;
}