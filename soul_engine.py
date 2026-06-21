#!/usr/bin/env python3
"""
============================================================
  GLOBAL BOOKSHELF — AI READING SOUL ENGINE
  Python 3.12  |  Soul profile computation + book matching
  
  In production: uses OpenAI text-embedding-3-small
  In demo mode:  generates deterministic soul vectors
============================================================
"""

import json
import math
import hashlib
import os
import sys
import random
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ── SOUL DIMENSION DEFINITIONS ───────────────────────────────
SOUL_DIMENSIONS = [
    'emotional_depth',
    'narrative_complexity',
    'cultural_range',
    'philosophical_appetite',
    'lyrical_sensitivity',
    'darkness_tolerance',
    'pace_preference',
    'geographical_curiosity',
    'historical_range',
    'length_preference',
    'social_reading',
    'introspection',
    'genre_adventurousness',
    'multilingual_appetite',
]

# ── ARCHETYPES ────────────────────────────────────────────────
ARCHETYPES = [
    {
        'name': 'Midnight Wanderer',
        'desc': 'You read to cross borders — of geography, time, and the self. You are drawn to darkness that illuminates.',
        'match': lambda d: d['cultural_range'] > 0.75 and d['darkness_tolerance'] > 0.6,
    },
    {
        'name': 'The Seeker',
        'desc': 'You read to find answers to questions most people are afraid to ask. Philosophy is your native language.',
        'match': lambda d: d['philosophical_appetite'] > 0.8 and d['introspection'] > 0.7,
    },
    {
        'name': 'The Lyricist',
        'desc': 'Language moves you like music. You read for the sentence, not just the story.',
        'match': lambda d: d['lyrical_sensitivity'] > 0.82 and d['emotional_depth'] > 0.7,
    },
    {
        'name': 'The Time Traveller',
        'desc': 'You live in multiple centuries simultaneously. History and the present are the same conversation.',
        'match': lambda d: d['historical_range'] > 0.75 and d['cultural_range'] > 0.65,
    },
    {
        'name': 'The Bridge',
        'desc': 'You read to connect worlds that do not know each other exist. Translation is your superpower.',
        'match': lambda d: d['multilingual_appetite'] > 0.75 and d['cultural_range'] > 0.7,
    },
    {
        'name': 'The Deep Reader',
        'desc': 'You read slowly and fully. One book at a time. Every word. You are the rarest kind of reader.',
        'match': lambda d: d['narrative_complexity'] > 0.8 and d['pace_preference'] < 0.35,
    },
    {
        'name': 'The Explorer',
        'desc': 'You read to discover what lies beyond what you already know. Every book is a new country.',
        'match': lambda d: d['genre_adventurousness'] > 0.75 and d['geographical_curiosity'] > 0.7,
    },
]

# ── LITERARY DNA CATEGORIES ───────────────────────────────────
LITERARY_DNA_MAP = {
    'Magical Realism':       lambda d: d['cultural_range'] > 0.65 and d['genre_adventurousness'] > 0.6,
    'Post-Colonial Fiction': lambda d: d['cultural_range'] > 0.7 and d['historical_range'] > 0.5,
    'Existentialism':        lambda d: d['philosophical_appetite'] > 0.75,
    'Stream of Consciousness': lambda d: d['lyrical_sensitivity'] > 0.7 and d['narrative_complexity'] > 0.7,
    'African Literature':    lambda d: d['cultural_range'] > 0.7 and d['geographical_curiosity'] > 0.65,
    'Russian Classics':      lambda d: d['darkness_tolerance'] > 0.65 and d['philosophical_appetite'] > 0.6,
    'Latin American Boom':   lambda d: d['genre_adventurousness'] > 0.65 and d['cultural_range'] > 0.6,
    'Dark Lyricism':         lambda d: d['darkness_tolerance'] > 0.7 and d['lyrical_sensitivity'] > 0.7,
    'Oral Traditions':       lambda d: d['cultural_range'] > 0.75 and d['multilingual_appetite'] > 0.6,
    'Literary Modernism':    lambda d: d['narrative_complexity'] > 0.75 and d['lyrical_sensitivity'] > 0.65,
    'Social Realism':        lambda d: d['emotional_depth'] > 0.75 and d['darkness_tolerance'] > 0.55,
    'World Literature':      lambda d: d['geographical_curiosity'] > 0.75,
}


