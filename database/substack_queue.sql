-- Substack posting queue table
CREATE TABLE IF NOT EXISTS substack_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'posted', 'failed', 'skipped')),
    scheduled_at DATETIME,
    posted_at DATETIME,
    post_content TEXT,
    media_path TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE
);

-- Index for efficient queue queries
CREATE INDEX IF NOT EXISTS idx_substack_queue_status ON substack_queue(status);
CREATE INDEX IF NOT EXISTS idx_substack_queue_scheduled ON substack_queue(scheduled_at);
