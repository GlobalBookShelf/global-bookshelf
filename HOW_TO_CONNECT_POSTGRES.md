# How to Solve the Data Loss Problem
## Connecting server.js to PostgreSQL

---

## The Problem in One Line
```
const DB = { users: new Map(), books: new Map() ... }
```
JavaScript Maps live in RAM. Server restarts = all data gone.

## The Solution in One Line
```
const db = require('./db');
```
db.js connects to PostgreSQL. Data survives forever.

---

## Step 1 — Install PostgreSQL (choose one)

**Option A — Local (your computer, fastest for development):**
```bash
# macOS
brew install postgresql@15
brew services start postgresql@15
createdb globalbookshelf

# Ubuntu / Debian (includes Tanzanian cloud servers)
sudo apt install postgresql-15
sudo -u postgres createdb globalbookshelf
sudo -u postgres psql -c "CREATE USER gbs WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "GRANT ALL ON DATABASE globalbookshelf TO gbs;"
```

**Option B — AWS RDS Aurora (production):**
```
1. AWS Console → RDS → Create Database
2. Engine: PostgreSQL 15
3. Template: Free tier (dev) or Production
4. DB name: globalbookshelf
5. Username: gbs_user
6. Copy the endpoint URL — you will need it below
```

**Option C — Supabase (free tier, quickest start):**
```
1. supabase.com → New project → Tanzania region
2. Settings → Database → Copy the connection string
```

---

## Step 2 — Run the Schema

This creates all 42 tables, 74 indexes, and everything else:
```bash
psql $DATABASE_URL < global-bookshelf-schema.sql
```

Enable the pgvector extension first:
```bash
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS uuid-ossp;"
```

---

## Step 3 — Set DATABASE_URL in .env

```env
# Local PostgreSQL
DATABASE_URL=postgresql://gbs_user:yourpassword@localhost:5432/globalbookshelf

# AWS RDS
DATABASE_URL=postgresql://gbs_user:yourpassword@your-rds-endpoint.amazonaws.com:5432/globalbookshelf

# Supabase
DATABASE_URL=postgresql://postgres:[your-password]@db.xxxx.supabase.co:5432/postgres
```

---

## Step 4 — Add db.js to server.js

Add this ONE LINE at the top of server.js (after the other requires):
```javascript
const db = require('./db');
```

---

## Step 5 — Replace every DB.* call

This is the complete swap map. Every old call → new call:

### AUTH — Users

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `DB.users.set(id, user)` | `await db.users.create(user)` |
| `DB.users.get(req.user.sub)` | `await db.users.findById(req.user.sub)` |
| `for (const u of DB.users.values()) { if u.email === email }` | `await db.users.findByEmail(email)` |
| `DB.users.get(req.params.id)` | `await db.users.findById(req.params.id)` |
| `Array.from(DB.users.values())` | `await db.users.list({ limit, offset })` |
| `user.is_banned = true` | `await db.users.ban(id, reason)` |
| `user.is_verified = true` | `await db.users.verify(id)` |
| `user.password_hash = hash` | `await db.users.resetPassword(id, hash)` |

### BOOKS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `Array.from(DB.books.values())` | `await db.books.list({ q, genre, country, language, sort, limit, offset })` |
| `DB.books.get(req.params.id)` | `await db.books.findById(id)` |
| `DB.books.has(book_id)` | `const b = await db.books.findById(book_id); if (!b) return 404` |
| `Array.from(DB.books.values()).sort(...)` | `await db.books.trending(8)` |
| Map pins query | `await db.books.mapPins({ eraFrom, eraTo })` |
| Random soul matching | `await db.books.matchBySoulVector(embedding, 6)` |

### SHELVES

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `DB.shelves.set(sid, {...})` (defaults) | `await db.shelves.createDefaults(userId)` |
| `Array.from(DB.shelves.values()).filter(s => s.user_id === id)` | `await db.shelves.listByUser(userId)` |
| `DB.shelves.get(req.params.shelf_id)` | `await db.shelves.findById(shelfId)` |
| `DB.shelves.set('sb_' + id, entry)` | `await db.shelves.addBook({ shelfId, userId, bookId, status })` |
| `DB.shelves.get('sb_' + id)` then update | `await db.shelves.updateProgress(entryId, userId, { status, current_pct, rating })` |

### REVIEWS & ANNOTATIONS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `Array.from(DB.reviews.values()).filter(r => r.book_id === id)` | `await db.reviews.listByBook(bookId)` |
| `for (r of DB.reviews.values()) { if r.user_id === ... }` | `await db.reviews.findByUserAndBook(userId, bookId)` |
| `DB.reviews.set(review.id, review)` | `await db.reviews.create({...})` |
| `DB.annotations.set(a.id, a)` | `await db.annotations.create({...})` |
| `Array.from(DB.annotations.values()).filter(...)` | `await db.annotations.listByBook(bookId, { publicOnly, userId })` |

