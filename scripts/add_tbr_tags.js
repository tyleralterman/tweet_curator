#!/usr/bin/env node
/**
 * One-time script to:
 * 1. Add "tbr" (to-be-read) tag to tweets with spirituality-related tags (unless already has "read")
 * 2. Delete any tags with 0 associated tweets
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

// Tags that trigger TBR assignment
const TRIGGER_TAGS = [
    'psychology',
    'psychospiritual-practice',
    'psychospiritual-theory',
    'religion',
    'spirituality',
    'woo-wizardry'
];

// ==============================
// Part 1: Add "tbr" tag to matching tweets
// ==============================

console.log('\n📖 Part 1: Adding "tbr" tag to spirituality-related tweets...');

// First, ensure "tbr" tag exists
let tbrTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('tbr');
if (!tbrTag) {
    db.prepare('INSERT INTO tags (name, category, color) VALUES (?, ?, ?)').run('tbr', 'custom', '#8e44ad');
    tbrTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('tbr');
    console.log('   Created "tbr" tag');
}
const tbrTagId = tbrTag.id;

// Ensure "read" tag exists for the exclusion check
let readTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('read');
const readTagId = readTag ? readTag.id : null;

// Find tweets that:
// - Have at least one of the trigger tags
// - Do NOT have the "read" tag
// - Do NOT already have the "tbr" tag
const tweetsToTag = db.prepare(`
    SELECT DISTINCT t.id
    FROM tweets t
    INNER JOIN tweet_tags tt ON t.id = tt.tweet_id
    INNER JOIN tags tag ON tt.tag_id = tag.id
    WHERE tag.name IN (${TRIGGER_TAGS.map(() => '?').join(', ')})
    AND t.id NOT IN (
        SELECT tweet_id FROM tweet_tags WHERE tag_id = ?
    )
    ${readTagId ? 'AND t.id NOT IN (SELECT tweet_id FROM tweet_tags WHERE tag_id = ?)' : ''}
`).all(...TRIGGER_TAGS, tbrTagId, ...(readTagId ? [readTagId] : []));

console.log(`   Found ${tweetsToTag.length} tweets to tag with "tbr"`);

// Add the tbr tag to each tweet
const insertTweetTag = db.prepare('INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, ?)');
let addedCount = 0;
for (const tweet of tweetsToTag) {
    const result = insertTweetTag.run(tweet.id, tbrTagId, 'manual');
    if (result.changes > 0) addedCount++;
}
console.log(`   ✅ Added "tbr" tag to ${addedCount} tweets`);

// ==============================
// Part 2: Delete tags with 0 posts
// ==============================

console.log('\n🗑️  Part 2: Deleting tags with 0 associated tweets...');

const emptyTags = db.prepare(`
    SELECT tags.id, tags.name, tags.category
    FROM tags
    LEFT JOIN tweet_tags ON tags.id = tweet_tags.tag_id
    GROUP BY tags.id
    HAVING COUNT(tweet_tags.tweet_id) = 0
`).all();

console.log(`   Found ${emptyTags.length} tags with 0 tweets:`);
for (const tag of emptyTags) {
    console.log(`      - ${tag.name} (${tag.category})`);
}

if (emptyTags.length > 0) {
    const deleteTag = db.prepare('DELETE FROM tags WHERE id = ?');
    for (const tag of emptyTags) {
        deleteTag.run(tag.id);
    }
    console.log(`   ✅ Deleted ${emptyTags.length} empty tags`);
} else {
    console.log('   ✅ No empty tags to delete');
}

db.close();
console.log('\n✨ Done!');
