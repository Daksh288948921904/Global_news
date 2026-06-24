/* ═══════════════════════════════════════════════════════════════
   Global News — Published Feed
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────
let ALL     = [];
let SHOWN   = [];
let CAT     = 'all';
let COUNTRY = null;
let Q       = '';
let SORT    = 'new';
let VIEW    = 'grid';
let READER_OPEN        = false;
let CURRENT_ARTICLE    = null;  // full article object
let CURRENT_ARTICLE_ID    = null;  // UUID
let LEAD_STORY_ARTICLE    = null;
let LEAD_STORY_ARTICLE_ID = null;

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sidebar      = $('sidebar');
const sbBackdrop   = $('sb-backdrop');
const gridEl       = $('grid');
const listEl       = $('list-view');
const emptyEl      = $('empty');
const skelEl       = $('skeleton');
const searchEl     = $('search');
const sortEl       = $('sort');
const refreshBtn   = $('btn-refresh');
const refreshSpinner = $('refresh-spinner');
const refreshLabel = $('refresh-label');
const tickerContent  = $('ticker-content');
const toastStack   = $('toast-stack');

// ── Category config ───────────────────────────────────────────
const CATS = {
  politics:      { cls:'c-politics',     emoji:'🏛', re:/election|government|parliament|minister|politics|president|prime minister|congress|senate|democrat|republican|modi|trump|biden/i },
  world:         { cls:'c-world',        emoji:'🌐', re:/international|foreign|global|war|peace|diplomacy|treaty|nato|united nations|conflict|military|ceasefire|sanctions/i },
  technology:    { cls:'c-technology',   emoji:'⚡', re:/\btech\b|technology|artificial intelligence|\bai\b|software|hardware|cyber|digital|startup|apple|google|meta|microsoft|openai|robot|machine learning/i },
  business:      { cls:'c-business',     emoji:'📈', re:/business|economy|market|stock|company|corporate|trade|finance|gdp|inflation|revenue|profit|tariff|federal reserve|central bank/i },
  sports:        { cls:'c-sports',       emoji:'🏆', re:/\bsport\b|football|cricket|tennis|olympic|championship|athlete|soccer|nba|nfl|ipl|formula one|f1\b|league|tournament/i },
  entertainment: { cls:'c-entertainment',emoji:'🎬', re:/entertainment|movie|music|celebrity|film|actor|actress|hollywood|bollywood|netflix|oscar|grammy|concert/i },
  health:        { cls:'c-health',       emoji:'🩺', re:/health|medical|disease|hospital|doctor|patient|medicine|covid|virus|cancer|vaccine|fda|who|pandemic|clinical/i },
  science:       { cls:'c-science',      emoji:'🔬', re:/\bscience\b|research study|scientist|discovery|space|climate|nasa|physics|biology|genome|experiment|astronomy/i },
};

function catOf(a) {
  // Prefer the stored category field if it matches one of our CATS keys
  const stored = (a.category || '').toLowerCase().trim();
  if (CATS[stored]) return { key: stored, ...CATS[stored] };

  // Fall back to text matching
  const txt = `${a.heading || ''} ${(a.story || '').slice(0, 300)}`;
  for (const [k, v] of Object.entries(CATS)) if (v.re.test(txt)) return { key: k, ...v };
  return { key: 'news', cls: 'c-news', emoji: '📰' };
}

// ── Helpers ───────────────────────────────────────────────────
function relTime(s) {
  if (!s) return 'Recent';
  try {
    const d = new Date(s), diff = Date.now() - d;
    if (diff < 60e3)    return 'Just now';
    if (diff < 3600e3)  return `${Math.floor(diff / 60e3)}m ago`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
    if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return 'Recent'; }
}

function wc(a) { return a.word_count || (a.story || '').split(/\s+/).filter(Boolean).length; }
function rt(n)  { return `${Math.max(1, Math.ceil(n / 200))} min`; }

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stagger(el, i) {
  el.style.animationDelay = `${Math.min(i * 35, 350)}ms`;
}

function hexRgba(hex, a) {
  const n = parseInt(hex.replace('#',''), 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

// ── Ticker (legacy, no-op if element absent) ──────────────────
function buildTicker(articles) {
  if (!articles.length || !tickerContent) return;
  const sep   = `<span class="ticker-sep">◆</span>`;
  const inner = articles.slice(0, 14).map(a => `<span>${esc(a.heading || '')}</span>`).join(sep);
  tickerContent.innerHTML = inner + sep + inner;
}

// ── Feed breaking-news ticker ─────────────────────────────────
function buildFeedTicker(articles) {
  const el = $('fh-ticker-inner');
  if (!el || !articles.length) return;
  const sep  = `<span class="fh-sep">◆</span>`;
  const items = articles.map(a =>
    `<span class="fh-item" onclick="openReader('${esc(a.id)}')">${esc(a.heading || '')}</span>`
  ).join(sep);
  // duplicate for seamless loop
  el.innerHTML = items + sep + items;
  // adjust speed: ~14px per char width average
  const dur = Math.max(30, articles.length * 4);
  el.style.animationDuration = dur + 's';
}

// ── Badges & stats ────────────────────────────────────────────
function refreshMeta(articles) {
  const cnts = { all: articles.length };
  articles.forEach(a => { const k = catOf(a).key; cnts[k] = (cnts[k] || 0) + 1; });
  Object.keys({ all: 0, ...CATS }).forEach(k => {
    const el = $(`cnt-${k}`);
    if (el) el.textContent = cnts[k] || 0;
  });

  const statsGrid = document.querySelector('.stats-grid');
  if (statsGrid) { statsGrid.classList.add('updating'); setTimeout(() => statsGrid.classList.remove('updating'), 600); }

  function bump(id, val) {
    const el = $(id); if (!el) return;
    el.textContent = val;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  bump('s-articles', articles.length);
  bump('s-updated', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  buildCountryList(articles);
}

function _extractCountry(a) {
  const raw = (a.region || a.location || '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0]).toUpperCase();
}

// ── World Clock ───────────────────────────────────────────────
(function initWorldClock() {
  const CITIES = [
    { name: 'New York',   tz: 'America/New_York' },
    { name: 'London',     tz: 'Europe/London' },
    { name: 'Paris',      tz: 'Europe/Paris' },
    { name: 'Dubai',      tz: 'Asia/Dubai' },
    { name: 'Mumbai',     tz: 'Asia/Kolkata' },
    { name: 'Singapore',  tz: 'Asia/Singapore' },
    { name: 'Tokyo',      tz: 'Asia/Tokyo' },
    { name: 'Sydney',     tz: 'Australia/Sydney' },
    { name: 'Los Angeles',tz: 'America/Los_Angeles' },
    { name: 'São Paulo',  tz: 'America/Sao_Paulo' },
  ];
  let idx = 0;
  const slide   = $('wc-slide');
  const cityEl  = $('wc-city');
  const timeEl  = $('wc-time');
  if (!slide || !cityEl || !timeEl) return;

  function fmt(tz) {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function tick() { if (timeEl) timeEl.textContent = fmt(CITIES[idx].tz); }

  function rotate() {
    slide.classList.add('exit');
    setTimeout(() => {
      idx = (idx + 1) % CITIES.length;
      cityEl.textContent = CITIES[idx].name;
      timeEl.textContent = fmt(CITIES[idx].tz);
      slide.classList.remove('exit');
      slide.classList.add('enter');
      requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.remove('enter')));
    }, 350);
  }

  // init
  cityEl.textContent = CITIES[0].name;
  timeEl.textContent = fmt(CITIES[0].tz);
  setInterval(tick, 1000);
  setInterval(rotate, 4000);
})();


function buildCountryList(articles) {
  const wrap = $('cbar-inner');
  if (!wrap) return;

  const countryCounts = {};
  const cityCounts    = {};
  (articles || ALL).forEach(a => {
    const c = _extractCountry(a);
    if (c) countryCounts[c] = (countryCounts[c] || 0) + 1;
    const city = (a.city || '').trim();
    if (city) cityCounts[city] = (cityCounts[city] || 0) + 1;
  });

  const sorted   = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);
  const topCities = Object.entries(cityCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const toTitle  = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  let html = `<button class="cbar-chip${!COUNTRY ? ' active' : ''}" data-country="">
    <span class="cbar-chip-label">🌍 All</span>
  </button>`;

  if (topCities.length) {
    html += `<div class="cbar-divider"></div>`;
    html += topCities.map(([city]) => `
      <button class="cbar-chip cbar-city${COUNTRY === city ? ' active' : ''}" data-country="${esc(city)}" title="Top city">
        <span class="cbar-chip-label">📍 ${esc(toTitle(city))}</span>
        <span class="cbar-chip-count">${cityCounts[city]}</span>
      </button>`).join('');
    html += `<div class="cbar-divider"></div>`;
  }

  html += sorted.map(([country, count]) => `
    <button class="cbar-chip${COUNTRY === country ? ' active' : ''}" data-country="${esc(country)}">
      <span class="cbar-chip-label">${esc(toTitle(country))}</span>
      <span class="cbar-chip-count">${count}</span>
    </button>`).join('');

  wrap.innerHTML = html;

  wrap.querySelectorAll('.cbar-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.country;
      COUNTRY = (COUNTRY === val || val === '') ? null : val;
      wrap.querySelectorAll('.cbar-chip').forEach(b =>
        b.classList.toggle('active', b.dataset.country === (COUNTRY || '')));
      if (COUNTRY) {
        document.querySelectorAll('#nav-list .nav-btn').forEach(b => b.classList.remove('active'));
        $('nav-list').querySelector('[data-cat="all"]').classList.add('active');
        CAT = 'all';
      }
      applyFilters();
    });
  });
}

// ── Filter & sort ─────────────────────────────────────────────
function applyFilters() {
  let list = ALL;
  if (CAT !== 'all') list = list.filter(a => catOf(a).key === CAT);
  if (COUNTRY)       list = list.filter(a => (a.country || _extractCountry(a) || '') === COUNTRY);
  if (Q) {
    const q = Q.toLowerCase();
    list = list.filter(a =>
      (a.heading || '').toLowerCase().includes(q) ||
      (a.story   || '').toLowerCase().includes(q) ||
      (a.source_name || '').toLowerCase().includes(q)
    );
  }
  if      (SORT === 'new')  list = [...list].sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
  else if (SORT === 'old')  list = [...list].sort((a, b) => new Date(a.published_at || 0) - new Date(b.published_at || 0));
  else if (SORT === 'long') list = [...list].sort((a, b) => wc(b) - wc(a));

  // Pin lead story to the top regardless of sort
  const leadIdx = list.findIndex(a => a.is_lead_story);
  if (leadIdx > 0) {
    const [lead] = list.splice(leadIdx, 1);
    list.unshift(lead);
  }

  SHOWN = list;
  renderFeed();
}

// ── Render ────────────────────────────────────────────────────
const CAT_COLORS = {
  politics:      ['#ef4444', '#dc2626'],
  world:         ['#3b82f6', '#2563eb'],
  technology:    ['#8b5cf6', '#7c3aed'],
  business:      ['#10b981', '#059669'],
  sports:        ['#f97316', '#ea580c'],
  entertainment: ['#ec4899', '#db2777'],
  health:        ['#06b6d4', '#0891b2'],
  science:       ['#a78bfa', '#7c3aed'],
  news:          ['#6366f1', '#4f46e5'],
};

const CAT_ICONS = {
  politics: '🏛', world: '🌐', technology: '⚡', business: '📈',
  sports: '🏆', entertainment: '🎬', health: '🩺', science: '🔬', news: '📰',
};

function langBadge(a) {
  const code = (a.language || 'en').toLowerCase().split('-')[0];
  if (!code || code === 'en') return '';
  const LANG_NAMES = {
    'ar':'Arabic','bn':'Bengali','zh':'Chinese','nl':'Dutch','fr':'French',
    'de':'German','gu':'Gujarati','hi':'Hindi','id':'Indonesian','it':'Italian',
    'ja':'Japanese','ko':'Korean','ml':'Malayalam','mr':'Marathi','pa':'Punjabi',
    'pt':'Portuguese','ru':'Russian','es':'Spanish','ta':'Tamil','te':'Telugu',
    'tr':'Turkish','ur':'Urdu',
  };
  return `<span class="card-lang-badge">${LANG_NAMES[code] || code.toUpperCase()}</span>`;
}

function cardHTML(a, i) {
  const cat    = catOf(a);
  const words  = wc(a);
  const img    = a.image_url || '';
  const date   = relTime(a.published_at || a.created_at);
  const isHero = i === 0;
  const lede   = (a.story || '').replace(/#{1,3}\s/g, '').replace(/\*\*/g, '').slice(0, 220);
  const [c1]   = CAT_COLORS[cat.key] || CAT_COLORS.news;

  let media;
  if (img) {
    media = `
      <div class="card-media" data-loaded="false">
        <img class="card-img" src="${esc(img)}" loading="lazy" alt=""
          onload="this.closest('.card-media').dataset.loaded='true'"
          onerror="this.closest('.card-media').classList.add('card-blank-fallback');this.remove()">
        <div class="card-overlay"></div>
      </div>`;
  } else {
    media = `
      <div class="card-media card-blank" style="background:linear-gradient(145deg,${c1}28 0%,rgba(9,9,11,.98) 65%),repeating-linear-gradient(-45deg,transparent,transparent 38px,rgba(255,255,255,.018) 38px,rgba(255,255,255,.018) 39px)">
        <div class="card-blank-icon">${CAT_ICONS[cat.key] || '📰'}</div>
        <div class="card-blank-wordmark">${esc((a.source_name || '').toUpperCase())}</div>
        <div class="card-overlay"></div>
      </div>`;
  }

  const sub = (a.sub_heading || '').trim();

  return `<article class="card${isHero ? ' card-hero' : ''}" data-cat="${cat.key}" onclick="openReader('${esc(a.id)}')">
    ${media}
    <div class="card-badges">
      <span class="card-cat-badge ${cat.cls}">${cat.key === 'world' && (a.country || _extractCountry(a)) ? (a.country || _extractCountry(a)).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : cat.key}</span>
      ${langBadge(a)}
      <img class="card-logo-badge" src="/static/img/logo.svg" alt="G">
    </div>
    ${a.is_lead_story ? `<span class="card-featured-label">Lead Story</span>` : ''}
    <div class="card-hover-sub" style="background:linear-gradient(to top,${hexRgba(c1,.52)} 0%,${hexRgba(c1,.28)} 55%,transparent 100%);border-top:1px solid ${hexRgba(c1,.32)}">
      ${!isHero ? `<div class="chsub-title">${esc(a.heading || '')}</div>` : ''}
      ${sub ? `<div class="chsub-body">${esc(sub)}</div>` : ''}
      ${(a.reporter || (Array.isArray(a.authors) ? a.authors[0] : a.authors)) ? `<div class="chsub-author">✍ ${esc(a.reporter || (Array.isArray(a.authors) ? a.authors[0] : a.authors))}</div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-source-row">
        <span class="card-source-dot"></span>
        <span class="card-source">${esc(a.source_name || 'DNL Global')}</span>
        ${a.region ? `<span class="card-region">· ${esc(a.region)}</span>` : ''}
        <span class="card-date">${date}</span>
      </div>
      <div class="card-rt-line">${rt(words)} read</div>
      <h3 class="card-title">${esc(a.heading || 'Untitled')}</h3>
      ${isHero && lede ? `<p class="card-lede">${esc(lede)}</p>` : ''}
    </div>
  </article>`;
}

function listCardHTML(a, i) {
  const cat   = catOf(a);
  const img   = a.image_url || '';
  const date  = relTime(a.published_at || a.created_at);
  const abbr  = (a.source_name || '').slice(0, 4).toUpperCase() || cat.key.slice(0, 4).toUpperCase();
  const thumb = img
    ? `<div class="list-thumb"><img src="${esc(img)}" loading="lazy"
         onerror="this.parentElement.className='list-thumb no-img-sm';this.parentElement.textContent='${abbr}'"></div>`
    : `<div class="list-thumb no-img-sm" style="font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--ink4)">${abbr}</div>`;

  return `<div class="list-card" onclick="openReader('${esc(a.id)}')">
    ${thumb}
    <div class="list-main">
      <div class="list-source">${esc(a.source_name || 'DNL Global')}${a.region ? ` <span style="color:var(--ink4);font-weight:400">· ${esc(a.region)}</span>` : ''}</div>
      <div class="list-title">${esc(a.heading || 'Untitled')}</div>
    </div>
    <div class="list-meta">
      <span class="list-date">${date}</span>
      ${langBadge(a)}
      <span class="list-badge ${cat.cls}">${cat.key}</span>
    </div>
  </div>`;
}

function renderFeed() {

  const hdrCount = $('feed-header-count');
  const hdrTitle = $('feed-header-title');
  const hdrDate  = $('feed-header-date');
  if (hdrCount) hdrCount.textContent = SHOWN.length ? `${SHOWN.length} stor${SHOWN.length === 1 ? 'y' : 'ies'}` : '';
  if (hdrTitle) {
    const activeCat = document.querySelector('#cat-bar .catb.active[data-cat]');
    const label = activeCat ? (activeCat.textContent.trim().replace(/\d+/g, '').trim() || 'All Stories') : 'All Stories';
    hdrTitle.textContent = label;
  }
  if (hdrDate) {
    hdrDate.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  if (!SHOWN.length) {
    gridEl.innerHTML = ''; listEl.innerHTML = '';
    gridEl.classList.add('hidden'); listEl.classList.add('hidden');
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  if (VIEW === 'grid') {
    listEl.classList.add('hidden');
    gridEl.classList.remove('hidden');
    gridEl.innerHTML = SHOWN.map((a, i) => cardHTML(a, i)).join('');
    gridEl.querySelectorAll('.card').forEach((el, i) => stagger(el, i));
  } else {
    gridEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    listEl.innerHTML = SHOWN.map((a, i) => listCardHTML(a, i)).join('');
    listEl.querySelectorAll('.list-card').forEach((el, i) => stagger(el, i));
  }
}

// ── Sidebar Breaking News rotation ───────────────────────────
let _sbnPage  = 0;
let _sbnTimer = null;

function renderSidebarBN() {
  const leadEl    = $('sbn-lead');
  const storiesEl = $('sbn-stories');
  const dotsEl    = $('sbn-dots');
  if (!storiesEl) return;

  // Current lead story is shown in the main hero — hide it from sidebar
  if (leadEl) leadEl.classList.add('hidden');

  // Rotating 3 stories — previous lead stories only, exclude current lead
  const pool  = ALL.filter(a => a.was_lead_story && !a.is_lead_story);
  const pages = Math.max(1, Math.ceil(pool.length / 3));
  const page  = _sbnPage % pages;
  const slice = pool.slice(page * 3, page * 3 + 3);

  storiesEl.innerHTML = slice.map(a => {
    const cat = catOf(a);
    return `<div class="sbn-card" onclick="openReader('${esc(a.id)}')">
      ${a.image_url
        ? `<img class="sbn-img" src="${esc(a.image_url)}" loading="lazy">`
        : `<div class="sbn-img-ph">${CAT_ICONS[cat.key] || '📰'}</div>`}
      <div class="sbn-info">
        <span class="sbn-cat ${cat.cls}">${cat.key}</span>
        <div class="sbn-title">${esc(a.heading || '')}</div>
      </div>
    </div>`;
  }).join('');

  // Dots
  if (pages > 1) {
    dotsEl.innerHTML = Array.from({length: Math.min(pages, 8)}, (_, i) =>
      `<span class="sbn-dot${i === page ? ' active' : ''}" data-p="${i}"></span>`
    ).join('');
    dotsEl.querySelectorAll('.sbn-dot').forEach(d =>
      d.addEventListener('click', () => { _sbnPage = +d.dataset.p; renderSidebarBN(); })
    );
  } else {
    dotsEl.innerHTML = '';
  }
}

function startSidebarBN() {
  renderSidebarBN();
  if (_sbnTimer) clearInterval(_sbnTimer);
  _sbnTimer = setInterval(() => {
    const storiesEl = $('sbn-stories');
    if (!storiesEl) return;
    const pool  = ALL.filter(a => a.was_lead_story && !a.is_lead_story);
    const pages = Math.max(1, Math.ceil(pool.length / 3));
    if (pages <= 1) return;
    storiesEl.classList.add('fading');
    setTimeout(() => {
      _sbnPage = (_sbnPage + 1) % pages;
      renderSidebarBN();
      storiesEl.classList.remove('fading');
    }, 260);
  }, 10000);
}

// ── Reader ────────────────────────────────────────────────────
const readerOverlay = $('reader-overlay');
const readerScroll  = $('reader-scroll');
const readerProg    = $('reader-prog');

function openReader(articleId) {
  const a = ALL.find(x => x.id === articleId);
  if (!a) return;

  CURRENT_ARTICLE    = a;
  CURRENT_ARTICLE_ID = a.id;

  const cat   = catOf(a);
  const words = wc(a);

  // Header
  $('rh-meta').innerHTML = `
    <span class="rh-cat ${cat.cls}">${cat.key}</span>
    <span class="rh-source">${esc(a.source_name || 'DNL Global')}</span>
    <span class="rh-date">${relTime(a.published_at || a.created_at)} · ${words} words · ${rt(words)} read</span>
  `;
  const extLink = $('reader-ext');
  if (a.source_url) { extLink.href = a.source_url; extLink.style.display = ''; }
  else extLink.style.display = 'none';

  $('r-cat').textContent = cat.key;
  $('r-cat').className   = `reader-cat-pill ${cat.cls}`;
  $('r-title').textContent = a.heading || 'Untitled';

  const deck = a.sub_heading || '';
  $('r-deck').textContent  = deck;
  $('r-deck').style.display = deck ? '' : 'none';

  const authorList = Array.isArray(a.authors) ? a.authors : (a.authors ? [a.authors] : []);
  const bylineParts = [
    a.reporter ? `<span>✍ ${esc(a.reporter)}</span>` : (authorList.length ? `<span>✍ ${esc(authorList.join(', '))}</span>` : ''),
    a.location ? `<span>📍 ${esc(a.location)}</span>` : '',
    `<span>⏱ ${rt(words)} read</span>`,
  ].filter(Boolean);
  $('r-byline').innerHTML = bylineParts.join('<span style="color:var(--border-hi)">·</span>');

  // Image (the published image — AI or scraped, stored at ingest time)
  const img = a.image_url || '';
  $('r-image').innerHTML = img
    ? `<img src="${esc(img)}" alt="" loading="lazy" style="width:100%;border-radius:12px;max-height:400px;object-fit:cover">`
    : '';

  // Body: prefer stored html_story, otherwise render markdown, fallback to sub_heading
  let bodyHtml;
  if (a.body_html) {
    bodyHtml = a.body_html;
  } else if (a.story) {
    bodyHtml = a.story
      .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/^/, '<p>').replace(/$/, '</p>');
  } else if (a.sub_heading) {
    bodyHtml = `<p style="color:var(--text-secondary);font-style:italic">${esc(a.sub_heading)}</p><p style="color:var(--text-muted);font-size:0.85rem">Full article body not available for this entry.</p>`;
  } else {
    bodyHtml = '<p style="color:var(--text-muted);font-size:0.85rem">No article body available.</p>';
  }
  $('r-body').innerHTML = bodyHtml;

  // Render selected tweets if present
  const tweetsEl = $('r-tweets');
  if (tweetsEl) {
    const rawTweets = a.selected_tweets;
    const tweets = Array.isArray(rawTweets) ? rawTweets : [];
    if (tweets.length) {
      const xSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
      let cards = '';
      for (const tw of tweets) {
        const url    = esc(tw.post_url || '');
        const author = esc(tw.username || tw.author || 'unknown');
        const text   = esc(tw.text || '');
        const likes  = Number(tw.likes || 0);
        const reposts = Number(tw.reposts || 0);
        const replies = Number(tw.replies || 0);
        const statsHtml = (likes + reposts + replies > 0)
          ? '<span class="r-tweet-stat">♥ ' + likes + '</span>'
            + '<span class="r-tweet-stat">↺ ' + reposts + '</span>'
            + (replies ? '<span class="r-tweet-stat">💬 ' + replies + '</span>' : '')
          : '';
        const viewLink = url ? '<a class="r-tweet-view" href="' + url + '" target="_blank" rel="noopener">View on X →</a>' : '';
        cards += '<div class="r-tweet-card">'
          + '<div class="r-tweet-inner">'
          + '<div class="r-tweet-head">'
          + '<a class="r-tweet-author" href="' + url + '" target="_blank" rel="noopener">@' + author + '</a>'
          + '<span class="r-tweet-xlogo">' + xSvg + '</span>'
          + '</div>'
          + '<p class="r-tweet-body">' + text + '</p>'
          + '<div class="r-tweet-foot">' + statsHtml + viewLink + '</div>'
          + '</div></div>';
      }
      tweetsEl.innerHTML = '<div class="r-tweets-section">'
        + '<div class="r-tweets-label">' + xSvg + ' Reactions on X</div>'
        + '<div class="r-tweets-list">' + cards + '</div>'
        + '</div>';
      tweetsEl.style.display = '';
    } else {
      tweetsEl.innerHTML = '';
      tweetsEl.style.display = 'none';
    }
  }

  $('reader-raw').textContent = JSON.stringify(a, null, 2);
  $('reader-raw').classList.add('hidden');

  renderRecommended(a);

  readerScroll.scrollTop = 0;
  readerProg.style.width = '0%';
  readerOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  READER_OPEN = true;
}

function closeReader() {
  readerOverlay.classList.remove('open');
  document.body.style.overflow = '';
  READER_OPEN = false;
}

function toggleRawJson() { $('reader-raw').classList.toggle('hidden'); }

readerScroll.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = readerScroll;
  const pct = scrollHeight - clientHeight > 0 ? scrollTop / (scrollHeight - clientHeight) * 100 : 0;
  readerProg.style.width = Math.min(100, pct) + '%';
}, { passive: true });

// ── Recommended Stories ───────────────────────────────────────
function renderRecommended(article) {
  const sec = $('rec-section');
  if (!sec) return;

  const thisCat = catOf(article).key;
  const sameCat = ALL.filter(a => a.id !== article.id && catOf(a).key === thisCat)
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
    .slice(0, 4);

  // If fewer than 2 in same category, fill from any category
  const pool = sameCat.length >= 2 ? sameCat :
    ALL.filter(a => a.id !== article.id)
      .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))
      .slice(0, 4);

  if (!pool.length) { sec.innerHTML = '<p class="rec-empty">No related stories found.</p>'; return; }

  sec.innerHTML = pool.map(a => {
    const cat = catOf(a);
    return `<div class="rec-card" onclick="openReader('${esc(a.id)}')">
      ${a.image_url
        ? `<div class="rec-img"><img src="${esc(a.image_url)}" loading="lazy"></div>`
        : `<div class="rec-img rec-img-ph">${CAT_ICONS[cat.key] || '📰'}</div>`}
      <div class="rec-info">
        <span class="rec-cat ${cat.cls}">${cat.key}</span>
        <div class="rec-title">${esc(a.heading || '')}</div>
        <div class="rec-meta">${relTime(a.published_at || a.created_at)} · ${rt(wc(a))} read</div>
      </div>
    </div>`;
  }).join('');
}

// kept for any legacy references — no longer called
async function runNewsCheck() {

  try {
    const res  = await fetch(`/api/articles/${id}/news-check`, { method: 'POST' });
    const data = await res.json();
    if (data.status !== 'success') {
      sec.innerHTML = `<div class="nc-error">Verification failed: ${esc(data.message || '')}</div>`;
      return;
    }
    renderNewsCheck(sec, data.check);
  } catch (e) {
    sec.innerHTML = `<div class="nc-error">Network error: ${esc(String(e))}</div>`;
  }
}

function renderNewsCheck(sec, c) {
  const credColor  = { concrete: 'nc-green', speculative: 'nc-yellow', misleading: 'nc-orange', false: 'nc-red' }[c.credibility] || 'nc-gray';
  const fakeColor  = { credible: 'nc-green', unverified: 'nc-gray', potentially_misleading: 'nc-orange', likely_false: 'nc-red' }[c.fake_check] || 'nc-gray';
  const trendColor = c.trending === 'trending' ? 'nc-blue' : 'nc-gray';
  const toneColor  = { positive: 'nc-green', negative: 'nc-red', neutral: 'nc-gray' }[c.tone] || 'nc-gray';
  const overallColor = { VERIFIED: 'nc-green', 'LIKELY FALSE': 'nc-red', 'USE CAUTION': 'nc-orange', UNVERIFIED: 'nc-gray' }[c.overall] || 'nc-gray';

  const credLabel  = (c.credibility  || '').replace(/_/g, ' ').toUpperCase();
  const fakeLabel  = (c.fake_check   || '').replace(/_/g, ' ').toUpperCase();
  const trendLabel = c.trending === 'trending' ? 'TRENDING' : 'NOT TRENDING';
  const toneLabel  = (c.tone || 'neutral').toUpperCase();
  const score      = Math.max(0, Math.min(100, c.credibility_score || 0));
  const arc        = (score / 100) * 283; // 2π×45 ≈ 283

  const redFlagsHtml = c.red_flags?.length
    ? `<div class="ncv-flags">${c.red_flags.map(f => `<span class="ncv-flag">⚠ ${esc(f)}</span>`).join('')}</div>`
    : '';

  sec.innerHTML = `
    <div class="ncv-hero ${overallColor}">
      <div class="ncv-ring-wrap">
        <svg class="ncv-ring" viewBox="0 0 100 100">
          <circle class="ncv-ring-bg" cx="50" cy="50" r="45"/>
          <circle class="ncv-ring-fill" cx="50" cy="50" r="45"/>
        </svg>
        <div class="ncv-score-inner">
          <span class="ncv-score-num">${score}</span>
          <span class="ncv-score-sub">/100</span>
        </div>
      </div>
      <div class="ncv-verdict-info">
        <span class="ncv-verdict-label">OVERALL VERDICT</span>
        <span class="ncv-verdict-value">${esc(c.overall)}</span>
        <span class="ncv-verdict-reason">${esc(c.credibility_reason)}</span>
      </div>
    </div>

    <div class="ncv-metrics">
      <div class="ncv-metric ${credColor}">
        <div class="ncv-metric-head">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.3 2.6 2.9.4-2.1 2 .5 2.9L6 7.5 3.4 8.9l.5-2.9L1.8 4l2.9-.4L6 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
          CREDIBILITY
        </div>
        <div class="ncv-metric-val">${credLabel}</div>
        <div class="ncv-metric-txt">${esc(c.credibility_reason)}</div>
      </div>
      <div class="ncv-metric ${fakeColor}">
        <div class="ncv-metric-head">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M6 3.5v2.8M6 7.8h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          AUTHENTICITY
        </div>
        <div class="ncv-metric-val">${fakeLabel}</div>
        <div class="ncv-metric-txt">${esc(c.fake_reason)}</div>
      </div>
      <div class="ncv-metric ${toneColor}">
        <div class="ncv-metric-head">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 9c1-2 2-3 4-3s3 1 4 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="4" cy="4.5" r="1" fill="currentColor"/><circle cx="8" cy="4.5" r="1" fill="currentColor"/></svg>
          TONE
        </div>
        <div class="ncv-metric-val">${toneLabel}</div>
        <div class="ncv-metric-txt">${esc(c.tone_reason)}</div>
      </div>
      <div class="ncv-metric ${trendColor}">
        <div class="ncv-metric-head">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 9l3-3 2.5 2L10 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          TRENDING
        </div>
        <div class="ncv-metric-val">${trendLabel}</div>
        <div class="ncv-metric-txt">${esc(c.trending_reason)}</div>
      </div>
    </div>
    ${redFlagsHtml}`;

  // Animate score ring after paint
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const fill = sec.querySelector('.ncv-ring-fill');
    if (fill) fill.style.strokeDasharray = `${arc} 283`;
  }));
}

// ── Fetch articles ────────────────────────────────────────────
function setRefreshBusy(busy) {
  refreshBtn.disabled = busy;
  refreshSpinner.classList.toggle('hidden', !busy);
  refreshLabel.textContent = busy ? 'Refreshing…' : 'Refresh Feed';
}

function showSkeleton(show) {
  skelEl.style.display = show ? '' : 'none';
  gridEl.classList.toggle('hidden', show);
  listEl.classList.toggle('hidden', true);
  if (show) emptyEl.style.display = 'none';
}

async function loadArticles(quiet = false) {
  if (!quiet) { setRefreshBusy(true); showSkeleton(true); }
  try {
    const data = await fetch('/api/articles').then(r => r.json());
    if (data.status === 'success') {
      ALL = data.articles || [];
      refreshMeta(ALL);
      buildTicker(ALL);
      buildFeedTicker(ALL);
      applyFilters();
      startSidebarBN();
      if (!quiet) toast('ok', `${ALL.length} stor${ALL.length === 1 ? 'y' : 'ies'} loaded`);
    } else {
      if (!quiet) toast('err', data.message || 'Failed to load');
    }
  } catch (e) {
    if (!quiet) toast('err', `Network error: ${e.message}`);
  } finally {
    if (!quiet) { setRefreshBusy(false); showSkeleton(false); }
  }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(type, msg, duration = 4000) {
  const icons = { ok: '✓', err: '✕', info: '•' };
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <span class="toast-icon ${type}">${icons[type] || '•'}</span>
    <span class="toast-msg">${esc(msg)}</span>
    <div class="toast-bar-wrap"><div class="toast-bar-fill"></div></div>
  `;
  toastStack.appendChild(el);
  setTimeout(() => el.querySelector('.toast-bar-fill').style.height = '100%', 50);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(4px)';
    el.style.transition = 'opacity .3s,transform .3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── View toggle ───────────────────────────────────────────────
