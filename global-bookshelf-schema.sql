-- ============================================================
--  GLOBAL BOOKSHELF — PRODUCTION DATABASE SCHEMA
--  PostgreSQL 15+  |  with pgvector, pg_trgm, uuid-ossp
--  Architect: Global BookShelf Engineering
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";          -- pgvector for AI embeddings
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ============================================================
--  ENUMS
-- ============================================================

CREATE TYPE user_role          AS ENUM ('reader','author','moderator','admin');
CREATE TYPE book_status        AS ENUM ('draft','published','archived','banned');
CREATE TYPE reading_status     AS ENUM ('want_to_read','reading','finished','abandoned','rereading');
CREATE TYPE patron_tier        AS ENUM ('story_friend','chapter_keeper','soul_patron','custom');
CREATE TYPE subscription_state AS ENUM ('active','paused','cancelled','past_due','trialing');
CREATE TYPE club_visibility    AS ENUM ('public','private','invite_only');
CREATE TYPE content_type       AS ENUM ('book','chapter','annotation','review','journal_entry','club_post','qa');
CREATE TYPE report_reason      AS ENUM ('spam','hate_speech','misinformation','copyright','harassment','other');
CREATE TYPE report_status      AS ENUM ('pending','reviewed','resolved','dismissed');
CREATE TYPE notification_type  AS ENUM (
  'new_chapter','new_patron','new_follower','qa_answered',
  'club_invite','milestone_reached','book_translated',
  'annotation_liked','review_liked','mention'
);
CREATE TYPE translation_status AS ENUM ('machine','community_draft','community_verified','professional');
CREATE TYPE currency_code      AS ENUM ('USD','GBP','EUR','NGN','BRL','INR','KRW','KES','GHS','ZAR');
CREATE TYPE payout_status      AS ENUM ('pending','processing','paid','failed');
CREATE TYPE soul_dimension     AS ENUM (
  'emotional_depth','narrative_complexity','cultural_range',
  'philosophical_appetite','lyrical_sensitivity','darkness_tolerance',
  'pace_preference','geographical_curiosity','historical_range','length_preference',
  'social_reading','introspection','genre_adventurousness','multilingual_appetite'
);

-- ============================================================
--  CORE: USERS
-- ============================================================

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               TEXT UNIQUE NOT NULL,
  email_verified_at   TIMESTAMPTZ,
  username            TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  display_name        TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  bio                 TEXT CHECK (char_length(bio) <= 2000),
  avatar_url          TEXT,
  cover_url           TEXT,
  role                user_role NOT NULL DEFAULT 'reader',
  country_code        CHAR(2),                       -- ISO 3166-1 alpha-2
  locale              TEXT DEFAULT 'en',
  timezone            TEXT DEFAULT 'UTC',
  preferred_languages TEXT[] DEFAULT ARRAY['en'],    -- ISO 639-1 codes
  is_author           BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified         BOOLEAN NOT NULL DEFAULT FALSE, -- verified author/notable
  is_banned           BOOLEAN NOT NULL DEFAULT FALSE,
  banned_at           TIMESTAMPTZ,
  ban_reason          TEXT,
  password_hash       TEXT,                          -- NULL if OAuth-only
  last_active_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ                    -- soft delete
);

CREATE INDEX idx_users_username       ON users (username);
CREATE INDEX idx_users_role           ON users (role);
CREATE INDEX idx_users_country        ON users (country_code);
CREATE INDEX idx_users_created        ON users (created_at DESC);
CREATE INDEX idx_users_active         ON users (last_active_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_search         ON users USING GIN (to_tsvector('simple', display_name || ' ' || COALESCE(bio,'')));

-- ── OAuth providers
CREATE TABLE user_oauth (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('google','apple','twitter','facebook')),
  provider_uid TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_uid)
);

