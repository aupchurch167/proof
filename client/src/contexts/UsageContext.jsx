import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';

const UsageContext = createContext(null);

// Shared plan-usage snapshot for the sidebar meter and Settings → Plan & billing.
// Layout stays mounted across navigation, so pages that create/delete vendors
// must call refreshUsage() after those mutations instead of hoping a remount
// or the slow poll will catch up.
export function UsageProvider({ children }) {
  const { user } = useAuth();
  const [usage, setUsage] = useState(null);

  const refreshUsage = useCallback(async () => {
    try {
      const next = await api.get('/organization/usage');
      setUsage(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setUsage(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.get('/organization/usage');
        if (!cancelled) setUsage(next);
      } catch {
        // Ambient — a failed poll must not take the shell down.
      }
    };

    load();
    const timer = setInterval(load, 120000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  return (
    <UsageContext.Provider value={{ usage, refreshUsage }}>
      {children}
    </UsageContext.Provider>
  );
}

export function useUsage() {
  const ctx = useContext(UsageContext);
  if (!ctx) throw new Error('useUsage must be used within UsageProvider');
  return ctx;
}
