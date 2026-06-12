-- Run this in Supabase SQL editor (project → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS published_articles (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  heading       TEXT NOT NULL,
  sub_heading   TEXT,
  story         TEXT,
  html_story    TEXT,
  image_url     TEXT,
  category      TEXT DEFAULT 'World',
  location      TEXT,
  region        TEXT,
  city          TEXT,
  language      TEXT DEFAULT 'en',
  reporter      TEXT,
  authors       JSONB DEFAULT '[]'::jsonb,
  source_url    TEXT,
  source_name   TEXT,
  news_type     TEXT DEFAULT 'Standard',
  publish_date  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  hocalwire_id  TEXT,
  word_count    INTEGER DEFAULT 0,
  tags          JSONB DEFAULT '[]'::jsonb
);

-- Index for fast latest-first queries
CREATE INDEX IF NOT EXISTS idx_published_articles_publish_date
  ON published_articles (publish_date DESC);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_published_articles_category
  ON published_articles (category);

-- Enable public read access (no auth needed for public feed)
ALTER TABLE published_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published articles"
  ON published_articles FOR SELECT
  USING (true);

-- Only service role / server-side can insert (the anon key cannot insert)
-- The backend uses the ANON key for reads and the SERVICE key for writes,
-- OR you can use the anon key for both if you set a permissive insert policy
-- (only safe if INGEST_API_KEY protects the /api/ingest endpoint).
CREATE POLICY "Backend can insert articles"
  ON published_articles FOR INSERT
  WITH CHECK (true);
