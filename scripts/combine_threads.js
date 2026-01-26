#!/usr/bin/env node
/**
 * Combine thread tweets into single notes
 * 
 * For each thread starter, finds all replies and combines into one text.
 * Saves combined text in the notes field for copying to Substack.
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
// Find Thread Starters and Combine
// ============================================

console.log('\n🧵 Finding and combining threads...\n');

// Get thread starters - tweets that have replies from the same user
const threadStarters = db.prepare(`
    SELECT DISTINCT t.*
    FROM tweets t
    WHERE EXISTS (
        SELECT 1 FROM tweets child 
        WHERE child.in_reply_to_tweet_id = t.id
    )
    AND t.tweet_type != 'reply'
    ORDER BY t.created_at DESC
`).all();

console.log(`Found ${threadStarters.length} thread starters\n`);

let combined = 0;
let readyPromoted = 0;

// Ready tag for clean threads
const readyTagId = db.prepare('SELECT id FROM tags WHERE name = ?').get('substack-ready')?.id;

for (const starter of threadStarters) {
    // Recursively get all parts of this thread
    const threadParts = db.prepare(`
        WITH RECURSIVE thread_chain AS (
            SELECT id, full_text, created_at, 0 as depth FROM tweets WHERE id = ?
            UNION ALL
            SELECT t.id, t.full_text, t.created_at, tc.depth + 1
            FROM tweets t
            JOIN thread_chain tc ON t.in_reply_to_tweet_id = tc.id
        )
        SELECT * FROM thread_chain ORDER BY depth, created_at
    `).all(starter.id);

    if (threadParts.length <= 1) continue;

    // Combine all parts
    const combinedText = threadParts.map((part, i) => {
        return `${i + 1}. ${part.full_text}`;
    }).join('\n\n');

    // Check for issues
    const hasIssues = /@\w+/.test(combinedText) ||
        /#\w+/.test(combinedText) ||
        /https?:\/\/t\.co\/\w+/.test(combinedText) ||
        combinedText.includes('…');

    // Save combined text
    const notePrefix = hasIssues ? '[THREAD - NEEDS REVIEW]' : '[THREAD - CLEAN]';
    db.prepare('UPDATE tweets SET notes = ? WHERE id = ?').run(
        `${notePrefix}\n\n${combinedText}`,
        starter.id
    );

    combined++;

    // If clean and not already tagged, could be promoted
    if (!hasIssues && readyTagId) {
        // Check if has media
        const hasMedia = threadParts.some(p => {
            const tweet = db.prepare('SELECT media_url FROM tweets WHERE id = ?').get(p.id);
            return tweet?.media_url;
        });

        if (!hasMedia) {
            console.log(`   ✅ Clean thread (${threadParts.length} parts): ${starter.id}`);
            readyPromoted++;
        }
    }
}

console.log('\n📊 Results:\n');
console.log(`   🧵 Threads combined:     ${combined}`);
console.log(`   ✅ Clean (no issues):    ${readyPromoted}`);
console.log(`   📝 Saved in notes field for easy copy`);

db.close();
console.log('\n✨ Thread combining complete!');
