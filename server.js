require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const db = require('./src/lib/db');
require('./src/lib/bank').loadBanks();

const examRoutes  = require('./src/routes/exam');
const audioRoutes = require('./src/routes/audio');
const adminRoutes = require('./src/routes/admin');
const aiRoutes    = require('./src/routes/ai');
const speakingRoutes = require('./src/routes/speaking');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Content Security Policy configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.pexels.com", "https://images.unsplash.com", "https://*.pexels.com"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
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

app.use(express.json({ limit: '256kb' }));
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

app.use('/api/exam/start', examStartLimiter);
app.use('/api/exam',  examLimiter, examRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/ai',   examLimiter, aiRoutes);
app.use('/api/speaking', examLimiter, speakingRoutes);

app.use('/admin/api/login', adminLoginLimiter);
app.use('/admin/api', adminRoutes);
app.use('/admin/api/bank', require('./src/routes/bank-manager'));

app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use('/',      express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), db: db.prepare('SELECT 1 AS x').get().x === 1 });
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