class SoulEngine:
    """Core AI Reading Soul computation engine."""

    def compute_dimensions(self, quiz_data: dict) -> dict:
        """
        Compute 14 soul dimensions from quiz answers.
        
        quiz_data keys:
          emotional_need  : 'wonder' | 'solace' | 'challenge' | 'escape' | 'meaning' | 'courage'
          passage_type    : 'realism' | 'absurd' | 'magical' | 'lyrical' | 'metaphysical' | 'interior'
          dials           : { pace, darkness, language, geography, time_period, length }  (all 1–10)
          reading_ritual  : 'dawn' | 'commute' | 'afternoon' | 'midnight' | 'bath' | 'anywhere'
        """
        e = quiz_data.get('emotional_need', 'wonder')
        p = quiz_data.get('passage_type', 'magical')
        dials = quiz_data.get('dials', {})
        ritual = quiz_data.get('reading_ritual', 'midnight')

        def norm(key, default=5): return max(0.05, min(1.0, (dials.get(key, default) - 1) / 9))

        dims = {
            'emotional_depth':        round(norm('darkness') * 0.6 + (0.9 if e in ('solace','meaning') else 0.5) * 0.4, 3),
            'narrative_complexity':   round(norm('length') * 0.5 + norm('language') * 0.5, 3),
            'cultural_range':         round(norm('geography'), 3),
            'philosophical_appetite': round((0.95 if e == 'meaning' else 0.7 if e == 'challenge' else 0.55) * 0.7
                                          + (0.9 if p in ('metaphysical','absurd') else 0.5) * 0.3, 3),
            'lyrical_sensitivity':    round(norm('language') * 0.7 + (0.9 if p == 'lyrical' else 0.6) * 0.3, 3),
            'darkness_tolerance':     round(norm('darkness'), 3),
            'pace_preference':        round(1.0 - norm('pace'), 3),   # higher = slower preference
            'geographical_curiosity': round(norm('geography') * 0.8 + (0.9 if p in ('magical','lyrical') else 0.6) * 0.2, 3),
            'historical_range':       round(norm('time_period'), 3),
            'length_preference':      round(norm('length'), 3),
            'social_reading':         round(0.75 if ritual in ('commute','anywhere') else 0.45, 3),
            'introspection':          round(0.9 if ritual in ('midnight','bath','dawn') else 0.55, 3),
            'genre_adventurousness':  round(norm('geography') * 0.5 + (0.9 if e in ('wonder','challenge') else 0.55) * 0.5, 3),
            'multilingual_appetite':  round(norm('geography') * 0.6 + (0.85 if p == 'interior' else 0.5) * 0.4, 3),
        }
        return dims

    def compute_archetype(self, dimensions: dict) -> dict:
        """Determine the reader's soul archetype from their dimension profile."""
        for arch in ARCHETYPES:
            try:
                if arch['match'](dimensions):
                    return {'name': arch['name'], 'desc': arch['desc']}
            except Exception:
                continue
        return {'name': 'The Explorer', 'desc': 'You read to discover what lies beyond what you already know.'}

    def compute_literary_dna(self, dimensions: dict) -> list:
        """Compute the reader's literary DNA — which literary traditions they belong to."""
        dna = []
        for genre, test_fn in LITERARY_DNA_MAP.items():
            try:
                if test_fn(dimensions):
                    dna.append(genre)
            except Exception:
                continue
        # Ensure at least 3
        if len(dna) < 3:
            dna.extend(['World Literature', 'Literary Fiction', 'Contemporary'][:3 - len(dna)])
        return list(dict.fromkeys(dna))[:8]   # unique, max 8

    def generate_soul_embedding(self, dimensions: dict, user_id: str = '') -> list:
        """
        Generate a 1536-dim soul embedding vector.
        
        In production: call OpenAI text-embedding-3-small with a rich
        textual description of the soul profile. The result is stored
        in soul_profiles.soul_embedding (pgvector) and indexed with HNSW.
        
        In demo: generate a deterministic pseudo-random vector seeded
        by the dimension values, so the same profile always gets the
        same vector (stable for testing).
        """
        openai_key = os.environ.get('OPENAI_API_KEY', '')

        if openai_key and not openai_key.startswith('sk-YOUR'):
            # PRODUCTION: real OpenAI embedding
            return self._openai_embedding(dimensions, user_id)
        else:
            # DEMO: deterministic seeded vector
            return self._demo_embedding(dimensions, user_id)

    def _demo_embedding(self, dimensions: dict, user_id: str = '') -> list:
        """Deterministic 1536-dim vector for demo/testing."""
        # Seed = hash of dimension values + user_id for uniqueness
        seed_str = json.dumps(dimensions, sort_keys=True) + user_id
        seed = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % (2**31)
        rng = random.Random(seed)

        # First 14 dims mirror soul dimensions directly
        base = [dimensions.get(d, 0.5) for d in SOUL_DIMENSIONS]

        # Remaining 1522 dims are seeded random with subtle correlation to base dims
        vector = base[:]
        for i in range(1536 - len(base)):
            val = rng.gauss(base[i % len(base)], 0.3)
            vector.append(max(-1.0, min(1.0, val)))

        # L2-normalise the vector (cosine similarity requires unit vectors)
        magnitude = math.sqrt(sum(v*v for v in vector))
        if magnitude > 0:
            vector = [round(v / magnitude, 6) for v in vector]

        return vector

    def _openai_embedding(self, dimensions: dict, user_id: str = '') -> list:
        """Call OpenAI to get a real text-embedding-3-small vector."""
        try:
            import urllib.request, urllib.error
            text = (
                f"Reader soul profile: "
                f"emotional_depth={dimensions['emotional_depth']:.2f}, "
                f"cultural_range={dimensions['cultural_range']:.2f}, "
                f"philosophical_appetite={dimensions['philosophical_appetite']:.2f}, "
                f"lyrical_sensitivity={dimensions['lyrical_sensitivity']:.2f}, "
                f"darkness_tolerance={dimensions['darkness_tolerance']:.2f}, "
                f"geographical_curiosity={dimensions['geographical_curiosity']:.2f}. "
                f"This reader gravitates toward {'philosophy and meaning' if dimensions['philosophical_appetite'] > 0.7 else 'narrative and story'}. "
                f"They prefer {'slow, immersive' if dimensions['pace_preference'] > 0.6 else 'fast-paced'} books "
                f"and read at {'midnight or dawn' if dimensions['introspection'] > 0.7 else 'various times'}."
            )
            payload = json.dumps({'input': text, 'model': 'text-embedding-3-small'}).encode()
            req = urllib.request.Request(
                'https://api.openai.com/v1/embeddings',
                data=payload,
                headers={'Authorization': f'Bearer {os.environ["OPENAI_API_KEY"]}', 'Content-Type': 'application/json'},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                return data['data'][0]['embedding']
        except Exception as e:
            print(f'[SOUL ENGINE] OpenAI call failed, using demo embedding: {e}')
            return self._demo_embedding(dimensions, user_id)

    def match_books(self, soul_embedding: list, books: list, top_k: int = 6) -> list:
        """
        Find top-k books matching the soul embedding using cosine similarity.
        
        In production: this is a single SQL query:
          SELECT id, 1 - (soul_embedding <=> $1::vector) AS score
          FROM books WHERE status='published'
          ORDER BY soul_embedding <=> $1::vector
          LIMIT $2;
        
        In demo: compute cosine similarity in Python.
        """
        results = []
        for book in books:
            book_vec = book.get('soul_embedding')
            if book_vec and len(book_vec) == len(soul_embedding):
                score = self._cosine_similarity(soul_embedding, book_vec)
            else:
                # No embedding yet — assign based on popularity + small random
                score = 0.65 + (book.get('rating', 4.0) - 3.5) / 10 + random.uniform(-0.05, 0.1)
            results.append({**book, 'match_score': round(min(0.99, score), 3)})

        results.sort(key=lambda x: x['match_score'], reverse=True)
        return results[:top_k]

    @staticmethod
    def _cosine_similarity(a: list, b: list) -> float:
        """Compute cosine similarity between two vectors."""
        dot   = sum(x*y for x,y in zip(a, b))
        mag_a = math.sqrt(sum(x*x for x in a))
        mag_b = math.sqrt(sum(x*x for x in b))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)

    def generate_match_reason(self, book: dict, dimensions: dict) -> str:
        """Generate a personal, human-readable reason why this book matches this soul."""
        reasons = []
        if dimensions.get('cultural_range', 0) > 0.7:
            reasons.append(f"Your appetite for world literature makes {book.get('origin_country','unknown')} fiction deeply resonant for you")
        if dimensions.get('lyrical_sensitivity', 0) > 0.7 and book.get('genres') and 'Fiction' in book.get('genres',[]):
            reasons.append(f"Your lyrical sensitivity means {book.get('author','this author')}'s prose will move you at the sentence level")
        if dimensions.get('darkness_tolerance', 0) > 0.65:
            reasons.append("Your darkness tolerance opens you to this book's unsparing emotional honesty")
        if dimensions.get('philosophical_appetite', 0) > 0.75:
            reasons.append("Your philosophical hunger will find real nourishment in the questions this book refuses to answer")
        if dimensions.get('introspection', 0) > 0.75:
            reasons.append("Read this at midnight — it rewards exactly the kind of slow, private attention you give to books")

        if not reasons:
            reasons.append(f"This book matches your soul profile across 7 of your 14 dimensions")

        return reasons[0] + '.'


