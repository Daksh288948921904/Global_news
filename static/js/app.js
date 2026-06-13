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

// ── Ticker ────────────────────────────────────────────────────
function buildTicker(articles) {
  if (!articles.length) return;
  const sep   = `<span class="ticker-sep">◆</span>`;
  const inner = articles.slice(0, 14).map(a => `<span>${esc(a.heading || '')}</span>`).join(sep);
  tickerContent.innerHTML = inner + sep + inner;
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
  if (COUNTRY)       list = list.filter(a => _extractCountry(a) === COUNTRY);
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

  return `<article class="card${isHero ? ' card-hero' : ''}" data-cat="${cat.key}" onclick="openReader('${esc(a.id)}')">
    ${media}
    <div class="card-badges">
      <span class="card-cat-badge ${cat.cls}">${cat.key}</span>
      ${langBadge(a)}
      <span class="card-rt-badge">${rt(words)}</span>
    </div>
    ${a.is_lead_story ? `<span class="card-featured-label">Lead Story</span>` : ''}
    <div class="card-info">
      <div class="card-source-row">
        <span class="card-source-dot"></span>
        <span class="card-source">${esc(a.source_name || 'Global News')}</span>
        ${a.region ? `<span class="card-region">· ${esc(a.region)}</span>` : ''}
        <span class="card-date">${date}</span>
      </div>
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
      <div class="list-source">${esc(a.source_name || 'Global News')}${a.region ? ` <span style="color:var(--ink4);font-weight:400">· ${esc(a.region)}</span>` : ''}</div>
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
    const activeCat = document.querySelector('.nav-btn.active[data-cat]');
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
    <span class="rh-source">${esc(a.source_name || 'Global News')}</span>
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

  $('reader-raw').textContent = JSON.stringify(a, null, 2);
  $('reader-raw').classList.add('hidden');

  // Auto-trigger news verification
  const ncSec = $('news-check-section');
  if (ncSec) ncSec.innerHTML = `<div class="nc-loading"><span class="nc-spinner"></span><span>Analysing article…</span></div>`;

  readerScroll.scrollTop = 0;
  readerProg.style.width = '0%';
  readerOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  READER_OPEN = true;

  runNewsCheck();
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

// ── News Verification (rule-based backend) ────────────────────
async function runNewsCheck() {
  const id = CURRENT_ARTICLE_ID;
  if (!id) return;
  const sec = $('news-check-section');
  if (!sec) return;

  sec.innerHTML = `<div class="nc-loading"><span class="nc-spinner"></span><span>Analysing article…</span></div>`;

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

  const redFlagsHtml = c.red_flags?.length
    ? `<div class="nc-flags"><span class="nc-flags-label">⚠ Red flags</span>${c.red_flags.map(f => `<span class="nc-flag">${esc(f)}</span>`).join('')}</div>`
    : '';

  sec.innerHTML = `
    <div class="nc-overall ${overallColor}">
      <div class="nc-overall-left">
        <span class="nc-overall-label">Overall Verdict</span>
        <span class="nc-overall-value">${esc(c.overall)}</span>
      </div>
      <div class="nc-overall-score">${c.credibility_score}<span>/100</span></div>
    </div>

    <div class="nc-grid">
      <div class="nc-card ${credColor}">
        <div class="nc-card-header">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.3 2.6 2.9.4-2.1 2 .5 2.9L6 7.5 3.4 8.9l.5-2.9L1.8 4l2.9-.4L6 1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
          <span>Credibility</span>
        </div>
        <div class="nc-card-badge">${credLabel}</div>
        <div class="nc-card-reason">${esc(c.credibility_reason)}</div>
      </div>

      <div class="nc-card ${fakeColor}">
        <div class="nc-card-header">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.1"/><path d="M6 3.5v3M6 8h.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          <span>Authenticity</span>
        </div>
        <div class="nc-card-badge">${fakeLabel}</div>
        <div class="nc-card-reason">${esc(c.fake_reason)}</div>
      </div>

      <div class="nc-card ${toneColor}">
        <div class="nc-card-header">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 9c1-2 2-3 4-3s3 1 4 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="4" cy="4.5" r="1" fill="currentColor"/><circle cx="8" cy="4.5" r="1" fill="currentColor"/></svg>
          <span>Tone</span>
        </div>
        <div class="nc-card-badge">${toneLabel}</div>
        <div class="nc-card-reason">${esc(c.tone_reason)}</div>
      </div>

      <div class="nc-card ${trendColor}">
        <div class="nc-card-header">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 9l3-3 2.5 2L10 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Trending</span>
        </div>
        <div class="nc-card-badge">${trendLabel}</div>
        <div class="nc-card-reason">${esc(c.trending_reason)}</div>
      </div>
    </div>

    ${redFlagsHtml}
    <button class="nc-rerun-btn" onclick="runNewsCheck()">Re-run</button>`;
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
      applyFilters();
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

$('nav-list').addEventListener('click', e => {
  const btn = e.target.closest('.nav-btn'); if (!btn) return;
  document.querySelectorAll('#nav-list .nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  CAT = btn.dataset.cat; COUNTRY = null;
  $('cbar-inner')?.querySelectorAll('.cbar-chip').forEach(b => b.classList.toggle('active', b.dataset.country === ''));
  applyFilters();
  if (window.innerWidth <= 900) closeSidebar();
});

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
    const hero = $('lead-story-hero');
    if (!hero) return;
    if (!a) { hero.style.display = 'none'; LEAD_STORY_ARTICLE = null; LEAD_STORY_ARTICLE_ID = null; return; }
    LEAD_STORY_ARTICLE    = a;
    LEAD_STORY_ARTICLE_ID = a.id;
    renderLeadStoryHero(a);
  } catch(e) { /* silent — hero stays hidden */ }
}

function renderLeadStoryHero(a) {
  const hero = $('lead-story-hero');
  if (!hero) return;
  const cat = catOf(a);
  hero.onclick = () => openReader(a.id);
  $('lsh-category').innerHTML  = `<span class="${cat.cls}">${cat.key}</span>`;
  $('lsh-title').textContent   = a.heading || '';
  $('lsh-subtitle').textContent = a.sub_heading || '';
  $('lsh-meta').textContent    = `${relTime(a.published_at || a.created_at)} · ${rt(wc(a))} read`;
  const imgEl = $('lsh-image');
  imgEl.innerHTML = a.image_url
    ? `<img src="${esc(a.image_url)}" alt="" loading="lazy">`
    : `<div class="lsh-img-placeholder">📰</div>`;
  const readBtn = $('lsh-read-btn');
  if (readBtn) readBtn.onclick = e => { e.stopPropagation(); openReader(a.id); };
  hero.style.display = '';
}

// ── Init ──────────────────────────────────────────────────────
loadArticles(false);
fetchLeadStory();
setInterval(fetchLeadStory, 60000);
