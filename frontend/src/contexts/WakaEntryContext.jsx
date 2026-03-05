import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const WakaEntryContext = createContext({
  status: 'pending', // 'pending' | 'granted' | 'denied'
  companyId: null,
  roles: [],
  token: null, // kept in memory for save-to-Waka (Step 4)
  error: null,
});

export function WakaEntryProvider({ children }) {
  const [status, setStatus] = useState('pending');
  const [companyId, setCompanyId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');

    if (!tokenFromUrl) {
      setStatus('granted');
      setError(null);
      return;
    }

    const validate = async () => {
      try {
        const url = `${API_URL.replace(/\/$/, '')}/waka/validate-entry?token=${encodeURIComponent(tokenFromUrl)}`;
        const res = await fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success && data.company_id) {
          setCompanyId(data.company_id);
          setRoles(Array.isArray(data.roles) ? data.roles : []);
          setToken(tokenFromUrl);
          setStatus('granted');
          setError(null);
          return;
        }

        setStatus('denied');
        setError(data.error || (res.status === 401 ? 'Invalid or expired link.' : 'Access denied.'));
      } catch (err) {
        setStatus('denied');
        setError(err.message || 'Could not verify access.');
      }
    };

    validate();
  }, []);

  const value = useMemo(
    () => ({ status, companyId, roles, token, error }),
    [status, companyId, roles, token, error]
  );

  return <WakaEntryContext.Provider value={value}>{children}</WakaEntryContext.Provider>;
}

export function useWakaEntry() {
  const ctx = useContext(WakaEntryContext);
  if (!ctx) throw new Error('useWakaEntry must be used within WakaEntryProvider');
  return ctx;
}
