require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (e) {
  jwt = null;
  console.warn('jsonwebtoken not installed - Waka validate-entry will return 503. Run: npm install jsonwebtoken');
}
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.GATEWAY_PORT || 5000;

const WAKA_AUTH_ISSUER = 'waka-auth';

// Step 7: In-memory cache for validate-entry (reduce Waka master-data calls). Key = token hash, value = { company_id, roles, exp }.
const VALIDATE_CACHE_TTL_MS = Math.min(parseInt(process.env.WAKA_VALIDATE_CACHE_TTL_MS || '60000', 10), 300000);
const validateEntryCache = new Map();
function tokenCacheKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}
function getCachedValidate(key) {
  const entry = validateEntryCache.get(key);
  if (!entry || entry.exp <= Date.now()) {
    if (entry) validateEntryCache.delete(key);
    return null;
  }
  return entry;
}
function setCachedValidate(key, data, expMs) {
  validateEntryCache.set(key, { ...data, exp: Date.now() + expMs });
  if (validateEntryCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of validateEntryCache.entries()) if (v.exp <= now) validateEntryCache.delete(k);
  }
}

// Step 7: Simple rate limit by IP for /api/waka/* (per minute).
const RATE_LIMIT_VALIDATE = parseInt(process.env.WAKA_RATE_LIMIT_VALIDATE || '60', 10);
const RATE_LIMIT_SAVE = parseInt(process.env.WAKA_RATE_LIMIT_SAVE || '20', 10);
const rateLimitValidate = new Map();
const rateLimitSave = new Map();
const WINDOW_MS = 60000;
function checkRateLimit(store, limit, ip) {
  const now = Date.now();
  let entry = store.get(ip);
  if (!entry || entry.resetAt < now) entry = { count: 0, resetAt: now + WINDOW_MS };
  entry.count += 1;
  store.set(ip, entry);
  if (entry.count > limit) return false;
  return true;
}
function wakaRateLimitValidate(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(rateLimitValidate, RATE_LIMIT_VALIDATE, ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests', code: 'RATE_LIMIT' });
  }
  next();
}
function wakaRateLimitSave(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(rateLimitSave, RATE_LIMIT_SAVE, ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests', code: 'RATE_LIMIT' });
  }
  next();
}

const allowedOrigins = [
  process.env.CORS_ORIGIN || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
];

app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin?.includes('localhost') || origin?.includes('127.0.0.1')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || allowedOrigins[0]);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});

// Step 3: Waka entry validation – verify JWT and company, allow only authorized routes
// Step 7: Rate limit and optional cache for validate-entry
app.get('/api/waka/validate-entry', wakaRateLimitValidate, async (req, res) => {
  const token = req.query.token;
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ success: false, error: 'Missing token', code: 'MISSING_TOKEN' });
  }

  const cacheKey = tokenCacheKey(token);
  const cached = getCachedValidate(cacheKey);
  if (cached) {
    return res.json({ success: true, company_id: cached.company_id, roles: cached.roles || [] });
  }

  if (!jwt) {
    return res.status(503).json({ success: false, error: 'JWT not available. Run: npm install jsonwebtoken', code: 'JWT_UNAVAILABLE' });
  }
  const secret = process.env.PDF_PROCESSOR_JWT_SECRET || process.env.WAKA_JWT_SECRET;
  if (!secret) {
    return res.status(503).json({ success: false, error: 'Service not configured', code: 'CONFIG_MISSING' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret, { issuer: WAKA_AUTH_ISSUER });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
      code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    });
  }

  const companyId = payload.company_id;
  if (!companyId) {
    return res.status(401).json({ success: false, error: 'Invalid token: missing company', code: 'INVALID_TOKEN' });
  }

  const masterDataBase = process.env.WAKA_MASTER_DATA_BASE_URL || 'http://localhost:4013';
  const validateUrl = `${masterDataBase}/api/v1/master-data/companies/${encodeURIComponent(companyId)}`;
  try {
    const companyRes = await fetch(validateUrl, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!companyRes.ok) {
      if (companyRes.status === 404) {
        return res.status(403).json({ success: false, error: 'Company not registered', code: 'COMPANY_NOT_FOUND' });
      }
      return res.status(502).json({ success: false, error: 'Could not validate company', code: 'VALIDATION_ERROR' });
    }
    const company = await companyRes.json();
    if (company.status && company.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Company not active', code: 'COMPANY_INACTIVE' });
    }
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: 'Could not reach Waka to validate company',
      code: 'VALIDATION_ERROR',
    });
  }

  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const expMs = payload.exp ? Math.max(0, payload.exp * 1000 - Date.now()) : VALIDATE_CACHE_TTL_MS;
  const ttlMs = Math.min(expMs, VALIDATE_CACHE_TTL_MS);
  if (ttlMs > 0) setCachedValidate(cacheKey, { company_id: companyId, roles }, ttlMs);

  return res.json({ success: true, company_id: companyId, roles });
});

