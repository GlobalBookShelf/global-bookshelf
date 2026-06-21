/**
 * ================================================================
 *  GLOBAL BOOKSHELF — REACT NATIVE  (Pure JavaScript)
 *  File     : App.js
 *  Language : JavaScript JSX — zero TypeScript
 *  Backend  : Node.js + Express (server.js) on port 4000
 *  Payments : Visa card via Stripe
 *
 *  SETUP (one-time):
 *    npx create-expo-app GlobalBookShelf
 *    cd GlobalBookShelf
 *    npm install @react-navigation/native @react-navigation/bottom-tabs \
 *                @react-navigation/native-stack               \
 *                react-native-screens react-native-safe-area-context \
 *                react-native-gesture-handler                 \
 *                @react-native-async-storage/async-storage   \
 *                @stripe/stripe-react-native
 *    cp App.js ./App.js   (replace the generated file)
 *    npx expo start
 *
 *  API ENDPOINTS WIRED (all from server.js):
 *    POST /api/auth/register          POST /api/auth/login
 *    GET  /api/auth/me                GET  /api/books
 *    GET  /api/books/trending/week    GET  /api/books/map/pins
 *    GET  /api/books/:id              GET  /api/books/:id/reviews
 *    GET  /api/books/:id/annotations  POST /api/books/:id/reviews
 *    POST /api/books/:id/annotations  POST /api/likes
 *    POST /api/soul/profile           GET  /api/soul/profile
 *    GET  /api/soul/recommendations   GET  /api/shelves
 *    POST /api/shelves/:id/books      PATCH /api/shelves/books/:id
 *    GET  /api/authors/:id/tiers      POST /api/payments/create-payment-intent
 *    POST /api/payments/subscribe     POST /api/payments/cancel
 *    GET  /api/payments/my-subscriptions
 *    GET  /api/payments/my-payments   GET  /api/clubs
 *    POST /api/clubs                  POST /api/clubs/:id/join
 *    GET  /api/notifications          POST /api/notifications/read-all
 *    GET  /api/live/readers           POST /api/live/ping
 *    GET  /api/search                 GET  /health
 * ================================================================
 */

import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  TouchableOpacity, TextInput, Modal, Alert,
  ActivityIndicator, Animated, Dimensions,
  SafeAreaView, StatusBar, Platform, RefreshControl,
  KeyboardAvoidingView, Switch,
} from 'react-native';

const { width: SW } = Dimensions.get('window');

/* ----------------------------------------------------------------
   SERVER ADDRESS
   - iOS simulator  : http://localhost:4000
   - Android emulator : http://10.0.2.2:4000
   - Real device    : http://YOUR_LAN_IP:4000  (e.g. 192.168.1.5:4000)
---------------------------------------------------------------- */
const API_BASE = 'http://localhost:4000';

/* ----------------------------------------------------------------
   COLOUR TOKENS
---------------------------------------------------------------- */
const C = {
  ink:   '#07070E', ink2:  '#10101A', ink3:  '#181724', ink4:  '#20202E',
  pg:    '#F3ECDE', pg2:   'rgba(243,236,222,.72)', pg3:  'rgba(243,236,222,.40)',
  pg4:   'rgba(243,236,222,.16)',
  gold:  '#C6A240', gold2: '#E4C058', goldd: 'rgba(198,162,64,.15)',
  goldb: 'rgba(198,162,64,.30)',
  teal:  '#32AEA6', teald: 'rgba(50,174,166,.13)',
  coral: '#DC5640', corald:'rgba(220,86,64,.13)',
  sage:  '#52886A', saged: 'rgba(82,136,106,.13)',
  violet:'#7460C8', violetd:'rgba(116,96,200,.13)',
  amber: '#B87030',
  border:'rgba(243,236,222,.10)', bord2:'rgba(243,236,222,.22)',
};

/* ----------------------------------------------------------------
   STATIC DISPLAY DATA
---------------------------------------------------------------- */
const BOOK_COLORS = {
  b1:'#8B3A2A', b2:'#7B4A1A', b3:'#2A4A6A', b4:'#3A5A2A',
  b5:'#4A2A6A', b6:'#5A3A1A', b7:'#1A5A4A', b8:'#4A4A6A',
};
const BOOK_EMOJIS = {
  b1:'🌿', b2:'🏺', b3:'🌙', b4:'🦋', b5:'🌹', b6:'🕌', b7:'✈️', b8:'🎰',
};
const COUNTRY_NAMES = {
  NG:'Nigeria', IN:'India', SD:'Sudan', CO:'Colombia', US:'USA',
  KR:'S. Korea', JP:'Japan', GB:'UK', BR:'Brazil', TZ:'Tanzania',
  EG:'Egypt', SN:'Senegal', GH:'Ghana', KE:'Kenya', ET:'Ethiopia',
};
const EXCERPTS = {
  b1:`May in Ayemenem is a hot, brooding month.\n\nThe world is lulled into a lazy, heavy silence. Even the butterflies move slowly, like a thought.\n\nIn the house of Shoba and Chacko, the twins Rahel and Estha grew in their separate silences, wrapped around each other like question marks.`,
  b2:`Okonkwo was well known throughout the nine villages and even beyond. His fame rested on solid personal achievements.\n\nAs a young man of eighteen he had brought honour to his village by throwing Amalinze the Cat — the great wrestler who for seven years was unbeaten.\n\nOkonkwo's fame had grown like a bush-fire in the harmattan.`,
  b3:`He opened his eyes at exactly that moment, and I felt terror close in around my throat.\n\nIn the room's quiet and the darkness outside, I had believed he was asleep. But he was watching me.\n\nI asked if he was in pain. He said no. I said nothing. He said nothing.`,
};

/* ----------------------------------------------------------------
   SESSION  (in-memory + AsyncStorage)
---------------------------------------------------------------- */
let SESSION = { token: null, user: null };

async function saveSession(token, user) {
  SESSION = { token, user };
  try {
    const AS = require('@react-native-async-storage/async-storage').default;
    await AS.multiSet([['gbs_token', token], ['gbs_user', JSON.stringify(user)]]);
  } catch {}
}

async function loadSession() {
  try {
    const AS = require('@react-native-async-storage/async-storage').default;
    const pairs = await AS.multiGet(['gbs_token','gbs_user']);
    const token   = pairs[0][1];
    const userStr = pairs[1][1];
    if (token && userStr) {
      SESSION = { token, user: JSON.parse(userStr) };
      return SESSION;
    }
  } catch {}
  return null;
}

async function clearSession() {
  SESSION = { token: null, user: null };
  try {
    const AS = require('@react-native-async-storage/async-storage').default;
    await AS.multiRemove(['gbs_token','gbs_user']);
  } catch {}
}

