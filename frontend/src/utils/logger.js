const API_BASE = import.meta.env.VITE_API_URL || '/api';

function formatMessage(level, message, context) {
  const ts = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${ctx}`;
}

async function sendToBackend(level, message, context = {}, stack) {
  try {
    await fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        message,
        context: typeof context === 'object' ? context : { data: context },
        stack,
        url: typeof window !== 'undefined' ? window.location?.href : undefined,
      }),
    });
  } catch (_) {
    // Ignore - backend may be offline
  }
}

export const logger = {
  info(message, context) {
    const formatted = formatMessage('info', message, context);
    console.info(formatted);
  },

  warn(message, context) {
    const formatted = formatMessage('warn', message, context);
    console.warn(formatted);
    sendToBackend('warn', message, context);
  },

  error(message, errorOrContext) {
    const ctx = errorOrContext instanceof Error
      ? { message: errorOrContext.message, name: errorOrContext.name }
      : (errorOrContext || {});
    const stack = errorOrContext instanceof Error ? errorOrContext.stack : undefined;
    const formatted = formatMessage('error', message, ctx);
    console.error(formatted, stack ? `\n${stack}` : '');
    sendToBackend('error', message, ctx, stack);
  },

  /** Log API/request errors with full context */
  apiError(context, err) {
    const msg = err?.response?.data?.message || err?.message || 'Unknown error';
    const ctx = {
      ...context,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      url: err?.config?.url,
      method: err?.config?.method,
      responseData: err?.response?.data,
    };
    this.error(msg, { ...ctx, originalError: err?.message, stack: err?.stack });
  },
};

export default logger;
