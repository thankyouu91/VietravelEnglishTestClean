/**
 * Vietravel English Test - Exam & Admin Server
 * Source code developed by: tranlong@cdimex.com.vn
 * Exam content developed by: MM Publications Vietnam
 */

require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');

const db = require('./src/lib/db');
require('./src/lib/bank').loadBanks();

const examRoutes  = require('./src/routes/exam');
const audioRoutes = require('./src/routes/audio');
const adminRoutes = require('./src/routes/admin');
const aiRoutes    = require('./src/routes/ai');
const speakingRoutes = require('./src/routes/speaking');

const app = express();
const PORT = process.env.PORT || 3000;

// M4: Dynamic proxy hops configuration
const trustProxyHops = process.env.TRUST_PROXY_HOPS ? parseInt(process.env.TRUST_PROXY_HOPS, 10) : 1;
app.set('trust proxy', trustProxyHops);

// H1: Middleware to generate cryptographic nonce per request
app.use((req, res, next) => {
  const crypto = require('crypto');
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Content Security Policy configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // H1: Strict CSP without unsafe-inline or unsafe-eval, whitelisting scripts with nonces
      scriptSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.nonce}'`,
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcAttr: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.pexels.com", "https://images.unsplash.com", "https://*.pexels.com"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
      // L7: CSP violation reporting
      reportUri: ["/api/csp-report"]
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS Origin configuration
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Exam-Token');
  }
  if (req.method === 'OPTIONS') {
    if (origin && !allowed.includes(origin)) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }
  next();
});

// L7: Allow parsing application/csp-report content type
app.use(express.json({ limit: '256kb', type: ['application/json', 'application/csp-report'] }));
app.use(cookieParser());

// Rate limiting configurations
const examLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: 'too_many_requests', message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
});
const examStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 attempts per windowMs
  message: { error: 'too_many_requests', message: 'Bạn đã yêu cầu tạo bài thi quá nhiều lần. Vui lòng đợi 15 phút.' },
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'too_many_login_attempts', message: 'Quá nhiều lần đăng nhập sai, đợi 15 phút.' },
});

// H2: Double-Submit Cookie CSRF check middleware
function csrfCheck(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    if (req.path === '/login' || req.path === '/login/mfa-verify') {
      return next();
    }
    const cookieToken = req.cookies?.admin_csrf;
    const headerToken = req.headers['x-admin-csrf'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'csrf_invalid', message: 'Yêu cầu không hợp lệ (CSRF verification failed).' });
    }
  }
  next();
}

app.use('/api/exam/start', examStartLimiter);
app.use('/api/exam',  examLimiter, examRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/ai',   examLimiter, aiRoutes);
app.use('/api/speaking', examLimiter, speakingRoutes);

app.use('/admin/api/login', adminLoginLimiter);
app.use('/admin/api', csrfCheck, adminRoutes);
app.use('/admin/api/bank', csrfCheck, require('./src/routes/bank-manager'));

// L7: CSP violation reporting endpoint
app.post('/api/csp-report', (req, res) => {
  console.warn('[CSP Violation]', req.body?.['csp-report'] || req.body);
  res.sendStatus(204);
});

// H1: Dynamic HTML file serving with nonce injection
function serveHtmlWithNonce(filePath) {
  return (req, res) => {
    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).send('Not Found');
      }
      let html = fs.readFileSync(filePath, 'utf8');
      const nonce = res.locals.nonce;
      // Inject nonce to all script tags dynamically
      html = html.replace(/<script(\s|>)/gi, (match, p1) => {
        return `<script nonce="${nonce}"${p1}`;
      });
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (e) {
      console.error(`Failed to serve HTML with nonce: ${filePath}`, e);
      res.status(500).send('Internal Server Error');
    }
  };
}

// Serve main entry HTMLs dynamically to inject CSP nonces
app.get('/', serveHtmlWithNonce(path.join(__dirname, 'public', 'index.html')));
app.get('/index.html', serveHtmlWithNonce(path.join(__dirname, 'public', 'index.html')));
app.get('/exam', (req, res, next) => {
  if (req.path === '/exam') return res.redirect('/exam/');
  next();
});
app.get('/exam/', serveHtmlWithNonce(path.join(__dirname, 'public', 'exam', 'index.html')));
app.get('/exam/index.html', serveHtmlWithNonce(path.join(__dirname, 'public', 'exam', 'index.html')));

app.get('/admin', (req, res, next) => {
  if (req.path === '/admin') return res.redirect('/admin/');
  next();
});
app.get('/admin/', serveHtmlWithNonce(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/admin/index.html', serveHtmlWithNonce(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/admin/login.html', serveHtmlWithNonce(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/admin/review.html', serveHtmlWithNonce(path.join(__dirname, 'public', 'admin', 'review.html')));
app.get('/admin/items.html', serveHtmlWithNonce(path.join(__dirname, 'public', 'admin', 'items.html')));

// Serve other static assets statically
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use('/',      express.static(path.join(__dirname, 'public')));

// L4: Sanitized health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'internal_error',
    message: isProd ? 'Đã có lỗi hệ thống xảy ra. Vui lòng liên hệ HR hoặc quản trị viên.' : err.message
  });
});

app.listen(PORT, () => {
  console.log(`▶ Vietravel English Test backend listening on http://localhost:${PORT}`);
  console.log(`   - Exam API : POST /api/exam/start, /submit, /listen`);
  console.log(`   - Audio    : GET  /api/audio/:type/:file`);
  console.log(`   - Admin    : http://localhost:${PORT}/admin`);
  console.log(`   - Health   : http://localhost:${PORT}/health`);
});