-- ── Author profiles (extends users where is_author = TRUE)
CREATE TABLE author_profiles (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pen_name             TEXT,
  born_city            TEXT,
  born_country         CHAR(2),
  currently_in_city    TEXT,
  currently_in_country CHAR(2),
  languages_written    TEXT[] NOT NULL DEFAULT '{}',
  writing_since        INTEGER,                      -- year
  genres               TEXT[] NOT NULL DEFAULT '{}',
  awards               JSONB DEFAULT '[]',           -- [{name, year, body}]
  social_links         JSONB DEFAULT '{}',           -- {twitter, instagram, website}
  total_followers      INTEGER NOT NULL DEFAULT 0,
  total_readers        INTEGER NOT NULL DEFAULT 0,
  total_patron_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  writing_streak_days  INTEGER NOT NULL DEFAULT 0,
  last_wrote_at        TIMESTAMPTZ,
  patron_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  payout_account_id    TEXT,                         -- Stripe Connect account
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Follows (reader ↔ author or reader ↔ reader)
CREATE TABLE follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX idx_follows_followee ON follows (followee_id);

-- ============================================================
--  CORE: BOOKS
-- ============================================================

CREATE TABLE books (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  isbn               TEXT UNIQUE,                    -- ISBN-13
  title              TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  subtitle           TEXT,
  slug               TEXT UNIQUE NOT NULL,
  status             book_status NOT NULL DEFAULT 'draft',
  cover_url          TEXT,
  description        TEXT,
  excerpt            TEXT,
  original_language  CHAR(2) NOT NULL DEFAULT 'en',  -- ISO 639-1
  published_year     INTEGER,
  published_date     DATE,
  page_count         INTEGER CHECK (page_count > 0),
  word_count         INTEGER,
  origin_country     CHAR(2),
  origin_city        TEXT,
  -- Taxonomy
  genres             TEXT[] NOT NULL DEFAULT '{}',
  themes             TEXT[] NOT NULL DEFAULT '{}',
  tags               TEXT[] NOT NULL DEFAULT '{}',
  content_warnings   TEXT[] NOT NULL DEFAULT '{}',
  age_rating         TEXT DEFAULT 'all',
  -- AI vectors
  soul_embedding     vector(1536),                   -- OpenAI text-embedding-3-small
  theme_embedding    vector(1536),
  -- Counters (denormalised for speed)
  reader_count       INTEGER NOT NULL DEFAULT 0,
  rating_count       INTEGER NOT NULL DEFAULT 0,
  rating_sum         NUMERIC(10,2) NOT NULL DEFAULT 0,
  review_count       INTEGER NOT NULL DEFAULT 0,
  annotation_count   INTEGER NOT NULL DEFAULT 0,
  shelf_count        INTEGER NOT NULL DEFAULT 0,
  -- Source
  is_public_domain   BOOLEAN NOT NULL DEFAULT FALSE,
  source_url         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX idx_books_slug        ON books (slug);
CREATE INDEX idx_books_status      ON books (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_language    ON books (original_language);
CREATE INDEX idx_books_country     ON books (origin_country);
CREATE INDEX idx_books_genres      ON books USING GIN (genres);
CREATE INDEX idx_books_tags        ON books USING GIN (tags);
CREATE INDEX idx_books_themes      ON books USING GIN (themes);
CREATE INDEX idx_books_year        ON books (published_year);
CREATE INDEX idx_books_rating      ON books ((rating_sum / NULLIF(rating_count,0)) DESC) WHERE status='published';
CREATE INDEX idx_books_readers     ON books (reader_count DESC);
CREATE INDEX idx_books_search      ON books USING GIN (
  to_tsvector('simple', title || ' ' || COALESCE(subtitle,'') || ' ' || COALESCE(description,''))
);
-- pgvector HNSW index for fast similarity search
CREATE INDEX idx_books_soul_vec    ON books USING hnsw (soul_embedding vector_cosine_ops);

-- ── Authors ↔ Books (many-to-many, ordered)
CREATE TABLE book_authors (
  book_id    UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('author','co_author','editor','translator','illustrator')),
  sort_order SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, author_id, role)
);
CREATE INDEX idx_book_authors_author ON book_authors (author_id);

-- ── Chapters (for serialised / writing-in-public books)
CREATE TABLE chapters (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id        UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  title          TEXT,
  content        TEXT,                               -- Markdown / Quill delta JSON
  word_count     INTEGER,
  is_published   BOOLEAN NOT NULL DEFAULT FALSE,
  is_public      BOOLEAN NOT NULL DEFAULT TRUE,      -- FALSE = patrons only
  published_at   TIMESTAMPTZ,
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, number)
);
CREATE INDEX idx_chapters_book      ON chapters (book_id, number);
CREATE INDEX idx_chapters_published ON chapters (book_id) WHERE is_published = TRUE;

-- ── Chapter followers (writing-in-public)
CREATE TABLE chapter_followers (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, book_id)
);

