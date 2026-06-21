# Global BookShelf — Complete Backend & Mobile Stack

## What is in this package

| File | What it is |
|---|---|
| `server.js` | Node.js + Express API — full backend (auth, books, soul, payments, admin) |
| `soul_engine.py` | Python AI Soul Engine — 14-dimension profile + 1536-dim embeddings |
| `admin-dashboard.html` | Admin dashboard — stats, payments, moderation, user management |
| `App.tsx` | React Native mobile app — iOS + Android |
| `.env.example` | All environment variables with explanations |

---

## Quick Start — Run Everything in 5 Steps

### Step 1 — Copy environment config
```bash
cp .env.example .env
# Edit .env — add your Stripe key for Visa card payments
```

### Step 2 — Start the Node.js API server
```bash
npm install           # installs express, stripe, bcryptjs, jsonwebtoken, etc.
node server.js        # starts on http://localhost:4000
```
You will see:
```
╔═══════════════════════════════════════════════════╗
║     GLOBAL BOOKSHELF API SERVER                   ║
║     Port : 4000                                   ║
╚═══════════════════════════════════════════════════╝
```

### Step 3 — Start the Python AI Soul Engine
```bash
python3 soul_engine.py   # starts on http://localhost:5000
```

### Step 4 — Open the Admin Dashboard
```bash
open admin-dashboard.html    # macOS
# or drag the file into any browser
```

### Step 5 — Run the Mobile App
```bash
npx create-expo-app GlobalBookShelf --template blank-typescript
cd GlobalBookShelf
npm install @stripe/stripe-react-native @react-navigation/native @react-navigation/bottom-tabs
# Copy App.tsx into the project root
npx expo start
```

---

## Visa Card Payment Setup

### How it works
1. User selects a patron tier (Story Friend $5, Chapter Keeper $12, Soul Patron $28)
2. User enters their Visa card number, expiry, and CVV on the mobile app
3. The app tokenises the card via Stripe (card number NEVER sent to our server)
4. Our API receives only a Stripe `paymentMethod.id` token
5. We create a monthly subscription — the card is charged automatically each month
6. 95% of the payment goes to the author, 5% is our platform fee

### Get Stripe API keys
1. Go to https://dashboard.stripe.com
2. Click **Developers → API keys**
3. Copy your **Secret key** (starts with `sk_test_` for testing)
4. Add to `.env`:
```env
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
```

### Test Visa card numbers (Stripe test mode)
| Card number | Result |
|---|---|
| 4242 4242 4242 4242 | Payment succeeds |
| 4000 0000 0000 0002 | Card declined |
| 4000 0025 0000 3155 | Requires 3D Secure |
Use any future expiry (e.g. 12/28) and any 3-digit CVV.

### Go live (real Visa charges)
Replace `sk_test_` with `sk_live_` in your `.env`. That's it.

---

## API Endpoints Reference

### Authentication
```
POST /api/auth/register     — Create new account
POST /api/auth/login        — Sign in, get JWT token
GET  /api/auth/me           — Get current user (requires auth)
POST /api/auth/refresh      — Refresh JWT token
```

### Books
```
GET  /api/books             — List books (search, filter, sort, paginate)
GET  /api/books/:id         — Single book detail
GET  /api/books/map/pins    — Book pins for world map (with era filter)
GET  /api/books/trending/week — Top 8 books this week
POST /api/books/:id/reviews — Submit a review (requires auth)
POST /api/books/:id/annotations — Add an annotation (requires auth)
```

### AI Reading Soul
```
POST /api/soul/profile          — Save quiz answers, compute soul profile
GET  /api/soul/profile          — Get current user's soul profile
GET  /api/soul/recommendations  — Get personalised book recommendations
```

### Payments (Visa card via Stripe)
```
POST /api/payments/create-payment-intent — One-off Visa payment (tips, books)
POST /api/payments/subscribe            — Start monthly patron subscription
POST /api/payments/cancel              — Cancel subscription
GET  /api/payments/my-subscriptions    — List user's active subscriptions
GET  /api/payments/my-payments         — Payment history
POST /api/payments/webhook             — Stripe webhook (auto-called by Stripe)
```