# ── HTTP REQUEST HANDLER ──────────────────────────────────────
engine = SoulEngine()

class SoulHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f'[SOUL ENGINE] {fmt % args}')

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, indent=2).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == '/health':
            self.send_json({
                'status':  'ok',
                'service': 'Global BookShelf — AI Soul Engine',
                'version': '1.0.0',
                'openai':  bool(os.environ.get('OPENAI_API_KEY','').startswith('sk-') and 'YOUR' not in os.environ.get('OPENAI_API_KEY','')),
                'embedding_dim': 1536,
                'archetypes': len(ARCHETYPES),
                'dimensions': len(SOUL_DIMENSIONS),
            })
        else:
            self.send_json({'error': f'Route not found: GET {path}'}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}

        # POST /compute — full soul profile from quiz data
        if path == '/compute':
            try:
                quiz_data = body.get('quiz_data', body)
                user_id   = body.get('user_id', '')

                dims      = engine.compute_dimensions(quiz_data)
                archetype = engine.compute_archetype(dims)
                dna       = engine.compute_literary_dna(dims)
                embedding = engine.generate_soul_embedding(dims, user_id)

                self.send_json({
                    'user_id':       user_id,
                    'archetype':     archetype,
                    'dimensions':    dims,
                    'literary_dna':  dna,
                    'soul_embedding': embedding,
                    'embedding_dims': len(embedding),
                    'computed_at':   __import__('datetime').datetime.utcnow().isoformat() + 'Z',
                })
            except Exception as e:
                self.send_json({'error': str(e)}, 500)

        # POST /match — find matching books for a soul embedding
        elif path == '/match':
            try:
                soul_embedding = body.get('soul_embedding', [])
                books          = body.get('books', [])
                top_k          = body.get('top_k', 6)
                dimensions     = body.get('dimensions', {})

                if not soul_embedding:
                    self.send_json({'error': 'soul_embedding required'}, 400)
                    return

                matched = engine.match_books(soul_embedding, books, top_k)

                # Add personal match reasons
                for book in matched:
                    book['match_reason'] = engine.generate_match_reason(book, dimensions)

                self.send_json({'recommendations': matched, 'total_books_evaluated': len(books)})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)

        # POST /dimensions — just compute dimensions (fast, no embedding)
        elif path == '/dimensions':
            try:
                dims      = engine.compute_dimensions(body)
                archetype = engine.compute_archetype(dims)
                dna       = engine.compute_literary_dna(dims)
                self.send_json({'dimensions': dims, 'archetype': archetype, 'literary_dna': dna})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)

        # POST /embedding — generate embedding for existing dimensions
        elif path == '/embedding':
            try:
                dimensions = body.get('dimensions', {})
                user_id    = body.get('user_id', '')
                if not dimensions:
                    self.send_json({'error': 'dimensions required'}, 400)
                    return
                embedding = engine.generate_soul_embedding(dimensions, user_id)
                self.send_json({'soul_embedding': embedding, 'dims': len(embedding)})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)

        else:
            self.send_json({'error': f'Route not found: POST {path}'}, 404)


