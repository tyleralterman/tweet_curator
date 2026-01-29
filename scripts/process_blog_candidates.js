#!/usr/bin/env node
/**
 * Process blog candidates: clean and store in database
 * - Threads (combined_text) + Long individual tweets (200+ chars)
 * - Fixes spelling, grammar, abbreviations
 * - Stores cleaned text in blog_text column
 * - Tags liked/superliked items as 'blog-ready'
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
// Abbreviation Map
// ============================================
const ABBREVIATIONS = {
    // Common abbreviations
    'ppl': 'people',
    'rn': 'right now',
    'bc': 'because',
    'b/c': 'because',
    'tbh': 'to be honest',
    'imo': 'in my opinion',
    'imho': 'in my humble opinion',
    'idk': "I don't know",
    'ngl': 'not gonna lie',
    'jk': 'just kidding',
    'w/': 'with',
    'w/o': 'without',
    'abt': 'about',
    'smth': 'something',
    'sth': 'something',
    'prob': 'probably',
    'def': 'definitely',
    'obv': 'obviously',
    'v ': 'very ',
    'ur': 'your',
    'u ': 'you ',
    'r ': 'are ',
    'thru': 'through',
    'tho': 'though',
    'govt': 'government',
    'yrs': 'years',
    'yr': 'year',
    'hrs': 'hours',
    'hr': 'hour',
    'mins': 'minutes',
    'min': 'minute',
    'secs': 'seconds',
    'sec': 'second',
    'info': 'information',
    'convo': 'conversation',
    'esp': 'especially',
    'diff': 'different',
    'approx': 'approximately',
    'btw': 'by the way',
    'fwiw': 'for what it\'s worth',
    'afaik': 'as far as I know',
    'iirc': 'if I recall correctly',
    'tldr': 'in summary',
    'tl;dr': 'in summary',
    'wrt': 'with respect to',
    're:': 'regarding',
    'msg': 'message',
    'msgs': 'messages',
    'acc': 'account',
    'acct': 'account',
    'mgmt': 'management',
    'btwn': 'between',
    // Twitter-specific
    'RT': '',
    'mt': '',
    'ht': '',
    'cc': '',
};

// Common spelling mistakes
const SPELLING_FIXES = {
    'definately': 'definitely',
    'seperate': 'separate',
    'occured': 'occurred',
    'recieve': 'receive',
    'wierd': 'weird',
    'untill': 'until',
    'alot': 'a lot',
    'noone': 'no one',
    'occassion': 'occasion',
    'neccessary': 'necessary',
    'accomodate': 'accommodate',
    'aquire': 'acquire',
    'apparantly': 'apparently',
    'begining': 'beginning',
    'beleive': 'believe',
    'calender': 'calendar',
    'collegue': 'colleague',
    'commited': 'committed',
    'concious': 'conscious',
    'existance': 'existence',
    'goverment': 'government',
    'humourous': 'humorous',
    'independant': 'independent',
    'knowlege': 'knowledge',
    'liason': 'liaison',
    'millenium': 'millennium',
    'occurance': 'occurrence',
    'privelege': 'privilege',
    'publically': 'publicly',
    'recomend': 'recommend',
    'refered': 'referred',
    'succesful': 'successful',
    'tommorow': 'tomorrow',
    'truely': 'truly',
};

// ============================================
// Cleanup Functions
// ============================================

function cleanContent(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove thread numbering patterns
    cleaned = cleaned.replace(/^(\d+)[.)\/:]\s*/gm, '');
    cleaned = cleaned.replace(/^[🧵]\s*/gm, '');
    cleaned = cleaned.replace(/\b(thread|THREAD|Thread):?\s*/gi, '');

    // Fix HTML entities
    cleaned = cleaned.replace(/&amp;/g, '&');
    cleaned = cleaned.replace(/&lt;/g, '<');
    cleaned = cleaned.replace(/&gt;/g, '>');
    cleaned = cleaned.replace(/&quot;/g, '"');
    cleaned = cleaned.replace(/&#39;/g, "'");
    cleaned = cleaned.replace(/&nbsp;/g, ' ');

    // Remove t.co links
    cleaned = cleaned.replace(/\s*https?:\/\/t\.co\/\w+/g, '');

    // Fix abbreviations (case-insensitive where appropriate)
    for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
        // Word boundary matching
        const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
        cleaned = cleaned.replace(regex, full);
    }

    // Fix common spelling mistakes (case-insensitive)
    for (const [wrong, right] of Object.entries(SPELLING_FIXES)) {
        const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
        cleaned = cleaned.replace(regex, right);
    }

    // Capitalize "I" when standalone
    cleaned = cleaned.replace(/\bi\b/g, 'I');

    // Capitalize first letter after periods
    cleaned = cleaned.replace(/\.\s+([a-z])/g, (match, p1) => '. ' + p1.toUpperCase());

    // Capitalize first letter of text
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

    // Add periods to sentences that end without punctuation (before newlines)
    cleaned = cleaned.replace(/([a-zA-Z0-9])(\n)/g, '$1.$2');

    // Remove @ mentions (keep the name without @)
    cleaned = cleaned.replace(/@(\w+)/g, '$1');

    // Normalize multiple spaces
    cleaned = cleaned.replace(/  +/g, ' ');

    // Normalize multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    cleaned = cleaned.trim();

    return cleaned;
}

