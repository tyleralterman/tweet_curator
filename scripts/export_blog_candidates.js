#!/usr/bin/env node
/**
 * Export blog candidates for Claude processing
 * Outputs cleaned threads ready for title/polish
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
// Cleanup Functions
// ============================================

function cleanContent(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove thread numbering patterns
    cleaned = cleaned.replace(/^(\d+)[.)\/:]\s*/gm, ''); // "1. ", "1) ", "1/ ", "1:"
    cleaned = cleaned.replace(/^[🧵]\s*/gm, '');
    cleaned = cleaned.replace(/\b(thread|THREAD|Thread):?\s*/g, '');

    // Fix HTML entities
    cleaned = cleaned.replace(/&amp;/g, '&');
    cleaned = cleaned.replace(/&lt;/g, '<');
    cleaned = cleaned.replace(/&gt;/g, '>');
    cleaned = cleaned.replace(/&quot;/g, '"');
    cleaned = cleaned.replace(/&#39;/g, "'");

    // Remove t.co links (they're usually dead or just media links)
    cleaned = cleaned.replace(/\s*https?:\/\/t\.co\/\w+/g, '');

    // Add periods to sentences that end without punctuation (before newlines)
    cleaned = cleaned.replace(/([a-zA-Z0-9])\n/g, '$1.\n');

    // Normalize multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    cleaned = cleaned.trim();

    return cleaned;
}

// ============================================
// Export
// ============================================

// Get liked threads and long posts
const likedThreads = db.prepare(`
    SELECT t.id, t.full_text, t.combined_text, t.favorite_count, t.retweet_count
    FROM tweets t
    WHERE t.combined_text IS NOT NULL
    AND t.swipe_status IN ('like', 'superlike')
    ORDER BY t.favorite_count DESC
`).all();

const likedLongTweets = db.prepare(`
    SELECT t.id, t.full_text, t.favorite_count, t.retweet_count
    FROM tweets t
    WHERE LENGTH(t.full_text) >= 280
    AND t.combined_text IS NULL
    AND t.swipe_status IN ('like', 'superlike')
    ORDER BY t.favorite_count DESC
`).all();

console.log(`\n📊 Found:`);
console.log(`   Liked threads: ${likedThreads.length}`);
console.log(`   Liked long tweets: ${likedLongTweets.length}`);

// Build output
let output = `# Blog Post Candidates\n\nExported: ${new Date().toISOString()}\n\n`;
output += `## Instructions for Claude\n\n`;
output += `For each post below:\n`;
output += `1. Clean up any remaining Twitter artifacts\n`;
output += `2. Polish into flowing prose (maintain original voice)\n`;
output += `3. Suggest a title and subtitle\n`;
output += `4. Suggest a publish date (one per week starting Feb 15, 2026)\n\n`;
output += `---\n\n`;

let count = 0;

// Add threads
for (const thread of likedThreads) {
    count++;
    const content = cleanContent(thread.combined_text);
    const engagement = (thread.favorite_count || 0) + (thread.retweet_count || 0);

    output += `========================\n`;
    output += `POST ${count} (Thread)\n`;
    output += `ID: ${thread.id}\n`;
    output += `Engagement: ${engagement} (${thread.favorite_count} likes)\n`;
    output += `Chars: ${content.length}\n`;
    output += `========================\n\n`;
    output += `${content}\n\n`;
    output += `========================\n\n`;
}

// Add long tweets
for (const tweet of likedLongTweets) {
    count++;
    const content = cleanContent(tweet.full_text);
    const engagement = (tweet.favorite_count || 0) + (tweet.retweet_count || 0);

    output += `========================\n`;
    output += `POST ${count} (Long Tweet - expand to 300-500 words)\n`;
    output += `ID: ${tweet.id}\n`;
    output += `Engagement: ${engagement} (${tweet.favorite_count} likes)\n`;
    output += `Chars: ${content.length}\n`;
    output += `========================\n\n`;
    output += `${content}\n\n`;
    output += `========================\n\n`;
}

// Save output
const outputPath = path.join(__dirname, '../blog_candidates.md');
fs.writeFileSync(outputPath, output);

console.log(`\n✅ Exported ${count} posts to: ${outputPath}`);
console.log(`\n📋 Next steps:`);
console.log(`   1. Open blog_candidates.md`);
console.log(`   2. Paste into Claude desktop app`);
console.log(`   3. Review generated titles and schedules`);

db.close();
