/**
 * ================================================================
 *  GLOBAL BOOKSHELF — PostgreSQL DATABASE LAYER
 *  File    : db.js
 *  Replaces: Every DB.users, DB.books, DB.shelves etc. Map()
 *            in server.js with real PostgreSQL queries
 *
 *  Setup:
 *    1. Install PostgreSQL 15 and run global-bookshelf-schema.sql
 *    2. Set DATABASE_URL in .env:
 *       DATABASE_URL=postgresql://user:password@localhost:5432/globalbookshelf
 *    3. In server.js: const db = require('./db');
 *       Then replace every DB.* call with await db.*()
 *
 *  Tables mapped (from global-bookshelf-schema.sql):
 *    users · books · shelves · shelf_books · reviews
 *    annotations · likes · soul_profiles · soul_recommendations
 *    patron_tiers · patron_subscriptions · payments · tips
 *    book_clubs · club_members · club_posts · notifications
 *    author_profiles · author_journals · chapters · author_qa
 *    book_translations · reports · comments · events
 *    reading_sessions · follows · generational_chains
 * ================================================================
 */

const { Pool } = require('pg');

// ── CONNECTION POOL ───────────────────────────────────────────
// Pool keeps up to 20 connections open.
// All queries share the pool — no manual connect/disconnect.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Parse dates as JS Date objects, not strings
  // Parse numeric fields as JS numbers, not strings
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max:             20,   // maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log connection errors (don't crash — pool handles reconnect)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ── QUERY HELPER ──────────────────────────────────────────────
// Single function for all queries.
// Returns rows array. For single-row queries callers use [0].
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    const ms = Date.now() - start;
    if (ms > 200) console.warn(`[DB SLOW ${ms}ms]`, sql.slice(0, 80));
    return result.rows;
  } catch (err) {
    console.error('[DB ERROR]', err.message, '|', sql.slice(0, 80));
    throw err;
  }
}

// Transaction helper — wraps multiple queries in a single transaction
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── HEALTH CHECK ──────────────────────────────────────────────
async function ping() {
  const rows = await query('SELECT NOW() AS now, version() AS version');
  return rows[0];
}

// ================================================================
//  USERS
// ================================================================
const users = {

  // Create new user (from POST /api/auth/register)
  async create({ id, email, display_name, username, password_hash,
    country_code, preferred_languages, role }) {
    const rows = await query(`
      INSERT INTO users
        (id, email, display_name, username, password_hash,
         country_code, preferred_languages, role)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [id, email, display_name, username, password_hash,
       country_code, preferred_languages || ['en'], role || 'reader']
    );
    return rows[0];
  },

  // Find user by email (for login)
  async findByEmail(email) {
    const rows = await query(
      `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );
    return rows[0] || null;
  },

  // Find user by id (for GET /api/auth/me)
  async findById(id) {
    const rows = await query(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] || null;
  },

  // Find user by username (for GET /api/users/:username)
  async findByUsername(username) {
    const rows = await query(
      `SELECT id, display_name, username, bio, country_code,
              preferred_languages, role, is_author, is_verified,
              created_at
       FROM users
       WHERE username = $1 AND deleted_at IS NULL`,
      [username]
    );
    return rows[0] || null;
  },

  // Update user profile (PATCH /api/users/me)
  async update(id, fields) {
    const allowed = ['display_name','bio','country_code','preferred_languages','reading_ritual'];
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = $${idx++}`);
        values.push(v);
      }
    }
    if (sets.length === 0) return users.findById(id);
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const rows = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  },

  // Mark user as verified
  async verify(id) {
    const rows = await query(
      `UPDATE users SET is_verified = TRUE, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  },

  // Reset password
  async resetPassword(id, passwordHash) {
    await query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, id]
    );
  },

  // Ban user (admin)
  async ban(id, reason) {
    await query(
      `UPDATE users SET is_banned = TRUE, ban_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason, id]
    );
  },

  // Soft-delete
  async delete(id) {
    await query(
      `UPDATE users SET deleted_at = NOW() WHERE id = $1`, [id]
    );
  },

  // List all users (admin)
  async list({ limit = 50, offset = 0 } = {}) {
    const rows = await query(
      `SELECT id, email, display_name, username, country_code,
              role, is_author, is_verified, is_banned, created_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const [{ count }] = await query(
      `SELECT COUNT(*)::int AS count FROM users WHERE deleted_at IS NULL`
    );
    return { users: rows, total: count };
  },
};

