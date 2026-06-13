"""
Global News — Published Article Feed
FastAPI backend that receives published stories from robin_cc
and serves them to the public-facing frontend.
"""

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from supabase import create_client, Client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

app = FastAPI(title='Global News')

_static_dir = Path(__file__).parent / 'static'
_static_dir.mkdir(parents=True, exist_ok=True)
app.mount('/static', StaticFiles(directory=str(_static_dir)), name='static')
templates = Jinja2Templates(directory=str(Path(__file__).parent / 'templates'))

SUPABASE_URL  = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY  = os.environ.get('SUPABASE_KEY', '')
INGEST_API_KEY = os.environ.get('INGEST_API_KEY', 'changeme-set-in-env')

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

# ── Groq key pool — 429-aware rotation + model fallback ────────
def _load_groq_keys():
    keys = []
    k = os.environ.get('GROQ_API_KEY', '').strip()
    if k: keys.append(k)
    for i in range(2, 21):
        k = os.environ.get(f'GROQ_API_KEY_{i}', '').strip()
        if k: keys.append(k)
        else: break
    return keys

_gk_keys: list  = _load_groq_keys()
_gk_idx:  int   = 0
_gk_lock         = threading.Lock()
_GROQ_MODEL      = os.environ.get('GROQ_MODEL', 'llama-3.3-70b-versatile')
_GROQ_FALLBACKS  = ['llama-3.1-8b-instant', 'gemma2-9b-it']


def _groq_completion(messages: list, model: str = None, temperature: float = 0.1, max_tokens: int = 512):
    from groq import Groq
    global _gk_idx

    if not _gk_keys:
        raise ValueError('No GROQ_API_KEY* found in environment')

    primary = model or _GROQ_MODEL
    models  = [primary] + [m for m in _GROQ_FALLBACKS if m != primary]
    last_exc = None

    for attempt_model in models:
        tried = 0
        start = _gk_idx
        while tried < len(_gk_keys):
            with _gk_lock:
                key = _gk_keys[_gk_idx]
            try:
                resp = Groq(api_key=key).chat.completions.create(
                    model=attempt_model, messages=messages,
                    temperature=temperature, max_tokens=max_tokens,
                )
                logger.debug('groq_pool OK model=%s key#%d', attempt_model, _gk_idx + 1)
                return resp
            except Exception as exc:
                err = str(exc)
                if 'rate_limit_exceeded' in err or '429' in err:
                    logger.warning('groq_pool key#%d rate-limited on %s — rotating', _gk_idx + 1, attempt_model)
                    last_exc = exc
                    with _gk_lock:
                        _gk_idx = (_gk_idx + 1) % len(_gk_keys)
                    tried += 1
                    if _gk_idx == start:
                        break
                else:
                    raise
        logger.warning('groq_pool all keys rate-limited for %s, trying fallback model', attempt_model)

    raise last_exc


# ── Pages ──────────────────────────────────────────────────────
@app.get('/')
async def index(request: Request):
    return templates.TemplateResponse(
        request, 'index.html', {'static_v': int(time.time())}
    )


# ── Public article endpoints ───────────────────────────────────
@app.get('/api/articles')
async def list_articles():
    if not supabase:
        return JSONResponse({'status': 'error', 'message': 'Database not configured'}, status_code=503)
    try:
        resp = (
            supabase.table('published_articles')
            .select('*')
            .order('published_at', desc=True)
            .limit(300)
            .execute()
        )
        articles = resp.data or []
        return {'status': 'success', 'articles': articles}
    except Exception as e:
        logger.error('list_articles error: %s', e)
        return JSONResponse({'status': 'error', 'message': str(e)}, status_code=500)


