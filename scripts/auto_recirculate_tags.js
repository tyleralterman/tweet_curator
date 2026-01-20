#!/usr/bin/env node
/**
 * Auto-tag tweets for recirculation based on length and engagement
 * 
 * Rules:
 * - "like" tag: Under 281 characters AND over 99 likes
 * - "superlike" tag: Over 550 characters AND over 59 likes
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Determine database path
const RENDER_DISK_PATH = '/data';
let DB_PATH;

if (fs.existsSync(RENDER_DISK_PATH) && fs.existsSync(path.join(RENDER_DISK_PATH, 'tweets.db'))) {
    DB_PATH = path.join(RENDER_DISK_PATH, 'tweets.db');
} else {
    DB_PATH = path.join(__dirname, '../tweets.db');
}

console.log('📂 Using database:', DB_PATH);
const db = new Database(DB_PATH);

// ==============================
// Helper: Ensure tag exists
// ==============================
function ensureTag(name, category = 'use') {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (!tag) {
        db.prepare('INSERT INTO tags (name, category, color) VALUES (?, ?, ?)').run(name, category, '#8e44ad');
        tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
        console.log(`   Created "${name}" tag (${category})`);
    }
    return tag.id;
}

// ==============================
// Part 1: Add "like" tag (short + popular)
// ==============================

console.log('\n❤️ Part 1: Adding "like" tag to short, popular tweets...');
console.log('   Criteria: < 281 characters AND > 99 likes');

const likeTagId = ensureTag('like', 'use');

const likeTweets = db.prepare(`
    SELECT t.id
    FROM tweets t
    WHERE LENGTH(t.full_text) < 281
    AND t.favorite_count > 99
    AND t.id NOT IN (SELECT tweet_id FROM tweet_tags WHERE tag_id = ?)
`).all(likeTagId);

console.log(`   Found ${likeTweets.length} tweets matching criteria`);

const insertTweetTag = db.prepare('INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, ?)');
let likeAdded = 0;
for (const tweet of likeTweets) {
    const result = insertTweetTag.run(tweet.id, likeTagId, 'ai');
    if (result.changes > 0) likeAdded++;
}
console.log(`   ✅ Added "like" tag to ${likeAdded} tweets`);

// ==============================
// Part 2: Add "superlike" tag (long + popular)
// ==============================

console.log('\n⭐ Part 2: Adding "superlike" tag to long, popular tweets...');
console.log('   Criteria: > 550 characters AND > 59 likes');

const superlikeTagId = ensureTag('superlike', 'use');

const superlikeTweets = db.prepare(`
    SELECT t.id
    FROM tweets t
    WHERE LENGTH(t.full_text) > 550
    AND t.favorite_count > 59
    AND t.id NOT IN (SELECT tweet_id FROM tweet_tags WHERE tag_id = ?)
`).all(superlikeTagId);

console.log(`   Found ${superlikeTweets.length} tweets matching criteria`);

let superlikeAdded = 0;
for (const tweet of superlikeTweets) {
    const result = insertTweetTag.run(tweet.id, superlikeTagId, 'ai');
    if (result.changes > 0) superlikeAdded++;
}
console.log(`   ✅ Added "superlike" tag to ${superlikeAdded} tweets`);

// ==============================
// Summary
// ==============================

console.log('\n📊 Summary:');
const likeCount = db.prepare('SELECT COUNT(*) as c FROM tweet_tags WHERE tag_id = ?').get(likeTagId);
const superlikeCount = db.prepare('SELECT COUNT(*) as c FROM tweet_tags WHERE tag_id = ?').get(superlikeTagId);
console.log(`   Total tweets with "like" tag: ${likeCount.c}`);
console.log(`   Total tweets with "superlike" tag: ${superlikeCount.c}`);

db.close();
console.log('\n✨ Done! These tweets are ready for recirculation.');
