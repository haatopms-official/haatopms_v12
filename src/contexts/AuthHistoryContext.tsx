import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useSharedState } from '@/lib/hotel-sync';
import type { LoginEvent } from './auth-types';

interface AuthHistoryContextValue {
  history: LoginEvent[];
  pushHistory: (ev: Omit<LoginEvent, 'id'>) => void;
  clearHistory: () => void;
  flushHistory: () => void;
}

const AuthHistoryContext = createContext<AuthHistoryContextValue | undefined>(undefined);

export function AuthHistoryProvider({ children }: { children: ReactNode }) {
  const { data, setData, flushNow: flushHistory } = useSharedState<LoginEvent[]>('auth-history', []);

  const history = useMemo(
    () => (Array.isArray(data) ? (data as LoginEvent[]) : []),
    [data],
  );

  const pushHistory = useCallback(
    (ev: Omit<LoginEvent, 'id'>) => {
      const full: LoginEvent = {
        ...ev,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      setData((prev) =>
        [full, ...(Array.isArray(prev) ? (prev as LoginEvent[]) : [])].slice(0, 500),
      );
    },
    [setData],
  );

  const clearHistory = useCallback(() => setData([]), [setData]);

const value = useMemo(
    () => ({ history, pushHistory, clearHistory, flushHistory }),
    [history, pushHistory, clearHistory, flushHistory],
  );

  return (
    <AuthHistoryContext.Provider value={value}>
      {children}
    </AuthHistoryContext.Provider>
  );
}

export function useAuthHistory() {
  const ctx = useContext(AuthHistoryContext);
  if (!ctx)
    throw new Error('useAuthHistory must be used within AuthHistoryProvider');
  return ctx;
}