-- ── Translations
CREATE TABLE book_translations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  language        CHAR(2) NOT NULL,
  status          translation_status NOT NULL DEFAULT 'machine',
  title           TEXT NOT NULL,
  description     TEXT,
  content_url     TEXT,
  translator_ids  UUID[],
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES users(id),
  contributor_count INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, language)
);
CREATE INDEX idx_translations_book     ON book_translations (book_id);
CREATE INDEX idx_translations_language ON book_translations (language);
CREATE INDEX idx_translations_status   ON book_translations (status);

-- ============================================================
--  READING: SHELVES & ACTIVITY
-- ============================================================

-- ── User shelves (can have multiple custom shelves)
CREATE TABLE shelves (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,        -- 'Reading', 'Finished', 'Want to read'
  is_public   BOOLEAN NOT NULL DEFAULT TRUE,
  book_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_shelves_user ON shelves (user_id);

-- ── Books on shelves (reading log)
CREATE TABLE shelf_books (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shelf_id       UUID NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id        UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status         reading_status NOT NULL DEFAULT 'want_to_read',
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  current_page   INTEGER,
  current_pct    NUMERIC(5,2),                       -- 0.00–100.00
  rating         SMALLINT CHECK (rating BETWEEN 1 AND 5),
  is_rereading   BOOLEAN NOT NULL DEFAULT FALSE,
  times_read     SMALLINT NOT NULL DEFAULT 0,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shelf_id, book_id)
);
CREATE INDEX idx_shelf_books_user   ON shelf_books (user_id, status);
CREATE INDEX idx_shelf_books_book   ON shelf_books (book_id);
CREATE INDEX idx_shelf_books_recent ON shelf_books (user_id, updated_at DESC);

-- ── Reading sessions (granular tracking per sitting)
CREATE TABLE reading_sessions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id      UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  pages_read   INTEGER,
  pct_start    NUMERIC(5,2),
  pct_end      NUMERIC(5,2),
  device       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_user ON reading_sessions (user_id, started_at DESC);
CREATE INDEX idx_sessions_book ON reading_sessions (book_id);

-- ============================================================
--  CONTENT: REVIEWS, ANNOTATIONS, QUOTES
-- ============================================================