// ============================================
// Main Processing
// ============================================

console.log('\n🔄 Processing blog candidates...\n');

// Get blog-ready tag ID
const blogReadyTag = db.prepare("SELECT id FROM tags WHERE name = 'blog-ready'").get();
if (!blogReadyTag) {
    console.error('❌ blog-ready tag not found!');
    process.exit(1);
}

const stats = {
    threadsProcessed: 0,
    longTweetsProcessed: 0,
    blogReadyTagged: 0
};

// Process threads (combined_text exists)
const threads = db.prepare(`
    SELECT id, combined_text, swipe_status
    FROM tweets 
    WHERE combined_text IS NOT NULL
    AND LENGTH(combined_text) > 200
`).all();

console.log(`📚 Processing ${threads.length} threads...`);

const updateBlogText = db.prepare('UPDATE tweets SET blog_text = ? WHERE id = ?');
const insertTag = db.prepare('INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id) VALUES (?, ?)');

for (const thread of threads) {
    const cleaned = cleanContent(thread.combined_text);
    updateBlogText.run(cleaned, thread.id);
    stats.threadsProcessed++;

    // Auto-tag liked/superliked as blog-ready
    if (thread.swipe_status === 'like' || thread.swipe_status === 'superlike') {
        insertTag.run(thread.id, blogReadyTag.id);
        stats.blogReadyTagged++;
    }
}

// Process long individual tweets (no combined_text)
const longTweets = db.prepare(`
    SELECT id, full_text, swipe_status
    FROM tweets 
    WHERE combined_text IS NULL
    AND LENGTH(full_text) >= 200
`).all();

console.log(`📝 Processing ${longTweets.length} long tweets...`);

for (const tweet of longTweets) {
    const cleaned = cleanContent(tweet.full_text);
    updateBlogText.run(cleaned, tweet.id);
    stats.longTweetsProcessed++;

    // Auto-tag liked/superliked as blog-ready
    if (tweet.swipe_status === 'like' || tweet.swipe_status === 'superlike') {
        insertTag.run(tweet.id, blogReadyTag.id);
        stats.blogReadyTagged++;
    }
}

console.log('\n✅ Processing complete!');
console.log(`   Threads processed: ${stats.threadsProcessed}`);
console.log(`   Long tweets processed: ${stats.longTweetsProcessed}`);
console.log(`   Tagged as blog-ready: ${stats.blogReadyTagged}`);

// Show sample of cleaned content
console.log('\n📋 Sample cleaned content:');
const sample = db.prepare(`
    SELECT id, SUBSTR(blog_text, 1, 200) as preview
    FROM tweets 
    WHERE blog_text IS NOT NULL 
    AND swipe_status IN ('like', 'superlike')
    LIMIT 2
`).all();

for (const s of sample) {
    console.log(`\n   ID ${s.id}:`);
    console.log(`   "${s.preview}..."`);
}

db.close();