// Step 4: Save template to Waka integration (server-side; company_id from token)
// Step 7: Rate limit save-template
app.post('/api/waka/save-template', wakaRateLimitSave, async (req, res) => {
  const { token, ...templatePayload } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ success: false, error: 'Missing token', code: 'MISSING_TOKEN' });
  }

  if (!jwt) {
    return res.status(503).json({ success: false, error: 'JWT not available. Run: npm install jsonwebtoken', code: 'JWT_UNAVAILABLE' });
  }
  const secret = process.env.PDF_PROCESSOR_JWT_SECRET || process.env.WAKA_JWT_SECRET;
  if (!secret) {
    return res.status(503).json({ success: false, error: 'Service not configured', code: 'CONFIG_MISSING' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret, { issuer: WAKA_AUTH_ISSUER });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
      code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    });
  }

  const companyId = payload.company_id;
  if (!companyId) {
    return res.status(401).json({ success: false, error: 'Invalid token: missing company', code: 'INVALID_TOKEN' });
  }

  const apiKey = process.env.INTEGRATION_SERVICE_API_KEY || process.env.PDF_PROCESSOR_API_KEY;
  const integrationBase = process.env.INTEGRATION_SERVICE_BASE_URL || process.env.WAKA_INTEGRATION_BASE_URL || 'http://localhost:4002';
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Integration service not configured', code: 'CONFIG_MISSING' });
  }

  const name = templatePayload.template_name || templatePayload.name;
  const base = name && String(name).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const templateCode = templatePayload.template_code || (base ? `doc_${base}` : `doc_template_${Date.now().toString(36)}`);

  const body = {
    company_id: companyId,
    template_name: name || 'Untitled template',
    template_code: templateCode,
    document_type: templatePayload.document_type || null,
    document_template: templatePayload.document_template || null,
    subject_template: templatePayload.subject_template || null,
    layout_config: templatePayload.layout_config || (templatePayload.settings ? { pageSize: templatePayload.settings.pageSize, orientation: templatePayload.settings.orientation, margins: templatePayload.settings.margins } : {}),
    variables: templatePayload.variables || (templatePayload.pages && templatePayload.pages[0]?.boxes ? templatePayload.pages[0].boxes.map((b) => ({ name: b.fieldName || b.labelName, description: '', example: b.content || `{{${b.fieldName || b.labelName}}}`, required: false })) : null),
    upsert: true,
  };

  try {
    const url = `${integrationBase}/api/v1/integration/document-templates`;
    const out = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await out.json().catch(() => ({}));
    if (!out.ok) {
      return res.status(out.status >= 500 ? 502 : out.status).json({
        success: false,
        error: data.message || data.error || 'Failed to save template to Waka',
        code: 'SAVE_FAILED',
      });
    }
    return res.json({ success: true, id: data.id });
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: err.message || 'Could not reach Waka integration service',
      code: 'SAVE_FAILED',
    });
  }
});

const logger = require('../shared/utils/logger');

