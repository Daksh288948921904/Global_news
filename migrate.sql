-- Run this in Supabase SQL editor to add missing columns to the existing table

ALTER TABLE published_articles
  ADD COLUMN IF NOT EXISTS story        TEXT,
  ADD COLUMN IF NOT EXISTS location     TEXT,
  ADD COLUMN IF NOT EXISTS region       TEXT,
  ADD COLUMN IF NOT EXISTS city         TEXT,
  ADD COLUMN IF NOT EXISTS language     TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS authors      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_url   TEXT,
  ADD COLUMN IF NOT EXISTS source_name  TEXT,
  ADD COLUMN IF NOT EXISTS news_type    TEXT DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS word_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags         JSONB DEFAULT '[]'::jsonb;

-- Lead story support
ALTER TABLE published_articles
  ADD COLUMN IF NOT EXISTS is_lead_story  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS was_lead_story BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS server_idx     INTEGER;

-- Selected tweets from social scrape
ALTER TABLE published_articles
  ADD COLUMN IF NOT EXISTS selected_tweets JSONB DEFAULT '[]'::jsonb;

-- Country for geo-filtering
ALTER TABLE published_articles
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_published_articles_lead_story
  ON published_articles (is_lead_story)
  WHERE is_lead_story = TRUE;

-- Index for fast latest-first queries (if not already there)
CREATE INDEX IF NOT EXISTS idx_published_articles_published_at
  ON published_articles (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_published_articles_category
  ON published_articles (category);