### LIKES

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `DB.shelves.has('like_' + key)` then delete/set | `await db.likes.toggle({ userId, targetType, targetId })` |

### SOUL PROFILES

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `DB.soul_profiles.set(req.user.sub, profile)` | `await db.soul.upsert({...})` |
| `DB.soul_profiles.get(req.user.sub)` | `await db.soul.findByUser(userId)` |
| Random match scores | `await db.books.matchBySoulVector(embedding, 6)` |

### PATRON TIERS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `Array.from(DB.patron_tiers.values()).filter(...)` | `await db.patronTiers.listByAuthor(authorId)` |
| `DB.patron_tiers.get(tier_id)` | `await db.patronTiers.findById(tierId)` |

### SUBSCRIPTIONS & PAYMENTS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `for (s of DB.subscriptions.values()) { if active }` | `await db.subscriptions.findActive(patronId, authorId)` |
| `DB.subscriptions.set(id, sub)` | `await db.subscriptions.create({...})` |
| `DB.subscriptions.get(id)` then cancel | `await db.subscriptions.cancel(subscriptionId)` |
| `Array.from(DB.subscriptions.values()).filter(...)` | `await db.subscriptions.listByPatron(patronId)` |
| `DB.payments.set(id, payment)` | `await db.payments.record({...})` |
| `Array.from(DB.payments.values()).filter(...)` | `await db.payments.listByPatron(patronId)` |

### CLUBS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `Array.from(DB.clubs.values())` | `await db.clubs.list({ language, visibility, q, limit })` |
| `DB.clubs.set(club.id, club)` | `await db.clubs.create({...})` |
| `DB.clubs.get(req.params.id)` | `await db.clubs.findById(id)` |
| `club.member_count++` | handled by DB trigger `sync_club_members` automatically |

### NOTIFICATIONS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `Array.from(DB.notifications.values()).filter(...)` | `await db.notifications.listByUser(userId)` |
| `n.is_read = true` loop | `await db.notifications.markAllRead(userId)` |

### ADMIN STATS

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `DB.users.size`, `DB.books.size` etc. | `await db.admin.stats()` |

### SEARCH

| Old (Map) | New (PostgreSQL) |
|-----------|-----------------|
| `Array.from(DB.books.values()).filter(b => b.title.includes(q))` | `await db.search.all(q, limit)` |

---

## Step 6 — Make route handlers async

Any route that uses db.* must use async/await.
Change this pattern:

```javascript
// BEFORE (synchronous Map)
app.get('/api/books', (req, res) => {
  const books = Array.from(DB.books.values());
  res.json({ books });
});

// AFTER (async PostgreSQL)
app.get('/api/books', async (req, res) => {
  try {
    const { books, total } = await db.books.list(req.query);
    res.json({ books, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

The pattern is always:
1. Add `async` to the route handler
2. Replace `DB.*` with `await db.*`
3. Wrap in `try/catch` to handle DB errors

---

## Step 7 — Test the connection

Add this health check to server.js:
```javascript
// In the /health route, add:
const dbInfo = await db.ping();
res.json({ status:'ok', db: dbInfo.version.split(' ').slice(0,2).join(' ') });
```

---

## Step 8 — Seed initial data

After connecting, seed the books and demo author:
```bash
psql $DATABASE_URL << 'SQL'
INSERT INTO users (id, email, display_name, username, role, is_author)
VALUES ('00000000-0000-0000-0000-000000000001',
        'system@globalbookshelf.com','System','system','admin',false)
ON CONFLICT DO NOTHING;

INSERT INTO books (title, author, origin_country, published_year, genres,
                   original_language, reader_count, status)
VALUES
  ('The God of Small Things','Arundhati Roy','IN',1997,
   ARRAY['Fiction','Post-Colonial'],'en',284190,'published'),
  ('Things Fall Apart','Chinua Achebe','NG',1958,
   ARRAY['Fiction','African'],'en',420000,'published'),
  ('Season of Migration to the North','Tayeb Salih','SD',1966,
   ARRAY['Fiction','Arabic'],'ar',98000,'published'),
  ('Americanah','Chimamanda Ngozi Adichie','NG',2013,
   ARRAY['Fiction','Contemporary'],'en',290000,'published'),
  ('Beloved','Toni Morrison','US',1987,
   ARRAY['Fiction','Historical'],'en',340000,'published');
SQL
```

---

## That is the complete solution

The data loss problem is solved by:
1. PostgreSQL stores data permanently on disk
2. `db.js` provides a clean function for every DB operation
3. Replacing `DB.*` with `await db.*` in every route
4. Data now survives server restarts, crashes, and deployments