app.post('/api/logs', (req, res) => {
  try {
    const { level = 'info', message, context, stack, url, method, statusCode } = req.body || {};
    const meta = { source: 'frontend', context, url, method, statusCode };
    const logMsg = message || 'Frontend log';
    if (level === 'error') {
      logger.error(logMsg, { ...meta, stack });
    } else if (level === 'warn') {
      logger.warn(logMsg, meta);
    } else {
      logger.info(logMsg, meta);
    }
    res.status(204).send();
  } catch (err) {
    logger.error('Failed to write frontend log', { error: err.message });
    res.status(500).json({ message: 'Log write failed' });
  }
});

const services = {
  template: `http://localhost:${process.env.TEMPLATE_SERVICE_PORT || 5002}`,
  pdf: `http://localhost:${process.env.PDF_SERVICE_PORT || 5003}`,
  csv: `http://localhost:${process.env.CSV_SERVICE_PORT || 5004}`,
};

app.use('/api/templates', (req, res, next) => {
  logger.info('Templates request', { method: req.method, path: req.url });
  next();
}, createProxyMiddleware({
  target: services.template,
  changeOrigin: true,
  pathRewrite: { '^/api/templates': '/api/templates' },
  logLevel: 'silent',
  proxyTimeout: 60000,
  onProxyReq: fixRequestBody,
  onError: (err, req, res) => {
    logger.error('Templates proxy error', { method: req.method, path: req.url, code: err.code, message: err.message });
    if (!res.headersSent) {
      const isUnavailable = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
      res.status(isUnavailable ? 503 : 500).json({
        message: isUnavailable ? 'Template service unavailable. Ensure backend is running (npm run dev in backend folder).' : 'Proxy error',
        error: err.message,
      });
    }
  },
}));

app.use('/api/pdf', createProxyMiddleware({
  target: services.pdf,
  changeOrigin: true,
  pathRewrite: { '^/api/pdf': '/api/pdf' },
  logLevel: 'silent',
  onProxyReq: fixRequestBody,
  onError: (err, req, res) => {
    if (!res.headersSent) {
      logger.error('PDF proxy error', { code: err.code, message: err.message, url: req.url });
      const isUnavailable = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
      const message = isUnavailable
        ? 'PDF service unavailable. Ensure the backend is running (e.g. npm run dev in the backend folder).'
        : (err.message || 'Proxy error');
      res.status(isUnavailable ? 503 : 500).json({ message, error: err.message });
    }
  },
}));

app.use('/api/csv', createProxyMiddleware({
  target: services.csv,
  changeOrigin: true,
  pathRewrite: { '^/api/csv': '/api/csv' },
  logLevel: 'silent',
  onProxyReq: fixRequestBody,
  onError: (err, req, res) => {
    if (!res.headersSent) {
      const msg = err.code === 'ECONNREFUSED'
        ? 'CSV service unavailable. Start the backend with: npm run dev (in backend folder).'
        : (err.message || 'Proxy error');
      res.status(503).json({ message: msg, error: err.message });
    }
  },
}));

app.use('/api/standardized-templates', createProxyMiddleware({
  target: services.template,
  changeOrigin: true,
  pathRewrite: { '^/api/standardized-templates': '/api/standardized-templates' },
  logLevel: 'silent',
  proxyTimeout: 60000,
  onProxyReq: fixRequestBody,
  onError: (err, req, res) => {
    if (!res.headersSent) res.status(500).json({ message: 'Proxy error', error: err.message });
  },
}));

app.use('/api/template-designs', createProxyMiddleware({
  target: services.template,
  changeOrigin: true,
  pathRewrite: { '^/api/template-designs': '/api/template-designs' },
  logLevel: 'silent',
  proxyTimeout: 60000,
  onProxyReq: fixRequestBody,
  onError: (err, req, res) => {
    if (!res.headersSent) res.status(500).json({ message: 'Proxy error', error: err.message });
  },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'API Gateway is running' });
});

const StartupLogger = require('../shared/utils/startupLogger');
const http = require('http');

const server = http.createServer(app);
server.headersTimeout = 120000;
server.requestTimeout = 120000;
server.listen(PORT, () => {
  StartupLogger.logHeader();
  StartupLogger.logServiceStarted('gateway', PORT);
});