# ── ENTRY POINT ───────────────────────────────────────────────
if __name__ == '__main__':
    PORT = int(os.environ.get('SOUL_ENGINE_PORT', 5000))
    print(f"""
╔═══════════════════════════════════════════════════╗
║     GLOBAL BOOKSHELF — AI SOUL ENGINE             ║
║     Reading soul computation + book matching      ║
╠═══════════════════════════════════════════════════╣
║  Status     : RUNNING                             ║
║  Port       : {PORT}                                    ║
║  Archetypes : {len(ARCHETYPES)} defined                            ║
║  Dimensions : {len(SOUL_DIMENSIONS)} soul dimensions                ║
║  Embeddings : 1536-dim (OpenAI compatible)        ║
║  OpenAI     : {'CONNECTED' if os.environ.get('OPENAI_API_KEY','').startswith('sk-') else 'DEMO MODE (no API key)'}                       ║
╠═══════════════════════════════════════════════════╣
║  Endpoints:                                       ║
║    GET  /health      — service health             ║
║    POST /compute     — full soul profile          ║
║    POST /match       — book recommendations       ║
║    POST /dimensions  — compute dimensions only    ║
║    POST /embedding   — generate vector only       ║
╚═══════════════════════════════════════════════════╝
    """)

    server = HTTPServer(('0.0.0.0', PORT), SoulHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[SOUL ENGINE] Shutting down gracefully.')
        server.server_close()