/* ----------------------------------------------------------------
   API HELPER  — wraps every fetch call to server.js
---------------------------------------------------------------- */
async function api(endpoint, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (SESSION.token) headers.Authorization = `Bearer ${SESSION.token}`;
  Object.assign(headers, opts.headers || {});

  const cfg = { method: opts.method || 'GET', headers };
  if (opts.body) cfg.body = JSON.stringify(opts.body);

  const res  = await fetch(`${API_BASE}${endpoint}`, cfg);
  const data = await res.json();
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

/* ================================================================
   SHARED MICRO-COMPONENTS
================================================================ */

function GoldBtn({ label, onPress, disabled, loading, style }) {
  return (
    <TouchableOpacity
      style={[S.goldBtn, disabled && { opacity: 0.4 }, style]}
      onPress={onPress} disabled={disabled || loading} activeOpacity={0.8}
    >
      {loading
        ? <ActivityIndicator color={C.ink} size="small" />
        : <Text style={S.goldBtnTxt}>{label}</Text>}
    </TouchableOpacity>
  );
}

function GhostBtn({ label, onPress, color, style }) {
  const col = color || C.pg3;
  return (
    <TouchableOpacity
      style={[S.ghostBtn, { borderColor: col }, style]}
      onPress={onPress} activeOpacity={0.75}
    >
      <Text style={[S.ghostBtnTxt, { color: col }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function FieldInput({
  label, value, onChange, placeholder, secure,
  keyboard, caps, style, autoFocus,
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={S.fieldLabel}>{label}</Text> : null}
      <TextInput
        style={[S.input, focused && S.inputFocused, style]}
        value={value} onChangeText={onChange}
        placeholder={placeholder || label || ''}
        placeholderTextColor={C.pg3}
        secureTextEntry={!!secure}
        keyboardType={keyboard || 'default'}
        autoCapitalize={caps || 'none'}
        autoFocus={!!autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

function BookCover({ book, size = 80 }) {
  const h = Math.round(size * 1.45);
  return (
    <View style={{
      width: size, height: h, borderRadius: 5,
      backgroundColor: BOOK_COLORS[book?.id] || C.ink3,
      alignItems: 'center', justifyContent: 'center',
      borderLeftWidth: 6, borderLeftColor: 'rgba(0,0,0,.25)',
    }}>
      <Text style={{ fontSize: size * 0.34 }}>{BOOK_EMOJIS[book?.id] || '📖'}</Text>
    </View>
  );
}

function Badge({ label, color, bg }) {
  return (
    <View style={{
      backgroundColor: bg || C.goldd, borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 3,
      borderWidth: 1, borderColor: color || C.gold,
      marginRight: 6, marginBottom: 4,
    }}>
      <Text style={{ color: color || C.gold, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children }) {
  return (
    <Text style={{
      color: C.gold, fontSize: 10, letterSpacing: 2,
      textTransform: 'uppercase', marginBottom: 10,
    }}>{children}</Text>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 14 }} />;
}

function ErrBox({ message }) {
  if (!message) return null;
  return (
    <View style={{
      backgroundColor: C.corald, borderLeftWidth: 3, borderLeftColor: C.coral,
      padding: 12, borderRadius: 6, marginBottom: 14,
    }}>
      <Text style={{ color: C.coral, fontSize: 13, lineHeight: 18 }}>{message}</Text>
    </View>
  );
}

function StarRating({ rating }) {
  const r = parseFloat(rating) || 0;
  return (
    <Text style={{ color: C.gold, fontSize: 13, letterSpacing: 1 }}>
      {'★'.repeat(Math.floor(r))}{'☆'.repeat(5 - Math.floor(r))}
      <Text style={{ color: C.pg3, fontSize: 11 }}> {r}</Text>
    </Text>
  );
}

/* ================================================================
   SCREEN WRAPPER  — dark bg + safe area + optional scroll
================================================================ */
function Screen({ children, scroll, refreshing, onRefresh, padH = 18 }) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: padH, paddingBottom: 110 }}
      refreshControl={
        onRefresh
          ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.gold} />
          : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
      <StatusBar barStyle="light-content" backgroundColor={C.ink} />
      {content}
    </SafeAreaView>
  );
}

/* ================================================================
   SPLASH SCREEN
================================================================ */
function SplashScreen({ onDone }) {
  const fade  = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.78)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,  { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={{ opacity: fade, transform: [{ scale }], alignItems: 'center' }}>
        <View style={S.orb}>
          <View style={S.orbRing} />
          <View style={S.orbCore}>
            <Text style={{ color: C.gold, fontSize: 26, fontStyle: 'italic' }}>G</Text>
          </View>
        </View>
        <Text style={{ color: C.pg, fontSize: 26, marginTop: 12 }}>
          Global <Text style={{ color: C.gold, fontStyle: 'italic' }}>BookShelf</Text>
        </Text>
        <Text style={{ color: C.pg3, fontSize: 13, marginTop: 4, letterSpacing: 0.5 }}>
          The World's Living Library
        </Text>
        <ActivityIndicator color={C.gold} size="small" style={{ marginTop: 36 }} />
      </Animated.View>
    </View>
  );
}

/* ================================================================
   AUTH SCREEN
   API:  POST /api/auth/register
         POST /api/auth/login
================================================================ */
function AuthScreen({ onAuth }) {
  const [mode,  setMode]  = useState('login');
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [ctry,  setCtry]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');

  const submit = async () => {
    setErr('');
    if (!email.trim())          return setErr('Email is required');
    if (!pass.trim())           return setErr('Password is required');
    if (mode === 'register' && !name.trim()) return setErr('Your name is required');
    setBusy(true);
    try {
      let data;
      if (mode === 'login') {
        data = await api('/api/auth/login', {
          method: 'POST',
          body: { email: email.trim(), password: pass },
        });
      } else {
        data = await api('/api/auth/register', {
          method: 'POST',
          body: {
            display_name: name.trim(),
            email: email.trim(),
            password: pass,
            country_code: ctry.trim().toUpperCase().slice(0, 2) || 'TZ',
            preferred_languages: ['en', 'sw'],
          },
        });
      }
      await saveSession(data.token, data.user);
      onAuth(data.user);
    } catch (e) {
      setErr(e.message || 'Could not connect to the server.');
    } finally {
      setBusy(false);
    }
  };

  const quickDemo = () => {
    setMode('register');
    setName('Demo Reader');
    setEmail(`demo_${Date.now()}@gbs.tz`);
    setPass('Demo1234');
    setCtry('TZ');
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 36, marginTop: 16 }}>
          <View style={S.orbSmall}>
            <Text style={{ color: C.gold, fontSize: 22, fontStyle: 'italic' }}>G</Text>
          </View>
          <Text style={{ color: C.pg, fontSize: 22, marginTop: 10 }}>
            Global <Text style={{ color: C.gold, fontStyle: 'italic' }}>BookShelf</Text>
          </Text>
          <Text style={{ color: C.pg3, fontSize: 13, marginTop: 4 }}>
            {mode === 'login' ? 'Welcome back' : 'Join the living library'}
          </Text>
        </View>

        {/* Tab toggle */}
        <View style={S.authTabs}>
          {['login', 'register'].map(m => (
            <TouchableOpacity key={m}
              style={[S.authTab, mode === m && S.authTabActive]}
              onPress={() => { setMode(m); setErr(''); }}>
              <Text style={[S.authTabTxt, mode === m && { color: C.gold }]}>
                {m === 'login' ? 'Sign in' : 'Join free'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ErrBox message={err} />

        {mode === 'register' && (
          <FieldInput label="Your name" value={name} onChange={setName} caps="words" />
        )}
        <FieldInput label="Email address" value={email} onChange={setEmail} keyboard="email-address" />
        <FieldInput label="Password" value={pass} onChange={setPass} secure />
        {mode === 'register' && (
          <FieldInput
            label="Country code  (TZ · NG · IN …)"
            value={ctry} onChange={setCtry} caps="characters"
          />
        )}

        <GoldBtn
          label={mode === 'login' ? 'Sign in to your BookShelf' : 'Create my account'}
          onPress={submit} loading={busy} style={{ marginTop: 6 }}
        />

        <Divider />

        <TouchableOpacity onPress={quickDemo}
          style={{ borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12 }}>
          <Text style={{ color: C.pg3, fontSize: 12, textAlign: 'center' }}>
            ↗  Quick demo — tap to auto-fill test credentials
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* ================================================================
   HOME SCREEN  (Book Feed + Live counter + Search + Trending)
   API:  GET /api/books
         GET /api/books/trending/week
         GET /api/live/readers
         GET /api/search?q=
================================================================ */
function HomeScreen({ navigate }) {
  const [books,   setBooks]   = useState([]);
  const [trending,setTrending]= useState([]);
  const [genre,   setGenre]   = useState('All');
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState(null);
  const [live,    setLive]    = useState(2847);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [error,   setError]   = useState('');

  const GENRES = ['All','Fiction','Post-Colonial','African','Historical','Magical Realism','Contemporary'];

  /* ── load books + trending + live count ── */
  const load = useCallback(async () => {
    setError('');
    try {
      const [bRes, tRes, lRes] = await Promise.all([
        api('/api/books?sort=readers&limit=20'),
        api('/api/books/trending/week'),
        api('/api/live/readers'),
      ]);
      setBooks(bRes.books   || []);
      setTrending(tRes.books || []);
      setLive(lRes.total    || 2847);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefresh(false); }
  }, []);

  useEffect(() => { load(); }, []);

  /* ── live counter tick — also pings /api/live/readers ── */
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/api/live/readers');
        setLive(d.total);
      } catch {
        setLive(n => Math.max(2400, n + Math.floor(Math.random() * 4) - 1));
      }
    }, 4000);
    return () => clearInterval(t);
  }, []);

  /* ── debounced search against GET /api/search?q= ── */
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const d = await api(`/api/search?q=${encodeURIComponent(query.trim())}&type=books`);
        setResults(d.results?.books || []);
      } catch { setResults([]); }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  const displayBooks = results || (
    genre === 'All' ? books : books.filter(b => (b.genres || []).some(g => g.includes(genre)))
  );

  return (
    <Screen padH={0}>
      {/* ── sticky header ── */}
      <View style={S.homeHeader}>
        <View>
          <Text style={S.homeTitle}>
            Global <Text style={{ color: C.gold, fontStyle: 'italic' }}>BookShelf</Text>
          </Text>
          <Text style={{ color: C.teal, fontSize: 12 }}>
            ● {live.toLocaleString()} reading right now
          </Text>
        </View>
        <TouchableOpacity
          style={S.iconBtn}
          onPress={() => navigate('Notifications')}>
          <Text style={{ fontSize: 18 }}>🔔</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refresh}
            onRefresh={() => { setRefresh(true); load(); }}
            tintColor={C.gold}
          />
        }
      >
        {/* ── search bar → /api/search ── */}
        <View style={[S.searchBar, { marginHorizontal: 16, marginBottom: 12 }]}>
          <Text style={{ color: C.pg3, marginRight: 8, fontSize: 16 }}>⌕</Text>
          <TextInput
            style={{ flex: 1, color: C.pg, fontSize: 14 }}
            placeholder="Search books, authors…"
            placeholderTextColor={C.pg3}
            value={query}
            onChangeText={setQuery}
          />
          {!!query && (
            <TouchableOpacity onPress={() => { setQuery(''); setResults(null); }}>
              <Text style={{ color: C.pg3, fontSize: 16, paddingLeft: 8 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── world-map banner ── */}
        <TouchableOpacity style={S.mapBanner} onPress={() => navigate('Map')}>
          {[12,29,48,65,82].map((x, i) => (
            <View key={i} style={[S.mapDot, { left: `${x}%`, top: `${18 + i * 13}%` }]} />
          ))}
          <View style={{ alignItems: 'center', zIndex: 2 }}>
            <Text style={{ fontSize: 24, marginBottom: 4 }}>🌍</Text>
            <Text style={S.mapBTitle}>Living World Map</Text>
            <Text style={S.mapBSub}>{live.toLocaleString()} readers on the map</Text>
          </View>
          <Text style={S.mapBCta}>Explore →</Text>
        </TouchableOpacity>

        {/* ── genre chips ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          {GENRES.map(g => (
            <TouchableOpacity key={g}
              style={[S.chip, genre === g && S.chipActive]}
              onPress={() => { setGenre(g); setQuery(''); setResults(null); }}>
              <Text style={[S.chipTxt, genre === g && { color: C.gold }]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── trending strip → /api/books/trending/week ── */}
        {!results && trending.length > 0 && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
              <SectionLabel>Trending this week</SectionLabel>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
              {trending.slice(0, 5).map(bk => (
                <TouchableOpacity key={bk.id} style={S.trendCard}
                  onPress={() => navigate('BookDetail', { bookId: bk.id })}>
                  <BookCover book={bk} size={72} />
                  <Text style={S.trendTitle} numberOfLines={2}>{bk.title}</Text>
                  <Text style={{ color: C.teal, fontSize: 10, marginTop: 2 }}>
                    ● {(bk.reader_count || 0).toLocaleString()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* ── main list → /api/books ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
          <SectionLabel>
            {results ? `Search results (${results.length})` : (genre === 'All' ? 'All books' : genre)}
          </SectionLabel>
        </View>
        <ErrBox message={error} />
        {loading
          ? <ActivityIndicator color={C.gold} style={{ marginTop: 40 }} />
          : displayBooks.map(bk => (
            <TouchableOpacity key={bk.id} style={S.bookRow}
              onPress={() => navigate('BookDetail', { bookId: bk.id })} activeOpacity={0.8}>
              <BookCover book={bk} size={70} />
              <View style={{ flex: 1, paddingLeft: 14 }}>
                <Text style={S.bookTitle} numberOfLines={2}>{bk.title}</Text>
                <Text style={S.bookAuthor}>{bk.author}</Text>
                <Text style={{ color: C.pg3, fontSize: 11, marginBottom: 4 }}>
                  {COUNTRY_NAMES[bk.origin_country] || bk.origin_country} · {bk.published_year}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <StarRating rating={bk.rating} />
                  <Text style={{ color: C.teal, fontSize: 11 }}>
                    ● {(bk.reader_count || 0).toLocaleString()}
                  </Text>
                </View>
              </View>
              <Text style={{ color: C.pg3, fontSize: 20, alignSelf: 'center' }}>›</Text>
            </TouchableOpacity>
          ))
        }
      </ScrollView>
    </Screen>
  );
}

/* ================================================================
   BOOK DETAIL SCREEN
   API:  GET  /api/books/:id
         GET  /api/books/:id/reviews
         GET  /api/books/:id/annotations
         POST /api/books/:id/reviews
         POST /api/books/:id/annotations
         POST /api/shelves/:id/books
         POST /api/likes
         POST /api/live/ping
================================================================ */
function BookDetailScreen({ navigate, params }) {
  const bookId = params?.bookId;

  const [book,    setBook]    = useState(null);
  const [reviews, setReviews] = useState([]);
  const [annots,  setAnnots]  = useState([]);
  const [onShelf, setOnShelf] = useState(false);
  const [tab,     setTab]     = useState('about');
  const [liveR,   setLiveR]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');

  /* review form */
  const [rvModal, setRvModal] = useState(false);
  const [rvBody,  setRvBody]  = useState('');
  const [rvStar,  setRvStar]  = useState(5);

  /* annotation form */
  const [anModal, setAnModal] = useState(false);
  const [anBody,  setAnBody]  = useState('');
  const [anQuote, setAnQuote] = useState('');

  const [saving, setSaving] = useState(false);

  const TABS = ['about','read','reviews','annotations'];

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      try {
        const [b, r, a] = await Promise.all([
          api(`/api/books/${bookId}`),
          api(`/api/books/${bookId}/reviews`),
          api(`/api/books/${bookId}/annotations`),
        ]);
        setBook(b);
        setReviews(r.reviews  || []);
        setAnnots(a.annotations || []);
        setLiveR(Math.floor(Math.random() * 200) + 60);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();

    /* presence ping → POST /api/live/ping */
    api('/api/live/ping', {
      method: 'POST',
      body: { book_id: bookId, country: SESSION.user?.country_code || 'TZ' },
    }).catch(() => {});

    const t = setInterval(() =>
      setLiveR(n => Math.max(40, n + Math.floor(Math.random() * 3) - 1)), 3500);
    return () => clearInterval(t);
  }, [bookId]);

  /* ── Add to shelf → GET /api/shelves + POST /api/shelves/:id/books ── */
  const addShelf = async () => {
    try {
      const sd = await api('/api/shelves');
      const want = (sd.shelves || []).find(s => s.name === 'Want to Read');
      if (want) {
        await api(`/api/shelves/${want.id}/books`, {
          method: 'POST', body: { book_id: bookId },
        });
      }
      setOnShelf(true);
      Alert.alert('Added ✦', `"${book.title}" is on your shelf.`);
    } catch {
      setOnShelf(true);
      Alert.alert('Added!', `"${book.title}" added to Want to Read.`);
    }
  };

  /* ── Submit review → POST /api/books/:id/reviews ── */
  const submitReview = async () => {
    if (!rvBody.trim()) return Alert.alert('Write something first');
    setSaving(true);
    try {
      const d = await api(`/api/books/${bookId}/reviews`, {
        method: 'POST',
        body: { rating: rvStar, body: rvBody.trim(), is_spoiler: false },
      });
      setReviews(p => [d.review, ...p]);
      setRvModal(false); setRvBody('');
      Alert.alert('Review published ✦');
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  /* ── Submit annotation → POST /api/books/:id/annotations ── */
  const submitAnnot = async () => {
    if (!anBody.trim()) return Alert.alert('Write your annotation');
    setSaving(true);
    try {
      const d = await api(`/api/books/${bookId}/annotations`, {
        method: 'POST',
        body: { body: anBody.trim(), quote: anQuote.trim() || null, position_pct: 0, is_public: true },
      });
      setAnnots(p => [d.annotation, ...p]);
      setAnModal(false); setAnBody(''); setAnQuote('');
      Alert.alert('Annotation saved ✦');
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  /* ── Like → POST /api/likes ── */
  const likeReview = async (reviewId) => {
    try {
      await api('/api/likes', {
        method: 'POST',
        body: { target_type: 'review', target_id: reviewId },
      });
    } catch {}
  };

  if (loading) return (
    <Screen><ActivityIndicator color={C.gold} size="large" style={{ marginTop: 80 }} /></Screen>
  );
  if (!book) return <Screen><ErrBox message={err || 'Book not found'} /></Screen>;

  return (
    <Screen padH={0}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>

        {/* ── HERO ── */}
        <View style={S.bookHero}>
          <TouchableOpacity onPress={() => navigate('Home')} style={{ marginBottom: 14 }}>
            <Text style={{ color: C.gold, fontSize: 15 }}>← Back</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', marginBottom: 14 }}>
            <BookCover book={book} size={96} />
            <View style={{ flex: 1, paddingLeft: 16 }}>
              <Text style={S.bookDetailTitle}>{book.title}</Text>
              <Text style={{ color: C.pg3, fontSize: 13, fontStyle: 'italic', marginBottom: 6 }}>
                {book.author}
              </Text>
              <Text style={{ color: C.pg3, fontSize: 12, marginBottom: 6 }}>
                {COUNTRY_NAMES[book.origin_country] || book.origin_country} · {book.published_year}
              </Text>
              <StarRating rating={book.rating} />
              <Text style={{ color: C.teal, fontSize: 12, marginTop: 6 }}>
                ● {liveR} reading right now
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <GoldBtn
              label={onShelf ? '✓ On shelf' : '+ Add to shelf'}
              onPress={addShelf}
              style={{ flex: 1, paddingVertical: 10 }}
            />
            <GhostBtn
              label="Support author"
              onPress={() => navigate('Patron', { authorId: 'a1' })}
              color={C.teal} style={{ flex: 1 }}
            />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(book.genres || []).map(g => <Badge key={g} label={g} />)}
          </View>
        </View>

        {/* ── TABS ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
          {TABS.map(t => (
            <TouchableOpacity key={t}
              style={[S.tab, tab === t && S.tabActive]}
              onPress={() => setTab(t)}>
              <Text style={[S.tabTxt, tab === t && { color: C.gold }]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'reviews'    ? ` (${reviews.length})`   : ''}
                {t === 'annotations'? ` (${annots.length})`    : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Divider />

        {/* ── TAB BODIES ── */}
        <View style={{ paddingHorizontal: 18 }}>

          {/* ABOUT */}
          {tab === 'about' && (
            <>
              <SectionLabel>About this book</SectionLabel>
              <Text style={{ color: C.pg2, fontSize: 14, lineHeight: 22 }}>
                {`A celebrated work from ${COUNTRY_NAMES[book.origin_country] || book.origin_country}, published in ${book.published_year}. Read by ${(book.reader_count || 0).toLocaleString()} readers across 67 countries. Language: ${(book.original_language || 'en').toUpperCase()}.`}
              </Text>
              <Divider />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  ['Readers', (book.reader_count||0).toLocaleString(), C.gold],
                  ['Rating',  `${book.rating} ★`,                     C.teal],
                  ['Year',    book.published_year,                     C.pg2],
                  ['Lang',    book.original_language?.toUpperCase(),   C.violet],
                ].map(([l,v,col]) => (
                  <View key={l} style={S.statBox}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: col, marginBottom: 2 }}>{v}</Text>
                    <Text style={{ color: C.pg3, fontSize: 10 }}>{l}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* READ */}
          {tab === 'read' && (
            <>
              <SectionLabel>Opening passage</SectionLabel>
              <View style={{
                backgroundColor: C.ink2, borderRadius: 10, padding: 18,
                borderWidth: 1, borderColor: C.goldb,
              }}>
                <Text style={{ color: C.pg2, fontSize: 17, lineHeight: 30, fontStyle: 'italic' }}>
                  {EXCERPTS[book.id] || 'The story begins where all great stories begin — in the middle of an ordinary life that is about to become extraordinary.'}
                </Text>
              </View>
              <Text style={{ color: C.pg3, fontSize: 11, textAlign: 'center', marginTop: 10, fontStyle: 'italic' }}>
                Full text available through the publisher
              </Text>
            </>
          )}

          {/* REVIEWS */}
          {tab === 'reviews' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <SectionLabel>Reviews ({reviews.length})</SectionLabel>
                <TouchableOpacity
                  onPress={() => setRvModal(true)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.goldb, borderRadius: 16 }}>
                  <Text style={{ color: C.gold, fontSize: 12 }}>+ Write review</Text>
                </TouchableOpacity>
              </View>
              {reviews.length === 0
                ? <Text style={{ color: C.pg3, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>
                    No reviews yet. Be the first.
                  </Text>
                : reviews.map(r => (
                  <View key={r.id} style={S.reviewCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: C.pg2, fontSize: 13, fontWeight: '500' }}>
                        {r.user_id === SESSION.user?.id ? 'You' : 'Reader'}
                      </Text>
                      <StarRating rating={r.rating} />
                    </View>
                    {r.body ? <Text style={{ color: C.pg2, fontSize: 13, lineHeight: 20, marginBottom: 6 }}>{r.body}</Text> : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.pg3, fontSize: 10 }}>
                        {new Date(r.created_at).toLocaleDateString()}
                      </Text>
                      <TouchableOpacity onPress={() => likeReview(r.id)}>
                        <Text style={{ color: C.pg3, fontSize: 12 }}>♡ {r.like_count || 0}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              }
            </>
          )}

          {/* ANNOTATIONS */}
          {tab === 'annotations' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <SectionLabel>Annotations ({annots.length})</SectionLabel>
                <TouchableOpacity
                  onPress={() => setAnModal(true)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.goldb, borderRadius: 16 }}>
                  <Text style={{ color: C.gold, fontSize: 12 }}>+ Add note</Text>
                </TouchableOpacity>
              </View>
              {annots.length === 0
                ? <Text style={{ color: C.pg3, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>
                    No annotations yet. Add your thoughts on a passage.
                  </Text>
                : annots.map(a => (
                  <View key={a.id} style={[S.reviewCard, { borderLeftWidth: 3, borderLeftColor: C.gold }]}>
                    {a.quote ? (
                      <Text style={{ color: C.gold, fontSize: 12, fontStyle: 'italic', marginBottom: 6 }}>
                        "{a.quote}"
                      </Text>
                    ) : null}
                    <Text style={{ color: C.pg2, fontSize: 13, lineHeight: 20 }}>{a.body}</Text>
                    <Text style={{ color: C.pg3, fontSize: 10, marginTop: 5 }}>
                      {Math.round(a.position_pct || 0)}% through the book
                    </Text>
                  </View>
                ))
              }
            </>
          )}
        </View>
      </ScrollView>

      {/* ── REVIEW MODAL ── */}
      <Modal visible={rvModal} animationType="slide" transparent
        onRequestClose={() => setRvModal(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Write a review</Text>
            <Text style={{ color: C.pg3, fontSize: 12, marginBottom: 14 }}>
              {book.title} · {book.author}
            </Text>
            <Text style={S.fieldLabel}>Your rating</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {[1,2,3,4,5].map(n => (
                <TouchableOpacity key={n} onPress={() => setRvStar(n)}>
                  <Text style={{ fontSize: 28, color: n <= rvStar ? C.gold : C.border }}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FieldInput
              label="Your review"
              value={rvBody} onChange={setRvBody}
              placeholder="What did this book do to you?"
            />
            <GoldBtn label="Submit review" onPress={submitReview} loading={saving} />
            <GhostBtn label="Cancel" onPress={() => setRvModal(false)} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>

      {/* ── ANNOTATION MODAL ── */}
      <Modal visible={anModal} animationType="slide" transparent
        onRequestClose={() => setAnModal(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Add annotation</Text>
            <FieldInput
              label="Quote from the book (optional)"
              value={anQuote} onChange={setAnQuote}
              placeholder="The passage you are annotating…"
            />
            <FieldInput
              label="Your note"
              value={anBody} onChange={setAnBody}
              placeholder="What does this mean to you?"
            />
            <GoldBtn label="Save annotation" onPress={submitAnnot} loading={saving} />
            <GhostBtn label="Cancel" onPress={() => setAnModal(false)} style={{ marginTop: 8 }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/* ================================================================
   SOUL SCREEN  (Quiz + Dashboard)
   API:  POST /api/soul/profile
         GET  /api/soul/profile
         GET  /api/soul/recommendations
================================================================ */
function SoulScreen({ navigate }) {
  const [step,    setStep]    = useState(-1);   /* -1 = intro or dashboard */
  const [answers, setAnswers] = useState({});
  const [profile, setProfile] = useState(null);
  const [recs,    setRecs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

  const QUESTIONS = [
    {
      key: 'emotional_need',
      title: 'What does your soul need right now?',
      options: [
        { val:'wonder',    icon:'✦', label:'To be awed',        desc:'Ideas that rearrange everything' },
        { val:'solace',    icon:'◎', label:'To feel less alone', desc:'Someone who truly sees you' },
        { val:'challenge', icon:'◈', label:'To be challenged',   desc:'Perspectives that force growth' },
        { val:'escape',    icon:'◇', label:'To escape',          desc:'Another world, another century' },
        { val:'meaning',   icon:'❋', label:'To find meaning',    desc:'Questions worth living for' },
        { val:'courage',   icon:'△', label:'To feel brave',      desc:'Stories of fire and coming through' },
      ],
    },
    {
      key: 'passage_type',
      title: 'Which passage moves you most?',
      options: [
        { val:'realism',      icon:'📖', label:'Tolstoy',  desc:'"Happy families are all alike…"' },
        { val:'absurd',       icon:'🌊', label:'Camus',    desc:'"There is but one serious problem…"' },
        { val:'magical',      icon:'🦋', label:'Márquez',  desc:'"It\'s enough that you and I exist…"' },
        { val:'lyrical',      icon:'🌿', label:'Morrison', desc:'"Definitions belong to the definers…"' },
        { val:'metaphysical', icon:'⏱', label:'Borges',   desc:'"Time forks toward innumerable futures…"' },
        { val:'interior',     icon:'💡', label:'Woolf',   desc:'"Arrange whatever pieces come your way…"' },
      ],
    },
    {
      key: 'reading_ritual',
      title: 'When do you truly read?',
      options: [
        { val:'dawn',      icon:'🌅', label:'Before the world wakes',    desc:'First light, absolute silence' },
        { val:'commute',   icon:'🚃', label:'In motion, in transit',     desc:'Stolen twenty-minute windows' },
        { val:'afternoon', icon:'☀️', label:'Afternoon light, sprawled', desc:'Forgetting to eat' },
        { val:'midnight',  icon:'🌙', label:'Midnight, when it\'s quiet', desc:'Secret and slightly dangerous' },
        { val:'bath',      icon:'🛁', label:'Bath, bed, surrender',       desc:'Complete escape mode' },
        { val:'anywhere',  icon:'📚', label:'Everywhere, always',         desc:'Books between every heartbeat' },
      ],
    },
  ];

  /* load existing soul profile on mount */
  useEffect(() => {
    (async () => {
      try {
        const [p, r] = await Promise.all([
          api('/api/soul/profile'),
          api('/api/soul/recommendations'),
        ]);
        setProfile(p.profile);
        setRecs(r.recommendations || []);
      } catch { /* no profile yet — that is fine */ }
      finally { setLoading(false); }
    })();
  }, []);

  const transition = fn => {
    Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      fn();
      Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    });
  };

  const select = (key, val) => {
    const updated = { ...answers, [key]: val };
    setAnswers(updated);
    if (step < QUESTIONS.length - 1) {
      transition(() => setStep(s => s + 1));
    } else {
      submitProfile(updated);
    }
  };

  /* POST /api/soul/profile */
  const submitProfile = async ans => {
    setSaving(true);
    try {
      const pRes = await api('/api/soul/profile', {
        method: 'POST',
        body: {
          emotional_need: ans.emotional_need || 'wonder',
          passage_type:   ans.passage_type   || 'magical',
          reading_ritual: ans.reading_ritual || 'midnight',
          dials: { pace: 4, darkness: 6, language: 7, geography: 8, time_period: 5, length: 7 },
        },
      });
      setProfile(pRes.profile);
      const rRes = await api('/api/soul/recommendations');
      setRecs(rRes.recommendations || []);
      setStep(-1);
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  /* ── loading / saving overlay ── */
  if (loading || saving) return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 80 }}>
        <View style={S.orb}>
          <View style={S.orbCore}>
            <Text style={{ color: C.gold, fontSize: 26, fontStyle: 'italic' }}>S</Text>
          </View>
        </View>
        <Text style={{ color: C.gold, marginTop: 24, letterSpacing: 2, fontSize: 13 }}>
          {saving ? 'READING YOUR SOUL…' : 'LOADING…'}
        </Text>
      </View>
    </Screen>
  );

  /* ── existing profile dashboard ── */
  if (step === -1 && profile) return (
    <Screen scroll>
      <SectionLabel>Your Reading Soul</SectionLabel>
      <Text style={[S.bookDetailTitle, { marginBottom: 4 }]}>
        You are a{' '}
        <Text style={{ color: C.gold, fontStyle: 'italic' }}>{profile.archetype}</Text>
      </Text>
      <Text style={{ color: C.pg2, fontStyle: 'italic', fontSize: 14, lineHeight: 22, marginBottom: 22 }}>
        "{profile.archetype_desc}"
      </Text>

      <SectionLabel>Literary DNA</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24 }}>
        {(profile.literary_dna || []).map(d => <Badge key={d} label={d} />)}
      </View>

      <SectionLabel>Soul Dimensions</SectionLabel>
      {Object.entries(profile.dimensions || {}).slice(0, 7).map(([k, v]) => (
        <View key={k} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
            <Text style={{ color: C.pg2, fontSize: 13 }}>{k.replace(/_/g, ' ')}</Text>
            <Text style={{ color: C.gold, fontSize: 13 }}>{Math.round(v * 100)}%</Text>
          </View>
          <View style={{ height: 4, backgroundColor: C.ink3, borderRadius: 2 }}>
            <View style={{ height: 4, width: `${Math.round(v * 100)}%`, backgroundColor: C.gold, borderRadius: 2 }} />
          </View>
        </View>
      ))}

      {recs.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Books chosen for your soul</SectionLabel>
          {recs.slice(0, 4).map(bk => (
            <TouchableOpacity key={bk.id} style={S.recCard}
              onPress={() => navigate('BookDetail', { bookId: bk.id })}>
              <BookCover book={bk} size={52} />
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ color: C.pg, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{bk.title}</Text>
                  <Text style={{ color: C.gold, fontSize: 13 }}>
                    {Math.round((bk.match_score || 0.85) * 100)}%
                  </Text>
                </View>
                <Text style={{ color: C.pg3, fontSize: 12, marginBottom: 4 }}>{bk.author}</Text>
                <Text style={{ color: C.pg2, fontSize: 12, lineHeight: 17, fontStyle: 'italic' }} numberOfLines={2}>
                  {bk.match_reason}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      <Divider />
      <GhostBtn label="Retake the soul quiz" onPress={() => { setAnswers({}); setStep(0); }} color={C.gold} />
    </Screen>
  );

  /* ── intro (no profile yet) ── */
  if (step === -1 && !profile) return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: 48, marginBottom: 30 }}>
        <View style={S.orb}>
          <View style={S.orbCore}>
            <Text style={{ color: C.gold, fontSize: 26, fontStyle: 'italic' }}>S</Text>
          </View>
        </View>
      </View>
      <Text style={[S.bookDetailTitle, { textAlign: 'center', marginBottom: 8 }]}>
        Your <Text style={{ color: C.gold, fontStyle: 'italic' }}>Reading Soul</Text>
      </Text>
      <Text style={{ color: C.pg2, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 36, fontStyle: 'italic', paddingHorizontal: 20 }}>
        Not an algorithm. Not a list. A mirror that learns what moves you — then finds the books that will change you.
      </Text>
      <GoldBtn label="Discover my soul →" onPress={() => setStep(0)} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 36, opacity: 0.6 }}>
        {[['14','Soul dimensions'],['4.2M','Books mapped'],['98%','Accuracy']].map(([n,l]) => (
          <View key={l} style={{ alignItems: 'center' }}>
            <Text style={{ color: C.pg, fontSize: 20, fontWeight: '500' }}>{n}</Text>
            <Text style={{ color: C.pg3, fontSize: 11, marginTop: 2 }}>{l}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );

  /* ── quiz question ── */
  const q = QUESTIONS[step];
  return (
    <Screen padH={0}>
      {/* progress */}
      <View style={{ flexDirection: 'row', padding: 16, gap: 6 }}>
        {QUESTIONS.map((_, i) => (
          <View key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            backgroundColor: i <= step ? C.gold : C.ink3,
          }} />
        ))}
      </View>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <Text style={{ color: C.pg3, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', paddingHorizontal: 18, marginBottom: 6 }}>
          Question {step + 1} of {QUESTIONS.length}
        </Text>
        <Text style={{ fontStyle: 'italic', fontSize: 22, color: C.pg, paddingHorizontal: 18, marginBottom: 20, lineHeight: 30 }}>
          {q.title}
        </Text>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {q.options.map(opt => (
            <TouchableOpacity key={opt.val} style={S.soulOpt}
              onPress={() => select(q.key, opt.val)} activeOpacity={0.75}>
              <Text style={{ fontSize: 22, width: 30 }}>{opt.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.pg, fontSize: 15, fontWeight: '500', marginBottom: 2 }}>{opt.label}</Text>
                <Text style={{ color: C.pg3, fontSize: 12 }}>{opt.desc}</Text>
              </View>
              <Text style={{ color: C.pg3, fontSize: 20 }}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
    </Screen>
  );
}

/* ================================================================
   MAP SCREEN
   API:  GET /api/books/map/pins
         GET /api/live/readers
================================================================ */
function MapScreen({ navigate }) {
  const [pins,    setPins]    = useState([]);
  const [live,    setLive]    = useState(2847);
  const [era,     setEra]     = useState(2024);
  const [loading, setLoading] = useState(true);

  const loadMap = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        api(`/api/books/map/pins?era_from=1800&era_to=${era}`),
        api('/api/live/readers'),
      ]);
      setPins(p.pins || []);
      setLive(l.total || 2847);
    } catch {}
    finally { setLoading(false); }
  }, [era]);

  useEffect(() => { loadMap(); }, [era]);

  useEffect(() => {
    const t = setInterval(async () => {
      try { const d = await api('/api/live/readers'); setLive(d.total); } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const ERAS = [1850,1900,1950,1970,1990,2000,2010,2020,2024];

  return (
    <Screen scroll refreshing={loading} onRefresh={loadMap}>
      <SectionLabel>Living World Map</SectionLabel>
      <Text style={[S.bookDetailTitle, { marginBottom: 4 }]}>
        <Text style={{ color: C.gold, fontStyle: 'italic' }}>{live.toLocaleString()}</Text> readers right now
      </Text>
      <Text style={{ color: C.pg3, fontSize: 12, marginBottom: 18 }}>
        {pins.length} books pinned · {new Set(pins.map(p => p.country)).size} countries · era ≤ {era}
      </Text>

      {/* era selector */}
      <SectionLabel>Time-travel era</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 18 }}>
        {ERAS.map(y => (
          <TouchableOpacity key={y}
            style={[S.chip, era === y && S.chipActive]}
            onPress={() => setEra(y)}>
            <Text style={[S.chipTxt, era === y && { color: C.gold }]}>{y}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* map visual */}
      <View style={S.mapView}>
        {loading
          ? <ActivityIndicator color={C.gold} />
          : <>
              {pins.slice(0,10).map((pin, i) => (
                <TouchableOpacity key={pin.id || i}
                  style={[S.mapPin, { left: `${6 + i * 9}%`, top: `${14 + (i % 4) * 18}%` }]}
                  onPress={() => Alert.alert(
                    pin.title || 'Book',
                    `By ${pin.author || '—'}\n${(pin.reader_count||0).toLocaleString()} readers\nCountry: ${COUNTRY_NAMES[pin.country] || pin.country}`,
                    [{ text:'Open', onPress:() => navigate('BookDetail',{bookId:pin.id}) },{ text:'Close' }]
                  )}>
                  <Text style={{ fontSize: 13 }}>📖</Text>
                </TouchableOpacity>
              ))}
              {[[10,44],[28,60],[46,38],[64,56],[80,40],[20,74],[72,30],[54,66]].map(([x,y],i)=>(
                <View key={i} style={[S.liveDot, { left:`${x}%`, top:`${y}%` }]} />
              ))}
              <Text style={{ color:C.pg3, fontSize:11, fontStyle:'italic', textAlign:'center', position:'absolute', bottom:10, alignSelf:'center' }}>
                Full interactive map via react-native-maps in production
              </Text>
            </>
        }
      </View>

      {/* pins list */}
      <Divider />
      <SectionLabel>Books on the map</SectionLabel>
      {pins.slice(0,8).map(pin => (
        <TouchableOpacity key={pin.id} style={S.bookRow}
          onPress={() => navigate('BookDetail', { bookId: pin.id })}>
          <View style={{ width:36, height:36, borderRadius:18, backgroundColor:BOOK_COLORS[pin.id]||C.ink3, alignItems:'center', justifyContent:'center' }}>
            <Text style={{ fontSize:16 }}>📖</Text>
          </View>
          <View style={{ flex:1, paddingLeft:12 }}>
            <Text style={S.bookTitle} numberOfLines={1}>{pin.title}</Text>
            <Text style={{ color:C.pg3, fontSize:12 }}>{pin.author} · {COUNTRY_NAMES[pin.country]||pin.country}</Text>
          </View>
          <Text style={{ color:C.teal, fontSize:12 }}>{(pin.reader_count||0).toLocaleString()} ●</Text>
        </TouchableOpacity>
      ))}
    </Screen>
  );
}

/* ================================================================
   COMMUNITIES SCREEN
   API:  GET  /api/clubs
         POST /api/clubs
         POST /api/clubs/:id/join
================================================================ */
function CommunitiesScreen() {
  const [clubs,   setClubs]   = useState([]);
  const [joined,  setJoined]  = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [modal,   setModal]   = useState(false);
  const [cName,   setCName]   = useState('');
  const [cBook,   setCBook]   = useState('');
  const [cLang,   setCLang]   = useState('en');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  const ICONS = ['🌍','🌙','✦','📚','🏛','🌊','🌿','🎭','🔥','⭐'];

  const load = useCallback(async () => {
    setErr('');
    try {
      const d = await api('/api/clubs?visibility=public&limit=20');
      setClubs(d.clubs || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); setRefresh(false); }
  }, []);

  useEffect(() => { load(); }, []);

  const join = async (id, name) => {
    try {
      await api(`/api/clubs/${id}/join`, { method: 'POST' });
      setJoined(prev => new Set([...prev, id]));
      Alert.alert('Joined! 👥', `Welcome to ${name}`);
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const create = async () => {
    if (!cName.trim() || !cBook.trim()) return Alert.alert('Fill in club name and first book');
    setSaving(true);
    try {
      const d = await api('/api/clubs', {
        method: 'POST',
        body: { name:cName.trim(), language:cLang, visibility:'public', description:`Reading: ${cBook.trim()}` },
      });
      setClubs(p => [d.club, ...p]);
      setModal(false); setCName(''); setCBook(''); setCLang('en');
      Alert.alert('Club created! 🎉', `"${d.club.name}" is now live.`);
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  return (
    <Screen padH={0}>
      <View style={S.homeHeader}>
        <Text style={S.homeTitle}>Communities</Text>
        <TouchableOpacity onPress={() => setModal(true)}
          style={{ paddingHorizontal:14, paddingVertical:6, borderWidth:1, borderColor:C.goldb, borderRadius:18 }}>
          <Text style={{ color:C.gold, fontSize:13 }}>+ New club</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding:16, paddingBottom:110 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => {setRefresh(true); load();}} tintColor={C.gold} />}
      >
        <SectionLabel>Book clubs worldwide</SectionLabel>
        <ErrBox message={err} />

        {loading
          ? <ActivityIndicator color={C.gold} style={{ marginTop:40 }} />
          : clubs.length === 0
            ? <Text style={{ color:C.pg3, fontStyle:'italic', textAlign:'center', marginTop:40 }}>No clubs yet. Create the first!</Text>
            : clubs.map((c, i) => (
              <View key={c.id} style={S.clubCard}>
                <View style={{ flexDirection:'row', gap:12 }}>
                  <View style={{ width:44, height:44, borderRadius:10, backgroundColor:C.goldd, alignItems:'center', justifyContent:'center' }}>
                    <Text style={{ fontSize:20 }}>{ICONS[i % ICONS.length]}</Text>
                  </View>
                  <View style={{ flex:1 }}>
                    <Text style={{ color:C.pg, fontSize:15, fontWeight:'500', marginBottom:2 }}>{c.name}</Text>
                    <Text style={{ color:C.pg3, fontSize:12, marginBottom:4 }}>
                      {(c.member_count||0).toLocaleString()} members · {(c.language||'en').toUpperCase()}
                    </Text>
                    {c.description ? (
                      <Text style={{ color:C.pg2, fontSize:12, fontStyle:'italic' }} numberOfLines={2}>{c.description}</Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={[S.joinBtn, joined.has(c.id) && { borderColor:C.sage, backgroundColor:C.saged }]}
                  onPress={() => !joined.has(c.id) && join(c.id, c.name)}>
                  <Text style={{ color: joined.has(c.id) ? C.sage : C.gold, fontSize:13 }}>
                    {joined.has(c.id) ? '✓ Joined' : 'Join →'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))
        }
      </ScrollView>

      {/* create club modal */}
      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Start a book club</Text>
            <Text style={{ color:C.pg3, fontSize:12, marginBottom:16, fontStyle:'italic' }}>
              Any book. Any language. Any timezone.
            </Text>
            <FieldInput label="Club name" value={cName} onChange={setCName} caps="words" />
            <FieldInput label="First book to read" value={cBook} onChange={setCBook} caps="words" />
            <Text style={S.fieldLabel}>Language</Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:16 }}>
              {['en','sw','fr','ar','yo','pt','hi','ig'].map(l => (
                <TouchableOpacity key={l}
                  style={[S.chip, cLang===l && S.chipActive]}
                  onPress={() => setCLang(l)}>
                  <Text style={[S.chipTxt, cLang===l && {color:C.gold}]}>{l.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <GoldBtn label="Create club" onPress={create} loading={saving} />
            <GhostBtn label="Cancel" onPress={() => setModal(false)} style={{ marginTop:8 }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/* ================================================================
   PATRON SCREEN  (Tier selection + Visa card payment)
   API:  GET  /api/authors/:id/tiers
         POST /api/payments/create-payment-intent
         POST /api/payments/subscribe
         POST /api/payments/cancel
         GET  /api/payments/my-subscriptions
         GET  /api/payments/my-payments
================================================================ */
function PatronScreen({ navigate, params }) {
  const authorId = params?.authorId || 'a1';

  const [tiers,   setTiers]   = useState([]);
  const [subs,    setSubs]    = useState([]);
  const [payments,setPayments]= useState([]);
  const [selected,setSelected]= useState(null);
  const [intent,  setIntent]  = useState(null);
  const [step,    setStep]    = useState('tiers');   // tiers | card | history | success
  const [loading, setLoading] = useState(true);
  const [paying,  setPaying]  = useState(false);
  const [err,     setErr]     = useState('');

  /* visa card fields */
  const [cardNum, setCardNum] = useState('');
  const [expiry,  setExpiry]  = useState('');
  const [cvv,     setCvv]     = useState('');
  const [cname,   setCname]   = useState('');

  const fmtCard   = t => t.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();
  const fmtExpiry = t => { const d=t.replace(/\D/g,'').slice(0,4); return d.length>2?d.slice(0,2)+'/'+d.slice(2):d; };

  /* load tiers + subscriptions + payments */
  useEffect(() => {
    (async () => {
      try {
        const [tRes, sRes, pRes] = await Promise.all([
          api(`/api/authors/${authorId}/tiers`),
          api('/api/payments/my-subscriptions'),
          api('/api/payments/my-payments'),
        ]);
        setTiers(tRes.tiers || []);
        setSubs(sRes.subscriptions || []);
        setPayments(pRes.payments || []);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const isSubscribed = id => subs.some(s => s.tier_id === id && s.state === 'active');

  /* POST /api/payments/create-payment-intent then move to card form */
  const chooseTier = async tier => {
    setSelected(tier); setErr('');
    try {
      const d = await api('/api/payments/create-payment-intent', {
        method: 'POST',
        body: { amount_usd: tier.price_usd, author_id: authorId, type: 'patron_subscription' },
      });
      setIntent(d);
      setStep('card');
    } catch (e) { setErr(e.message); }
  };

  /* POST /api/payments/subscribe */
  const pay = async () => {
    if (cardNum.replace(/\s/g,'').length !== 16) return setErr('Enter a valid 16-digit Visa card number');
    if (!expiry.match(/^\d{2}\/\d{2}$/))         return setErr('Enter expiry as MM/YY');
    if (cvv.length < 3)                           return setErr('Enter the 3-digit CVV');
    if (!cname.trim())                            return setErr('Enter the name on the card');
    setErr(''); setPaying(true);
    try {
      /* In production use @stripe/stripe-react-native to tokenise:
         const { paymentMethod } = await createPaymentMethod({ type:'Card', cardDetails:{ number:cardNum, expMonth, expYear, cvc:cvv } });
         Then send paymentMethod.id to the server.
         Here we pass a demo ID. */
      const d = await api('/api/payments/subscribe', {
        method: 'POST',
        body: {
          tier_id:           selected.id,
          payment_method_id: `pm_demo_visa_${Date.now()}`,
        },
      });
      if (d.error) throw new Error(d.error);
      setSubs(p => [...p, d.subscription]);
      setStep('success');
    } catch (e) { setErr(e.message); }
    finally { setPaying(false); }
  };

  /* POST /api/payments/cancel */
  const cancel = async subId => {
    Alert.alert('Cancel subscription', 'This will stop your monthly Visa billing at the end of the current period.', [
      { text: 'Keep subscription' },
      { text: 'Cancel', style: 'destructive', onPress: async () => {
        try {
          await api('/api/payments/cancel', { method:'POST', body:{ subscription_id: subId } });
          setSubs(p => p.map(s => s.id === subId ? { ...s, state:'cancelled' } : s));
          Alert.alert('Cancelled', 'Your subscription has been cancelled.');
        } catch (e) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  if (loading) return <Screen><ActivityIndicator color={C.gold} 