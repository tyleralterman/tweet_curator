#!/usr/bin/env node
/**
 * Build the Substack posting queue from ready tweets
 * Assigns scheduled times: 9:00 AM, 1:00 PM, 8:30 PM daily
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

// Run schema
const schemaPath = path.join(__dirname, '../database/substack_queue.sql');
if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    console.log('✅ Queue schema applied');
}

// ============================================
// Config
// ============================================

const POSTS_PER_DAY = 3;
const POST_TIMES = ['09:00', '13:00', '20:30']; // 9am, 1pm, 8:30pm
const TIMEZONE = 'America/Chicago'; // CST

// ============================================
// Get Ready Tweets
// ============================================

console.log('\n📋 Building posting queue...\n');

// Get substack-ready tag ID
const readyTag = db.prepare("SELECT id FROM tags WHERE name = 'substack-ready'").get();
if (!readyTag) {
    console.log('❌ No substack-ready tag found. Run analyze_for_substack.js first.');
    process.exit(1);
}

// Get all ready tweets not already in queue
const readyTweets = db.prepare(`
    SELECT DISTINCT t.id, t.full_text, t.media_url
    FROM tweets t
    JOIN tweet_tags tt ON t.id = tt.tweet_id
    WHERE tt.tag_id = ?
    AND t.id NOT IN (SELECT tweet_id FROM substack_queue)
    ORDER BY t.favorite_count DESC
`).all(readyTag.id);

console.log(`Found ${readyTweets.length} ready tweets to schedule`);

if (readyTweets.length === 0) {
    console.log('No new tweets to add to queue.');
    db.close();
    process.exit(0);
}

// ============================================
// Schedule Tweets
// ============================================

// Start from tomorrow
const startDate = new Date();
startDate.setDate(startDate.getDate() + 1);
startDate.setHours(0, 0, 0, 0);

const insertQueue = db.prepare(`
    INSERT INTO substack_queue (tweet_id, scheduled_at, post_content, media_path, status)
    VALUES (?, ?, ?, ?, 'pending')
`);

let scheduled = 0;
let currentDate = new Date(startDate);
let timeIndex = 0;

for (const tweet of readyTweets) {
    // Build scheduled datetime
    const [hours, minutes] = POST_TIMES[timeIndex].split(':').map(Number);
    const scheduledAt = new Date(currentDate);
    scheduledAt.setHours(hours, minutes, 0, 0);

    // Clean post content (basic cleanup - more can be done in review)
    let content = tweet.full_text || '';
    // Remove t.co links at end of tweets (often just media links)
    content = content.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '');

    try {
        insertQueue.run(
            tweet.id,
            scheduledAt.toISOString(),
            content.trim(),
            tweet.media_url || null
        );
        scheduled++;
    } catch (e) {
        // Already in queue, skip
    }

    // Move to next time slot
    timeIndex++;
    if (timeIndex >= POST_TIMES.length) {
        timeIndex = 0;
        currentDate.setDate(currentDate.getDate() + 1);
    }
}

// ============================================
// Report
// ============================================

const queueStats = db.prepare(`
    SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted,
        MIN(scheduled_at) as first_scheduled,
        MAX(scheduled_at) as last_scheduled
    FROM substack_queue
`).get();

console.log(`\n📊 Queue Status:`);
console.log(`   Total in queue: ${queueStats.total}`);
console.log(`   Pending: ${queueStats.pending}`);
console.log(`   Posted: ${queueStats.posted}`);
console.log(`   First post: ${queueStats.first_scheduled}`);
console.log(`   Last post: ${queueStats.last_scheduled}`);

const daysOfContent = Math.ceil(queueStats.pending / POSTS_PER_DAY);
console.log(`\n📅 That's ${daysOfContent} days of content (${Math.round(daysOfContent / 30)} months)`);

db.close();
console.log('\n✨ Queue built successfully!');
