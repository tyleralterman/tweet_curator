#!/usr/bin/env node
/**
 * Analyze tweets for Substack posting and apply appropriate tags
 * 
 * Tags applied:
 * - substack-ready: Clean, ready to auto-post
 * - substack-review: Has issues to review (mentions, hashtags, etc.)
 * - substack-manual: Can't auto-post (media, quotes, truncated, threads)
 * - truncated: Text ends with … (incomplete)
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
// Helper: Ensure tag exists
// ============================================
function ensureTag(name, category = 'use') {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (!tag) {
        db.prepare('INSERT INTO tags (name, category, color) VALUES (?, ?, ?)').run(name, category, '#9b59b6');
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

function removeTag(tweetId, tagId) {
    db.prepare('DELETE FROM tweet_tags WHERE tweet_id = ? AND tag_id = ?').run(tweetId, tagId);
}

// ============================================
// Issue Detection Functions
// ============================================

function detectIssues(tweet) {
    const issues = [];
    const text = tweet.full_text || '';

    // Auto-exclude checks
    if (tweet.tweet_type === 'reply') issues.push({ type: 'exclude', reason: 'reply' });
    if (text.toLowerCase().includes('tpot')) issues.push({ type: 'exclude', reason: 'mentions-tpot' });
    if (text.toLowerCase().includes('twitter')) issues.push({ type: 'exclude', reason: 'mentions-twitter' });

    // Manual-post checks
    if (tweet.tweet_type === 'retweet') issues.push({ type: 'manual', reason: 'retweet' });
    if (tweet.tweet_type === 'thread') issues.push({ type: 'manual', reason: 'thread' });
    if (tweet.media_url) {
        // Check if text stands alone (>50 chars without just a t.co link)
        const textWithoutLinks = text.replace(/https?:\/\/t\.co\/\w+/g, '').trim();
        if (textWithoutLinks.length < 50) {
            issues.push({ type: 'manual', reason: 'has-media' });
        } else {
            // Media with good text can be posted - just flag for review
            issues.push({ type: 'review', reason: 'has-media' });
        }
    }
    if (tweet.quoted_tweet_id) issues.push({ type: 'manual', reason: 'quote-tweet' });
    if (text.endsWith('…')) issues.push({ type: 'manual', reason: 'truncated' });

    // Review checks (can still auto-post after review)
    if (/@\w+/.test(text)) issues.push({ type: 'review', reason: 'has-mentions' });
    if (/#\w+/.test(text)) issues.push({ type: 'review', reason: 'has-hashtags' });
    if (/^\d+\//.test(text) || /🧵/.test(text)) issues.push({ type: 'review', reason: 'thread-indicator' });
    if (/retweet|rt this|rt if/i.test(text)) issues.push({ type: 'review', reason: 'twitter-cta' });
    if (/https?:\/\/t\.co\/\w+/.test(text)) issues.push({ type: 'review', reason: 'tco-links' });
    if (/on twitter|on here|on this app|this platform/i.test(text)) issues.push({ type: 'review', reason: 'platform-reference' });
    if (/today|yesterday|just now|this morning|this week|right now/i.test(text)) issues.push({ type: 'review', reason: 'time-sensitive' });
    if (/\b(19|20)\d{2}\b/.test(text)) issues.push({ type: 'review', reason: 'dated-reference' });

    return issues;
}

// ============================================
// Main Analysis
// ============================================

console.log('\n🔍 Analyzing tweets for Substack...\n');

// Ensure tags exist
const readyTagId = ensureTag('substack-ready', 'use');
const reviewTagId = ensureTag('substack-review', 'use');
const manualTagId = ensureTag('substack-manual', 'use');
const truncatedTagId = ensureTag('truncated', 'use');
const excludedTagId = ensureTag('substack-excluded', 'use');

// Get all liked and auto-liked tweets
const tweets = db.prepare(`
    SELECT DISTINCT t.*
    FROM tweets t
    LEFT JOIN tweet_tags tt ON t.id = tt.tweet_id
    LEFT JOIN tags tg ON tt.tag_id = tg.id
    WHERE t.swipe_status = 'like'
       OR tg.name = 'auto-like'
`).all();

console.log(`Found ${tweets.length} liked/auto-liked tweets to analyze\n`);

// Stats
const stats = {
    ready: 0,
    review: 0,
    manual: 0,
    excluded: 0,
    truncated: 0
};

const issueBreakdown = {};

// Process each tweet
for (const tweet of tweets) {
    const issues = detectIssues(tweet);

    // Track issue breakdown
    for (const issue of issues) {
        issueBreakdown[issue.reason] = (issueBreakdown[issue.reason] || 0) + 1;
    }

    // Determine category
    const hasExclude = issues.some(i => i.type === 'exclude');
    const hasManual = issues.some(i => i.type === 'manual');
    const hasReview = issues.some(i => i.type === 'review');
    const isTruncated = issues.some(i => i.reason === 'truncated');

    // Remove any existing substack tags first
    removeTag(tweet.id, readyTagId);
    removeTag(tweet.id, reviewTagId);
    removeTag(tweet.id, manualTagId);
    removeTag(tweet.id, excludedTagId);

    if (hasExclude) {
        addTag(tweet.id, excludedTagId);
        stats.excluded++;
    } else if (hasManual) {
        addTag(tweet.id, manualTagId);
        if (isTruncated) {
            addTag(tweet.id, truncatedTagId);
            stats.truncated++;
        }
        stats.manual++;
    } else if (hasReview) {
        addTag(tweet.id, reviewTagId);
        stats.review++;
    } else {
        addTag(tweet.id, readyTagId);
        stats.ready++;
    }
}

// ============================================
// Report
// ============================================

console.log('📊 Results:\n');
console.log(`   ✅ Ready to post:     ${stats.ready}`);
console.log(`   👀 Needs review:      ${stats.review}`);
console.log(`   ✋ Manual post:       ${stats.manual}`);
console.log(`   ❌ Excluded:          ${stats.excluded}`);
console.log(`   📄 Truncated:         ${stats.truncated}`);
console.log(`   ─────────────────────`);
console.log(`   📝 Total analyzed:    ${tweets.length}`);

console.log('\n📋 Issue Breakdown:\n');
const sortedIssues = Object.entries(issueBreakdown).sort((a, b) => b[1] - a[1]);
for (const [issue, count] of sortedIssues) {
    console.log(`   ${issue}: ${count}`);
}

// How many needed for a year?
const totalPostable = stats.ready + stats.review;
const neededForYear = 3 * 365;
console.log(`\n📅 Scheduling Math:`);
console.log(`   Ready + Review: ${totalPostable}`);
console.log(`   Needed for 1 year (3/day): ${neededForYear}`);
if (totalPostable >= neededForYear) {
    console.log(`   ✅ You have enough!`);
} else {
    console.log(`   ⚠️  Gap: ${neededForYear - totalPostable} more tweets needed`);
}

db.close();
console.log('\n✨ Analysis complete! Tags applied.');