$('vb-grid').addEventListener('click', () => {
  VIEW = 'grid';
  $('vb-grid').classList.add('active'); $('vb-list').classList.remove('active');
  renderFeed();
});
$('vb-list').addEventListener('click', () => {
  VIEW = 'list';
  $('vb-list').classList.add('active'); $('vb-grid').classList.remove('active');
  renderFeed();
});

// ── Events ────────────────────────────────────────────────────
refreshBtn.addEventListener('click', () => loadArticles(false));

searchEl.addEventListener('input', e => { Q = e.target.value.trim(); applyFilters(); });
sortEl.addEventListener('change', e => { SORT = e.target.value; applyFilters(); });

$('cat-bar').addEventListener('click', e => {
  const btn = e.target.closest('.catb'); if (!btn) return;
  document.querySelectorAll('#cat-bar .catb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  CAT = btn.dataset.cat; COUNTRY = null;
  applyFilters();
});

// ── World country dropdown ────────────────────────────────────
(function initWorldDropdown() {
  const worldBtn = document.querySelector('.catb[data-cat="world"]');
  if (!worldBtn) return;

  // Create floating panel attached to body
  const panel = document.createElement('div');
  panel.id = 'world-dropdown';
  panel.className = 'world-dropdown';
  document.body.appendChild(panel);

  let hideTimer;

  function buildPanel() {
    const counts = {};
    ALL.forEach(a => {
      const c = (a.country || _extractCountry(a) || '').trim();
      if (c) counts[c] = (counts[c] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) {
      panel.innerHTML = '<div class="wd-empty">No country data yet</div>';
      return;
    }
    panel.innerHTML = sorted.map(([c, n]) => `
      <button class="wd-chip${COUNTRY === c ? ' active' : ''}" data-country="${esc(c)}">
        <span class="wd-name">${esc(c)}</span>
        <span class="wd-count">${n}</span>
      </button>`).join('');

    panel.querySelectorAll('.wd-chip').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const val = btn.dataset.country;
        COUNTRY = COUNTRY === val ? null : val;
        // Switch to All Stories so country filter applies across categories
        document.querySelectorAll('#cat-bar .catb').forEach(b => b.classList.remove('active'));
        document.querySelector('#cat-bar .catb[data-cat="all"]').classList.add('active');
        CAT = 'all';
        applyFilters();
        hidePanel();
      });
    });
  }

  function showPanel() {
    clearTimeout(hideTimer);
    const r = worldBtn.getBoundingClientRect();
    panel.style.top  = r.top + 'px';
    panel.style.left = (r.right + 10) + 'px';
    buildPanel();
    panel.classList.add('visible');
  }
  function hidePanel() {
    hideTimer = setTimeout(() => panel.classList.remove('visible'), 180);
  }

  worldBtn.addEventListener('mouseenter', showPanel);
  worldBtn.addEventListener('mouseleave', hidePanel);
  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', hidePanel);
})();

