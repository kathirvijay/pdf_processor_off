require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.GATEWAY_PORT || 5000;

const allowedOrigins = [
  process.env.CORS_ORIGIN || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
];

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

const services = {
  template: `http://localhost:${process.env.TEMPLATE_SERVICE_PORT || 5002}`,
  pdf: `http://localhost:${process.env.PDF_SERVICE_PORT || 5003}`,
  csv: `http://localhost:${process.env.CSV_SERVICE_PORT || 5004}`,
};

app.use('/api/templates', createProxyMiddleware({
  target: services.template,
  changeOrigin: true,
  pathRewrite: { '^/api/templates': '/api/templates' },
  logLevel: 'silent',
  onError: (err, req, res) => {
    if (!res.headersSent) res.status(500).json({ message: 'Proxy error', error: err.message });
  },
}));

app.use('/api/pdf', createProxyMiddleware({
  target: services.pdf,
  changeOrigin: true,
  pathRewrite: { '^/api/pdf': '/api/pdf' },
  logLevel: 'silent',
  onError: (err, req, res) => {
    if (!res.headersSent) {
      console.error('PDF proxy error:', err.code || err.message, err.message);
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
  onError: (err, req, res) => {
    if (!res.headersSent) res.status(500).json({ message: 'Proxy error', error: err.message });
  },
}));

app.use('/api/template-designs', createProxyMiddleware({
  target: services.template,
  changeOrigin: true,
  pathRewrite: { '^/api/template-designs': '/api/template-designs' },
  logLevel: 'silent',
  onError: (err, req, res) => {
    if (!res.headersSent) res.status(500).json({ message: 'Proxy error', error: err.message });
  },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'API Gateway is running' });
});

const StartupLogger = require('../shared/utils/startupLogger');

app.listen(PORT, () => {
  StartupLogger.logHeader();
  StartupLogger.logServiceStarted('gateway', PORT);
});
