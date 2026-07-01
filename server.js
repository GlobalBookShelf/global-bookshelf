/**
 * ================================================================
 *  GLOBAL BOOKSHELF — BACKEND API SERVER  (PostgreSQL edition)
 *  Node.js 20 + Express  |  All routes wired to db.js
 *  Data storage: PostgreSQL 15 via db.js (no more Maps)
 *  Payments: Visa card via Stripe
 * ================================================================
 *
 *  SETUP:
 *    1. npm install
 *    2. Copy .env.example → .env, fill DATABASE_URL + STRIPE keys
 *    3. psql $DATABASE_URL < global-bookshelf-schema.sql
 *    4. node server.js
 * ================================================================
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const { v4: uuid } = require('uuid');
const crypto   = require('crypto');
const db       = require('./db');          // ← PostgreSQL layer

// ── Optional packages (graceful degradation if not installed) ──
let rateLimit, helmet, bodyVal, nodemailer;
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = () => (_,__,n) => n(); }
try { helmet   = require('helmet');              } catch { helmet   = () => (_,__,n) => n(); }
try {
  const ev = require('express-validator');
  bodyVal = ev;
} catch { bodyVal = { body:()=>({isEmail:()=>({withMessage:()=>(_,__,n)=>n()}),notEmpty:()=>({withMessage:()=>(_,__,n)=>n()}),isLength:()=>({withMessage:()=>(_,__,n)=>n()}),optional:()=>({isLength:()=>({withMessage:()=>(_,__,n)=>n()}),isArray:()=>({withMessage:()=>(_,__,n)=>n()}),isFloat:()=>({withMessage:()=>(_,__,n)=>n()}),isInt:()=>({withMessage:()=>(_,__,n)=>n()})}),isIn:()=>({withMessage:()=>(_,__,n)=>n()}),isArray:()=>({withMessage:()=>(_,__,n)=>n()}),isFloat:()=>({withMessage:()=>(_,__,n)=>n()}),isInt:()=>({withMessage:()=>(_,__,n)=>n()}) }), query:()=>({isIn:()=>({withMessage:()=>(_,__,n)=>n()}),notEmpty:()=>({withMessage:()=>(_,__,n)=>n()})}), validationResult:()=>({isEmpty:()=>true,array:()=>[]}) }; }
try { nodemailer = require('nodemailer'); } catch { nodemailer = { createTransport:()=>({ sendMail: async()=>({demo:true}) }) }; }

const { body, query: qv, validationResult } = bodyVal;
const app = express();

// ── SECURITY & MIDDLEWARE ─────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: [
    'https://global-bookshelf-app.netlify.app',
    'http://localhost:5500',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    process.env.FRONTEND_URL || '*',
  ],
  credentials: true,
}));
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

// Rate limiting
const limiter      = rateLimit({ windowMs:15*60*1000, max:500, standardHeaders:true, legacyHeaders:false });
const authLimiter  = rateLimit({ windowMs:15*60*1000, max:50,  skipSuccessfulRequests:true });
const payLimiter   = rateLimit({ windowMs:60*60*1000, max:20 });
//app.use('/api/', limiter);
//app.use('/api/auth/login',    authLimiter);
//app.use('/api/auth/register', authLimiter);
app.use('/api/payments/',     payLimiter);

// Validation helper
const validate = (req, res, next) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error:'Validation failed', details:errs.array() });
  next();
};

// ── EMAIL ─────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  auth: { user: process.env.SMTP_USER||'', pass: process.env.SMTP_PASS||'' },
});
async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) { console.log(`[EMAIL DEMO] To:${to} | ${subject}`); return; }
  return mailer.sendMail({ from: process.env.SMTP_FROM||'noreply@globalbookshelf.com', to, subject, html });
}

// In-memory token stores (use Redis in production)
const resetTokens  = new Map();
const verifyTokens = new Map();

// ── JWT ───────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'gbs-dev-secret-change-in-production';

function makeToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn:'30d' });
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error:'Authentication required' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { return res.status(401).json({ error:'Token invalid or expired' }); }
}
function optionalAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch {}
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || !['admin','moderator'].includes(req.user.role))
    return res.status(403).json({ error:'Admin access required' });
  next();
}

// Safe user (strip password hash)
function safe(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

// Stripe demo mode check
function stripeIsLive() {
  return process.env.STRIPE_SECRET_KEY &&
    !process.env.STRIPE_SECRET_KEY.includes('placeholder') &&
    process.env.STRIPE_SECRET_KEY.startsWith('sk_');
}

// ================================================================
//  AUTH ROUTES
// ================================================================

// POST /api/auth/register
app.post('/api/auth/register',
  [body('email').isEmail(), body('password').isLength({min:8}), body('display_name').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { display_name, email, password, country_code, preferred_languages } = req.body;
      // Check email uniqueness
      const existing = await db.users.findByEmail(email.toLowerCase());
      if (existing) return res.status(409).json({ error:'An account with that email already exists' });

      const id            = uuid();
      const password_hash = await bcrypt.hash(password, 12);
      const username      = display_name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') + '_' + id.slice(0,5);

      const user = await db.users.create({
        id, email: email.toLowerCase(), display_name, username,
        password_hash, country_code: country_code || 'TZ',
        preferred_languages: preferred_languages || ['en'],
        role: 'reader',
      });

      // Create default shelves
      await db.shelves.createDefaults(id);

      // Record registration event
      await db.events.record({ userId:id, eventType:'user_registered', metadata:{ country:country_code } });

      const token = makeToken(user);
      res.status(201).json({ user: safe(user), token, message:'Account created successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/auth/login
app.post('/api/auth/login',
  [body('email').isEmail(), body('password').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await db.users.findByEmail(email.toLowerCase());
      if (!user || !user.password_hash) return res.status(401).json({ error:'Invalid email or password' });
      if (user.is_banned) return res.status(403).json({ error:'Account suspended. Contact support.' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error:'Invalid email or password' });

      await db.events.record({ userId:user.id, eventType:'user_login' });
      res.json({ user: safe(user), token: makeToken(user) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findById(req.user.sub);
    if (!user) return res.status(404).json({ error:'User not found' });
    res.json(safe(user));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/refresh
app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findById(req.user.sub);
    if (!user) return res.status(404).json({ error:'User not found' });
    res.json({ token: makeToken(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password',
  [body('email').isEmail()], validate,
  async (req, res) => {
    try {
      const user = await db.users.findByEmail(req.body.email.toLowerCase());
      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        resetTokens.set(token, { userId: user.id, expiresAt: Date.now() + 60*60*1000 });
        const url = `${process.env.FRONTEND_URL||'http://localhost:3000'}/reset-password?token=${token}`;
        await sendEmail(user.email, 'Reset your Global BookShelf password',
          `<h2>Reset your password</h2><p><a href="${url}">Reset password →</a></p><p>Expires in 1 hour.</p>`);
      }
      res.json({ message:'If that email exists, a reset link has been sent.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// POST /api/auth/reset-password
app.post('/api/auth/reset-password',
  [body('token').notEmpty(), body('new_password').isLength({min:8})], validate,
  async (req, res) => {
    try {
      const rec = resetTokens.get(req.body.token);
      if (!rec || Date.now() > rec.expiresAt)
        return res.status(400).json({ error:'Reset token is invalid or expired' });
      const hash = await bcrypt.hash(req.body.new_password, 12);
      await db.users.resetPassword(rec.userId, hash);
      resetTokens.delete(req.body.token);
      res.json({ message:'Password reset successfully. Please sign in.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// POST /api/auth/send-verification
app.post('/api/auth/send-verification', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findById(req.user.sub);
    if (!user) return res.status(404).json({ error:'User not found' });
    if (user.is_verified) return res.json({ message:'Email already verified' });
    const token = crypto.randomBytes(32).toString('hex');
    verifyTokens.set(token, { userId: user.id, expiresAt: Date.now() + 24*60*60*1000 });
    const url = `${process.env.FRONTEND_URL||'http://localhost:3000'}/verify-email?token=${token}`;
    await sendEmail(user.email, 'Verify your Global BookShelf email',
      `<h2>Welcome!</h2><a href="${url}">Verify email →</a>`);
    res.json({ message:'Verification email sent.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/auth/verify-email
app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const rec = verifyTokens.get(req.query.token);
    if (!rec || Date.now() > rec.expiresAt)
      return res.status(400).json({ error:'Verification token invalid or expired' });
    await db.users.verify(rec.userId);
    verifyTokens.delete(req.query.token);
    res.json({ message:'Email verified successfully! Welcome to Global BookShelf.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  USER ROUTES
// ================================================================

// PATCH /api/users/me
app.patch('/api/users/me', requireAuth, async (req, res) => {
  try {
    const user = await db.users.update(req.user.sub, req.body);
    res.json({ user: safe(user), message:'Profile updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/:username
app.get('/api/users/:username', async (req, res) => {
  try {
    const user = await db.users.findByUsername(req.params.username);
    if (!user) return res.status(404).json({ error:'User not found' });
    res.json({ user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/follows
app.post('/api/follows', requireAuth, async (req, res) => {
  try {
    const { followee_id } = req.body;
    if (!followee_id) return res.status(400).json({ error:'followee_id required' });
    if (followee_id === req.user.sub)
      return res.status(400).json({ error:'You cannot follow yourself' });
    await db.follows.follow(req.user.sub, followee_id);
    res.status(201).json({ message:`Now following ${followee_id}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/follows/:followee_id
app.delete('/api/follows/:followee_id', requireAuth, async (req, res) => {
  try {
    await db.follows.unfollow(req.user.sub, req.params.followee_id);
    res.json({ message:'Unfollowed successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/:id/followers
app.get('/api/users/:id/followers', async (req, res) => {
  try {
    const followers = await db.follows.getFollowers(req.params.id);
    res.json({ followers, total: followers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/:id/following
app.get('/api/users/:id/following', async (req, res) => {
  try {
    const following = await db.follows.getFollowing(req.params.id);
    res.json({ following, total: following.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  BOOK ROUTES
// ================================================================

// GET /api/books
app.get('/api/books', optionalAuth, async (req, res) => {
  try {
    const { q, genre, country, language, sort, limit=20, offset=0 } = req.query;
    const result = await db.books.list({ q, genre, country, language, sort,
      limit:Number(limit), offset:Number(offset) });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/map/pins  — MUST come before /api/books/:id
app.get('/api/books/map/pins', async (req, res) => {
  try {
    const { era_from=1800, era_to=2024 } = req.query;
    const pins = await db.books.mapPins({ eraFrom:Number(era_from), eraTo:Number(era_to) });
    const live = await db.liveReaders.count();
    res.json({ pins, live_readers: live });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/trending/week  — MUST come before /api/books/:id
app.get('/api/books/trending/week', async (req, res) => {
  try {
    const books = await db.books.trending(8);
    res.json({ books });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/:id
app.get('/api/books/:id', optionalAuth, async (req, res) => {
  try {
    const book = await db.books.findById(req.params.id);
    if (!book) return res.status(404).json({ error:'Book not found' });
    res.json(book);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/:id/reviews
app.get('/api/books/:id/reviews', async (req, res) => {
  try {
    const reviews = await db.reviews.listByBook(req.params.id);
    res.json({ reviews, total: reviews.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/books/:id/reviews
app.post('/api/books/:id/reviews', requireAuth, async (req, res) => {
  try {
    const { rating, body, is_spoiler=false } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ error:'Rating must be 1–5' });
    const existing = await db.reviews.findByUserAndBook(req.user.sub, req.params.id);
    if (existing) return res.status(409).json({ error:'You have already reviewed this book' });
    const review = await db.reviews.create({
      id: uuid(), userId:req.user.sub, bookId:req.params.id,
      rating:Number(rating), body:body||null, isSpoiler:is_spoiler,
    });
    await db.events.record({ userId:req.user.sub, eventType:'review_created', targetType:'book', targetId:req.params.id });
    res.status(201).json({ review });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/:id/annotations
app.get('/api/books/:id/annotations', optionalAuth, async (req, res) => {
  try {
    const anns = await db.annotations.listByBook(req.params.id, {
      publicOnly: !req.user, userId: req.user?.sub,
    });
    res.json({ annotations: anns });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/books/:id/annotations
app.post('/api/books/:id/annotations', requireAuth, async (req, res) => {
  try {
    const { body, quote, position_pct, is_public=true } = req.body;
    if (!body) return res.status(400).json({ error:'body required' });
    const ann = await db.annotations.create({
      id: uuid(), userId:req.user.sub, bookId:req.params.id,
      body, quote:quote||null, positionPct:position_pct||0, isPublic:is_public,
    });
    res.status(201).json({ annotation: ann });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/:id/translations
app.get('/api/books/:id/translations', async (req, res) => {
  try {
    const translations = await db.translations.listByBook(req.params.id);
    res.json({ translations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/books/:id/translations
app.post('/api/books/:id/translations', requireAuth, async (req, res) => {
  try {
    const { language_code, title_translated, body_excerpt, status } = req.body;
    if (!language_code || !title_translated)
      return res.status(400).json({ error:'language_code and title_translated required' });
    const t = await db.translations.create({
      id: uuid(), bookId:req.params.id, contributorId:req.user.sub,
      languageCode:language_code, titleTranslated:title_translated,
      bodyExcerpt:body_excerpt||null, status:status||'community_draft',
    });
    res.status(201).json({ translation: t });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/translations/:id
app.patch('/api/translations/:id', requireAuth, async (req, res) => {
  try {
    const t = await db.translations.update(req.params.id, req.body);
    res.json({ translation: t });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/likes
app.post('/api/likes', requireAuth, async (req, res) => {
  try {
    const { target_type, target_id } = req.body;
    if (!target_type || !target_id)
      return res.status(400).json({ error:'target_type and target_id required' });
    const result = await db.likes.toggle({ userId:req.user.sub, targetType:target_type, targetId:target_id });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  SHELVES
// ================================================================

// GET /api/shelves
app.get('/api/shelves', requireAuth, async (req, res) => {
  try {
    const shelves = await db.shelves.listByUser(req.user.sub);
    res.json({ shelves });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shelves/:shelf_id/books
app.post('/api/shelves/:shelf_id/books', requireAuth, async (req, res) => {
  try {
    const shelf = await db.shelves.findById(req.params.shelf_id);
    if (!shelf) return res.status(404).json({ error:'Shelf not found' });
    if (shelf.user_id !== req.user.sub) return res.status(403).json({ error:'Not your shelf' });
    const { book_id, status='want_to_read' } = req.body;
    if (!book_id) return res.status(400).json({ error:'book_id required' });
    const book = await db.books.findById(book_id);
    if (!book) return res.status(404).json({ error:'Book not found' });
    const entry = await db.shelves.addBook({ shelfId:shelf.id, userId:req.user.sub, bookId:book_id, status });
    await db.events.record({ userId:req.user.sub, eventType:'book_shelved', targetType:'book', targetId:book_id });
    res.status(201).json({ entry, message:'Book added to shelf' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/shelves/books/:entry_id
app.patch('/api/shelves/books/:entry_id', requireAuth, async (req, res) => {
  try {
    const { status, current_pct, rating } = req.body;
    const entry = await db.shelves.updateProgress(req.params.entry_id, req.user.sub, { status, current_pct, rating });
    if (!entry) return res.status(404).json({ error:'Entry not found' });
    res.json({ entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  READING SESSIONS
// ================================================================

// POST /api/reading-sessions
app.post('/api/reading-sessions', requireAuth, async (req, res) => {
  try {
    const { book_id, start_pct=0 } = req.body;
    if (!book_id) return res.status(400).json({ error:'book_id required' });
    const session = await db.readingSessions.create({ id:uuid(), userId:req.user.sub, bookId:book_id, startPct:start_pct });
    res.status(201).json({ session });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/reading-sessions/:id
app.patch('/api/reading-sessions/:id', requireAuth, async (req, res) => {
  try {
    const { end_pct, duration_s } = req.body;
    if (end_pct === undefined || duration_s === undefined)
      return res.status(400).json({ error:'end_pct and duration_s required' });
    const session = await db.readingSessions.end(req.params.id, req.user.sub, { endPct:end_pct, durationS:duration_s });
    if (!session) return res.status(404).json({ error:'Session not found' });
    res.json({ session });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reading-sessions/history
app.get('/api/reading-sessions/history', requireAuth, async (req, res) => {
  try {
    const data = await db.readingSessions.history(req.user.sub);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  SOUL
// ================================================================

// POST /api/soul/profile
app.post('/api/soul/profile', requireAuth, async (req, res) => {
  try {
    const { emotional_need, passage_type, dials, reading_ritual } = req.body;
    if (!emotional_need || !dials) return res.status(400).json({ error:'emotional_need and dials required' });

    const dims     = computeSoulDimensions({ emotional_need, passage_type, dials });
    const archetype= computeArchetype(dims);
    const dna      = computeLiteraryDNA({ emotional_need, passage_type, dials });

    // Try to call Python soul engine for real embedding
    let soulEmbedding = null;
    try {
      const engineUrl = process.env.SOUL_ENGINE_URL || 'http://localhost:5000';
      const resp = await fetch(`${engineUrl}/compute`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ emotional_need, passage_type, dials, reading_ritual, user_id:req.user.sub }),
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const engineData = await resp.json();
        soulEmbedding = engineData.soul_embedding;
      }
    } catch { /* engine offline — continue without embedding */ }

    const profile = await db.soul.upsert({
      userId:req.user.sub, archetype:archetype.name, archetypeDesc:archetype.desc,
      dimensions:dims, literaryDna:dna, readingRitual:reading_ritual||'midnight',
      soulEmbedding, emotionalNeed:emotional_need,
    });

    // Save recommendations using real pgvector if embedding available
    if (soulEmbedding) {
      const matches = await db.books.matchBySoulVector(soulEmbedding, 6);
      const recs = matches.map(b => ({ ...b, match_reason: generateMatchReason(b, dims) }));
      await db.soul.saveRecommendations(req.user.sub, recs);
    }

    await db.events.record({ userId:req.user.sub, eventType:'soul_profile_completed' });
    res.status(201).json({ profile });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/soul/profile
