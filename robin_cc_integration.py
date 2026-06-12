"""
Drop this snippet into robin_cc's src/frontend/app.py to push
a published article to Global News whenever Hocalwire publish succeeds.

In robin_cc .env add:
  GLOBAL_NEWS_URL=https://your-global-news-domain.com
  GLOBAL_NEWS_API_KEY=<same value as INGEST_API_KEY in Global News .env>
"""

import os
import requests as _req

_GN_URL = os.environ.get('GLOBAL_NEWS_URL', '').rstrip('/')
_GN_KEY = os.environ.get('GLOBAL_NEWS_API_KEY', '')


def push_to_global_news(article: dict, image_url: str = '', hocalwire_id: str = '') -> bool:
    """
    Call after a successful Hocalwire publish.
    article  — the element from SCRAPED_ARTICLES (or summary dict)
    image_url — the final chosen image URL (AI or scraped)
    """
    if not _GN_URL or not _GN_KEY:
        return False

    payload = {
        'heading':      article.get('heading') or article.get('title', ''),
        'sub_heading':  article.get('sub_heading') or article.get('subtitle', ''),
        'story':        article.get('story', ''),
        'html_story':   article.get('html_story', ''),
        'image_url':    image_url or article.get('top_image') or article.get('image_url', ''),
        'category':     article.get('category', 'World'),
        'location':     article.get('location', ''),
        'region':       article.get('region', ''),
        'city':         article.get('city', ''),
        'language':     article.get('language', 'en'),
        'reporter':     article.get('reporter', ''),
        'authors':      article.get('authors', []),
        'source_url':   article.get('source_url', ''),
        'source_name':  article.get('source_name', ''),
        'news_type':    article.get('news_type', 'Standard'),
        'publish_date': article.get('publish_date', ''),
        'hocalwire_id': hocalwire_id,
        'word_count':   article.get('word_count', 0),
        'tags':         article.get('tags', []),
    }

    try:
        resp = _req.post(
            f'{_GN_URL}/api/ingest',
            json=payload,
            headers={'X-API-Key': _GN_KEY},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get('status') == 'success'
    except Exception as e:
        print(f'[GlobalNews] push failed: {e}')
        return False


# ── Where to call it in robin_cc app.py ──────────────────────
# Inside the confirmPublishToHocalwire endpoint, after a successful
# Hocalwire upload, add:
#
#   from <path>.robin_cc_integration import push_to_global_news
#   push_to_global_news(
#       article=SCRAPED_ARTICLES[real_idx],
#       image_url=chosen_image_url,   # the URL that was sent to Hocalwire
#       hocalwire_id=feed_id,
#   )
