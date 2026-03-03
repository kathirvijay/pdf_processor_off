import React from 'react';
import { useWakaEntry } from '../contexts/WakaEntryContext';

export default function WakaEntryGuard({ children }) {
  const { status, error } = useWakaEntry();

  if (status === 'pending') {
    return (
      <div className="waka-entry-guard" style={styles.container}>
        <div style={styles.card}>
          <p style={styles.message}>Checking access…</p>
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="waka-entry-guard" style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Access denied</h1>
          <p style={styles.message}>{error || 'You do not have access to this application.'}</p>
          <p style={styles.hint}>
            Open the PDF template designer from Waka → Settings → Document templates.
          </p>
        </div>
      </div>
    );
  }

  return children;
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    background: '#fff',
    padding: '2rem 2.5rem',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    maxWidth: '420px',
    textAlign: 'center',
  },
  title: {
    margin: '0 0 1rem',
    fontSize: '1.25rem',
    color: '#333',
  },
  message: {
    margin: '0 0 0.5rem',
    color: '#555',
    fontSize: '0.95rem',
  },
  hint: {
    margin: '1rem 0 0',
    color: '#888',
    fontSize: '0.85rem',
  },
};