@app.get('/api/articles/{article_id}')
async def get_article(article_id: str):
    if not supabase:
        return JSONResponse({'status': 'error', 'message': 'Database not configured'}, status_code=503)
    try:
        resp = (
            supabase.table('published_articles')
            .select('*')
            .eq('id', article_id)
            .single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail='Article not found')
        return {'status': 'success', 'article': resp.data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('get_article error: %s', e)
        return JSONResponse({'status': 'error', 'message': str(e)}, status_code=500)


# ── Ingest webhook (called by robin_cc on publish) ─────────────
@app.post('/api/ingest')
async def ingest_article(request: Request):
    body = await request.json()

    # API key can come from header or body
    api_key = request.headers.get('X-API-Key') or body.get('api_key', '')
    if api_key != INGEST_API_KEY:
        logger.warning('Ingest rejected — invalid API key from %s', request.client.host)
        raise HTTPException(status_code=401, detail='Invalid API key')

    if not supabase:
        return JSONResponse({'status': 'error', 'message': 'Database not configured'}, status_code=503)

    try:
        story_text = body.get('story') or body.get('body') or ''
        html_body  = body.get('html_story') or body.get('body_html') or ''
        article = {
            'heading':      body.get('heading') or body.get('title') or '',
            'sub_heading':  body.get('sub_heading') or body.get('subtitle') or '',
            'story':        story_text,
            'body_html':    html_body,
            'image_url':    body.get('image_url') or body.get('top_image') or '',
            'category':     body.get('category') or 'World',
            'location':     body.get('location') or '',
            'region':       body.get('region') or '',
            'city':         body.get('city') or '',
            'language':     body.get('language') or 'en',
            'reporter':     body.get('reporter') or '',
            'authors':      body.get('authors') or [],
            'source_url':   body.get('source_url') or '',
            'source_name':  body.get('source_name') or '',
            'news_type':    body.get('news_type') or 'Standard',
            'published_at': body.get('publish_date') or body.get('published_at') or datetime.now(timezone.utc).isoformat(),
            'hocalwire_id': body.get('hocalwire_id') or body.get('feed_id') or '',
            'word_count':   body.get('word_count') or len(story_text.split()),
            'tags':         body.get('tags') or [],
            'server_idx':    int(body['server_idx']) if str(body.get('server_idx', '')).isdigit() else None,
            'is_lead_story': False,
        }
        # Deduplicate: if server_idx already exists, update instead of insert
        server_idx = article.get('server_idx')
        existing_id = None
        if server_idx is not None:
            ex = supabase.table('published_articles').select('id').eq('server_idx', server_idx).limit(1).execute()
            if ex.data:
                existing_id = ex.data[0]['id']
                # Delete any extra duplicates first (keep only the first)
                all_dupes = supabase.table('published_articles').select('id').eq('server_idx', server_idx).execute()
                for row in (all_dupes.data or [])[1:]:
                    supabase.table('published_articles').delete().eq('id', row['id']).execute()
                # Update the surviving record (preserve is_lead_story)
                update_payload = {k: v for k, v in article.items() if k != 'is_lead_story'}
                supabase.table('published_articles').update(update_payload).eq('id', existing_id).execute()
                logger.info('Updated existing article "%s" id=%s', article['heading'][:60], existing_id)
                return {'status': 'success', 'id': existing_id, 'action': 'updated'}

        resp = supabase.table('published_articles').insert(article).execute()
        new_id = resp.data[0]['id'] if resp.data else None
        logger.info('Ingested article "%s" id=%s', article['heading'][:60], new_id)
        return {'status': 'success', 'id': new_id, 'action': 'inserted'}
    except Exception as e:
        logger.error('ingest_article error: %s', e)
        return JSONResponse({'status': 'error', 'message': str(e)}, status_code=500)


# ── News verification (LLM) ────────────────────────────────────
@app.post('/api/articles/{article_id}/news-check')
async def news_check(article_id: str):
    if not supabase:
        return JSONResponse({'status': 'error', 'message': 'Database not configured'}, status_code=503)
    try:
        resp = (
            supabase.table('published_articles')
            .select('heading, sub_heading, story, body_html, source_url, reporter, authors')
            .eq('id', article_id)
            .single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail='Article not found')
        check = await _llm_news_check(resp.data)
        return {'status': 'success', 'check': check}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('news_check error: %s', e)
        return JSONResponse({'status': 'error', 'message': str(e)}, status_code=500)


# ── Lead Story endpoints ───────────────────────────────────────
@app.post('/api/lead-story')
async def set_lead_story(request: Request):
    api_key = request.headers.get('X-API-Key') or ''
    if api_key != INGEST_API_KEY:
        raise HTTPException(status_code=401, detail='Invalid API key')
    if not supabase:
        return JSONResponse({'status': 'error', 'message': 'Database not configured'}, status_code=503)
    try:
        body           = await request.json()
        server_idx     = body.get('server_idx')
        heading        = (body.get('heading') or '').strip()
        global_news_id = (body.get('global_news_id') or '').strip()

        # Clear all existing lead stories
        supabase.table('published_articles') \
            .update({'is_lead_story': False}) \
            .neq('id', '00000000-0000-0000-0000-000000000000') \
            .execute()

        if server_idx is None:
            return {'status': 'success'}   # clear-only call

        matched_id = None

        # 1. Try by exact UUID (most reliable — stored at publish time)
        if global_news_id:
            resp = supabase.table('published_articles').select('id') \
                .eq('id', global_news_id).limit(1).execute()
            if resp.data:
                matched_id = resp.data[0]['id']

        # 2. Try by server_idx (works for articles published after schema migration)
        if not matched_id and server_idx is not None:
            resp = supabase.table('published_articles').select('id') \
                .eq('server_idx', int(server_idx)).limit(1).execute()
            if resp.data:
                matched_id = resp.data[0]['id']

        # 3. Fallback: exact heading match (same session, heading is the generated title)
        if not matched_id and heading:
            resp = supabase.table('published_articles').select('id') \
                .eq('heading', heading).order('published_at', desc=True).limit(1).execute()
            if resp.data:
                matched_id = resp.data[0]['id']

        if matched_id:
            supabase.table('published_articles') \
                .update({'is_lead_story': True}) \
                .eq('id', matched_id) \
                .execute()
            logger.info('Lead story set: id=%s server_idx=%s', matched_id, server_idx)
        else:
            logger.warning('Lead story: no article found for server_idx=%s', server_idx)
            return JSONResponse({'status': 'error', 'message': 'Article not found in Global News — publish it first'}, status_code=404)

        return {'status': 'success'}
    except Exception as e:
        logger.error('set_lead_story error: %s', e)
        return JSONResponse({'status': 'error', 'message': str(e)}, status_code=500)


@app.get('/api/lead-story')
async def get_lead_story():
    if not supabase:
        return JSONResponse({'status': 'error', 'message': 'Database not configured'}, status_code=503)
    try:
        resp = (
            supabase.table('published_articles')
            .select('*')
            .eq('is_lead_story', True)
            .limit(1)
            .execute()
        )
        return {'status': 'success', 'article': resp.data[0] if resp.data else None}
    except Exception as e:
        logger.error('get_lead_story error: %s', e)
        return JSONResponse({'status': 'error', 'message': str(e)}, status_code=500)


# ── Health check ───────────────────────────────────────────────
@app.get('/api/status')
async def status():
    db_ok = supabase is not None
    return {'status': 'ok', 'db': db_ok, 'ts': datetime.now(timezone.utc).isoformat()}


# ── LLM news verification logic ───────────────────────────────
_NC_SYSTEM = (
    'You are a senior investigative fact-checker and news authenticity analyst. '
    'Given a news article headline and body, return a structured JSON analysis. '
    'Be concise and precise. Do not hallucinate facts.'
)

_NC_PROMPT = """Analyse this news article and return ONLY a JSON object — no markdown, no explanation.

HEADLINE: {headline}

BODY (first 800 chars):
{body_excerpt}

Return this exact JSON structure:
{{
  "credibility": "concrete|speculative|misleading|false",
  "credibility_score": <integer 0-100, where 100 = fully concrete>,
  "credibility_reason": "<one sentence>",
  "fake_check": "credible|unverified|potentially_misleading|likely_false",
  "fake_reason": "<one sentence>",
  "tone": "positive|negative|neutral",
  "tone_reason": "<one sentence>",
  "key_claims": ["<claim 1>", "<claim 2>"],
  "red_flags": ["<flag 1 or empty list if none>"]
}}

Definitions:
- concrete: backed by named officials, verifiable events, or hard data
- speculative: uses hedging language (could, may, might, sources say) with no named attribution
- misleading: factual but framed to distort; selective omission
- false: contradicts known facts or multiple authoritative sources
- credible: well-sourced, no red flags
- unverified: could be true but lacks enough sourcing
- potentially_misleading: framing or context concerns
- likely_false: significant evidence contradicts the claims"""


async def _llm_news_check(article: dict) -> dict:
    heading      = article.get('heading') or ''
    story        = article.get('story') or article.get('body_html') or ''
    body_excerpt = re.sub(r'<[^>]+>', '', story)[:800]

    prompt = _NC_PROMPT.format(headline=heading, body_excerpt=body_excerpt)

    llm_result = {}
    try:
        resp = _groq_completion(
            messages=[
                {'role': 'system', 'content': _NC_SYSTEM},
                {'role': 'user',   'content': prompt},
            ],
        )
        raw = resp.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
        raw = re.sub(r'\s*```$',          '', raw, flags=re.MULTILINE)
        llm_result = json.loads(raw)
    except Exception as e:
        logger.warning('groq_pool exhausted for news-check: %s', e)

    if not llm_result:
        llm_result = {
            'credibility': 'unverified', 'credibility_score': 50,
            'credibility_reason': 'API keys rate-limited — try again in a moment.',
            'fake_check': 'unverified',
            'fake_reason': 'API keys rate-limited — try again in a moment.',
            'tone': 'neutral', 'tone_reason': 'Unable to analyse tone.',
            'key_claims': [], 'red_flags': [],
        }

    cred  = llm_result.get('credibility', 'speculative')
    fake  = llm_result.get('fake_check',  'unverified')
    score = int(llm_result.get('credibility_score', 50))

    if cred == 'concrete' and fake == 'credible':
        overall = 'VERIFIED'
    elif cred == 'false' or fake == 'likely_false':
        overall = 'LIKELY FALSE'
    elif cred == 'misleading' or fake == 'potentially_misleading':
        overall = 'USE CAUTION'
    else:
        overall = 'UNVERIFIED'

    return {
        'credibility':        cred,
        'credibility_score':  score,
        'credibility_reason': llm_result.get('credibility_reason', ''),
        'fake_check':         fake,
        'fake_reason':        llm_result.get('fake_reason', ''),
        'tone':               llm_result.get('tone', 'neutral'),
        'tone_reason':        llm_result.get('tone_reason', ''),
        'key_claims':         llm_result.get('key_claims', []),
        'red_flags':          llm_result.get('red_flags', []),
        'trending':           'not_trending',
        'trending_reason':    'Single-source feed — cross-source trending unavailable.',
        'overall':            overall,
    }