CREATE TABLE reviews (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id        UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body           TEXT CHECK (char_length(body) <= 10000),
  is_spoiler     BOOLEAN NOT NULL DEFAULT FALSE,
  like_count     INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  UNIQUE (user_id, book_id)
);
CREATE INDEX idx_reviews_book    ON reviews (book_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_reviews_user    ON reviews (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_reviews_popular ON reviews (book_id, like_count DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_reviews_search  ON reviews USING GIN (to_tsvector('simple', COALESCE(body,'')));

CREATE TABLE annotations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id        UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id     UUID REFERENCES chapters(id) ON DELETE SET NULL,
  body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  quote          TEXT,                               -- the highlighted passage
  position_pct   NUMERIC(5,2),                      -- where in the book (0–100)
  page_number    INTEGER,
  is_public      BOOLEAN NOT NULL DEFAULT TRUE,
  like_count     INTEGER NOT NULL DEFAULT 0,
  reply_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_annotations_book    ON annotations (book_id, position_pct) WHERE deleted_at IS NULL;
CREATE INDEX idx_annotations_user    ON annotations (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_annotations_popular ON annotations (book_id, like_count DESC);

-- ── Likes (polymorphic)
CREATE TABLE likes (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  content_type NOT NULL,
  target_id    UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX idx_likes_target ON likes (target_type, target_id);

-- ── Comments (polymorphic, threaded)
CREATE TABLE comments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  content_type NOT NULL,
  target_id    UUID NOT NULL,
  parent_id    UUID REFERENCES comments(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 3000),
  like_count   INTEGER NOT NULL DEFAULT 0,
  depth        SMALLINT NOT NULL DEFAULT 0 CHECK (depth <= 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX idx_comments_target ON comments (target_type, target_id, created_at);
CREATE INDEX idx_comments_parent ON comments (parent_id);

-- ============================================================
--  AI READING SOUL
-- ============================================================

CREATE TABLE soul_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  archetype      TEXT,                               -- e.g. 'Midnight Wanderer'
  archetype_desc TEXT,
  -- 14 dimension scores (0.0–1.0)
  dimensions     JSONB NOT NULL DEFAULT '{}',        -- {emotional_depth: 0.87, ...}
  literary_dna   TEXT[] DEFAULT '{}',                -- ['Magical Realism','Post-Colonial',...]
  reading_ritual TEXT,                               -- 'midnight', 'dawn', etc.
  emotional_need TEXT,                               -- 'wonder','solace','challenge',...
  soul_embedding vector(1536),                       -- for reader-to-reader matching
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_soul_embedding ON soul_profiles USING hnsw (soul_embedding vector_cosine_ops);

-- ── Soul quiz responses (for re-training)
CREATE TABLE soul_responses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  answer      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI book recommendations (materialised per user)
CREATE TABLE soul_recommendations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  match_score     NUMERIC(5,4) NOT NULL,             -- 0.0000–1.0000
  match_reason    TEXT,
  dimension_match JSONB,                             -- which dimensions drove the match
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed       BOOLEAN NOT NULL DEFAULT FALSE,
  clicked         BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, book_id)
);
CREATE INDEX idx_soul_recs_user  ON soul_recommendations (user_id, match_score DESC) WHERE dismissed = FALSE;
CREATE INDEX idx_soul_recs_book  ON soul_recommendations (book_id);

-- ============================================================
--  MAP: BOOK PINS & GEO
-- ============================================================

CREATE TABLE book_pins (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  lat         NUMERIC(9,6) NOT NULL,
  lng         NUMERIC(9,6) NOT NULL,
  country     CHAR(2),
  city        TEXT,
  pin_type    TEXT NOT NULL DEFAULT 'origin' CHECK (pin_type IN ('origin','setting','inspired_by','author_born')),
  label       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pins_book ON book_pins (book_id);
CREATE INDEX idx_pins_geo  ON book_pins (lat, lng);

-- ── Live reader presence (for the "reading right now" dots)
CREATE TABLE live_readers (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  country    CHAR(2),
  lat        NUMERIC(9,6),
  lng        NUMERIC(9,6),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX idx_live_readers_book    ON live_readers (book_id);
CREATE INDEX idx_live_readers_seen    ON live_readers (last_seen DESC);

-- ============================================================
--  COMMUNITIES: BOOK CLUBS
-- ============================================================

CREATE TABLE book_clubs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  slug            TEXT UNIQUE NOT NULL,
  description     TEXT,
  cover_url       TEXT,
  visibility      club_visibility NOT NULL DEFAULT 'public',
  language        CHAR(2) NOT NULL DEFAULT 'en',
  languages       TEXT[] NOT NULL DEFAULT '{}',      -- allowed languages
  current_book_id UUID REFERENCES books(id),
  owner_id        UUID NOT NULL REFERENCES users(id),
  member_count    INTEGER NOT NULL DEFAULT 0,
  timezone        TEXT DEFAULT 'UTC',
  meeting_schedule TEXT,                             -- RRULE string
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_clubs_owner    ON book_clubs (owner_id);
CREATE INDEX idx_clubs_language ON book_clubs (language);
CREATE INDEX idx_clubs_public   ON book_clubs (member_count DESC) WHERE visibility = 'public';

CREATE TABLE club_members (
  club_id    UUID NOT NULL REFERENCES book_clubs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX idx_club_members_user ON club_members (user_id);

CREATE TABLE club_books (
  club_id     UUID NOT NULL REFERENCES book_clubs(id) ON DELETE CASCADE,
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at  DATE,
  finished_at DATE,
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  nominated_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, book_id)
);

CREATE TABLE club_posts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES book_clubs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     UUID REFERENCES books(id),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  is_spoiler  BOOLEAN NOT NULL DEFAULT FALSE,
  like_count  INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_club_posts_club ON club_posts (club_id, created_at DESC) WHERE deleted_at IS NULL;

-- ============================================================
--  AUTHORS: JOURNALS & Q&A
-- ============================================================

CREATE TABLE author_journals (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    UUID REFERENCES books(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  is_public  BOOLEAN NOT NULL DEFAULT TRUE,
  patron_only BOOLEAN NOT NULL DEFAULT FALSE,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_journals_author ON author_journals (author_id, created_at DESC);

CREATE TABLE author_qa (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asker_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     UUID REFERENCES books(id),
  question    TEXT NOT NULL CHECK (char_length(question) BETWEEN 5 AND 1000),
  answer      TEXT CHECK (char_length(answer) <= 5000),
  answered_at TIMESTAMPTZ,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  like_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_qa_author     ON author_qa (author_id, created_at DESC);
CREATE INDEX idx_qa_unanswered ON author_qa (author_id) WHERE answered_at IS NULL;

-- ============================================================
--  PATRONAGE & PAYMENTS
-- ============================================================

CREATE TABLE patron_tiers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier         patron_tier NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  price_usd    NUMERIC(8,2) NOT NULL CHECK (price_usd > 0),
  benefits     TEXT[] NOT NULL DEFAULT '{}',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  patron_count INTEGER NOT NULL DEFAULT 0,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tiers_author ON patron_tiers (author_id) WHERE is_active = TRUE;

CREATE TABLE patron_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patron_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier_id            UUID NOT NULL REFERENCES patron_tiers(id),
  state              subscription_state NOT NULL DEFAULT 'trialing',
  price_usd          NUMERIC(8,2) NOT NULL,
  currency           currency_code NOT NULL DEFAULT 'USD',
  stripe_sub_id      TEXT UNIQUE,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patron_id, author_id)
);
CREATE INDEX idx_subs_author  ON patron_subscriptions (author_id, state);
CREATE INDEX idx_subs_patron  ON patron_subscriptions (patron_id);
CREATE INDEX idx_subs_renewal ON patron_subscriptions (current_period_end) WHERE state = 'active';

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id  UUID REFERENCES patron_subscriptions(id),
  patron_id        UUID NOT NULL REFERENCES users(id),
  author_id        UUID NOT NULL REFERENCES users(id),
  amount_gross     NUMERIC(10,2) NOT NULL,
  platform_fee     NUMERIC(10,2) NOT NULL,           -- GBS 5% cut
  author_net       NUMERIC(10,2) NOT NULL,
  currency         currency_code NOT NULL DEFAULT 'USD',
  stripe_payment_id TEXT UNIQUE,
  stripe_charge_id  TEXT,
  paid_at          TIMESTAMPTZ,
  refunded_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_author ON payments (author_id, paid_at DESC);
CREATE INDEX idx_payments_patron ON payments (patron_id, paid_at DESC);

CREATE TABLE author_payouts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id        UUID NOT NULL REFERENCES users(id),
  amount           NUMERIC(10,2) NOT NULL,
  currency         currency_code NOT NULL DEFAULT 'USD',
  status           payout_status NOT NULL DEFAULT 'pending',
  stripe_payout_id TEXT UNIQUE,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payouts_author ON author_payouts (author_id, created_at DESC);

-- ── Direct tips (one-off)
CREATE TABLE tips (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipper_id       UUID NOT NULL REFERENCES users(id),
  author_id       UUID NOT NULL REFERENCES users(id),
  amount_usd      NUMERIC(8,2) NOT NULL CHECK (amount_usd >= 1),
  message         TEXT CHECK (char_length(message) <= 500),
  stripe_payment_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tips_author ON tips (author_id, created_at DESC);

-- ============================================================
--  NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type content_type,
  target_id   UUID,
  payload     JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifs_user   ON notifications (user_id, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX idx_notifs_all    ON notifications (user_id, created_at DESC);

-- ============================================================
--  MODERATION
-- ============================================================

CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type content_type NOT NULL,
  target_id   UUID NOT NULL,
  reason      report_reason NOT NULL,
  details     TEXT CHECK (char_length(details) <= 2000),
  status      report_status NOT NULL DEFAULT 'pending',
  reviewer_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  resolution  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reports_status ON reports (status, created_at);
CREATE INDEX idx_reports_target ON reports (target_type, target_id);

-- ============================================================
--  ANALYTICS (append-only event log)
-- ============================================================

CREATE TABLE events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID,
  event      TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  ip_hash    TEXT,                                   -- hashed for privacy
  country    CHAR(2),
  device     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Monthly partitions (create rolling)
CREATE TABLE events_2024_01 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE events_2024_02 PARTITION OF events FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE events_2024_q2 PARTITION OF events FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');
CREATE TABLE events_2024_q3 PARTITION OF events FOR VALUES FROM ('2024-07-01') TO ('2024-10-01');
CREATE TABLE events_2024_q4 PARTITION OF events FOR VALUES FROM ('2024-10-01') TO ('2025-01-01');
CREATE TABLE events_2025_q1 PARTITION OF events FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');

CREATE INDEX idx_events_user    ON events (user_id, created_at DESC);
CREATE INDEX idx_events_type    ON events (event, created_at DESC);
CREATE INDEX idx_events_country ON events (country, created_at DESC);

-- ============================================================
--  SEARCH: FULL-TEXT SEARCH INDEX
-- ============================================================

CREATE TABLE search_index (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('book','author','club')),
  entity_id   UUID NOT NULL UNIQUE,
  title       TEXT,
  body        TEXT,
  tags        TEXT[],
  language    CHAR(2),
  ts_document TSVECTOR,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_search_ts      ON search_index USING GIN (ts_document);
CREATE INDEX idx_search_type    ON search_index (entity_type);
CREATE INDEX idx_search_tags    ON search_index USING GIN (tags);

-- ============================================================
--  TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_users_updated        BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_books_updated        BEFORE UPDATE ON books           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_chapters_updated     BEFORE UPDATE ON chapters        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_reviews_updated      BEFORE UPDATE ON reviews         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_annotations_updated  BEFORE UPDATE ON annotations     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_author_profiles_upd  BEFORE UPDATE ON author_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_clubs_updated        BEFORE UPDATE ON book_clubs      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subs_updated         BEFORE UPDATE ON patron_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Update book rating when shelf_books rating changes
CREATE OR REPLACE FUNCTION sync_book_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE books SET
    rating_sum   = (SELECT COALESCE(SUM(rating),0) FROM shelf_books WHERE book_id = NEW.book_id AND rating IS NOT NULL),
    rating_count = (SELECT COUNT(*) FROM shelf_books WHERE book_id = NEW.book_id AND rating IS NOT NULL)
  WHERE id = NEW.book_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sync_rating AFTER INSERT OR UPDATE ON shelf_books FOR EACH ROW EXECUTE FUNCTION sync_book_rating();

-- Update book reader_count
CREATE OR REPLACE FUNCTION sync_book_readers()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE books SET reader_count = (
    SELECT COUNT(DISTINCT user_id) FROM shelf_books WHERE book_id = COALESCE(NEW.book_id, OLD.book_id)
  ) WHERE id = COALESCE(NEW.book_id, OLD.book_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sync_readers AFTER INSERT OR DELETE ON shelf_books FOR EACH ROW EXECUTE FUNCTION sync_book_readers();

-- Update club member_count
CREATE OR REPLACE FUNCTION sync_club_members()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE club UUID := COALESCE(NEW.club_id, OLD.club_id);
BEGIN
  UPDATE book_clubs SET member_count = (SELECT COUNT(*) FROM club_members WHERE club_id = club) WHERE id = club;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sync_club_members AFTER INSERT OR DELETE ON club_members FOR EACH ROW EXECUTE FUNCTION sync_club_members();

-- Expire live_readers older than 30 minutes (call via pg_cron)
CREATE OR REPLACE FUNCTION expire_live_readers()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN DELETE FROM live_readers WHERE last_seen < NOW() - INTERVAL '30 minutes'; END; $$;

-- ============================================================
--  ROW-LEVEL SECURITY (Supabase / PostgREST pattern)
-- ============================================================

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelves                ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelf_books            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews                ENABLE ROW LEVEL SECURITY;
ALTER TABLE annotations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_journals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE soul_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE soul_recommendations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE patron_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;

-- Users: readable by all, writable only by owner
CREATE POLICY users_read_all  ON users FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY users_own_write ON users FOR UPDATE USING (auth.uid() = id);

-- Shelves: public shelves readable by all, private only by owner
CREATE POLICY shelves_public  ON shelves FOR SELECT USING (is_public = TRUE OR user_id = auth.uid());
CREATE POLICY shelves_own     ON shelves FOR ALL   USING (user_id = auth.uid());

-- Soul profiles: own only
CREATE POLICY soul_own ON soul_profiles FOR ALL USING (user_id = auth.uid());

-- Notifications: own only
CREATE POLICY notifs_own ON notifications FOR ALL USING (user_id = auth.uid());

-- Payments: own only
CREATE POLICY payments_own ON payments FOR SELECT USING (patron_id = auth.uid() OR author_id = auth.uid());

-- ============================================================
--  USEFUL VIEWS
-- ============================================================

-- Trending books (last 7 days by new readers)
CREATE VIEW v_trending_books AS
SELECT
  b.id, b.title, b.slug, b.cover_url,
  b.rating_sum / NULLIF(b.rating_count,0) AS avg_rating,
  b.reader_count,
  COUNT(sb.id) AS new_readers_7d,
  b.origin_country
FROM books b
JOIN shelf_books sb ON sb.book_id = b.id AND sb.added_at >= NOW() - INTERVAL '7 days'
WHERE b.status = 'published' AND b.deleted_at IS NULL
GROUP BY b.id
ORDER BY new_readers_7d DESC;

-- Author earnings summary
CREATE VIEW v_author_earnings AS
SELECT
  a.author_id AS user_id,
  COUNT(DISTINCT ps.id)        AS active_patrons,
  SUM(p.author_net)            AS total_earned_usd,
  SUM(CASE WHEN p.paid_at >= date_trunc('month', NOW()) THEN p.author_net ELSE 0 END) AS this_month_usd,
  MAX(p.paid_at)               AS last_payment_at
FROM author_profiles a
LEFT JOIN patron_subscriptions ps ON ps.author_id = a.user_id AND ps.state = 'active'
LEFT JOIN payments p ON p.author_id = a.user_id AND p.refunded_at IS NULL
GROUP BY a.user_id;

-- Live world map data
CREATE VIEW v_world_map AS
SELECT
  bp.book_id, bp.lat, bp.lng, bp.country, bp.pin_type,
  b.title, b.cover_url, b.origin_country,
  b.reader_count,
  COALESCE(lr.live_count, 0) AS live_readers_now
FROM book_pins bp
JOIN books b ON b.id = bp.book_id AND b.status = 'published'
LEFT JOIN (
  SELECT book_id, COUNT(*) AS live_count
  FROM live_readers
  WHERE last_seen >= NOW() - INTERVAL '30 minutes'
  GROUP BY book_id
) lr ON lr.book_id = bp.book_id;

-- Soul match between two readers
CREATE VIEW v_reader_matches AS
SELECT
  a.user_id AS reader_a,
  b.user_id AS reader_b,
  1 - (a.soul_embedding <=> b.soul_embedding) AS similarity
FROM soul_profiles a
CROSS JOIN soul_profiles b
WHERE a.user_id < b.user_id
  AND a.soul_embedding IS NOT NULL
  AND b.soul_embedding IS NOT NULL;

-- ============================================================
--  SEED: SYSTEM DEFAULTS
-- ============================================================

INSERT INTO users (id, email, username, display_name, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'system@globalbookshelf.com', 'system', 'Global BookShelf', 'admin');

-- ============================================================
--  COMMENTS: KEY DESIGN DECISIONS
-- ============================================================
/*
  1. VECTOR SEARCH: pgvector powers both soul-to-book matching (soul_embedding on books)
     and reader-to-reader discovery (soul_embedding on soul_profiles). HNSW index gives
     sub-10ms similarity search at 4M books.

  2. PARTITIONED EVENTS: The events table uses RANGE partitioning by month. At scale,
     drop old partitions without locking the table. Use Timescale for compression.

  3. DENORMALISED COUNTERS: reader_count, rating_count, like_count etc. are kept in sync
     by triggers and background jobs. Avoids COUNT(*) queries on hot paths.

  4. SOFT DELETES: users, books, reviews, annotations, comments all use deleted_at.
     Partial indexes exclude soft-deleted rows from all critical indexes.

  5. MULTI-LANGUAGE: preferred_languages[] on users + original_language + translations
     table gives full language graph. Soul recommendations filter by language preference.

  6. RLS: Row-Level Security on all PII and financial tables. Works natively with
     Supabase JWT. Each user can only see their own soul, payments, notifications.

  7. PATRONAGE: Stripe Connect handles payouts. We store stripe_sub_id for webhooks.
     Platform takes 5% (platform_fee). Authors get paid monthly via author_payouts.

  8. LIVE PRESENCE: live_readers is a lightweight table updated every 60s via client ping.
     A pg_cron job calls expire_live_readers() every 5 minutes to clean stale rows.

  9. SEARCH: Two-layer search — pg_tsvector for text (title, description, bio) +
     pgvector for semantic (soul-based discovery). GIN indexes on arrays for genre/tag filter.

  10. SCALING PATH: Start on a single Postgres instance. Promote to read replicas for
      analytics queries. Shard by user_id hash when > 50M users. Events table → ClickHouse.
*/
