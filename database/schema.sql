-- Core tweets table
CREATE TABLE IF NOT EXISTS tweets (
    id TEXT PRIMARY KEY,
    full_text TEXT,
    created_at DATETIME,
    favorite_count INTEGER DEFAULT 0,
    retweet_count INTEGER DEFAULT 0,
    is_reply BOOLEAN DEFAULT FALSE,
    is_quote_tweet BOOLEAN DEFAULT FALSE,
    is_retweet BOOLEAN DEFAULT FALSE,
    is_thread BOOLEAN DEFAULT FALSE,
    has_media BOOLEAN DEFAULT FALSE,
    media_type TEXT,
    media_url TEXT,
    lang TEXT,
    source TEXT,
    in_reply_to_user TEXT,
    in_reply_to_tweet_id TEXT,
    quoted_tweet_id TEXT,
    tweet_url TEXT,
    -- Derived fields
    char_count INTEGER,
    length_category TEXT CHECK(length_category IN ('short', 'medium', 'long')),
    tweet_type TEXT CHECK(tweet_type IN ('text_only', 'media', 'quote', 'reply', 'retweet', 'thread')),
    -- Curation fields
    quality_rating TEXT CHECK(quality_rating IN ('high', 'medium', 'low')),
    ai_quality_score REAL,
    swipe_status TEXT CHECK(swipe_status IN ('dislike', 'like', 'superlike', 'review_later')),
    is_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_at DATETIME,
    notes TEXT
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('topic', 'pattern', 'use', 'custom')),
    color TEXT
);

-- Tweet-Tag relationship (many-to-many)
CREATE TABLE IF NOT EXISTS tweet_tags (
    tweet_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    source TEXT DEFAULT 'manual' CHECK(source IN ('ai', 'manual')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tweet_id, tag_id),
    FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Session stats table for tracking daily progress
CREATE TABLE IF NOT EXISTS swipe_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date DATE DEFAULT (date('now')),
    tweets_swiped INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    superlikes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0,
    review_later INTEGER DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at);
CREATE INDEX IF NOT EXISTS idx_tweets_favorite_count ON tweets(favorite_count);
CREATE INDEX IF NOT EXISTS idx_tweets_quality_rating ON tweets(quality_rating);
CREATE INDEX IF NOT EXISTS idx_tweets_ai_quality_score ON tweets(ai_quality_score);
CREATE INDEX IF NOT EXISTS idx_tweets_swipe_status ON tweets(swipe_status);
CREATE INDEX IF NOT EXISTS idx_tweets_length_category ON tweets(length_category);
CREATE INDEX IF NOT EXISTS idx_tweets_tweet_type ON tweets(tweet_type);
CREATE INDEX IF NOT EXISTS idx_tweet_tags_tweet_id ON tweet_tags(tweet_id);
CREATE INDEX IF NOT EXISTS idx_tweet_tags_tag_id ON tweet_tags(tag_id);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts USING fts5(
    id,
    full_text,
    content='tweets',
    content_rowid='rowid'
);

-- Trigger to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS tweets_ai AFTER INSERT ON tweets BEGIN
    INSERT INTO tweets_fts(id, full_text) VALUES (new.id, new.full_text);
END;

-- Insert default tags (Dark Academia color palette)
-- Topic tags
INSERT OR IGNORE INTO tags (name, category, color) VALUES
    ('art', 'topic', '#8B4513'),
    ('aesthetics', 'topic', '#CD853F'),
    ('romance', 'topic', '#722F37'),
    ('friendship', 'topic', '#DAA520'),
    ('religion', 'topic', '#4A3728'),
    ('spirituality', 'topic', '#6B4423'),
    ('nyc', 'topic', '#2F4F4F'),
    ('psychospiritual-practices', 'topic', '#556B2F'),
    ('psychospiritual-theory', 'topic', '#6B8E23'),
    ('history', 'topic', '#8B7355'),
    ('media-commentary', 'topic', '#A0522D'),
    ('life-hacks', 'topic', '#B8860B'),
    ('technology', 'topic', '#4682B4'),
    ('performing-arts', 'topic', '#800020'),
    ('community', 'topic', '#8B6914'),
    ('woo-wizardry', 'topic', '#483D8B'),
    ('philosophy', 'topic', '#704214'),
    ('psychology', 'topic', '#8B5A2B'),
    ('politics', 'topic', '#654321'),
    ('culture', 'topic', '#5D3A1A'),
    ('productivity', 'topic', '#6B4226'),
    ('creativity', 'topic', '#996515'),
    ('health', 'topic', '#228B22'),
    ('career', 'topic', '#8B7765'),
    ('education', 'topic', '#5C4033'),
    ('science', 'topic', '#2E8B57'),
    ('economics', 'topic', '#8B4726'),
    ('depression', 'topic', '#4A5568'),
    ('strategy', 'topic', '#744210'),
    ('sociology', 'topic', '#7B341E'),
    ('entities', 'topic', '#553C9A'),
    ('culture', 'topic', '#9C4221');

-- Pattern tags
INSERT OR IGNORE INTO tags (name, category, color) VALUES
    ('hot-take', 'pattern', '#DC143C'),
    ('theory', 'pattern', '#9932CC'),
    ('observation', 'pattern', '#CD853F'),
    ('question', 'pattern', '#B8860B'),
    ('advice', 'pattern', '#DAA520'),
    ('story', 'pattern', '#8B4513'),
    ('joke', 'pattern', '#D2691E'),
    ('rant', 'pattern', '#800000'),
    ('announcement', 'pattern', '#6B4423'),
    ('promotion', 'pattern', '#C53030'),
    ('insight', 'pattern', '#556B2F'),
    ('thread', 'pattern', '#2B6CB0'),
    ('engagement-bait', 'pattern', '#E53E3E'),
    ('dated-reference', 'pattern', '#718096');

-- Use tags (for content destination)
INSERT OR IGNORE INTO tags (name, category, color) VALUES
    ('book', 'use', '#1A365D'),
    ('blog-post', 'use', '#2C5282'),
    ('short-post', 'use', '#4299E1');
