const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

console.log('🔄 enforcing strict blog-candidate criteria...');
console.log('   - Threads: Must have 4+ tweets');
console.log('   - Long Tweets: Must be 1000+ chars');

const tag = db.prepare("SELECT id FROM tags WHERE name = 'blog-candidate'").get();
if (!tag) {
    console.error('Tag not found!');
    process.exit(1);
}

// 1. CLEANUP: Remove tags from items that don't meet criteria
const currentTagged = db.prepare(`
    SELECT tt.tweet_id, t.combined_text, t.full_text
    FROM tweet_tags tt
    JOIN tweets t ON t.id = tt.tweet_id
    WHERE tt.tag_id = ?
`).all(tag.id);

console.log(`Checking ${currentTagged.length} currently tagged items...`);

let removed = 0;
const deleteTag = db.prepare("DELETE FROM tweet_tags WHERE tweet_id = ? AND tag_id = ?");

for (const item of currentTagged) {
    let keep = false;

    if (item.combined_text) {
        // Count parts (e.g. "1. ", "5. ")
        const parts = (item.combined_text.match(/^\d+\.\s/gm) || []).length;
        if (parts >= 4) keep = true;
    } else {
        if (item.full_text.length >= 1000) keep = true;
    }

    if (!keep) {
        deleteTag.run(item.tweet_id, tag.id);
        removed++;
    }
}
console.log(`🗑️ Removed ${removed} tags (did not meet criteria).`);

// 2. ADD: Tag items that meet criteria but aren't tagged
const candidates = db.prepare(`
    SELECT id, combined_text, full_text 
    FROM tweets 
    WHERE (combined_text IS NOT NULL OR LENGTH(full_text) >= 1000)
    AND id NOT IN (
        SELECT tweet_id FROM tweet_tags 
        WHERE tag_id = ?
    )
`).all(tag.id);

console.log(`Checking ${candidates.length} potential candidates...`);

let added = 0;
const insert = db.prepare("INSERT INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, 'manual')");

for (const tweet of candidates) {
    let shouldTag = false;

    if (tweet.combined_text) {
        const parts = (tweet.combined_text.match(/^\d+\.\s/gm) || []).length;
        if (parts >= 4) shouldTag = true;
    } else {
        if (tweet.full_text.length >= 1000) shouldTag = true;
    }

    if (shouldTag) {
        insert.run(tweet.id, tag.id);
        added++;
    }
}

console.log(`✅ Added ${added} new tags.`);
console.log(`📊 Final Count: ${(currentTagged.length - removed) + added}`);
