import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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

const STORAGE_KEY = 'hotel:details:v1';

interface Ctx {
  details: HotelDetails;
  setDetails: (patch: Partial<HotelDetails>) => void;
  reset: () => void;
}

const HotelDetailsContext = createContext<Ctx | null>(null);

export function HotelDetailsProvider({ children }: { children: ReactNode }) {
  const [details, setState] = useState<HotelDetails>(DEFAULTS);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(details)); } catch { /* ignore */ }
  }, [details]);

  const setDetails = useCallback((patch: Partial<HotelDetails>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setState(DEFAULTS), []);

  const value = useMemo(() => ({ details, setDetails, reset }), [details, setDetails, reset]);
  return <HotelDetailsContext.Provider value={value}>{children}</HotelDetailsContext.Provider>;
}

export function useHotelDetails() {
  const ctx = useContext(HotelDetailsContext);
  if (!ctx) throw new Error('useHotelDetails must be used within HotelDetailsProvider');
  return ctx;
}