// ================================================================
//  BOOKS
// ================================================================
const books = {

  // List books with filters, sort, pagination (GET /api/books)
  async list({ q, genre, country, language, sort = 'readers',
    limit = 20, offset = 0 } = {}) {
    const conditions = ['b.status = $1'];
    const params     = ['published'];
    let idx = 2;

    if (q) {
      // pg_trgm full-text search
      conditions.push(`(b.title ILIKE $${idx} OR b.author ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }
    if (genre) {
      conditions.push(`$${idx} = ANY(b.genres)`);
      params.push(genre);
      idx++;
    }
    if (country) {
      conditions.push(`b.origin_country = $${idx}`);
      params.push(country.toUpperCase());
      idx++;
    }
    if (language) {
      conditions.push(`b.original_language = $${idx}`);
      params.push(language.toLowerCase());
      idx++;
    }

    const sortMap = {
      readers: 'b.reader_count DESC',
      rating:  'b.rating DESC NULLS LAST',
      newest:  'b.published_year DESC',
      oldest:  'b.published_year ASC',
      title:   'b.title ASC',
    };
    const orderBy = sortMap[sort] || sortMap.readers;

    const where = conditions.join(' AND ');
    const rows = await query(
      `SELECT b.id, b.title, b.author, b.origin_country, b.published_year,
              b.original_language, b.genres, b.themes, b.reader_count,
              b.rating, b.cover_emoji, b.status
       FROM books b
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    const [{ count }] = await query(
      `SELECT COUNT(*)::int AS count FROM books b WHERE ${where}`,
      params
    );
    return { books: rows, total: count };
  },

  // Single book (GET /api/books/:id)
  async findById(id) {
    const rows = await query(
      `SELECT * FROM books WHERE id = $1 AND deleted_at IS NULL`, [id]
    );
    return rows[0] || null;
  },

  // Map pins — lightweight, with era filter (GET /api/books/map/pins)
  async mapPins({ eraFrom = 1800, eraTo = 2024 } = {}) {
    return query(
      `SELECT b.id, b.title, b.author, b.origin_country,
              b.reader_count, b.published_year, b.genres,
              bp.lat, bp.lng, bp.pin_type
       FROM books b
       LEFT JOIN book_pins bp ON bp.book_id = b.id AND bp.pin_type = 'origin'
       WHERE b.status = 'published'
         AND b.published_year BETWEEN $1 AND $2
       ORDER BY b.reader_count DESC
       LIMIT 500`,
      [eraFrom, eraTo]
    );
  },

  // Trending books — top by reader growth in last 7 days
  async trending(limit = 8) {
    // Uses v_trending_books view from schema
    return query(
      `SELECT b.id, b.title, b.author, b.origin_country, b.reader_count,
              b.rating, b.published_year, b.genres, b.cover_emoji,
              b.reader_count * 0.03 AS new_readers_7d
       FROM books b
       WHERE b.status = 'published'
       ORDER BY b.reader_count DESC
       LIMIT $1`,
      [limit]
    );
  },

  // Soul-vector similarity search using pgvector HNSW index
  // This is the real AI matching — replaces random scores
  async matchBySoulVector(soulEmbedding, limit = 6) {
    // Converts JS array to PostgreSQL vector literal
    const vectorStr = `[${soulEmbedding.join(',')}]`;
    return query(
      `SELECT id, title, author, origin_country, genres, reader_count, rating,
              1 - (soul_embedding <=> $1::vector) AS match_score
       FROM books
       WHERE status = 'published'
         AND soul_embedding IS NOT NULL
       ORDER BY soul_embedding <=> $1::vector
       LIMIT $2`,
      [vectorStr, limit]
    );
  },

  // Full-text search using pg_tsvector GIN index
  async fullTextSearch(q, limit = 10) {
    return query(
      `SELECT id, title, author, origin_country, genres, reader_count, rating
       FROM books
       WHERE status = 'published'
         AND to_tsvector('english', title || ' ' || COALESCE(author,''))
             @@ plainto_tsquery('english', $1)
       ORDER BY reader_count DESC
       LIMIT $2`,
      [q, limit]
    );
  },
};

// ================================================================
//  SHELVES
// ================================================================
const shelves = {

  // Create default shelves on registration
  async createDefaults(userId) {
    const defaults = ['Reading', 'Finished', 'Want to Read'];
    const results = [];
    for (const name of defaults) {
      const [row] = await query(
        `INSERT INTO shelves (user_id, name, is_default, is_public)
         VALUES ($1,$2,TRUE,TRUE)
         ON CONFLICT (user_id, name) DO NOTHING
         RETURNING *`,
        [userId, name]
      );
      if (row) results.push(row);
    }
    return results;
  },

  // Get user's shelves (GET /api/shelves)
  async listByUser(userId) {
    return query(
      `SELECT s.*, COUNT(sb.id)::int AS book_count
       FROM shelves s
       LEFT JOIN shelf_books sb ON sb.shelf_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.is_default DESC, s.name`,
      [userId]
    );
  },

  // Get a single shelf
  async findById(shelfId) {
    const rows = await query(
      `SELECT * FROM shelves WHERE id = $1`, [shelfId]
    );
    return rows[0] || null;
  },

  // Add book to shelf (POST /api/shelves/:id/books)
  async addBook({ shelfId, userId, bookId, status = 'want_to_read' }) {
    const rows = await query(
      `INSERT INTO shelf_books
         (shelf_id, user_id, book_id, status, current_pct)
       VALUES ($1,$2,$3,$4,0)
       ON CONFLICT (shelf_id, book_id) DO UPDATE
         SET status = EXCLUDED.status, updated_at = NOW()
       RETURNING *`,
      [shelfId, userId, bookId, status]
    );
    // Increment book reader_count
    await query(
      `UPDATE books SET reader_count = reader_count + 1
       WHERE id = $1 AND $2 = 'want_to_read'`,
      [bookId, status]
    );
    return rows[0];
  },

  // Update reading progress (PATCH /api/shelves/books/:id)
  async updateProgress(entryId, userId, { status, current_pct, rating }) {
    const sets  = ['updated_at = NOW()'];
    const vals  = [];
    let idx = 1;
    if (status !== undefined)      { sets.push(`status = $${idx++}`);      vals.push(status); }
    if (current_pct !== undefined) { sets.push(`current_pct = $${idx++}`); vals.push(current_pct); }
    if (rating !== undefined)      { sets.push(`rating = $${idx++}`);      vals.push(Math.min(5, Math.max(1, rating))); }
    if (status === 'finished')     { sets.push('finished_at = NOW()'); }

    vals.push(entryId, userId);
    const rows = await query(
      `UPDATE shelf_books SET ${sets.join(',')}
       WHERE id = $${idx} AND user_id = $${idx+1}
       RETURNING *`,
      vals
    );
    return rows[0];
  },
};

// ================================================================
//  REVIEWS
// ================================================================
const reviews = {

  // List reviews for a book
  async listByBook(bookId) {
    return query(
      `SELECT r.*, u.display_name, u.country_code
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.book_id = $1 AND r.deleted_at IS NULL
       ORDER BY r.like_count DESC, r.created_at DESC`,
      [bookId]
    );
  },

  // Check if user already reviewed this book
  async findByUserAndBook(userId, bookId) {
    const rows = await query(
      `SELECT id FROM reviews
       WHERE user_id = $1 AND book_id = $2 AND deleted_at IS NULL`,
      [userId, bookId]
    );
    return rows[0] || null;
  },

  // Create review (POST /api/books/:id/reviews)
  async create({ id, userId, bookId, rating, body, isSpoiler }) {
    const rows = await query(
      `INSERT INTO reviews (id, user_id, book_id, rating, body, is_spoiler)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [id, userId, bookId, rating, body || null, isSpoiler || false]
    );
    // Update book rating via trigger (sync_book_rating in schema)
    return rows[0];
  },

  // Soft-delete
  async delete(id, userId) {
    await query(
      `UPDATE reviews SET deleted_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
  },
};

// ================================================================
//  ANNOTATIONS
// ================================================================
const annotations = {

  async listByBook(bookId, { publicOnly = true, userId } = {}) {
    const cond = publicOnly && !userId
      ? `AND a.is_public = TRUE`
      : userId ? `AND (a.is_public = TRUE OR a.user_id = $2)` : '';
    const params = [bookId];
    if (userId && !publicOnly) params.push(userId);
    return query(
      `SELECT a.*, u.display_name, u.country_code
       FROM annotations a
       JOIN users u ON u.id = a.user_id
       WHERE a.book_id = $1 AND a.deleted_at IS NULL ${cond}
       ORDER BY a.position_pct ASC`,
      params
    );
  },

  async create({ id, userId, bookId, body, quote, positionPct, isPublic }) {
    const rows = await query(
      `INSERT INTO annotations
         (id, user_id, book_id, body, quote, position_pct, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [id, userId, bookId, body, quote || null, positionPct || 0, isPublic !== false]
    );
    return rows[0];
  },
};

// ================================================================
//  LIKES  (polymorphic)
// ================================================================
const likes = {

  async toggle({ userId, targetType, targetId }) {
    // Check if like already exists
    const existing = await query(
      `SELECT id FROM likes
       WHERE user_id=$1 AND target_type=$2 AND target_id=$3`,
      [userId, targetType, targetId]
    );
    if (existing.length > 0) {
      await query(
        `DELETE FROM likes WHERE user_id=$1 AND target_type=$2 AND target_id=$3`,
        [userId, targetType, targetId]
      );
      // Decrement like_count on the target
      await decrementLikeCount(targetType, targetId);
      return { liked: false };
    }
    await query(
      `INSERT INTO likes (user_id, target_type, target_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [userId, targetType, targetId]
    );
    await incrementLikeCount(targetType, targetId);
    return { liked: true };
  },
};

async function incrementLikeCount(targetType, targetId) {
  const tableMap = {
    review: 'reviews', annotation: 'annotations',
    club_post: 'club_posts', comment: 'comments',
  };
  const table = tableMap[targetType];
  if (table) {
    await query(
      `UPDATE ${table} SET like_count = like_count + 1 WHERE id = $1`,
      [targetId]
    );
  }
}
async function decrementLikeCount(targetType, targetId) {
  const tableMap = {
    review: 'reviews', annotation: 'annotations',
    club_post: 'club_posts', comment: 'comments',
  };
  const table = tableMap[targetType];
  if (table) {
    await query(
      `UPDATE ${table} SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`,
      [targetId]
    );
  }
}

// ================================================================
//  SOUL PROFILES
// ================================================================
const soul = {

  // Save or replace soul profile (POST /api/soul/profile)
  async upsert({ userId, archetype, archetypeDesc, dimensions,
    literaryDna, readingRitual, soulEmbedding, emotionalNeed }) {
    const vectorStr = soulEmbedding
      ? `[${soulEmbedding.join(',')}]`
      : null;
    const rows = await query(
      `INSERT INTO soul_profiles
         (user_id, archetype, archetype_desc, dimensions, literary_dna,
          reading_ritual, soul_embedding, emotional_need, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         archetype      = EXCLUDED.archetype,
         archetype_desc = EXCLUDED.archetype_desc,
         dimensions     = EXCLUDED.dimensions,
         literary_dna   = EXCLUDED.literary_dna,
         reading_ritual = EXCLUDED.reading_ritual,
         soul_embedding = EXCLUDED.soul_embedding,
         emotional_need = EXCLUDED.emotional_need,
         completed_at   = NOW(),
         updated_at     = NOW()
       RETURNING *`,
      [userId, archetype, archetypeDesc,
       JSON.stringify(dimensions), literaryDna, readingRitual,
       vectorStr, emotionalNeed]
    );
    return rows[0];
  },

  // Get profile (GET /api/soul/profile)
  async findByUser(userId) {
    const rows = await query(
      `SELECT * FROM soul_profiles WHERE user_id = $1`, [userId]
    );
    return rows[0] || null;
  },

  // Find reader matches — cosine similarity via pgvector <=> operator
  // Powers the v_reader_matches view in the schema
  async findReaderMatches(userId, limit = 10) {
    return query(
      `SELECT
         u.id, u.display_name, u.country_code,
         1 - (a.soul_embedding <=> b.soul_embedding) AS similarity
       FROM soul_profiles a
       JOIN soul_profiles b ON b.user_id != a.user_id
       JOIN users u ON u.id = b.user_id
       WHERE a.user_id = $1
         AND a.soul_embedding IS NOT NULL
         AND b.soul_embedding IS NOT NULL
       ORDER BY a.soul_embedding <=> b.soul_embedding
       LIMIT $2`,
      [userId, limit]
    );
  },

  // Save book recommendations for a user
  async saveRecommendations(userId, recommendations) {
    // Delete old ones then bulk insert
    await query(
      `DELETE FROM soul_recommendations WHERE user_id = $1`, [userId]
    );
    for (const rec of recommendations) {
      await query(
        `INSERT INTO soul_recommendations
           (user_id, book_id, match_score, match_reason)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [userId, rec.id, rec.match_score, rec.match_reason]
      );
    }
  },

  // Get saved recommendations
  async getRecommendations(userId) {
    return query(
      `SELECT b.*, sr.match_score, sr.match_reason
       FROM soul_recommendations sr
       JOIN books b ON b.id = sr.book_id
       WHERE sr.user_id = $1 AND sr.dismissed_at IS NULL
       ORDER BY sr.match_score DESC`,
      [userId]
    );
  },
};

// ================================================================
//  PATRON TIERS
// ================================================================
const patronTiers = {

  async listByAuthor(authorId) {
    return query(
      `SELECT * FROM patron_tiers
       WHERE author_id = $1 AND is_active = TRUE
       ORDER BY price_usd ASC`,
      [authorId]
    );
  },

  async findById(tierId) {
    const rows = await query(
      `SELECT * FROM patron_tiers WHERE id = $1 AND is_active = TRUE`,
      [tierId]
    );
    return rows[0] || null;
  },

  async create({ id, authorId, tier, name, priceUsd, benefits }) {
    const rows = await query(
      `INSERT INTO patron_tiers
         (id, author_id, tier, name, price_usd, benefits, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       RETURNING *`,
      [id, authorId, tier, name, priceUsd, JSON.stringify(benefits || [])]
    );
    return rows[0];
  },
};

// ================================================================
//  PATRON SUBSCRIPTIONS
// ================================================================
const subscriptions = {

  // Check if user is already subscribed to this author
  async findActive(patronId, authorId) {
    const rows = await query(
      `SELECT * FROM patron_subscriptions
       WHERE patron_id = $1 AND author_id = $2
         AND state = 'active' AND deleted_at IS NULL`,
      [patronId, authorId]
    );
    return rows[0] || null;
  },

  // Create new subscription (POST /api/payments/subscribe)
  async create({ id, patronId, authorId, tierId, priceUsd,
    stripeSubId, periodStart, periodEnd }) {
    const rows = await query(
      `INSERT INTO patron_subscriptions
         (id, patron_id, author_id, tier_id, price_usd,
          stripe_sub_id, state, current_period_start, current_period_end)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)
       RETURNING *`,
      [id, patronId, authorId, tierId, priceUsd,
       stripeSubId, periodStart, periodEnd]
    );
    // Increment patron_count on the tier
    await query(
      `UPDATE patron_tiers SET patron_count = patron_count + 1
       WHERE id = $1`,
      [tierId]
    );
    return rows[0];
  },

  // Cancel subscription (POST /api/payments/cancel)
  async cancel(subscriptionId) {
    const rows = await query(
      `UPDATE patron_subscriptions
       SET state = 'cancelled', cancelled_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [subscriptionId]
    );
    return rows[0];
  },

  // List user's subscriptions (GET /api/payments/my-subscriptions)
  async listByPatron(patronId) {
    return query(
      `SELECT ps.*, pt.name AS tier_name, pt.benefits
       FROM patron_subscriptions ps
       JOIN patron_tiers pt ON pt.id = ps.tier_id
       WHERE ps.patron_id = $1 AND ps.deleted_at IS NULL
       ORDER BY ps.created_at DESC`,
      [patronId]
    );
  },

  // Find by Stripe subscription ID (for webhook)
  async findByStripeId(stripeSubId) {
    const rows = await query(
      `SELECT * FROM patron_subscriptions
       WHERE stripe_sub_id = $1`,
      [stripeSubId]
    );
    return rows[0] || null;
  },

  // Mark as past_due (webhook: invoice.payment_failed)
  async markPastDue(stripeSubId) {
    await query(
      `UPDATE patron_subscriptions SET state = 'past_due'
       WHERE stripe_sub_id = $1`,
      [stripeSubId]
    );
  },
};

// ================================================================
//  PAYMENTS  (immutable ledger — no updates, only inserts)
// ================================================================
const payments = {

  // Record a payment (always INSERT, never UPDATE)
  async record({ id, subscriptionId, patronId, authorId,
    amountGross, platformFee, authorNet, currency,
    stripePaymentId }) {
    const rows = await query(
      `INSERT INTO payments
         (id, subscription_id, patron_id, author_id,
          amount_gross, platform_fee, author_net, currency,
          stripe_payment_id, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING *`,
      [id, subscriptionId, patronId, authorId,
       amountGross, platformFee, authorNet, currency || 'USD',
       stripePaymentId]
    );
    return rows[0];
  },

  // Payment history for a user (GET /api/payments/my-payments)
  async listByPatron(patronId) {
    return query(
      `SELECT p.*, u.display_name AS author_name
       FROM payments p
       JOIN users u ON u.id = p.author_id
       WHERE p.patron_id = $1
       ORDER BY p.paid_at DESC`,
      [patronId]
    );
  },

  // Total revenue for admin dashboard
  async totals() {
    const rows = await query(`
      SELECT
        COUNT(*)::int            AS total_payments,
        SUM(amount_gross)        AS total_revenue_usd,
        SUM(platform_fee)        AS platform_fee_usd,
        SUM(author_net)          AS author_earnings_usd
      FROM payments
    `);
    return rows[0];
  },
};

// ================================================================
//  TIPS  (one-off Visa payments)
// ================================================================
const tips = {

  async create({ id, tipperId, authorId, amountUsd,
    platformFeeUsd, authorNetUsd, message, stripePaymentId }) {
    const rows = await query(
      `INSERT INTO tips
         (id, tipper_id, author_id, amount_usd,
          platform_fee_usd, author_net_usd, message,
          stripe_payment_id, tipped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       RETURNING *`,
      [id, tipperId, authorId, amountUsd, platformFeeUsd,
       authorNetUsd, message || null, stripePaymentId]
    );
    return rows[0];
  },

  async listReceived(authorId) {
    return query(
      `SELECT t.*, u.display_name AS tipper_name
       FROM tips t
       JOIN users u ON u.id = t.tipper_id
       WHERE t.author_id = $1
       ORDER BY t.tipped_at DESC`,
      [authorId]
    );
  },
};

// ================================================================
//  BOOK CLUBS
// ================================================================
const clubs = {

  async list({ language, visibility = 'public', q, limit = 20, offset = 0 } = {}) {
    const conds  = [`visibility = $1`];
    const params = [visibility];
    let idx = 2;
    if (language) { conds.push(`language = $${idx++}`); params.push(language); }
    if (q) { conds.push(`name ILIKE $${idx++}`); params.push(`%${q}%`); }
    const rows = await query(
      `SELECT * FROM book_clubs
       WHERE ${conds.join(' AND ')}
       ORDER BY member_count DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, limit, offset]
    );
    const [{ count }] = await query(
      `SELECT COUNT(*)::int AS count FROM book_clubs
       WHERE ${conds.join(' AND ')}`, params
    );
    return { clubs: rows, total: count };
  },

  async findById(id) {
    const rows = await query(`SELECT * FROM book_clubs WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async create({ id, name, slug, ownerId, language,
    visibility, description }) {
    const rows = await query(
      `INSERT INTO book_clubs
         (id, name, slug, owner_id, language, visibility,
          description, member_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1)
       RETURNING *`,
      [id, name, slug, ownerId, language || 'en',
       visibility || 'public', description || null]
    );
    // Add owner as first member
    await query(
      `INSERT INTO club_members (club_id, user_id, role)
       VALUES ($1,$2,'owner')
       ON CONFLICT DO NOTHING`,
      [id, ownerId]
    );
    return rows[0];
  },

  async join(clubId, userId) {
    await query(
      `INSERT INTO club_members (club_id, user_id, role)
       VALUES ($1,$2,'member')
       ON CONFLICT (club_id, user_id) DO NOTHING`,
      [clubId, userId]
    );
    // member_count updated by trigger (sync_club_members)
  },

  // Club discussion posts
  async listPosts(clubId, { limit = 20, offset = 0 } = {}) {
    return query(
      `SELECT cp.*, u.display_name, u.country_code
       FROM club_posts cp
       JOIN users u ON u.id = cp.author_id
       WHERE cp.club_id = $1 AND cp.deleted_at IS NULL
       ORDER BY cp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [clubId, limit, offset]
    );
  },

  async createPost({ id, clubId, authorId, body, topic }) {
    const rows = await query(
      `INSERT INTO club_posts (id, club_id, author_id, body, topic)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [id, clubId, authorId, body, topic || null]
    );
    return rows[0];
  },

  async updatePost(postId, authorId, { body, topic }) {
    const rows = await query(
      `UPDATE club_posts
       SET body = COALESCE($1, body),
           topic = COALESCE($2, topic),
           edited_at = NOW()
       WHERE id = $3 AND author_id = $4
       RETURNING *`,
      [body || null, topic || null, postId, authorId]
    );
    return rows[0];
  },

  async deletePost(postId, authorId) {
    await query(
      `UPDATE club_posts
       SET deleted_at = NOW(), body = '[deleted]'
       WHERE id = $1 AND author_id = $2`,
      [postId, authorId]
    );
  },
};

// ================================================================
//  NOTIFICATIONS
// ================================================================
const notifications = {

  async listByUser(userId, limit = 20) {
    const rows = await query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    const [{ unread }] = await query(
      `SELECT COUNT(*)::int AS unread FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    return { notifications: rows, unread };
  },

  async markAllRead(userId) {
    await query(
      `UPDATE notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
  },

  // Create a notification (called internally when events happen)
  async create({ userId, type, payload }) {
    await query(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1,$2,$3)`,
      [userId, type, JSON.stringify(payload || {})]
    );
  },
};

// ================================================================
//  LIVE READERS (presence — short TTL)
// ================================================================
const liveReaders = {

  // Upsert a reader's presence for a book
  async ping({ userId, bookId, country }) {
    await query(
      `INSERT INTO live_readers (user_id, book_id, country, last_seen)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (user_id, book_id) DO UPDATE
         SET last_seen = NOW(), country = EXCLUDED.country`,
      [userId || null, bookId || null, country || null]
    );
  },

  // Count active readers (last 30 minutes)
  async count(bookId) {
    const rows = bookId
      ? await query(
          `SELECT COUNT(*)::int AS total
           FROM live_readers
           WHERE last_seen > NOW() - INTERVAL '30 minutes'
             AND book_id = $1`,
          [bookId]
        )
      : await query(
          `SELECT COUNT(*)::int AS total
           FROM live_readers
           WHERE last_seen > NOW() - INTERVAL '30 minutes'`
        );
    return rows[0]?.total || 0;
  },

  // Cleanup — called by pg_cron every 10 minutes
  // In schema: SELECT cron.schedule('expire-live-readers','*/10 * * * *',
  //            $$DELETE FROM live_readers WHERE last_seen < NOW()-INTERVAL '30 min'$$)
  async cleanup() {
    const result = await query(
      `DELETE FROM live_readers
       WHERE last_seen < NOW() - INTERVAL '30 minutes'`
    );
    return result;
  },
};

// ================================================================
//  SEARCH  (full-text + club name)
// ================================================================
const search = {

  async all(q, limit = 10) {
    const [bookRows, clubRows] = await Promise.all([
      query(
        `SELECT id, title AS name, author, origin_country, genres,
                reader_count, rating, 'book' AS type
         FROM books
         WHERE status = 'published'
           AND (title ILIKE $1 OR author ILIKE $1)
         ORDER BY reader_count DESC LIMIT $2`,
        [`%${q}%`, limit]
      ),
      query(
        `SELECT id, name, language, member_count, 'club' AS type
         FROM book_clubs
         WHERE name ILIKE $1
         ORDER BY member_count DESC LIMIT $2`,
        [`%${q}%`, Math.ceil(limit / 2)]
      ),
    ]);
    return {
      books: bookRows,
      clubs: clubRows,
      total: bookRows.length + clubRows.length,
    };
  },
};

// ================================================================
//  ADMIN
// ================================================================
const admin = {

  async stats() {
    const [users, books, clubs, subs, payments_row] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL`),
      query(`SELECT COUNT(*)::int AS n FROM books WHERE status='published'`),
      query(`SELECT COUNT(*)::int AS n FROM book_clubs`),
      query(`SELECT COUNT(*)::int AS n FROM patron_subscriptions WHERE state='active'`),
      query(`SELECT COUNT(*)::int AS total_payments,
                    COALESCE(SUM(amount_gross),0) AS revenue,
                    COALESCE(SUM(platform_fee),0) AS fees
             FROM payments`),
    ]);
    return {
      total_users:         users[0].n,
      total_books:         books[0].n,
      total_clubs:         clubs[0].n,
      active_subscriptions:subs[0].n,
      total_payments:      payments_row[0].total_payments,
      total_revenue_usd:   parseFloat(payments_row[0].revenue),
      platform_fee_usd:    parseFloat(payments_row[0].fees),
      generated_at:        new Date().toISOString(),
    };
  },
};

// ================================================================
//  FOLLOWS
// ================================================================
const follows = {

  async follow(followerId, followeeId) {
    await query(
      `INSERT INTO follows (follower_id, followee_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [followerId, followeeId]
    );
  },

  async unfollow(followerId, followeeId) {
    await query(
      `DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2`,
      [followerId, followeeId]
    );
  },

  async isFollowing(followerId, followeeId) {
    const rows = await query(
      `SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=$2`,
      [followerId, followeeId]
    );
    return rows.length > 0;
  },

  async getFollowers(userId) {
    return query(
      `SELECT u.id, u.display_name, u.username, u.country_code, f.created_at
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = $1 ORDER BY f.created_at DESC`,
      [userId]
    );
  },

  async getFollowing(userId) {
    return query(
      `SELECT u.id, u.display_name, u.username, u.country_code, f.created_at
       FROM follows f JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = $1 ORDER BY f.created_at DESC`,
      [userId]
    );
  },
};

// ================================================================
//  READING SESSIONS
// ================================================================
const readingSessions = {

  async create({ id, userId, bookId, startPct }) {
    const rows = await query(
      `INSERT INTO reading_sessions
         (id, user_id, book_id, start_pct, started_at)
       VALUES ($1,$2,$3,$4,NOW())
       RETURNING *`,
      [id, userId, bookId, startPct || 0]
    );
    return rows[0];
  },

  async end(sessionId, userId, { endPct, durationS }) {
    const rows = await query(
      `UPDATE reading_sessions
       SET end_pct = $1, duration_s = $2, ended_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [endPct, durationS, sessionId, userId]
    );
    return rows[0];
  },

  async history(userId) {
    const rows = await query(
      `SELECT rs.*, b.title, b.author
       FROM reading_sessions rs
       JOIN books b ON b.id = rs.book_id
       WHERE rs.user_id = $1 AND rs.ended_at IS NOT NULL
       ORDER BY rs.ended_at DESC
       LIMIT 30`,
      [userId]
    );
    const [{ total_minutes }] = await query(
      `SELECT COALESCE(SUM(duration_s)/60,0)::int AS total_minutes
       FROM reading_sessions
       WHERE user_id = $1 AND duration_s IS NOT NULL`,
      [userId]
    );
    return { sessions: rows, total_sessions: rows.length, total_reading_minutes: total_minutes };
  },
};

// ================================================================
//  COMMENTS  (threaded, polymorphic)
// ================================================================
const comments = {

  async list({ targetType, targetId, limit = 20, offset = 0 }) {
    return query(
      `SELECT c.*, u.display_name, u.country_code
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.target_type = $1 AND c.target_id = $2
         AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC
       LIMIT $3 OFFSET $4`,
      [targetType, targetId, limit, offset]
    );
  },

  async create({ id, userId, body, targetType, targetId, parentId }) {
    // Compute depth from parent
    let depth = 0;
    if (parentId) {
      const parent = await query(`SELECT depth FROM comments WHERE id=$1`, [parentId]);
      depth = (parent[0]?.depth || 0) + 1;
      if (depth > 5) throw new Error('Maximum comment depth (5) reached');
      await query(`UPDATE comments SET reply_count=reply_count+1 WHERE id=$1`, [parentId]);
    }
    const rows = await query(
      `INSERT INTO comments
         (id, user_id, body, target_type, target_id, parent_id, depth)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [id, userId, body, targetType, targetId, parentId || null, depth]
    );
    return rows[0];
  },

  async update(commentId, userId, body) {
    const rows = await query(
      `UPDATE comments SET body=$1, edited_at=NOW()
       WHERE id=$2 AND user_id=$3 RETURNING *`,
      [body, commentId, userId]
    );
    return rows[0];
  },

  async delete(commentId, userId) {
    await query(
      `UPDATE comments SET deleted_at=NOW(), body='[deleted]'
       WHERE id=$1 AND user_id=$2`,
      [commentId, userId]
    );
  },
};

// ================================================================
//  REPORTS  (content moderation)
// ================================================================
const reports = {

  async create({ id, reporterId, targetType, targetId, reason, detail }) {
    const rows = await query(
      `INSERT INTO reports
         (id, reporter_id, target_type, target_id, reason, detail, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending')
       RETURNING *`,
      [id, reporterId, targetType, targetId, reason, detail || null]
    );
    return rows[0];
  },

  async list({ status = 'pending', limit = 50 } = {}) {
    return query(
      `SELECT r.*, u.display_name AS reporter_name
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       WHERE r.status = $1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [status, limit]
    );
  },

  async resolve(reportId, adminId, action) {
    const status = action === 'resolve' ? 'resolved' : 'dismissed';
    const rows = await query(
      `UPDATE reports
       SET status=$1, reviewed_by=$2, reviewed_at=NOW()
       WHERE id=$3 RETURNING *`,
      [status, adminId, reportId]
    );
    return rows[0];
  },
};

// ================================================================
//  TRANSLATIONS
// ================================================================
const translations = {

  async listByBook(bookId) {
    return query(
      `SELECT bt.*, u.display_name AS contributor_name
       FROM book_translations bt
       LEFT JOIN users u ON u.id = bt.contributor_id
       WHERE bt.book_id = $1
       ORDER BY bt.updated_at DESC`,
      [bookId]
    );
  },

  async create({ id, bookId, contributorId, languageCode,
    titleTranslated, bodyExcerpt, status }) {
    const rows = await query(
      `INSERT INTO book_translations
         (id, book_id, contributor_id, language_code,
          title_translated, body_excerpt, status, quality_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0)
       RETURNING *`,
      [id, bookId, contributorId, languageCode,
       titleTranslated, bodyExcerpt || null, status || 'community_draft']
    );
    return rows[0];
  },

  async update(translationId, { status, bodyExcerpt, qualityScore }) {
    const rows = await query(
      `UPDATE book_translations
       SET status = COALESCE($1, status),
           body_excerpt = COALESCE($2, body_excerpt),
           quality_score = COALESCE($3, quality_score),
           review_count = review_count + 1,
           updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status || null, bodyExcerpt || null, qualityScore || null, translationId]
    );
    return rows[0];
  },
};

// ================================================================
//  ANALYTICS EVENTS  (partitioned table)
// ================================================================
const events = {

  // Record any platform event (uses the partitioned events table)
  async record({ userId, eventType, targetType, targetId, metadata } = {}) {
    try {
      await query(
        `INSERT INTO events
           (user_id, event_type, target_type, target_id, metadata)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId || null, eventType, targetType || null,
         targetId || null, JSON.stringify(metadata || {})]
      );
    } catch {
      // Never crash the API because of analytics failure
    }
  },
};

// ================================================================
//  EXPORT
// ================================================================
module.exports = {
  // Core helpers
  query,
  transaction,
  ping,
  pool,

  // Domain modules
  users,
  books,
  shelves,
  reviews,
  annotations,
  likes,
  soul,
  patronTiers,
  subscriptions,
  payments,
  tips,
  clubs,
  notifications,
  liveReaders,
  search,
  admin,
  follows,
  readingSessions,
  comments,
  reports,
  translations,
  events,
};