// Sidebar mobile
function openSidebar()  { sidebar.classList.add('open');    sbBackdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeSidebar() { sidebar.classList.remove('open'); sbBackdrop.classList.remove('open'); document.body.style.overflow = ''; }
$('hamburger').addEventListener('click', openSidebar);
$('sidebar-close').addEventListener('click', closeSidebar);
sbBackdrop.addEventListener('click', closeSidebar);

// Keyboard
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchEl.focus(); }
  if (e.key === 'Escape') {
    if (READER_OPEN) closeReader();
    else searchEl.blur();
  }
});

// ── Live clock ────────────────────────────────────────────────
(function startClock() {
  const el = $('topbar-clock');
  if (!el) return;
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      + '  ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  tick();
  setInterval(tick, 1000);
})();

// ── Auto-refresh every 5 minutes ─────────────────────────────
setInterval(() => loadArticles(true), 5 * 60 * 1000);

// ── Lead Story Hero ───────────────────────────────────────────
async function fetchLeadStory() {
  try {
    const data = await fetch('/api/lead-story').then(r => r.json());
    const a    = data.article;
    LEAD_STORY_ARTICLE    = a || null;
    LEAD_STORY_ARTICLE_ID = a ? a.id : null;

    // Show or hide the hero section
    const hero = $('lead-story-hero');
    if (hero) {
      if (a) { renderLeadStoryHero(a); hero.classList.remove('hidden'); }
      else    { hero.classList.add('hidden'); }
    }

    // Sync is_lead_story flags into ALL array and re-render feed if anything changed
    let changed = false;
    ALL.forEach(art => {
      const should = !!(a && art.id === a.id);
      if (!!art.is_lead_story !== should) { art.is_lead_story = should; changed = true; }
    });
    // If lead story isn't in ALL yet (just published), add it at the top
    if (a && !ALL.find(art => art.id === a.id)) {
      ALL.unshift(a);
      changed = true;
    }
    if (changed) { applyFilters(); renderSidebarBN(); }
  } catch(e) { /* silent */ }
}

function renderLeadStoryHero(a) {
  const hero = $('lead-story-hero');
  if (!hero) return;
  const cat = catOf(a);
  hero.onclick = () => openReader(a.id);
  $('lsh-category').innerHTML  = `<span class="card-cat-badge ${cat.cls}">${cat.key}</span>`;
  $('lsh-title').textContent   = a.heading || '';
  const sub = a.sub_heading || '';
  const subtitleEl = $('lsh-subtitle');
  subtitleEl.textContent  = sub;
  subtitleEl.style.display = sub ? '' : 'none';
  $('lsh-meta').textContent = `${relTime(a.published_at || a.created_at)} · ${rt(wc(a))} read`;
  $('lsh-image').innerHTML  = a.image_url
    ? `<img src="${esc(a.image_url)}" alt="" loading="lazy">`
    : `<div class="lsh-img-placeholder">📰</div>`;
  const readBtn = $('lsh-read-btn');
  if (readBtn) readBtn.onclick = e => { e.stopPropagation(); openReader(a.id); };
}

// ── Init ──────────────────────────────────────────────────────
loadArticles(false);
fetchLeadStory();
setInterval(fetchLeadStory, 60000);