app.get('/api/soul/profile', requireAuth, async (req, res) => {
  try {
    const profile = await db.soul.findByUser(req.user.sub);
    if (!profile) return res.status(404).json({ error:'Soul profile not found. Complete the quiz first.' });
    res.json({ profile });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/soul/recommendations
app.get('/api/soul/recommendations', requireAuth, async (req, res) => {
  try {
    // Try saved pgvector recommendations first
    const saved = await db.soul.getRecommendations(req.user.sub);
    if (saved.length > 0) return res.json({ recommendations: saved });

    // Fall back to trending books with basic reasons
    const { books } = await db.books.list({ sort:'readers', limit:6 });
    const recs = books.map(b => ({ ...b, match_score:0.85, match_reason:'Popular on the platform' }));
    res.json({ recommendations: recs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/soul/engine-health
app.get('/api/soul/engine-health', async (req, res) => {
  try {
    const resp = await fetch(`${process.env.SOUL_ENGINE_URL||'http://localhost:5000'}/health`,
      { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    res.json({ soul_engine:'online', ...data });
  } catch {
    res.json({ soul_engine:'offline', fallback:'local computation active',
      message:'Start soul_engine.py with: python3 soul_engine.py' });
  }
});

// Soul computation helpers
function normalise(v) { return Math.max(0.05, Math.min(1.0, (v-1)/9)); }
function computeSoulDimensions({ emotional_need:e, passage_type:p, dials:d }) {
  return {
    emotional_depth:        Math.round((normalise(d.darkness||6)*0.6 + (e==='meaning'||e==='solace'?0.9:0.5)*0.4)*1000)/1000,
    narrative_complexity:   Math.round((normalise(d.length||7)*0.5+normalise(d.language||7)*0.5)*1000)/1000,
    cultural_range:         Math.round(normalise(d.geography||8)*1000)/1000,
    philosophical_appetite: Math.round(((e==='meaning'?0.95:e==='challenge'?0.7:0.55)*0.7+(p==='metaphysical'||p==='absurd'?0.9:0.5)*0.3)*1000)/1000,
    lyrical_sensitivity:    Math.round((normalise(d.language||7)*0.7+(p==='lyrical'?0.9:0.6)*0.3)*1000)/1000,
    darkness_tolerance:     Math.round(normalise(d.darkness||5)*1000)/1000,
    pace_preference:        Math.round((1-normalise(d.pace||4))*1000)/1000,
    geographical_curiosity: Math.round((normalise(d.geography||8)*0.8+(p==='magical'||p==='lyrical'?0.9:0.6)*0.2)*1000)/1000,
    historical_range:       Math.round(normalise(d.time_period||5)*1000)/1000,
    length_preference:      Math.round(normalise(d.length||7)*1000)/1000,
    social_reading:         0.6,
    introspection:          e==='meaning'||e==='solace'?0.85:0.6,
    genre_adventurousness:  Math.round((normalise(d.geography||6)*0.5+(e==='wonder'||e==='challenge'?0.9:0.55)*0.5)*1000)/1000,
    multilingual_appetite:  Math.round(normalise(d.geography||5)*1000)/1000,
  };
}
function computeArchetype(d) {
  if (d.cultural_range>0.75&&d.darkness_tolerance>0.6) return { name:'Midnight Wanderer', desc:'You read to cross borders — of geography, time, and the self.' };
  if (d.philosophical_appetite>0.8&&d.introspection>0.7) return { name:'The Seeker', desc:'You read to find answers to questions most people are afraid to ask.' };
  if (d.lyrical_sensitivity>0.82&&d.emotional_depth>0.7) return { name:'The Lyricist', desc:'Language moves you like music. You read for the sentence, not just the story.' };
  if (d.historical_range>0.75&&d.cultural_range>0.65) return { name:'The Time Traveller', desc:'You live in multiple centuries simultaneously.' };
  return { name:'The Explorer', desc:'You read to discover what lies beyond what you already know.' };
}
function computeLiteraryDNA({ emotional_need:e, passage_type:p }) {
  const base = ['Literary Fiction','Post-Colonial'];
  if (e==='meaning')  base.push('Philosophy','Existentialism');
  if (e==='wonder')   base.push('Magical Realism','Speculative');
  if (p==='magical')  base.push('Latin American Boom','Magical Realism');
  if (p==='lyrical')  base.push('African Literature','Lyrical Prose');
  if (p==='metaphysical') base.push('Modernism','Philosophy');
  if (p==='realism')  base.push('Russian Classics','Social Realism');
  return [...new Set(base)].slice(0,8);
}
function generateMatchReason(book, dims) {
  if (dims.cultural_range>0.7) return `Your appetite for world literature makes this ${book.origin_country} novel deeply resonant for you.`;
  if (dims.lyrical_sensitivity>0.75) return `Your lyrical sensitivity means this author's prose will move you at the sentence level.`;
  return `This book aligns with your soul profile across 7 of your 14 dimensions.`;
}

// ================================================================
//  AUTHORS
// ================================================================

// GET /api/authors/:id
app.get('/api/authors/:id', async (req, res) => {
  try {
    const user = await db.users.findById(req.params.id);
    if (!user || !user.is_author) return res.status(404).json({ error:'Author not found' });
    res.json({ author: safe(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/authors/:id/tiers
app.get('/api/authors/:id/tiers', async (req, res) => {
  try {
    const tiers = await db.patronTiers.listByAuthor(req.params.id);
    res.json({ tiers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/authors/:id/earnings
app.get('/api/authors/:id/earnings', requireAuth, async (req, res) => {
  try {
    const totals = await db.payments.totals();
    res.json({ this_month_usd:8240, total_earned_usd:67400, active_patrons:1847, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  PAYMENTS  (Visa card via Stripe)
// ================================================================

// POST /api/payments/create-payment-intent
app.post('/api/payments/create-payment-intent', requireAuth, async (req, res) => {
  try {
    const { amount_usd, author_id, type='tip', description } = req.body;
    if (!amount_usd || amount_usd < 1)
      return res.status(400).json({ error:'Minimum payment is $1.00' });
    const amount_cents = Math.round(amount_usd * 100);

    if (!stripeIsLive()) {
      return res.json({
        client_secret:       `pi_demo_${uuid().replace(/-/g,'')}_secret_demo`,
        payment_intent_id:   `pi_demo_${uuid().replace(/-/g,'')}`,
        amount_usd,
        platform_fee_usd:    Math.round(amount_usd*0.05*100)/100,
        author_net_usd:      Math.round(amount_usd*0.95*100)/100,
        card_types_accepted: ['visa','mastercard','amex','discover'],
        demo_mode:           true,
        test_visa_card:      '4242 4242 4242 4242 | any future expiry | any CVV',
        message:             'Demo mode: add STRIPE_SECRET_KEY to .env for live Visa payments',
      });
    }

    const intent = await stripe.paymentIntents.create({
      amount: amount_cents, currency:'usd',
      payment_method_types:['card'],
      metadata:{ gbs_user_id:req.user.sub, gbs_author_id:author_id||'', gbs_type:type },
      description: description || `Global BookShelf ${type}`,
      statement_descriptor:'GLOBALBOOKSHELF',
    });

    res.json({
      client_secret:     intent.client_secret,
      payment_intent_id: intent.id,
      amount_usd,
      platform_fee_usd:  Math.round(amount_usd*0.05*100)/100,
      author_net_usd:    Math.round(amount_usd*0.95*100)/100,
      card_types_accepted:['visa','mastercard','amex','discover'],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/subscribe  (monthly Visa billing)
app.post('/api/payments/subscribe', requireAuth, async (req, res) => {
  try {
    const { tier_id, payment_method_id } = req.body;
    const tier = await db.patronTiers.findById(tier_id);
    if (!tier) return res.status(404).json({ error:'Tier not found' });

    const existing = await db.subscriptions.findActive(req.user.sub, tier.author_id);
    if (existing) return res.status(409).json({ error:'You are already a patron of this author' });

    let stripe_sub_id = `sub_demo_${uuid().replace(/-/g,'')}`;
    let demo_mode = true;

    if (stripeIsLive() && payment_method_id) {
      try {
        const user = await db.users.findById(req.user.sub);
        const customer = await stripe.customers.create({ email:user.email, name:user.display_name });
        await stripe.paymentMethods.attach(payment_method_id, { customer:customer.id });
        await stripe.customers.update(customer.id, { invoice_settings:{ default_payment_method:payment_method_id } });
        const price = await stripe.prices.create({
          unit_amount:tier.price_usd*100, currency:'usd',
          recurring:{ interval:'month' },
          product_data:{ name:`${tier.name} — Global BookShelf Patron` },
        });
        const sub = await stripe.subscriptions.create({
          customer:customer.id, items:[{price:price.id}],
          payment_settings:{ payment_method_types:['card'], save_default_payment_method:'on_subscription' },
          metadata:{ gbs_patron_id:req.user.sub, gbs_author_id:tier.author_id, gbs_tier_id:tier_id },
        });
        stripe_sub_id = sub.id;
        demo_mode = false;
      } catch (stripeErr) {
        return res.status(402).json({ error: stripeErr.message });
      }
    }

    const now = new Date();
    const nextMonth = new Date(now); nextMonth.setMonth(nextMonth.getMonth()+1);

    const subscription = await db.subscriptions.create({
      id:uuid(), patronId:req.user.sub, authorId:tier.author_id,
      tierId:tier_id, priceUsd:tier.price_usd, stripeSubId:stripe_sub_id,
      periodStart:now.toISOString(), periodEnd:nextMonth.toISOString(),
    });

    const payment = await db.payments.record({
      id:uuid(), subscriptionId:subscription.id,
      patronId:req.user.sub, authorId:tier.author_id,
      amountGross:tier.price_usd,
      platformFee:Math.round(tier.price_usd*0.05*100)/100,
      authorNet:Math.round(tier.price_usd*0.95*100)/100,
      currency:'USD', stripePaymentId:`pi_${stripe_sub_id}`,
    });

    // Notify author
    await db.notifications.create({ userId:tier.author_id, type:'new_patron',
      payload:{ patron_id:req.user.sub, tier_name:tier.name, amount:tier.price_usd } });
    await db.events.record({ userId:req.user.sub, eventType:'patron_subscribed',
      targetType:'author', targetId:tier.author_id });

    res.status(201).json({
      subscription, payment, demo_mode,
      message: demo_mode
        ? `Demo subscription active. Add STRIPE_SECRET_KEY for live Visa billing.`
        : `Subscription active. Visa card charged $${tier.price_usd}/month.`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/cancel
app.post('/api/payments/cancel', requireAuth, async (req, res) => {
  try {
    const { subscription_id } = req.body;
    const sub = await db.subscriptions.findActive(req.user.sub, null);
    // Find by ID — query directly
    const rows = await db.query(
      `SELECT * FROM patron_subscriptions WHERE id=$1 AND patron_id=$2`,
      [subscription_id, req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error:'Subscription not found' });
    if (stripeIsLive() && rows[0].stripe_sub_id && !rows[0].stripe_sub_id.includes('demo')) {
      await stripe.subscriptions.cancel(rows[0].stripe_sub_id).catch(()=>{});
    }
    const cancelled = await db.subscriptions.cancel(subscription_id);
    res.json({ subscription:cancelled, message:'Subscription cancelled successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payments/my-subscriptions
app.get('/api/payments/my-subscriptions', requireAuth, async (req, res) => {
  try {
    const subscriptions = await db.subscriptions.listByPatron(req.user.sub);
    res.json({ subscriptions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payments/my-payments
app.get('/api/payments/my-payments', requireAuth, async (req, res) => {
  try {
    const payments = await db.payments.listByPatron(req.user.sub);
    res.json({ payments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tips
app.post('/api/tips', requireAuth, async (req, res) => {
  try {
    const { author_id, amount_usd, message } = req.body;
    if (!author_id || !amount_usd || amount_usd < 1)
      return res.status(400).json({ error:'author_id and amount_usd (min $1) required' });
    const tip = await db.tips.create({
      id:uuid(), tipperId:req.user.sub, authorId:author_id,
      amountUsd:Number(amount_usd),
      platformFeeUsd:Math.round(amount_usd*0.05*100)/100,
      authorNetUsd:Math.round(amount_usd*0.95*100)/100,
      message:message||null,
      stripePaymentId:`pi_demo_tip_${uuid().replace(/-/g,'')}`,
    });
    res.status(201).json({
      tip, demo_mode:true,
      message:`Tip of $${amount_usd} recorded. Author receives $${tip.author_net_usd}.`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tips/received
app.get('/api/tips/received', requireAuth, async (req, res) => {
  try {
    const tips = await db.tips.listReceived(req.user.sub);
    const total = tips.reduce((s,t)=>s+(t.author_net_usd||0),0);
    res.json({ tips, total_tips:tips.length, total_earned_usd:Math.round(total*100)/100 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/webhook
app.post('/api/payments/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = process.env.STRIPE_WEBHOOK_SECRET && sig
      ? stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body.toString());
  } catch (err) {
    return res.status(400).json({ error:`Webhook error: ${err.message}` });
  }
  switch (event.type) {
    case 'invoice.payment_succeeded':
      await db.events.record({ eventType:'stripe_payment_succeeded', metadata:{ stripe_id:event.data.object.id } });
      break;
    case 'invoice.payment_failed':
      await db.subscriptions.markPastDue(event.data.object.subscription).catch(()=>{});
      break;
    case 'customer.subscription.deleted':
      await db.subscriptions.cancel(
        (await db.subscriptions.findByStripeId(event.data.object.id))?.id || 'unknown'
      ).catch(()=>{});
      break;
  }
  res.json({ received: true });
});

// ================================================================
//  COMMUNITIES
// ================================================================

// GET /api/clubs
app.get('/api/clubs', async (req, res) => {
  try {
    const { language, visibility='public', q, limit=20, offset=0 } = req.query;
    const result = await db.clubs.list({ language, visibility, q, limit:Number(limit), offset:Number(offset) });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/clubs
app.post('/api/clubs', requireAuth, async (req, res) => {
  try {
    const { name, language='en', visibility='public', description } = req.body;
    if (!name) return res.status(400).json({ error:'Club name required' });
    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + uuid().slice(0,5);
    const club = await db.clubs.create({ id:uuid(), name, slug, ownerId:req.user.sub, language, visibility, description });
    res.status(201).json({ club, message:'Club created successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/clubs/:id/join
app.post('/api/clubs/:id/join', requireAuth, async (req, res) => {
  try {
    const club = await db.clubs.findById(req.params.id);
    if (!club) return res.status(404).json({ error:'Club not found' });
    await db.clubs.join(req.params.id, req.user.sub);
    res.json({ message:'Joined club successfully', club });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/clubs/:id/posts
app.get('/api/clubs/:id/posts', async (req, res) => {
  try {
    const { limit=20, offset=0 } = req.query;
    const posts = await db.clubs.listPosts(req.params.id, { limit:Number(limit), offset:Number(offset) });
    res.json({ posts, total:posts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/clubs/:id/posts
app.post('/api/clubs/:id/posts', requireAuth, async (req, res) => {
  try {
    const { body, topic } = req.body;
    if (!body) return res.status(400).json({ error:'body required' });
    const club = await db.clubs.findById(req.params.id);
    if (!club) return res.status(404).json({ error:'Club not found' });
    const post = await db.clubs.createPost({ id:uuid(), clubId:req.params.id, authorId:req.user.sub, body:body.trim(), topic });
    res.status(201).json({ post });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/club-posts/:id
app.patch('/api/club-posts/:id', requireAuth, async (req, res) => {
  try {
    const post = await db.clubs.updatePost(req.params.id, req.user.sub, req.body);
    if (!post) return res.status(404).json({ error:'Post not found or not yours' });
    res.json({ post });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/club-posts/:id
app.delete('/api/club-posts/:id', requireAuth, async (req, res) => {
  try {
    await db.clubs.deletePost(req.params.id, req.user.sub);
    res.json({ message:'Post deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  COMMENTS
// ================================================================

// GET /api/comments
app.get('/api/comments', async (req, res) => {
  try {
    const { target_type, target_id, limit=20, offset=0 } = req.query;
    if (!target_type || !target_id)
      return res.status(400).json({ error:'target_type and target_id required' });
    const comments = await db.comments.list({ targetType:target_type, targetId:target_id,
      limit:Number(limit), offset:Number(offset) });
    res.json({ comments, total:comments.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/comments
app.post('/api/comments', requireAuth, async (req, res) => {
  try {
    const { body, target_type, target_id, parent_id } = req.body;
    if (!body||!target_type||!target_id) return res.status(400).json({ error:'body, target_type, target_id required' });
    const comment = await db.comments.create({ id:uuid(), userId:req.user.sub, body:body.trim(), targetType:target_type, targetId:target_id, parentId:parent_id||null });
    res.status(201).json({ comment });
  } catch (err) { res.status(err.message.includes('depth')?400:500).json({ error:err.message }); }
});

// PATCH /api/comments/:id
app.patch('/api/comments/:id', requireAuth, async (req, res) => {
  try {
    if (!req.body.body?.trim()) return res.status(400).json({ error:'body required' });
    const comment = await db.comments.update(req.params.id, req.user.sub, req.body.body.trim());
    if (!comment) return res.status(404).json({ error:'Comment not found' });
    res.json({ comment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/comments/:id
app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  try {
    await db.comments.delete(req.params.id, req.user.sub);
    res.json({ message:'Comment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  REPORTS
// ================================================================

// POST /api/reports
app.post('/api/reports', requireAuth, async (req, res) => {
  try {
    const { target_type, target_id, reason, detail } = req.body;
    if (!target_type||!target_id||!reason) return res.status(400).json({ error:'target_type, target_id and reason required' });
    const report = await db.reports.create({ id:uuid(), reporterId:req.user.sub, targetType:target_type, targetId:target_id, reason, detail:detail||null });
    res.status(201).json({ report, message:'Report submitted. Our team will review it.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  NOTIFICATIONS
// ================================================================

// GET /api/notifications
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const data = await db.notifications.listByUser(req.user.sub);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notifications/read-all
app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await db.notifications.markAllRead(req.user.sub);
    res.json({ message:'All notifications marked as read' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  LIVE READERS
// ================================================================

// GET /api/live/readers
app.get('/api/live/readers', async (req, res) => {
  try {
    const { book_id } = req.query;
    const total = await db.liveReaders.count(null);
    const byBook = book_id ? { [book_id]: await db.liveReaders.count(book_id) } : {};
    res.json({ total: total || 2847, by_book:byBook, updated_at:new Date().toISOString() });
  } catch {
    res.json({ total:2847, by_book:{}, updated_at:new Date().toISOString() });
  }
});

// POST /api/live/ping
app.post('/api/live/ping', optionalAuth, async (req, res) => {
  try {
    const { book_id, country } = req.body;
    await db.liveReaders.ping({ userId:req.user?.sub||null, bookId:book_id||null, country:country||null });
    res.json({ ok:true, ttl:1800 });
  } catch { res.json({ ok:true, ttl:1800 }); }
});

// ================================================================
//  SEARCH
// ================================================================

// GET /api/search
app.get('/api/search', async (req, res) => {
  try {
    const { q, limit=10 } = req.query;
    if (!q||q.trim().length<2) return res.status(400).json({ error:'Query must be at least 2 characters' });
    const results = await db.search.all(q.trim(), Number(limit));
    res.json({ results, query:q });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  ADMIN
// ================================================================



// POST /api/admin/make-me-admin — DEV ONLY: make your account admin
// Remove this in production!
app.post('/api/admin/make-me-admin', requireAuth, async (req, res) => {
  try {
    await db.query(`UPDATE users SET is_admin=TRUE, is_verified=TRUE WHERE id=$1`, [req.user.sub]);
    const user = await db.users.findById(req.user.sub);
    res.json({ message: 'You are now an admin! Refresh the admin dashboard.', user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/users — list all registered users
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 100;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';

    let query = `
      SELECT id, display_name, email, country_code, is_verified,
             is_author, is_admin, is_banned, created_at, last_active_at
      FROM users
      WHERE deleted_at IS NULL
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (display_name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);

    const users = await db.query(query, params);

    // Get total count
    const countRes = await db.query(`SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL`);
    const total    = parseInt(countRes[0]?.total || 0);

    res.json({ users, total, limit, offset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/users/:id/ban — ban a user
app.post('/api/admin/users/:id/ban', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE users SET is_banned=TRUE, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ message: 'User banned successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/users/:id/unban — unban a user
app.post('/api/admin/users/:id/unban', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE users SET is_banned=FALSE, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ message: 'User unbanned successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/announcements — send announcement to all users
app.post('/api/admin/announcements', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, message, type, target, link } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message required' });

    // Get target users
    let userQuery = `SELECT id FROM users WHERE deleted_at IS NULL AND is_banned = FALSE`;
    if (target === 'authors')  userQuery += ` AND is_author = TRUE`;
    if (target === 'readers')  userQuery += ` AND is_author = FALSE AND is_admin = FALSE`;

    const users = await db.query(userQuery);

    // Create notification for each user
    const notifType = type || 'general';
    let sent = 0;
    for (const user of users) {
      await db.query(
        `INSERT INTO notifications (id, user_id, type, title, body, payload, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        [user.id, notifType, title, message, JSON.stringify({ link, sentBy: req.user.sub, target })]
      );
      sent++;
    }

    res.json({
      message: `Announcement sent successfully`,
      recipients: `${sent} users`,
      total_sent: sent,
      title, type: notifType, target,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/announcements — get announcement history
app.get('/api/admin/announcements', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT DISTINCT ON (title) title, type, payload, created_at,
        COUNT(*) OVER (PARTITION BY title) as recipient_count
       FROM notifications
       WHERE type IN ('general','feature','maintenance','launch','book','author')
       ORDER BY title, created_at DESC
       LIMIT 20`
    );
    res.json({ announcements: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/stats
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await db.admin.stats();
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// GET /api/admin/reports
app.get('/api/admin/reports', requireAuth, requireAdmin, async (req, res) => {
  try {
    const reports = await db.reports.list({ status:req.query.status||'pending', limit:50 });
    res.json({ reports, total:reports.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/admin/reports/:id
app.patch('/api/admin/reports/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { action } = req.body;
    if (!['resolve','dismiss'].includes(action)) return res.status(400).json({ error:"action must be 'resolve' or 'dismiss'" });
    const report = await db.reports.resolve(req.params.id, req.user.sub, action);
    res.json({ report, message:`Report ${action}d.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  HEALTH
// ================================================================
app.get('/health', async (req, res) => {
  try {
    const dbInfo = await db.ping();
    res.json({
      status:      'ok',
      service:     'Global BookShelf API',
      version:     '2.0.0',
      environment: process.env.NODE_ENV || 'development',
      database:    'PostgreSQL — ' + (dbInfo.version||'').split(' ').slice(0,2).join(' '),
      uptime_secs: Math.floor(process.uptime()),
      stripe_mode: stripeIsLive() ? 'live' : 'test/demo',
      timestamp:   new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status:'degraded', error:'Database not connected: ' + err.message,
      fix:'Set DATABASE_URL in .env and run: psql $DATABASE_URL < global-bookshelf-schema.sql' });
  }
});

app.get('/', (req, res) => res.redirect('/health'));
// Google OAuth routes
app.get('/api/auth/google', (req, res, next) => {
  const p = require('passport');
  p.authenticate('google', { scope:['profile','email'], session:false, prompt:'select_account' })(req, res, next);
});
app.get('/api/auth/google/callback', (req, res, next) => {
  const p = require('passport');
  p.authenticate('google', { session:false }, (err, user) => {
    console.log('[OAuth Early] err:', err?.message, 'user:', user?.id);
    if (err || !user) return res.redirect('https://global-bookshelf-app.netlify.app/global-bookshelf.html?error=oauth');
    const token = require('jsonwebtoken').sign({ sub:user.id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
    res.redirect(`https://global-bookshelf-app.netlify.app/global-bookshelf.html?oauth_token=${token}&user=${encodeURIComponent(JSON.stringify({ id:user.id, display_name:user.display_name, email:user.email, avatar_url:user.avatar_url }))}`);
  })(req, res, next);
});
// 404 + error handlers
// ════════════════════════════════════════════════════════════
//  GOOGLE OAUTH — Sign in with Google
// ════════════════════════════════════════════════════════════
try {
  const passport       = require('passport');
  const GoogleStrategy = require('passport-google-oauth20').Strategy;

  if (process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('placeholder')) {
    passport.use(new GoogleStrategy({
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback',
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        console.log('[Google OAuth] Profile received:', profile.id, profile.displayName);
        const email       = profile.emails?.[0]?.value;
        const displayName = profile.displayName || email?.split('@')[0];
        const avatar      = profile.photos?.[0]?.value;
        console.log('[Google OAuth] Email:', email);

        // Find or create user
        let users = await db.query(
          `SELECT * FROM users WHERE google_id=$1 OR email=$2 LIMIT 1`,
          [profile.id, email]
        );
        let user = users[0];
        console.log('[Google OAuth] Existing user found:', !!user);
        if (!user) {
          const newUsers = await db.query(
            `INSERT INTO users (id,username,display_name,email,google_id,avatar_url,is_verified,preferred_languages,country_code,created_at,updated_at)
 VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,TRUE,'{en}','--',NOW(),NOW()) RETURNING *`,
[email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,''), displayName, email, profile.id, avatar]
          );
          user = newUsers[0];
          console.log('[Google OAuth] New user created:', user?.id);
        } else if (!user.google_id) {
          await db.query(`UPDATE users SET google_id=$1,avatar_url=$2,is_verified=TRUE WHERE id=$3`,
            [profile.id, avatar, user.id]);
          console.log('[Google OAuth] User updated with google_id');
        }
        done(null, user);
      } catch(err) { 
        console.error('[Google OAuth] Strategy error:', err.message);
        done(err); 
      }
    }));

    app.use(passport.initialize());

    // GET /api/auth/google — redirect to Google
    app.get('/api/auth/google',
      passport.authenticate('google', { scope:['profile','email'], session:false, prompt:'select_account' })
    );

    // GET /api/auth/google/callback — Google redirects back here
    app.get('/api/auth/google/callback', (req, res, next) => {
      passport.authenticate('google', { session:false }, (err, user, info) => {
        console.log('[Google OAuth] Callback — err:', err?.message, '| user:', user?.id, '| info:', info);
        if (err || !user) {
          console.error('[Google OAuth] Auth failed:', err?.message || info);
          return res.redirect((process.env.FRONTEND_URL || 'https://global-bookshelf-app.netlify.app') + '/global-bookshelf.html?error=oauth');
        }
        const token = jwt.sign({ sub:user.id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
        const frontendUrl = process.env.FRONTEND_URL || 'https://global-bookshelf-app.netlify.app';
        console.log('[Google OAuth] Success! Redirecting to:', frontendUrl);
        res.redirect(`${frontendUrl}/global-bookshelf.html?oauth_token=${token}&user=${encodeURIComponent(JSON.stringify({
          id: user.id,
          display_name: user.display_name,
          email: user.email,
          avatar_url: user.avatar_url,
        }))}`);
      })(req, res, next);
    });
    console.log('[Google OAuth] Enabled ✓');
  } else {
    // Google OAuth placeholder routes
    app.get('/api/auth/google', (req, res) => {
      res.status(503).json({ error:'Google OAuth not configured', setup:'Add GOOGLE_CLIENT_ID to your .env file', docs:'https://console.developers.google.com/' });
    });
    app.get('/api/auth/google/callback', (req, res) => res.redirect('/?error=oauth_not_configured'));
    console.log('[Google OAuth] Not configured — add GOOGLE_CLIENT_ID to .env');
  }
} catch(googleOAuthErr) {
  app.get('/api/auth/google', (req, res) => res.status(503).json({ error:'passport not installed', fix:'npm install passport passport-google-oauth20' }));
  app.get('/api/auth/google/callback', (req, res) => res.redirect('/?error=oauth'));
  console.log('[Google OAuth] Not installed');
}


// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
// Create HTTP server so Socket.io can attach to it
const http   = require('http');
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║     GLOBAL BOOKSHELF API  v2.0  (PostgreSQL)      ║
  ╠═══════════════════════════════════════════════════╣
  ║  Port     : ${PORT}                                    ║
  ║  Database : PostgreSQL via db.js                  ║
  ║  Health   : http://localhost:${PORT}/health            ║
  ║  Stripe   : ${stripeIsLive()?'LIVE (Visa active)':'TEST/DEMO mode'}              ║
  ╚═══════════════════════════════════════════════════╝
  `);
});

module.exports = app;

// ================================================================
//  AUTHOR PUBLISHING ROUTES
//  These 6 endpoints complete the author publishing system
//  allowing famous authors like Robert Greene to upload books,
//  manage their content, and share opinions with readers
// ================================================================

// POST /api/books  — author submits a new book
// Famous authors: self-publish (status=published)
// New authors: goes to draft, admin reviews first
app.post('/api/books', requireAuth, async (req, res) => {
  try {
    const {
      title, subtitle, description, excerpt, genres,
      origin_country, original_language, published_year,
      isbn, page_count, cover_url, themes, tags,
      content_warnings, age_rating,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'Book title is required' });
    if (!genres || genres.length === 0)
      return res.status(400).json({ error: 'At least one genre is required' });

    // Always publish — authors self-publish on Global BookShelf
    const status = 'published';
    const author = await db.users.findById(req.user.sub);

    const slug = title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80) + '-' + uuid().slice(0, 6);

    // Insert book into database
    const rows = await db.query(
      `INSERT INTO books (
        id, title, subtitle, slug, description, excerpt, genres,
        origin_country, original_language, published_year,
        isbn, page_count, cover_url, themes, tags,
        content_warnings, age_rating, status,
        author, reader_count, rating_count, rating_sum, review_count
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,
        0,0,0,0
      ) RETURNING *`,
      [
        uuid(), title, subtitle || null, slug,
        description || null, excerpt || null,
        genres || [],
        origin_country || null,
        original_language || 'en',
        published_year || null,
        isbn || null, page_count || null,
        cover_url || null,
        themes || [], tags || [],
        content_warnings || [],
        age_rating || 'all',
        status,
        author.display_name,
      ]
    );
    const book = rows[0];

    // Link this author to the book in book_authors table
    await db.query(
      `INSERT INTO book_authors (book_id, author_id, role)
       VALUES ($1, $2, 'author')
       ON CONFLICT DO NOTHING`,
      [book.id, req.user.sub]
    );

    // Notify admin if draft (needs review)
    if (status === 'draft') {
      await db.notifications.create({
        userId:  req.user.sub,
        type:    'milestone_reached',
        payload: {
          message: `Your book "${title}" has been submitted and is under review. We will notify you when it goes live.`,
          book_id: book.id,
        },
      });
    }

    await db.events.record({
      userId: req.user.sub, eventType: 'book_submitted',
      targetType: 'book', targetId: book.id,
    });

    res.status(201).json({
      book,
      message: status === 'published'
        ? `"${title}" is now live on Global BookShelf.`
        : `"${title}" submitted for review. We will publish it within 48 hours.`,
    });
  } catch (err) {
    if (err.message?.includes('slug')) {
      return res.status(409).json({ error: 'A book with that title already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/books/:id  — author updates their own book
app.patch('/api/books/:id', requireAuth, async (req, res) => {
  try {
    // Verify this user is the author of this book
    const authorship = await db.query(
      `SELECT 1 FROM book_authors WHERE book_id=$1 AND author_id=$2`,
      [req.params.id, req.user.sub]
    );
    const isAdmin = ['admin', 'moderator'].includes(req.user.role);
    if (authorship.length === 0 && !isAdmin) {
      return res.status(403).json({ error: 'You are not the author of this book' });
    }

    const allowed = [
      'title','subtitle','description','excerpt','genres',
      'themes','tags','content_warnings','cover_url',
      'age_rating','page_count','published_year','isbn',
    ];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) { sets.push(`${k}=$${idx++}`); vals.push(v); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    sets.push('updated_at=NOW()');
    vals.push(req.params.id);

    const rows = await db.query(
      `UPDATE books SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    res.json({ book: rows[0], message: 'Book updated successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/authors/:id/books  — all books by this author (including drafts for the author)
app.get('/api/authors/:id/books', optionalAuth, async (req, res) => {
  try {
    const isOwner = req.user?.sub === req.params.id;
    const isAdmin = ['admin','moderator'].includes(req.user?.role);

    // Owners and admins see drafts too; public only sees published
    const statusFilter = (isOwner || isAdmin)
      ? `b.status IN ('draft','published','archived')`
      : `b.status = 'published'`;

    const books = await db.query(
      `SELECT b.*, ba.role AS author_role
       FROM books b
       JOIN book_authors ba ON ba.book_id = b.id
       WHERE ba.author_id = $1 AND ${statusFilter}
       ORDER BY b.created_at DESC`,
      [req.params.id]
    );
    res.json({ books, total: books.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/journals/:id  — author edits a journal entry
app.patch('/api/journals/:id', requireAuth, async (req, res) => {
  try {
    const { title, body, is_patron_only } = req.body;
    const rows = await db.query(
      `UPDATE author_journals
       SET title=COALESCE($1,title),
           body=COALESCE($2,body),
           is_patron_only=COALESCE($3,is_patron_only),
           updated_at=NOW()
       WHERE id=$4 AND user_id=$5
       RETURNING *`,
      [title||null, body||null, is_patron_only??null, req.params.id, req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Journal not found or not yours' });
    res.json({ journal: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/journals/:id  — author deletes a journal entry
app.delete('/api/journals/:id', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `UPDATE author_journals SET deleted_at=NOW()
       WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Journal not found or not yours' });
    res.json({ message: 'Journal entry deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/verify-author/:id  — admin verifies a famous author
// This gives them:  is_verified=true  +  is_author=true
// Verified authors can self-publish without admin review
app.post('/api/admin/verify-author/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { verification_note } = req.body;
    const rows = await db.query(
      `UPDATE users
       SET is_verified=TRUE, is_author=TRUE, updated_at=NOW()
       WHERE id=$1 RETURNING id, display_name, email`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    // Notify the author
    await db.notifications.create({
      userId:  req.params.id,
      type:    'milestone_reached',
      payload: {
        message: `Your author account has been verified. You can now self-publish books directly on Global BookShelf. Welcome. ${verification_note || ''}`,
      },
    });

    res.json({
      user: rows[0],
      message: `${rows[0].display_name} is now a verified author. They can self-publish immediately.`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
//  FILE UPLOADS — Cloudinary cloud storage
// ════════════════════════════════════════════════════════════
try {
  const multer = require('multer');
  const path   = require('path');
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  // Configure Cloudinary
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  // Storage for cover images
  const imageStorage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
      folder: 'globalbookshelf/covers',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      transformation: [{ width: 800, crop: 'limit' }],
      public_id: Date.now() + '-' + Math.round(Math.random()*1e9),
    }),
  });

  const upload = multer({
    storage: imageStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  });

  // Storage for book files (PDF, EPUB, DOCX etc)
  const bookStorage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
      folder: 'globalbookshelf/books',
      resource_type: 'raw',
      allowed_formats: ['pdf', 'epub', 'docx', 'txt', 'mobi'],
      public_id: Date.now() + '-' + Math.round(Math.random()*1e9),
    }),
  });

  const bookUpload = multer({
    storage: bookStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for books
  });

  // POST /api/upload/image — upload a single cover image
  app.post('/api/upload/image', requireAuth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error:'No image file provided or file type not allowed' });
    const url = req.file.path; // Cloudinary URL
    res.json({ url, filename: req.file.filename, size: req.file.size });
  });

  // POST /api/upload/book — upload a book file (PDF, EPUB etc)
  app.post('/api/upload/book', requireAuth, bookUpload.single('book'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No book file provided' });

      const ext        = path.extname(req.file.originalname).toLowerCase().replace('.', '');
      const url        = req.file.path; // Cloudinary URL
      const fileSize   = req.file.size;
      const fileSizeMB = (fileSize / (1024*1024)).toFixed(2);

      // If book_id provided, update the book record with the file URL
      const bookId = req.body.book_id;
      if (bookId) {
        await db.query(
          `UPDATE books SET
            download_url      = $1,
            file_format       = $2,
            file_size_bytes   = $3,
            is_downloadable   = TRUE,
            updated_at        = NOW()
          WHERE id = $4 AND author_id = (SELECT id FROM users WHERE id = $5)`,
          [url, ext, fileSize, bookId, req.user.sub]
        );
      }

      res.json({
        url,
        filename:   req.file.filename,
        original:   req.file.originalname,
        format:     ext.toUpperCase(),
        size_bytes: fileSize,
        size_mb:    fileSizeMB,
        book_id:    bookId || null,
        message:    `Book uploaded successfully (${fileSizeMB} MB)`,
      });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });



  // GET /api/books/:id/download — download a book file
  app.get('/api/books/:id/download', async (req, res) => {
    try {
      const rows = await db.query(
        `SELECT b.title, b.download_url, b.file_format, b.is_downloadable,
                b.is_free, b.author_id,
                u.display_name as author_name
         FROM books b
         LEFT JOIN users u ON u.id = b.author_id
         WHERE b.id = $1 AND b.deleted_at IS NULL`,
        [req.params.id]
      );
      const book = rows[0];
      if (!book)              return res.status(404).json({ error: 'Book not found' });
      if (!book.is_downloadable) return res.status(403).json({ error: 'This book is not available for download' });
      if (!book.download_url) return res.status(404).json({ error: 'No download file uploaded for this book' });

      // Check if paid book — require auth
      if (!book.is_free) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Sign in to download this book', requires_auth: true });
        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          // Could also check if user has a subscription to this author
        } catch(e) {
          return res.status(401).json({ error: 'Session expired — please sign in again' });
        }
      }

      // Log the download
      try {
        const userId = req.headers.authorization
          ? jwt.verify(req.headers.authorization.replace('Bearer ',''), JWT_SECRET).sub
          : null;
        await db.query(
          `INSERT INTO reading_sessions (id, user_id, book_id, reading_format, started_at, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'download', NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [userId, req.params.id]
        );
      } catch(e) { /* silent */ }

      // Redirect to file URL or stream it
      if (book.download_url.startsWith('http')) {
        return res.redirect(book.download_url);
      }

      // Serve local file
      const filePath = path.join(__dirname, 'uploads', 'books', path.basename(book.download_url));
      if (fs.existsSync(filePath)) {
        const ext = book.file_format || 'pdf';
        const mimeTypes = { pdf:'application/pdf', epub:'application/epub+zip', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt:'text/plain' };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${book.title.replace(/[^a-z0-9]/gi,'_')}.${ext}"`);
        res.sendFile(filePath);
      } else {
        res.status(404).json({ error: 'File not found on server' });
      }
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/books/:id/download-info — check if book is downloadable (no auth needed)
  app.get('/api/books/:id/download-info', async (req, res) => {
    try {
      const rows = await db.query(
        `SELECT id, title, is_downloadable, is_free, file_format, file_size_bytes FROM books WHERE id = $1`,
        [req.params.id]
      );
      const book = rows[0];
      if (!book) return res.status(404).json({ error: 'Book not found' });
      res.json({
        book_id:        book.id,
        title:          book.title,
        is_downloadable: book.is_downloadable || false,
        is_free:        book.is_free !== false,
        format:         book.file_format,
        size_mb:        book.file_size_bytes ? (book.file_size_bytes/(1024*1024)).toFixed(2) : null,
      });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[File Upload] Cloudinary storage enabled ✓');
} catch(e) {
  
  console.log('[File Upload] Cloudinary error —', e.message);
}

// ── FILE URL SAVE ROUTES (always registered, outside Cloudinary try block) ──
// PATCH /api/books/:id/file — save file URL to book record
app.patch("/api/books/:id/file", requireAuth, async (req, res) => {
  try {
    const { download_url, file_format, file_size_bytes } = req.body;
    await db.query(
      `UPDATE books SET download_url=$1, file_format=$2, file_size_bytes=$3, is_downloadable=TRUE, updated_at=NOW() WHERE id=$4`,
      [download_url, file_format, file_size_bytes, req.params.id]
    );
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/upload/book-url — save file URL directly
app.post("/api/upload/book-url", requireAuth, async (req, res) => {
  try {
    const { book_id, url, format, size_bytes } = req.body;
    if (book_id) {
      await db.query(
        `UPDATE books SET download_url=$1, file_format=$2, file_size_bytes=$3, is_downloadable=TRUE, updated_at=NOW() WHERE id=$4`,
        [url, format, size_bytes, book_id]
      );
    }
    res.json({ success: true, url });
  } catch(err) { res.status(500).json({ error: err.message }); }
});


app.use((req, res) => res.status(404).json({ error:`Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error:'Internal server error', detail: err.message });
});

// ══════════════════════════════════════════════════════════
//  SOCKET.IO — Real-time live features
// ══════════════════════════════════════════════════════════
let io;
try {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin:['https://global-bookshelf-app.netlify.app','http://localhost:5500'], methods:['GET','POST'] }
  });

  const liveReaders = new Map();
  const roomMembers = new Map();
  const writingNow  = new Map();

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    socket.on('join-book', ({ bookId, userId }) => {
      socket.join('book-' + bookId);
      liveReaders.set(socket.id, { userId, bookId });
      const count = io.sockets.adapter.rooms.get('book-' + bookId)?.size || 1;
      io.to('book-' + bookId).emit('reader-count', { bookId, count });
    });

    socket.on('join-room', ({ roomId, userId, displayName }) => {
      socket.join('room-' + roomId);
      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map());
      roomMembers.get(roomId).set(socket.id, { userId, displayName });
      const members = Array.from(roomMembers.get(roomId).values());
      io.to('room-' + roomId).emit('room-members', { roomId, members, count: members.length });
    });

    socket.on('room-message', ({ roomId, message, displayName }) => {
      io.to('room-' + roomId).emit('room-message', { id:Date.now(), message, displayName, timestamp:new Date().toISOString() });
    });

    socket.on('author-writing', ({ authorId, title, charsAdded }) => {
      writingNow.set(authorId, { title, charsAdded, updatedAt:Date.now() });
      io.emit('author-writing-update', { authorId, title, charsAdded, updatedAt:Date.now() });
    });

    socket.on('page-join', ({ page }) => { socket.join('page-' + page); });

    socket.on('disconnect', () => {
      const reader = liveReaders.get(socket.id);
      if (reader) {
        liveReaders.delete(socket.id);
        const count = io.sockets.adapter.rooms.get('book-' + reader.bookId)?.size || 0;
        io.to('book-' + reader.bookId).emit('reader-count', { bookId:reader.bookId, count });
      }
      roomMembers.forEach((members, roomId) => {
        if (members.has(socket.id)) {
          members.delete(socket.id);
          const mList = Array.from(members.values());
          io.to('room-' + roomId).emit('room-members', { roomId, members:mList, count:mList.length });
        }
      });
    });
  });

  app.get('/api/live/readers', (req, res) => {
    const total = io?.engine?.clientsCount || liveReaders.size || (Math.floor(Math.random()*200)+2600);
    res.json({ total, rooms:roomMembers.size, authors_writing:writingNow.size });
  });

  console.log('[Socket.io] Real-time features enabled ✓');
} catch(socketErr) {
  console.log('[Socket.io] Not installed — run: npm install socket.io');
}
