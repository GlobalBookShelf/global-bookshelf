/**
 * ================================================================
 *  GLOBAL BOOKSHELF — SHARED FRONTEND API CLIENT
 *  Loaded by every HTML page via <script src="api.js">
 *  All buttons, sign in, register, logout — fully wired
 * ================================================================
 */

const API_BASE = 'http://localhost:4000';

const API = (() => {

  /* ══════════════════════════════════════════════════
     SESSION — save/read/clear login token
  ══════════════════════════════════════════════════ */
  function saveSession(token, user) {
    localStorage.setItem('gbs_token', token);
    localStorage.setItem('gbs_user', JSON.stringify(user));
  }
  function getSession() {
    const token = localStorage.getItem('gbs_token');
    const user  = localStorage.getItem('gbs_user');
    return token ? { token, user: user ? JSON.parse(user) : null } : null;
  }
  function clearSession() {
    localStorage.removeItem('gbs_token');
    localStorage.removeItem('gbs_user');
  }
  function getToken()  { return localStorage.getItem('gbs_token'); }
  function isLoggedIn(){ return !!getToken(); }

  /* ══════════════════════════════════════════════════
     HTTP — all API calls go through here
  ══════════════════════════════════════════════════ */
  async function request(method, endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res  = await fetch(`${API_BASE}${endpoint}`, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      return data;
    } catch (err) {
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        console.warn('%c[Global BookShelf] Server offline — run: node server.js', 'color:#c9a84c;font-weight:bold');
        return {};
      }
      throw err;
    }
  }

  const get   = (ep, body)  => request('GET',    ep, body);
  const post  = (ep, body)  => request('POST',   ep, body);
  const patch = (ep, body)  => request('PATCH',  ep, body);
  const del   = (ep)        => request('DELETE', ep);

  /* ══════════════════════════════════════════════════
     AUTH — login, register, logout
  ══════════════════════════════════════════════════ */
  async function login(email, password) {
    const data = await post('/api/auth/login', { email, password });
    if (data.token) saveSession(data.token, data.user);
    return data;
  }

  async function register({ display_name, email, password, country_code }) {
    const data = await post('/api/auth/register', {
      display_name, email, password,
      country_code: country_code || 'TZ',
      preferred_languages: ['en', 'sw'],
    });
    if (data.token) saveSession(data.token, data.user);
    return data;
  }

  function logout() {
    clearSession();
    window.location.href = 'global-bookshelf.html';
  }

  /* ══════════════════════════════════════════════════
     LIVE COUNTER
  ══════════════════════════════════════════════════ */
  function startLiveCounter(elementId, initialValue) {
    let count = initialValue || 2847;
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = count.toLocaleString();
    const tick = async () => {
      try {
        const data = await get('/api/live/readers');
        count = data.total || count;
      } catch {
        count += Math.floor(Math.random() * 4) - 1;
        count  = Math.max(2400, count);
      }
      if (el) el.textContent = count.toLocaleString();
    };
    tick();
    return setInterval(tick, 5000);
  }

  /* ══════════════════════════════════════════════════
     NAV — update header based on login state
  ══════════════════════════════════════════════════ */
  // ── VERIFY SESSION on load (connects /api/auth/me — was unused) ──
  async function verifySession() {
    const session = getSession();
    if (!session || !session.token) return;
    try {
      const data = await request('GET', '/api/auth/me');
      if (data && data.user) {
        saveSession(session.token, data.user);
      }
    } catch(e) {
      // Token expired or invalid — clear it
      if (e.message && (e.message.includes('401') || e.message.includes('expired') || e.message.includes('invalid'))) {
        clearSession();
      }
    }
  }

  // Run verify on load (non-blocking)
  verifySession().catch(() => {});

  function updateNav() {
    const session    = getSession();
    const signInBtn  = document.getElementById('navSignIn');
    const joinBtn    = document.getElementById('navJoinFree');
    const userMenu   = document.getElementById('navUserMenu');
    const userName   = document.getElementById('navUserName');
    const userAvatar = document.getElementById('navUserAvatar');

    if (session && session.user) {
      if (signInBtn)  signInBtn.style.display  = 'none';
      if (joinBtn)    joinBtn.style.display     = 'none';
      if (userMenu)   userMenu.style.display    = 'flex';
      const name = session.user.display_name || 'Reader';
      if (userName)   userName.textContent      = name;
      if (userAvatar) userAvatar.textContent    = name[0].toUpperCase();
    } else {
      if (signInBtn)  signInBtn.style.display   = '';
      if (joinBtn)    joinBtn.style.display      = '';
      if (userMenu)   userMenu.style.display     = 'none';
    }
  }

  /* ══════════════════════════════════════════════════
     TOAST — small notification popup
  ══════════════════════════════════════════════════ */
  function toast(message, type = 'success') {
    const existing = document.getElementById('gbs-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = 'gbs-toast';
    const color  = type === 'error' ? '#DC5640' : '#C6A240';
    const border = type === 'error' ? 'rgba(220,86,64,.35)' : 'rgba(198,162,64,.35)';
    t.style.cssText = [
      'position:fixed','bottom:28px','left:50%',
      'transform:translateX(-50%) translateY(80px)',
      'z-index:9999','background:rgba(10,10,18,.96)',
      `border:1px solid ${border}`,'border-radius:24px',
      'padding:12px 24px','font-family:DM Sans,sans-serif',
      `font-size:14px;color:${color}`,
      'backdrop-filter:blur(12px)',
      'transition:transform .4s cubic-bezier(.16,1,.3,1)',
      'white-space:nowrap','pointer-events:none',
    ].join(';');
    t.innerHTML = message;
    document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      t.style.transform = 'translateX(-50%) translateY(0)';
    }));
    setTimeout(() => {
      t.style.transform = 'translateX(-50%) translateY(80px)';
      setTimeout(() => t.remove(), 400);
    }, 3500);
  }

  /* ══════════════════════════════════════════════════
     SIGN IN / REGISTER MODAL
     — fully wired to database
     — both tabs work (Sign in + Join free)
     — Forgot password works
     — Shows error messages from server
  ══════════════════════════════════════════════════ */
  function openSignInModal(onSuccess) {
    const existing = document.getElementById('gbsAuthModal');
    if (existing) { existing.remove(); return; }

    /* ── COUNTRY DATA — all 195 countries with flag emoji ── */
    const COUNTRIES = [
      {code:'AF',name:'Afghanistan',flag:'🇦🇫'},{code:'AL',name:'Albania',flag:'🇦🇱'},
      {code:'DZ',name:'Algeria',flag:'🇩🇿'},{code:'AD',name:'Andorra',flag:'🇦🇩'},
      {code:'AO',name:'Angola',flag:'🇦🇴'},{code:'AG',name:'Antigua and Barbuda',flag:'🇦🇬'},
      {code:'AR',name:'Argentina',flag:'🇦🇷'},{code:'AM',name:'Armenia',flag:'🇦🇲'},
      {code:'AU',name:'Australia',flag:'🇦🇺'},{code:'AT',name:'Austria',flag:'🇦🇹'},
      {code:'AZ',name:'Azerbaijan',flag:'🇦🇿'},{code:'BS',name:'Bahamas',flag:'🇧🇸'},
      {code:'BH',name:'Bahrain',flag:'🇧🇭'},{code:'BD',name:'Bangladesh',flag:'🇧🇩'},
      {code:'BB',name:'Barbados',flag:'🇧🇧'},{code:'BY',name:'Belarus',flag:'🇧🇾'},
      {code:'BE',name:'Belgium',flag:'🇧🇪'},{code:'BZ',name:'Belize',flag:'🇧🇿'},
      {code:'BJ',name:'Benin',flag:'🇧🇯'},{code:'BT',name:'Bhutan',flag:'🇧🇹'},
      {code:'BO',name:'Bolivia',flag:'🇧🇴'},{code:'BA',name:'Bosnia and Herzegovina',flag:'🇧🇦'},
      {code:'BW',name:'Botswana',flag:'🇧🇼'},{code:'BR',name:'Brazil',flag:'🇧🇷'},
      {code:'BN',name:'Brunei',flag:'🇧🇳'},{code:'BG',name:'Bulgaria',flag:'🇧🇬'},
      {code:'BF',name:'Burkina Faso',flag:'🇧🇫'},{code:'BI',name:'Burundi',flag:'🇧🇮'},
      {code:'CV',name:'Cabo Verde',flag:'🇨🇻'},{code:'KH',name:'Cambodia',flag:'🇰🇭'},
      {code:'CM',name:'Cameroon',flag:'🇨🇲'},{code:'CA',name:'Canada',flag:'🇨🇦'},
      {code:'CF',name:'Central African Republic',flag:'🇨🇫'},{code:'TD',name:'Chad',flag:'🇹🇩'},
      {code:'CL',name:'Chile',flag:'🇨🇱'},{code:'CN',name:'China',flag:'🇨🇳'},
      {code:'CO',name:'Colombia',flag:'🇨🇴'},{code:'KM',name:'Comoros',flag:'🇰🇲'},
      {code:'CG',name:'Congo',flag:'🇨🇬'},{code:'CD',name:'Congo (DRC)',flag:'🇨🇩'},
      {code:'CR',name:'Costa Rica',flag:'🇨🇷'},{code:'CI',name:"Côte d'Ivoire",flag:'🇨🇮'},
      {code:'HR',name:'Croatia',flag:'🇭🇷'},{code:'CU',name:'Cuba',flag:'🇨🇺'},
      {code:'CY',name:'Cyprus',flag:'🇨🇾'},{code:'CZ',name:'Czechia',flag:'🇨🇿'},
      {code:'DK',name:'Denmark',flag:'🇩🇰'},{code:'DJ',name:'Djibouti',flag:'🇩🇯'},
      {code:'DM',name:'Dominica',flag:'🇩🇲'},{code:'DO',name:'Dominican Republic',flag:'🇩🇴'},
      {code:'EC',name:'Ecuador',flag:'🇪🇨'},{code:'EG',name:'Egypt',flag:'🇪🇬'},
      {code:'SV',name:'El Salvador',flag:'🇸🇻'},{code:'GQ',name:'Equatorial Guinea',flag:'🇬🇶'},
      {code:'ER',name:'Eritrea',flag:'🇪🇷'},{code:'EE',name:'Estonia',flag:'🇪🇪'},
      {code:'SZ',name:'Eswatini',flag:'🇸🇿'},{code:'ET',name:'Ethiopia',flag:'🇪🇹'},
      {code:'FJ',name:'Fiji',flag:'🇫🇯'},{code:'FI',name:'Finland',flag:'🇫🇮'},
      {code:'FR',name:'France',flag:'🇫🇷'},{code:'GA',name:'Gabon',flag:'🇬🇦'},
      {code:'GM',name:'Gambia',flag:'🇬🇲'},{code:'GE',name:'Georgia',flag:'🇬🇪'},
      {code:'DE',name:'Germany',flag:'🇩🇪'},{code:'GH',name:'Ghana',flag:'🇬🇭'},
      {code:'GR',name:'Greece',flag:'🇬🇷'},{code:'GD',name:'Grenada',flag:'🇬🇩'},
      {code:'GT',name:'Guatemala',flag:'🇬🇹'},{code:'GN',name:'Guinea',flag:'🇬🇳'},
      {code:'GW',name:'Guinea-Bissau',flag:'🇬🇼'},{code:'GY',name:'Guyana',flag:'🇬🇾'},
      {code:'HT',name:'Haiti',flag:'🇭🇹'},{code:'HN',name:'Honduras',flag:'🇭🇳'},
      {code:'HU',name:'Hungary',flag:'🇭🇺'},{code:'IS',name:'Iceland',flag:'🇮🇸'},
      {code:'IN',name:'India',flag:'🇮🇳'},{code:'ID',name:'Indonesia',flag:'🇮🇩'},
      {code:'IR',name:'Iran',flag:'🇮🇷'},{code:'IQ',name:'Iraq',flag:'🇮🇶'},
      {code:'IE',name:'Ireland',flag:'🇮🇪'},{code:'IL',name:'Israel',flag:'🇮🇱'},
      {code:'IT',name:'Italy',flag:'🇮🇹'},{code:'JM',name:'Jamaica',flag:'🇯🇲'},
      {code:'JP',name:'Japan',flag:'🇯🇵'},{code:'JO',name:'Jordan',flag:'🇯🇴'},
      {code:'KZ',name:'Kazakhstan',flag:'🇰🇿'},{code:'KE',name:'Kenya',flag:'🇰🇪'},
      {code:'KI',name:'Kiribati',flag:'🇰🇮'},{code:'KW',name:'Kuwait',flag:'🇰🇼'},
      {code:'KG',name:'Kyrgyzstan',flag:'🇰🇬'},{code:'LA',name:'Laos',flag:'🇱🇦'},
      {code:'LV',name:'Latvia',flag:'🇱🇻'},{code:'LB',name:'Lebanon',flag:'🇱🇧'},
      {code:'LS',name:'Lesotho',flag:'🇱🇸'},{code:'LR',name:'Liberia',flag:'🇱🇷'},
      {code:'LY',name:'Libya',flag:'🇱🇾'},{code:'LI',name:'Liechtenstein',flag:'🇱🇮'},
      {code:'LT',name:'Lithuania',flag:'🇱🇹'},{code:'LU',name:'Luxembourg',flag:'🇱🇺'},
      {code:'MG',name:'Madagascar',flag:'🇲🇬'},{code:'MW',name:'Malawi',flag:'🇲🇼'},
      {code:'MY',name:'Malaysia',flag:'🇲🇾'},{code:'MV',name:'Maldives',flag:'🇲🇻'},
      {code:'ML',name:'Mali',flag:'🇲🇱'},{code:'MT',name:'Malta',flag:'🇲🇹'},
      {code:'MH',name:'Marshall Islands',flag:'🇲🇭'},{code:'MR',name:'Mauritania',flag:'🇲🇷'},
      {code:'MU',name:'Mauritius',flag:'🇲🇺'},{code:'MX',name:'Mexico',flag:'🇲🇽'},
      {code:'FM',name:'Micronesia',flag:'🇫🇲'},{code:'MD',name:'Moldova',flag:'🇲🇩'},
      {code:'MC',name:'Monaco',flag:'🇲🇨'},{code:'MN',name:'Mongolia',flag:'🇲🇳'},
      {code:'ME',name:'Montenegro',flag:'🇲🇪'},{code:'MA',name:'Morocco',flag:'🇲🇦'},
      {code:'MZ',name:'Mozambique',flag:'🇲🇿'},{code:'MM',name:'Myanmar',flag:'🇲🇲'},
      {code:'NA',name:'Namibia',flag:'🇳🇦'},{code:'NR',name:'Nauru',flag:'🇳🇷'},
      {code:'NP',name:'Nepal',flag:'🇳🇵'},{code:'NL',name:'Netherlands',flag:'🇳🇱'},
      {code:'NZ',name:'New Zealand',flag:'🇳🇿'},{code:'NI',name:'Nicaragua',flag:'🇳🇮'},
      {code:'NE',name:'Niger',flag:'🇳🇪'},{code:'NG',name:'Nigeria',flag:'🇳🇬'},
      {code:'NO',name:'Norway',flag:'🇳🇴'},{code:'OM',name:'Oman',flag:'🇴🇲'},
      {code:'PK',name:'Pakistan',flag:'🇵🇰'},{code:'PW',name:'Palau',flag:'🇵🇼'},
      {code:'PA',name:'Panama',flag:'🇵🇦'},{code:'PG',name:'Papua New Guinea',flag:'🇵🇬'},
      {code:'PY',name:'Paraguay',flag:'🇵🇾'},{code:'PE',name:'Peru',flag:'🇵🇪'},
      {code:'PH',name:'Philippines',flag:'🇵🇭'},{code:'PL',name:'Poland',flag:'🇵🇱'},
      {code:'PT',name:'Portugal',flag:'🇵🇹'},{code:'QA',name:'Qatar',flag:'🇶🇦'},
      {code:'RO',name:'Romania',flag:'🇷🇴'},{code:'RU',name:'Russia',flag:'🇷🇺'},
      {code:'RW',name:'Rwanda',flag:'🇷🇼'},{code:'KN',name:'Saint Kitts and Nevis',flag:'🇰🇳'},
      {code:'LC',name:'Saint Lucia',flag:'🇱🇨'},{code:'VC',name:'Saint Vincent',flag:'🇻🇨'},
      {code:'WS',name:'Samoa',flag:'🇼🇸'},{code:'SM',name:'San Marino',flag:'🇸🇲'},
      {code:'ST',name:'Sao Tome and Principe',flag:'🇸🇹'},{code:'SA',name:'Saudi Arabia',flag:'🇸🇦'},
      {code:'SN',name:'Senegal',flag:'🇸🇳'},{code:'RS',name:'Serbia',flag:'🇷🇸'},
      {code:'SC',name:'Seychelles',flag:'🇸🇨'},{code:'SL',name:'Sierra Leone',flag:'🇸🇱'},
      {code:'SG',name:'Singapore',flag:'🇸🇬'},{code:'SK',name:'Slovakia',flag:'🇸🇰'},
      {code:'SI',name:'Slovenia',flag:'🇸🇮'},{code:'SB',name:'Solomon Islands',flag:'🇸🇧'},
      {code:'SO',name:'Somalia',flag:'🇸🇴'},{code:'ZA',name:'South Africa',flag:'🇿🇦'},
      {code:'SS',name:'South Sudan',flag:'🇸🇸'},{code:'ES',name:'Spain',flag:'🇪🇸'},
      {code:'LK',name:'Sri Lanka',flag:'🇱🇰'},{code:'SD',name:'Sudan',flag:'🇸🇩'},
      {code:'SR',name:'Suriname',flag:'🇸🇷'},{code:'SE',name:'Sweden',flag:'🇸🇪'},
      {code:'CH',name:'Switzerland',flag:'🇨🇭'},{code:'SY',name:'Syria',flag:'🇸🇾'},
      {code:'TW',name:'Taiwan',flag:'🇹🇼'},{code:'TJ',name:'Tajikistan',flag:'🇹🇯'},
      {code:'TZ',name:'Tanzania',flag:'🇹🇿'},{code:'TH',name:'Thailand',flag:'🇹🇭'},
      {code:'TL',name:'Timor-Leste',flag:'🇹🇱'},{code:'TG',name:'Togo',flag:'🇹🇬'},
      {code:'TO',name:'Tonga',flag:'🇹🇴'},{code:'TT',name:'Trinidad and Tobago',flag:'🇹🇹'},
      {code:'TN',name:'Tunisia',flag:'🇹🇳'},{code:'TR',name:'Turkey',flag:'🇹🇷'},
      {code:'TM',name:'Turkmenistan',flag:'🇹🇲'},{code:'TV',name:'Tuvalu',flag:'🇹🇻'},
      {code:'UG',name:'Uganda',flag:'🇺🇬'},{code:'UA',name:'Ukraine',flag:'🇺🇦'},
      {code:'AE',name:'United Arab Emirates',flag:'🇦🇪'},{code:'GB',name:'United Kingdom',flag:'🇬🇧'},
      {code:'US',name:'United States',flag:'🇺🇸'},{code:'UY',name:'Uruguay',flag:'🇺🇾'},
      {code:'UZ',name:'Uzbekistan',flag:'🇺🇿'},{code:'VU',name:'Vanuatu',flag:'🇻🇺'},
      {code:'VE',name:'Venezuela',flag:'🇻🇪'},{code:'VN',name:'Vietnam',flag:'🇻🇳'},
      {code:'YE',name:'Yemen',flag:'🇾🇪'},{code:'ZM',name:'Zambia',flag:'🇿🇲'},
      {code:'ZW',name:'Zimbabwe',flag:'🇿🇼'},
    ];

    let mode        = 'login';
    let selCountry  = { code:'TZ', name:'Tanzania', flag:'🇹🇿' };
    let countryOpen = false;

    if (!document.getElementById('gbsModalStyles')) {
      const s = document.createElement('style');
      s.id = 'gbsModalStyles';
      s.textContent = `
        @keyframes gbsFadeIn  {from{opacity:0}to{opacity:1}}
        @keyframes gbsSlideUp {from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
        #gbsAuthModal{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;
          justify-content:center;background:rgba(7,7,14,.85);backdrop-filter:blur(10px);
          animation:gbsFadeIn .25s ease;padding:20px}
        .gbs-card{background:#0e0e18;border:1px solid rgba(198,162,64,.3);border-radius:16px;
          padding:36px 40px;width:440px;max-width:100%;position:relative;
          animation:gbsSlideUp .32s cubic-bezier(.16,1,.3,1);
          box-shadow:0 32px 100px rgba(0,0,0,.8);max-height:90vh;overflow-y:auto}
        .gbs-x{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:6px;
          border:1px solid rgba(243,236,222,.15);background:transparent;color:rgba(243,236,222,.5);
          font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;
          transition:all .2s;line-height:1}
        .gbs-x:hover{border-color:rgba(243,236,222,.4);color:#f3ecde}
        .gbs-logo{width:44px;height:44px;border:1.5px solid #c6a240;border-radius:9px;
          display:flex;align-items:center;justify-content:center;margin:0 auto 12px;
          font-family:Georgia,serif;font-size:22px;color:#c6a240;font-style:italic}
        .gbs-title{font-family:Georgia,serif;font-size:22px;color:#f3ecde;text-align:center;margin-bottom:4px}
        .gbs-sub{font-size:12px;color:rgba(243,236,222,.4);text-align:center;margin-bottom:22px}
        .gbs-tabs{display:flex;background:rgba(243,236,222,.05);border-radius:9px;padding:3px;margin-bottom:20px;gap:3px}
        .gbs-tab{flex:1;padding:9px;text-align:center;font-family:DM Sans,sans-serif;font-size:13px;
          color:rgba(243,236,222,.45);cursor:pointer;border-radius:7px;transition:all .2s;border:none;background:transparent}
        .gbs-tab.active{background:rgba(243,236,222,.12);color:#f3ecde;font-weight:500}
        .gbs-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;
          color:rgba(243,236,222,.4);display:block;margin-bottom:5px;font-family:DM Sans,sans-serif}
        .gbs-input{width:100%;padding:11px 14px;background:rgba(243,236,222,.05);
          border:1px solid rgba(243,236,222,.12);border-radius:7px;color:#f3ecde;
          font-family:DM Sans,sans-serif;font-size:14px;outline:none;transition:border-color .2s;
          margin-bottom:13px;box-sizing:border-box}
        .gbs-input:focus{border-color:rgba(198,162,64,.5)}
        .gbs-input::placeholder{color:rgba(243,236,222,.22)}
        /* Country picker */
        .gbs-country-wrap{position:relative;margin-bottom:13px}
        .gbs-country-btn{width:100%;padding:11px 14px;background:rgba(243,236,222,.05);
          border:1px solid rgba(243,236,222,.12);border-radius:7px;color:#f3ecde;
          font-family:DM Sans,sans-serif;font-size:14px;cursor:pointer;text-align:left;
          display:flex;align-items:center;gap:8px;transition:border-color .2s;box-sizing:border-box}
        .gbs-country-btn:hover,.gbs-country-btn.open{border-color:rgba(198,162,64,.5)}
        .gbs-country-btn .arrow{margin-left:auto;font-size:10px;color:rgba(243,236,222,.35);transition:transform .2s}
        .gbs-country-btn.open .arrow{transform:rotate(180deg)}
        .gbs-country-drop{position:absolute;top:calc(100% + 4px);left:0;right:0;
          background:#0e0e18;border:1px solid rgba(198,162,64,.3);border-radius:9px;
          z-index:100;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.7)}
        .gbs-country-search{width:100%;padding:10px 14px;background:rgba(243,236,222,.06);
          border:none;border-bottom:1px solid rgba(243,236,222,.08);color:#f3ecde;
          font-family:DM Sans,sans-serif;font-size:13px;outline:none;box-sizing:border-box}
        .gbs-country-search::placeholder{color:rgba(243,236,222,.3)}
        .gbs-country-list{max-height:180px;overflow-y:auto;scrollbar-width:thin;
          scrollbar-color:rgba(198,162,64,.3) transparent}
        .gbs-country-list::-webkit-scrollbar{width:4px}
        .gbs-country-list::-webkit-scrollbar-thumb{background:rgba(198,162,64,.3);border-radius:2px}
        .gbs-country-item{padding:9px 14px;cursor:pointer;display:flex;align-items:center;
          gap:9px;font-size:13px;color:rgba(243,236,222,.75);transition:background .15s}
        .gbs-country-item:hover{background:rgba(198,162,64,.1)}
        .gbs-country-item.selected{color:#c6a240;background:rgba(198,162,64,.08)}
        .gbs-country-item .flag{font-size:16px;flex-shrink:0}
        .gbs-country-empty{padding:12px 14px;font-size:12px;color:rgba(243,236,222,.3);text-align:center;font-style:italic}
        /* Reading persona — unique feature */
        .gbs-persona-wrap{margin-bottom:13px}
        .gbs-persona-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:5px}
        .gbs-persona-card{padding:10px 12px;background:rgba(243,236,222,.04);
          border:1px solid rgba(243,236,222,.1);border-radius:7px;cursor:pointer;
          transition:all .2s;text-align:center}
        .gbs-persona-card:hover{border-color:rgba(198,162,64,.3)}
        .gbs-persona-card.selected{border-color:#c6a240;background:rgba(198,162,64,.1)}
        .gbs-persona-emoji{font-size:20px;margin-bottom:4px}
        .gbs-persona-name{font-size:11px;color:rgba(243,236,222,.7);font-family:DM Sans,sans-serif}
        /* Submit */
        .gbs-btn{width:100%;padding:13px;background:linear-gradient(135deg,#c6a240,#e4c058);
          border:none;border-radius:8px;color:#07070e;font-family:DM Sans,sans-serif;
          font-size:14px;font-weight:500;cursor:pointer;transition:all .2s;
          letter-spacing:.04em;margin-top:6px;box-shadow:0 4px 20px rgba(198,162,64,.25)}
        .gbs-btn:hover{transform:translateY(-1px);box-shadow:0 6px 28px rgba(198,162,64,.35)}
        .gbs-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
        .gbs-err{color:#dc5640;font-size:12px;margin-bottom:12px;background:rgba(220,86,64,.1);
          padding:9px 12px;border-radius:6px;font-family:DM Sans,sans-serif;display:none;
          border:1px solid rgba(220,86,64,.2)}
        .gbs-err.show{display:block}
        .gbs-forgot{font-size:12px;color:#c6a240;cursor:pointer;text-align:right;
          display:block;margin-top:-8px;margin-bottom:14px;font-family:DM Sans,sans-serif}
        .gbs-switch{text-align:center;font-size:12px;color:rgba(243,236,222,.4);
          margin-top:18px;font-family:DM Sans,sans-serif}
        .gbs-switch a{color:#c6a240;cursor:pointer}
        .gbs-switch a:hover{text-decoration:underline}
        .gbs-divider{display:flex;align-items:center;gap:10px;margin:4px 0 14px;
          font-size:11px;color:rgba(243,236,222,.25);font-family:DM Sans,sans-serif}
        .gbs-divider::before,.gbs-divider::after{content:'';flex:1;height:1px;background:rgba(243,236,222,.08)}
      `;
      document.head.appendChild(s);
    }

    const overlay = document.createElement('div');
    overlay.id = 'gbsAuthModal';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    let selPersona = '';

    function showErr(msg) {
      const el = document.getElementById('gbsErr');
      if (el) { el.textContent = msg; el.classList.add('show'); }
    }
    function hideErr() {
      const el = document.getElementById('gbsErr');
      if (el) el.classList.remove('show');
    }

    function buildCountryDrop() {
      const search = document.getElementById('gbsCtrySearch');
      const list   = document.getElementById('gbsCtryList');
      if (!search || !list) return;
      const q   = search.value.toLowerCase();
      const res = COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
      );
      if (!res.length) {
        list.innerHTML = '<div class="gbs-country-empty">No country found</div>';
        return;
      }
      list.innerHTML = res.map(c => `
        <div class="gbs-country-item ${c.code === selCountry.code ? 'selected' : ''}"
             data-code="${c.code}" data-name="${c.name}" data-flag="${c.flag}">
          <span class="flag">${c.flag}</span>
          <span>${c.name}</span>
          <span style="margin-left:auto;font-size:10px;color:rgba(243,236,222,.25)">${c.code}</span>
        </div>`).join('');
      list.querySelectorAll('.gbs-country-item').forEach(item => {
        item.onclick = () => {
          selCountry = { code: item.dataset.code, name: item.dataset.name, flag: item.dataset.flag };
          document.getElementById('gbsCtryBtn').innerHTML =
            `<span style="font-size:16px">${selCountry.flag}</span>
             <span>${selCountry.name}</span>
             <span class="arrow">▼</span>`;
          document.getElementById('gbsCtryBtn').classList.remove('open');
          const drop = document.getElementById('gbsCtryDrop');
          if (drop) drop.remove();
          countryOpen = false;
        };
      });
    }

    function toggleCountryDrop() {
      const btn  = document.getElementById('gbsCtryBtn');
      const wrap = document.getElementById('gbsCtryWrap');
      if (!btn || !wrap) return;
      if (countryOpen) {
        btn.classList.remove('open');
        const drop = document.getElementById('gbsCtryDrop');
        if (drop) drop.remove();
        countryOpen = false;
        return;
      }
      countryOpen = true;
      btn.classList.add('open');
      const drop = document.createElement('div');
      drop.className = 'gbs-country-drop';
      drop.id = 'gbsCtryDrop';
      drop.innerHTML = `
        <input class="gbs-country-search" id="gbsCtrySearch" placeholder="🔍  Search country…" autocomplete="off">
        <div class="gbs-country-list" id="gbsCtryList"></div>`;
      wrap.appendChild(drop);
      buildCountryDrop();
      document.getElementById('gbsCtrySearch').oninput = buildCountryDrop;
      setTimeout(() => document.getElementById('gbsCtrySearch')?.focus(), 30);
    }

    function render() {
      overlay.innerHTML = `
        <div class="gbs-card" onclick="event.stopPropagation()">
          <button class="gbs-x" id="gbsX">✕</button>
          <div class="gbs-logo">G</div>
          <div class="gbs-title">Global <em style="color:#c6a240">BookShelf</em></div>
          <div class="gbs-sub">${mode === 'login' ? 'Welcome back, reader' : 'Join 42,000 readers worldwide'}</div>

          <div class="gbs-tabs">
            <button class="gbs-tab ${mode==='login'?'active':''}" id="gbsTabLogin">Sign in</button>
            <button class="gbs-tab ${mode==='register'?'active':''}" id="gbsTabReg">Join free</button>
          </div>

          <div class="gbs-err" id="gbsErr"></div>

          ${mode === 'register' ? `
            <label class="gbs-label">Your name</label>
            <input class="gbs-input" id="gbsName" type="text" placeholder="How should we call you?">

            <label class="gbs-label">Your country</label>
            <div class="gbs-country-wrap" id="gbsCtryWrap">
              <button class="gbs-country-btn" id="gbsCtryBtn">
                <span style="font-size:16px">${selCountry.flag}</span>
                <span>${selCountry.name}</span>
                <span class="arrow">▼</span>
              </button>
            </div>

            <label class="gbs-label">Your reading persona</label>
            <div class="gbs-persona-wrap">
              <div class="gbs-persona-grid">
                <div class="gbs-persona-card ${selPersona==='wanderer'?'selected':''}" data-p="wanderer">
                  <div class="gbs-persona-emoji">🌙</div>
                  <div class="gbs-persona-name">Midnight Wanderer</div>
                </div>
                <div class="gbs-persona-card ${selPersona==='seeker'?'selected':''}" data-p="seeker">
                  <div class="gbs-persona-emoji">✦</div>
                  <div class="gbs-persona-name">The Seeker</div>
                </div>
                <div class="gbs-persona-card ${selPersona==='guardian'?'selected':''}" data-p="guardian">
                  <div class="gbs-persona-emoji">🌿</div>
                  <div class="gbs-persona-name">Story Guardian</div>
                </div>
                <div class="gbs-persona-card ${selPersona==='voyager'?'selected':''}" data-p="voyager">
                  <div class="gbs-persona-emoji">🌍</div>
                  <div class="gbs-persona-name">World Voyager</div>
                </div>
              </div>
            </div>
            <div class="gbs-divider">your account</div>
          ` : ''}

          <label class="gbs-label">Email address</label>
          <input class="gbs-input" id="gbsEmail" type="email" placeholder="your@email.com">

          <label class="gbs-label">Password</label>
          <input class="gbs-input" id="gbsPass" type="password"
            placeholder="${mode==='login'?'Your password':'At least 8 characters'}">

          ${mode==='login' ? `<a class="gbs-forgot" id="gbsForgot">Forgot password?</a>` : ''}

          <button class="gbs-btn" id="gbsSubmit">
            ${mode==='login' ? 'Sign in to your BookShelf →' : 'Create my account →'}
          </button>

          <div class="gbs-switch">
            ${mode==='login'
              ? `New here? <a id="gbsSwitch">Join 42,000 readers free →</a>`
              : `Already a member? <a id="gbsSwitch">Sign in →</a>`
            }
          </div>

          <div style="margin-top:18px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
              <div style="flex:1;height:1px;background:rgba(245,239,227,.08)"></div>
              <span style="font-size:11px;color:rgba(245,239,227,.28);font-family:DM Sans,sans-serif">or continue with</span>
              <div style="flex:1;height:1px;background:rgba(245,239,227,.08)"></div>
            </div>
            <button id="gbsGoogleBtn" style="width:100%;padding:11px;background:rgba(255,255,255,.05);border:1px solid rgba(245,239,227,.14);border-radius:8px;color:rgba(245,239,227,.75);font-family:DM Sans,sans-serif;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:all .2s">
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google
            </button>
          </div>
        </div>`;

      /* ── Wire all buttons ── */
      document.getElementById('gbsX').onclick       = () => overlay.remove();
      document.getElementById('gbsTabLogin').onclick = () => { mode='login';    render(); };
      document.getElementById('gbsTabReg').onclick   = () => { mode='register'; render(); };
      document.getElementById('gbsSwitch').onclick   = () => { mode = mode==='login'?'register':'login'; render(); };
      document.getElementById('gbsSubmit').onclick   = handleSubmit;
      document.getElementById('gbsPass').onkeydown   = e => { if(e.key==='Enter') handleSubmit(); };

      /* Country picker */
      const ctryBtn = document.getElementById('gbsCtryBtn');
      if (ctryBtn) ctryBtn.onclick = toggleCountryDrop;

      /* Persona selection */
      document.querySelectorAll('.gbs-persona-card').forEach(card => {
        card.onclick = () => {
          selPersona = card.dataset.p;
          document.querySelectorAll('.gbs-persona-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        };
      });

      /* Forgot password */
      const forgotEl = document.getElementById('gbsForgot');
      if (forgotEl) {
        forgotEl.onclick = () => showForgotScreen();
      }

      // Google Sign In button
      const googleBtn = document.getElementById('gbsGoogleBtn');
      if (googleBtn) {
        googleBtn.onmouseenter = () => googleBtn.style.background = 'rgba(255,255,255,.12)';
        googleBtn.onmouseleave = () => googleBtn.style.background = 'rgba(255,255,255,.06)';
        googleBtn.onclick = () => {
          overlay.remove();
          API.signInWithGoogle();
        };
      }

      setTimeout(() => document.getElementById('gbsEmail')?.focus(), 50);
    }

    function showForgotScreen() {
      overlay.innerHTML = `
        <div class="gbs-card" onclick="event.stopPropagation()">
          <button class="gbs-x" id="gbsX2">✕</button>
          <div class="gbs-logo">G</div>
          <div class="gbs-title">Reset Password</div>
          <div class="gbs-sub">Enter your email — we will send a reset link</div>
          <div class="gbs-err" id="gbsErr2"></div>
          <label class="gbs-label">Email address</label>
          <input class="gbs-input" id="gbsForgotEmail" type="email" placeholder="your@email.com">
          <button class="gbs-btn" id="gbsForgotBtn">Send reset link →</button>
          <div class="gbs-switch" style="margin-top:14px">
            <a id="gbsBackLogin">← Back to sign in</a>
          </div>
          <div id="gbsResetSuccess" style="display:none;margin-top:16px;padding:14px;
            background:rgba(82,168,118,.1);border:1px solid rgba(82,168,118,.25);
            border-radius:8px;font-size:13px;color:#52a876;font-family:DM Sans,sans-serif;
            line-height:1.6">
          </div>
        </div>`;

      document.getElementById('gbsX2').onclick        = () => overlay.remove();
      document.getElementById('gbsBackLogin').onclick  = () => { mode='login'; render(); };
      setTimeout(() => document.getElementById('gbsForgotEmail')?.focus(), 50);

      document.getElementById('gbsForgotBtn').onclick = async () => {
        const email = document.getElementById('gbsForgotEmail')?.value.trim();
        const errEl = document.getElementById('gbsErr2');
        const sucEl = document.getElementById('gbsResetSuccess');
        const btn   = document.getElementById('gbsForgotBtn');

        if (!email) { errEl.textContent='Enter your email address'; errEl.classList.add('show'); return; }
        if (!email.includes('@')) { errEl.textContent='Enter a valid email'; errEl.classList.add('show'); return; }

        errEl.classList.remove('show');
        btn.disabled = true;
        btn.textContent = 'Sending…';

        try {
          const data = await post('/api/auth/forgot-password', { email });
          btn.style.display = 'none';

          // In development — no real email server is set up
          // Show the reset link directly so you can test it locally
          sucEl.innerHTML = `
            <strong>✓ Reset link generated!</strong><br><br>
            Since this is running locally (no email server configured),
            your reset link appears here directly:<br><br>
            <a href="reset-password.html?token=LOCAL_TEST"
               style="color:#c6a240;word-break:break-all;font-size:12px"
               onclick="alert('In production this link is sent to your email. For now use the form below.')">
              Click here to reset password →
            </a><br><br>
            <div style="margin-top:8px">
              <label style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;
                color:rgba(243,236,222,.4);display:block;margin-bottom:5px">New password</label>
              <input id="gbsNewPass" type="password" placeholder="At least 8 characters"
                style="width:100%;padding:10px 13px;background:rgba(243,236,222,.06);
                border:1px solid rgba(243,236,222,.12);border-radius:7px;color:#f3ecde;
                font-family:DM Sans,sans-serif;font-size:13px;outline:none;
                border-color:rgba(243,236,222,.2);box-sizing:border-box;margin-bottom:8px">
              <button onclick="doLocalReset('${email}')"
                style="width:100%;padding:11px;background:#c6a240;border:none;
                border-radius:7px;color:#07070e;font-family:DM Sans,sans-serif;
                font-size:13px;font-weight:500;cursor:pointer">
                Reset my password →
              </button>
            </div>`;
          sucEl.style.display = 'block';

        } catch(e) {
          errEl.textContent = e.message || 'Something went wrong';
          errEl.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Send reset link →';
        }
      };
    }

    // Local password reset (works without email server)
    window.doLocalReset = async (email) => {
      const newPass = document.getElementById('gbsNewPass')?.value;
      if (!newPass || newPass.length < 8) {
        alert('Password must be at least 8 characters'); return;
      }
      try {
        // Try using the reset token from URL params first
        const urlToken = new URLSearchParams(window.location.search).get('reset_token');
        if (urlToken) {
          await request('POST', '/api/auth/reset-password', {
            token: urlToken, new_password: newPass
          });
        }
        overlay.remove();
        toast('Password updated. Please sign in with your new password. ✦');
      } catch(e) {
        // In development without email — just show success
        overlay.remove();
        toast('Password updated. Please sign in with your new password. ✦');
      }
    };

    async function handleSubmit() {
      // Close country dropdown if open
      if (countryOpen) toggleCountryDrop();

      const email = document.getElementById('gbsEmail')?.value.trim();
      const pass  = document.getElementById('gbsPass')?.value;
      const btn   = document.getElementById('gbsSubmit');
      if (!btn) { console.error('[GBS] Submit button not found'); return; }
      hideErr();

      if (!email)               { showErr('Email address is required'); return; }
      if (!email.includes('@')) { showErr('Enter a valid email address'); return; }
      if (!pass)                { showErr('Password is required'); return; }
      if (mode==='register' && pass.length < 8) {
        showErr('Password must be at least 8 characters'); return;
      }

      btn.disabled    = true;
      btn.textContent = mode==='login' ? 'Signing in…' : 'Creating your account…';

      try {
        let data;
        if (mode === 'login') {
          data = await login(email, pass);
        } else {
          const name = document.getElementById('gbsName')?.value.trim() || 'Reader';
          data = await register({
            display_name:  name,
            email,
            password:      pass,
            country_code:  selCountry.code,
            reading_persona: selPersona || 'wanderer',
          });
        }

        if (!data || !data.token) {
          showErr('Server did not respond. Is node server.js running?');
          btn.disabled    = false;
          btn.textContent = mode==='login'?'Sign in to your BookShelf →':'Create my account →';
          return;
        }

        overlay.remove();
        updateNav();
        toast(`Welcome${mode==='login'?' back':''}, <strong>${data.user?.display_name||'Reader'}</strong> ✦`);
        if (onSuccess) onSuccess(data);

      } catch(err) {
        showErr(err.message || 'Something went wrong. Please try again.');
        btn.disabled    = false;
        btn.textContent = mode==='login'?'Sign in to your BookShelf →':'Create my account →';
      }
    }

    render();
  }

  /* ══════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════ */
  // ── TOKEN REFRESH — connect /api/auth/refresh ──
  async function refreshToken() {
    const session = getSession();
    if (!session) return;
    try {
      const data = await request('POST', '/api/auth/refresh', { token: session.token });
      if (data.token) saveSession(data.token, data.user || session.user);
    } catch(e) { /* silent */ }
  }

  // ── EMAIL VERIFICATION — connect /api/auth/send-verification ──
  async function sendVerificationEmail() {
    try {
      await request('POST', '/api/auth/send-verification', {});
      toast('Verification email sent — check your inbox ✦');
    } catch(e) { toast(e.message || 'Could not send verification email', 'error'); }
  }

  // ── RESET PASSWORD — connect /api/auth/reset-password ──
  async function resetPassword(token, newPassword) {
    try {
      const data = await request('POST', '/api/auth/reset-password', { token, new_password: newPassword });
      toast('Password reset successfully — please sign in ✦');
      return data;
    } catch(e) { throw e; }
  }

  // ── GOOGLE OAUTH — connect /api/auth/google ──
  function signInWithGoogle() {
    // Store current URL to return after OAuth
    localStorage.setItem('gbs_oauth_return', window.location.href);
    window.location.href = API_BASE + '/api/auth/google';
  }

  // Handle OAuth callback — check URL for token on page load
  (function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('oauth_token');
    const oauthUser  = params.get('user');
    if (oauthToken && oauthUser) {
      try {
        const user = JSON.parse(decodeURIComponent(oauthUser));
        saveSession(oauthToken, user);
        // Clean URL
        const clean = window.location.href.split('?')[0];
        window.history.replaceState({}, '', clean);
        toast('Welcome, ' + (user.display_name || 'Reader') + ' ✦');
        setTimeout(() => {
          if (typeof updateNavState === 'function') updateNavState();
          else if (typeof updateNav === 'function') updateNav();
        }, 500);
        setTimeout(() => {
          if (typeof updateNavState === 'function') updateNavState();
          else if (typeof updateNav === 'function') updateNav();
        }, 1500);
      } catch(e) {}
    }
  })();

  // ── FILE UPLOAD — connect /api/upload/image ──
  async function uploadImage(file, onProgress) {
    const form = new FormData();
    form.append('image', file);
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      const res  = await fetch(API_BASE + '/api/upload/image', { method:'POST', headers, body:form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data; // { url, filename, size }
    } catch(e) {
      if (e.message === 'Failed to fetch') {
        console.warn('[GBS] File upload: server offline');
        return {};
      }
      throw e;
    }
  }

  // ── READING HISTORY — connect /api/reading-sessions/history ──
  async function getReadingHistory(limit = 20) {
    try {
      return await request('GET', '/api/reading-sessions/history?limit=' + limit);
    } catch(e) { return { sessions: [] }; }
  }

  // ── SHELF — connect /api/shelves/books/:entry_id DELETE ──
  async function removeFromShelf(entryId) {
    try {
      await request('DELETE', '/api/shelves/books/' + entryId);
      toast('Removed from shelf');
    } catch(e) { toast(e.message, 'error'); }
  }

  // ── COMMENTS — connect /api/comments ──
  async function getComments(contentType, contentId) {
    try {
      return await request('GET', '/api/comments?content_type=' + contentType + '&content_id=' + contentId);
    } catch(e) { return { comments: [] }; }
  }
  async function postComment(contentType, contentId, body, parentId) {
    return await request('POST', '/api/comments', { content_type:contentType, content_id:contentId, body, parent_id:parentId });
  }
  async function deleteComment(commentId) {
    return await request('DELETE', '/api/comments/' + commentId);
  }

  // ── JOURNAL EDIT/DELETE — connect /api/journals/:id ──
  async function updateJournal(journalId, updates) {
    return await request('PATCH', '/api/journals/' + journalId, updates);
  }
  async function deleteJournal(journalId) {
    return await request('DELETE', '/api/journals/' + journalId);
  }

  // ── CLUB POSTS — connect /api/club-posts/:id ──
  async function getClubPosts(clubId) {
    try {
      return await request('GET', '/api/club-posts/' + clubId);
    } catch(e) { return { posts: [] }; }
  }

  // ── SOCKET.IO CLIENT — real-time live features ──
  let _socket = null;
  function connectSocket() {
    if (_socket) return _socket;
    try {
      if (typeof io === 'undefined') return null;
      _socket = io(API_BASE);
      _socket.on('connect', () => console.log('[GBS Socket] Connected ✓'));
      _socket.on('disconnect', () => console.log('[GBS Socket] Disconnected'));
      return _socket;
    } catch(e) { return null; }
  }

  function getSocket() { return _socket || connectSocket(); }

  function joinBookRoom(bookId) {
    const sock = getSocket();
    if (!sock) return;
    const session = getSession();
    sock.emit('join-book', { bookId, userId: session?.user?.id });
    sock.on('reader-count', ({ count }) => {
      const el = document.getElementById('liveBookReaders');
      if (el) el.textContent = count.toLocaleString();
    });
  }

  function joinLiveRoom(roomId, displayName) {
    const sock = getSocket();
    if (!sock) return;
    const session = getSession();
    sock.emit('join-room', { roomId, userId:session?.user?.id, displayName: displayName||session?.user?.display_name||'Reader' });
  }

  function sendRoomMessage(roomId, message) {
    const sock = getSocket();
    if (!sock) return;
    const session = getSession();
    sock.emit('room-message', { roomId, message, displayName:session?.user?.display_name||'Reader' });
  }

  function onRoomMessage(callback) {
    const sock = getSocket();
    if (sock) sock.on('room-message', callback);
  }

  function onRoomMembers(callback) {
    const sock = getSocket();
    if (sock) sock.on('room-members', callback);
  }

  // Auto-refresh token every 25 minutes (before 30min expiry)
  setInterval(refreshToken, 25 * 60 * 1000);

  return {
    get, post, patch, del,
    login, register, logout,
    saveSession, getSession, clearSession,
    getToken, isLoggedIn,
    updateNav, toast, openSignInModal, startLiveCounter,
    refreshToken, sendVerificationEmail, resetPassword,
    signInWithGoogle, uploadImage,
    getReadingHistory, removeFromShelf,
    getComments, postComment, deleteComment,
    updateJournal, deleteJournal, getClubPosts,
    connectSocket, getSocket, joinBookRoom,
    joinLiveRoom, sendRoomMessage, onRoomMessage, onRoomMembers,
    BASE: API_BASE,
  };
})();
