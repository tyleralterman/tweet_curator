const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

console.log('🔄 Auto-tagging threads and long tweets as "blog-candidate"...');

// Ensure tag exists
db.prepare("INSERT OR IGNORE INTO tags (name, category) VALUES ('blog-candidate', 'use')").run();
const tag = db.prepare("SELECT id FROM tags WHERE name = 'blog-candidate'").get();

// Find candidates not yet tagged
const candidates = db.prepare(`
    SELECT id, combined_text, full_text 
    FROM tweets 
    WHERE (combined_text IS NOT NULL OR LENGTH(full_text) > 200)
    AND id NOT IN (
        SELECT tweet_id FROM tweet_tags 
        WHERE tag_id = ?
    )
`).all(tag.id);

console.log(`Found ${candidates.length} untagged candidates.`);

const insert = db.prepare("INSERT INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, 'manual')");

let count = 0;
for (const tweet of candidates) {
    insert.run(tweet.id, tag.id);
    count++;
}

console.log(`✅ tagged ${count} tweets as blog-candidate.`);