### Communities
```
GET  /api/clubs        — List public book clubs
POST /api/clubs        — Create a club
POST /api/clubs/:id/join — Join a club
```

### Admin (admin role required)
```
GET  /api/admin/stats         — Platform overview stats
GET  /api/admin/users         — All users list
POST /api/admin/users/:id/ban — Ban a user
```

### Search & Live
```
GET  /api/search?q=term     — Search books and clubs
GET  /api/live/readers      — Live reader count
POST /api/live/ping         — Reader presence heartbeat
```

---

## AI Soul Engine Endpoints

```
GET  /health         — Service health check
POST /compute        — Full soul profile (dimensions + archetype + embedding)
POST /match          — Book recommendations from soul embedding
POST /dimensions     — Compute dimensions only (fast)
POST /embedding      — Generate vector from existing dimensions
```

### Example: Compute a soul profile
```bash
curl -X POST http://localhost:5000/compute \
  -H "Content-Type: application/json" \
  -d '{
    "emotional_need": "meaning",
    "passage_type": "lyrical",
    "dials": {"pace":3,"darkness":7,"language":8,"geography":9,"time_period":4,"length":8},
    "reading_ritual": "midnight",
    "user_id": "user_123"
  }'
```

Returns:
```json
{
  "archetype": { "name": "Midnight Wanderer", "desc": "..." },
  "dimensions": { "emotional_depth": 0.87, "cultural_range": 0.92, ... },
  "literary_dna": ["Post-Colonial", "Magical Realism", "African Literature", ...],
  "soul_embedding": [0.021, -0.043, 0.018, ...],
  "embedding_dims": 1536
}
```

---

## Mobile App (React Native) — 7 Screens

| Screen | What it does |
|---|---|
| Splash | Animated soul orb loading screen |
| Auth | Sign in / Register (connects to `/api/auth`) |
| Home | Book discovery with genre filters and live counter |
| Book Detail | Book info, Add to shelf, immersive reader modal |
| Soul Quiz | 3-question mobile quiz → computes soul profile |
| Patron / Visa Payment | Select tier → enter Visa card → monthly subscription |
| Profile | User profile, subscriptions, soul profile link |
| Map | Living world map preview with book pins and reader dots |

---

## Production Deployment

### 1. Database — Deploy the PostgreSQL schema
```bash
psql $DATABASE_URL < global-bookshelf-schema.sql
```
This creates all 42 tables, 74 indexes, 11 triggers, 4 views, and 7 RLS policies.

### 2. Replace in-memory store with real PostgreSQL
In `server.js`, replace the `DB.*` Maps with real `pg` queries:
```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Example: replace DB.books.get(id) with:
const { rows } = await pool.query('SELECT * FROM books WHERE id=$1', [id]);
```

### 3. Add OpenAI for real soul embeddings
```env
OPENAI_API_KEY=sk-...your real key...
```
The Soul Engine automatically uses OpenAI `text-embedding-3-small` when a valid key is present.

### 4. Deploy to AWS
```bash
# API on ECS Fargate:
docker build -t gbs-api .
aws ecr push gbs-api
# Soul Engine on Lambda or ECS
# Frontend static files on S3 + CloudFront
```

---

## Architecture Summary

```
Browser / Mobile App
      │
      ├─── GET /api/books ──────────────────► Node.js API (server.js :4000)
      │                                           │
      ├─── POST /api/soul/profile ─────────────── │ ──► Python Soul Engine (:5000)
      │                                           │         (14 dimensions + embedding)
      ├─── POST /api/payments/subscribe ──────── │ ──► Stripe (Visa card billing)
      │         (Visa card token)                 │
      └─── WebSocket (Phase 2) ────────────────── │ ──► Redis pub/sub (live readers)
                                                  │
                                              PostgreSQL 15
                                         (42 tables, pgvector, RLS)
```

---

## File size summary
- `server.js`          — 520 lines, complete Node.js API
- `soul_engine.py`     — 320 lines, complete AI engine
- `admin-dashboard.html` — 580 lines, complete admin UI
- `App.tsx`            — 680 lines, complete React Native app
- `.env.example`       — 50 lines, fully documented config
