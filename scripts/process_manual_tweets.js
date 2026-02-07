#!/usr/bin/env node
/**
 * Process substack-manual tweets into subcategories and merge self-quotes
 * 
 * Tags created:
 * - manual-media: Has attached image/video
 * - manual-quote-self: Quotes your own tweet (can auto-merge)
 * - manual-quote-external: Quotes someone else's tweet
 * - manual-thread: Part of a thread
 * 
 * For self-quotes: Creates merged text in notes field for easy copy
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database path
const RENDER_DISK_PATH = '/data';
let DB_PATH;
if (fs.existsSync(RENDER_DISK_PATH) && fs.existsSync(path.join(RENDER_DISK_PATH, 'tweets.db'))) {
    DB_PATH = path.join(RENDER_DISK_PATH, 'tweets.db');
} else {
    DB_PATH = path.join(__dirname, '../tweets.db');
}

console.log('📂 Using database:', DB_PATH);
const db = new Database(DB_PATH);

// ============================================
// Helper Functions
// ============================================

function ensureTag(name, category = 'use') {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (!tag) {
        db.prepare('INSERT INTO tags (name, category, color) VALUES (?, ?, ?)').run(name, category, '#e67e22');
        tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
        console.log(`   Created "${name}" tag`);
    }
    return tag.id;
}

function addTag(tweetId, tagId) {
    try {
        db.prepare('INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, ?)').run(tweetId, tagId, 'ai');
        return true;
    } catch (e) {
        return false;
    }
}

// ============================================
// Main Processing
// ============================================

console.log('\n🔧 Processing substack-manual tweets...\n');

// Create subcategory tags
const mediaTagId = ensureTag('manual-media', 'use');
const selfQuoteTagId = ensureTag('manual-quote-self', 'use');
const extQuoteTagId = ensureTag('manual-quote-external', 'use');
const threadTagId = ensureTag('manual-thread', 'use');

// Get all manual tweets
const manualTweets = db.prepare(`
    SELECT DISTINCT t.*
    FROM tweets t
    JOIN tweet_tags tt ON t.id = tt.tweet_id
    JOIN tags tg ON tt.tag_id = tg.id
    WHERE tg.name = 'substack-manual'
`).all();

console.log(`Found ${manualTweets.length} substack-manual tweets\n`);

const stats = {
    media: 0,
    selfQuote: 0,
    extQuote: 0,
    thread: 0,
    merged: 0
};

// Ready tag for promoting self-quotes
const readyTagId = db.prepare('SELECT id FROM tags WHERE name = ?').get('broadcast-ready')?.id;
const manualTagId = db.prepare('SELECT id FROM tags WHERE name = ?').get('substack-manual')?.id;

for (const tweet of manualTweets) {
    // Category: Has media
    if (tweet.media_url) {
        addTag(tweet.id, mediaTagId);
        stats.media++;
    }

    // Category: Thread
    if (tweet.tweet_type === 'thread') {
        addTag(tweet.id, threadTagId);
        stats.thread++;
    }

    // Category: Quote tweet
    if (tweet.quoted_tweet_id) {
        // Check if it's a self-quote
        const quotedTweet = db.prepare('SELECT * FROM tweets WHERE id = ?').get(tweet.quoted_tweet_id);

        if (quotedTweet) {
            // Self-quote! Merge and promote to ready
            addTag(tweet.id, selfQuoteTagId);
            stats.selfQuote++;

            // Create merged text
            const mergedText = `${tweet.full_text}\n\n---\n\n${quotedTweet.full_text}`;

            // Check for issues in merged text
            const hasIssues = /@\w+/.test(mergedText) ||
                /#\w+/.test(mergedText) ||
                /https?:\/\/t\.co\/\w+/.test(mergedText) ||
                mergedText.endsWith('…');

            if (!hasIssues && !tweet.media_url && !quotedTweet.media_url) {
                // Clean self-quote - promote to ready!
                db.prepare('UPDATE tweets SET notes = ? WHERE id = ?').run(
                    `[AUTO-MERGED]\n${mergedText}`,
                    tweet.id
                );

                // Remove manual tag, add ready tag
                if (readyTagId && manualTagId) {
                    db.prepare('DELETE FROM tweet_tags WHERE tweet_id = ? AND tag_id = ?').run(tweet.id, manualTagId);
                    addTag(tweet.id, readyTagId);
                    stats.merged++;
                    console.log(`   ✅ Merged and promoted: ${tweet.id}`);
                }
            } else {
                // Has issues, save merged text in notes for manual review
                db.prepare('UPDATE tweets SET notes = ? WHERE id = ?').run(
                    `[NEEDS REVIEW - merged self-quote]\n${mergedText}`,
                    tweet.id
                );
            }
        } else {
            // External quote
            addTag(tweet.id, extQuoteTagId);
            stats.extQuote++;
        }
    }
}

// ============================================
// Report
// ============================================

console.log('\n📊 Results:\n');
console.log(`   🖼️  With media:         ${stats.media}`);
console.log(`   💬 Self-quotes:        ${stats.selfQuote}`);
console.log(`      ✅ Auto-merged:     ${stats.merged}`);
console.log(`   📣 External quotes:    ${stats.extQuote}`);
console.log(`   🧵 Threads:            ${stats.thread}`);

// Get updated ready count
const readyCount = db.prepare(`
    SELECT COUNT(*) as count FROM tweets t
    JOIN tweet_tags tt ON t.id = tt.tweet_id
    JOIN tags tg ON tt.tag_id = tg.id
    WHERE tg.name = 'broadcast-ready'
`).get();

console.log(`\n📈 Total broadcast-ready: ${readyCount.count}`);

db.close();
console.log('\n✨ Processing complete!');
