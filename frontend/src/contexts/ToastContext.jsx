import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

const TOAST_DURATION_MS = 5500;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, type = 'success') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), TOAST_DURATION_MS);
    return id;
  }, [removeToast]);

  const success = useCallback((message) => show(message, 'success'), [show]);
  const error = useCallback((message) => show(message, 'error'), [show]);
  const info = useCallback((message) => show(message, 'info'), [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, info, toasts, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: (msg, type) => console.log('[Toast]', type, msg),
      success: (msg) => console.log('[Toast] success', msg),
      error: (msg) => console.log('[Toast] error', msg),
      info: (msg) => console.log('[Toast] info', msg),
    };
  }
  return ctx;
}
