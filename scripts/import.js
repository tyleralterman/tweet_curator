/**
 * Twitter Archive Import Script
 * Parses tweets.js and note-tweet.js and populates SQLite database
 * Supports: thread detection, media URLs, tweet URLs, deduplication
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Configuration
const ARCHIVE_PATH = process.argv[2] || path.join(__dirname, '../../twitter_archive/data');
const DB_PATH = path.join(__dirname, '../database/tweets.db');
const SCHEMA_PATH = path.join(__dirname, '../database/schema.sql');

// Your Twitter username (for thread detection)
const YOUR_USERNAME = 'tyleralterman';

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Check if this is an update or fresh import
const isUpdate = fs.existsSync(DB_PATH);

// Initialize database
console.log(isUpdate ? '🔄 Updating existing database...' : '🗄️  Initializing new database...');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Run schema (creates tables if not exist)
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);
console.log('✅ Schema ready');

// Parse Twitter's JS format (window.YTD.tweets.part0 = [...])
function parseTwitterJS(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const jsonStart = content.indexOf('[');
    const jsonContent = content.slice(jsonStart);
    return JSON.parse(jsonContent);
}

// Load note tweets and build prefix-based lookup
function loadNoteTweets() {
    const noteTweetPath = path.join(ARCHIVE_PATH, 'note-tweet.js');
    if (!fs.existsSync(noteTweetPath)) {
        console.log('ℹ️  No note-tweet.js found');
        return { byId: new Map(), byPrefix: new Map() };
    }

    const noteTweets = parseTwitterJS(noteTweetPath);
    const byId = new Map();
    const byPrefix = new Map();

    for (const item of noteTweets) {
        const note = item.noteTweet;
        if (note && note.noteTweetId && note.core && note.core.text) {
            const fullText = note.core.text;
            byId.set(note.noteTweetId, fullText);
            const prefix = fullText.substring(0, 200).toLowerCase().replace(/\s+/g, ' ').trim();
            byPrefix.set(prefix, fullText);
        }
    }

    console.log(`📝 Loaded ${byId.size} note tweets (long tweets)`);
    return { byId, byPrefix };
}

// Build map of all tweet IDs for thread detection
function buildTweetIdMap(tweetsData) {
    const idMap = new Map();
    for (const item of tweetsData) {
        const tweet = item.tweet;
        if (tweet && tweet.id_str) {
            idMap.set(tweet.id_str, tweet);
        }
    }
    return idMap;
}

// Parse date from Twitter format
function parseTwitterDate(dateStr) {
    const date = new Date(dateStr);
    return date.toISOString();
}

// Determine length category
function getLengthCategory(charCount) {
    if (charCount <= 280) return 'short';
    if (charCount <= 1000) return 'medium';
    return 'long';
}

// Determine tweet type with thread detection
function getTweetType(tweet, tweetIdMap) {
    // Check for retweet first
    if (tweet.full_text && tweet.full_text.startsWith('RT @')) {
        return 'retweet';
    }

    // Check for thread (reply to self)
    if (tweet.in_reply_to_screen_name &&
        tweet.in_reply_to_screen_name.toLowerCase() === YOUR_USERNAME.toLowerCase()) {
        return 'thread';
    }

    // Check if this tweet has self-replies (is thread starter)
    // This would require a second pass, we'll handle it differently

    // Check for reply to others
    if (tweet.in_reply_to_status_id) {
        return 'reply';
    }

    // Check for quote tweet
    if (tweet.quoted_status_id || (tweet.entities && tweet.entities.urls &&
        tweet.entities.urls.some(u => u.expanded_url && u.expanded_url.includes('/status/')))) {
        return 'quote';
    }

    // Check for media
    if (tweet.entities && (tweet.extended_entities ||
        (tweet.entities.media && tweet.entities.media.length > 0))) {
        return 'media';
    }

    return 'text_only';
}

// Get media URL and type
function getMediaInfo(tweet) {
    const extMedia = tweet.extended_entities;
    if (extMedia && extMedia.media && extMedia.media.length > 0) {
        const media = extMedia.media[0];
        const type = media.type === 'video' ? 'video' :
            media.type === 'animated_gif' ? 'gif' : 'photo';
        // Get the best URL
        let url = media.media_url_https || media.media_url;
        if (type === 'video' && media.video_info && media.video_info.variants) {
            // Get highest quality video
            const mp4s = media.video_info.variants.filter(v => v.content_type === 'video/mp4');
            if (mp4s.length > 0) {
                mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                url = mp4s[0].url;
            }
        }
        return { type, url };
    }
    return { type: null, url: null };
}

// Get quoted tweet ID
function getQuotedTweetId(tweet) {
    if (tweet.quoted_status_id_str) {
        return tweet.quoted_status_id_str;
    }
    // Try to extract from URLs
    if (tweet.entities && tweet.entities.urls) {
        for (const url of tweet.entities.urls) {
            if (url.expanded_url) {
                const match = url.expanded_url.match(/twitter\.com\/\w+\/status\/(\d+)/);
                if (match) return match[1];
                const xMatch = url.expanded_url.match(/x\.com\/\w+\/status\/(\d+)/);
                if (xMatch) return xMatch[1];
            }
        }
    }
    return null;
}

// Generate tweet URL
function getTweetUrl(tweetId) {
    return `https://x.com/${YOUR_USERNAME}/status/${tweetId}`;
}

// Get existing tweet IDs for deduplication
function getExistingTweetIds() {
    const rows = db.prepare('SELECT id FROM tweets').all();
    return new Set(rows.map(r => r.id));
}

// Check if text is truncated
function isTruncated(text) {
    return text.endsWith('…') || text.endsWith('...');
}

// Get full text from note tweets by matching prefix
function getFullTextFromNotes(tweet, noteTweets) {
    const originalText = tweet.full_text || '';

    if (!isTruncated(originalText)) {
        return originalText;
    }

    const textWithoutEllipsis = originalText.replace(/…$/, '').replace(/\.{3}$/, '').trim();
    const prefix = textWithoutEllipsis.substring(0, 200).toLowerCase().replace(/\s+/g, ' ').trim();

    if (noteTweets.byPrefix.has(prefix)) {
        return noteTweets.byPrefix.get(prefix);
    }

    if (noteTweets.byId.has(tweet.id_str)) {
        return noteTweets.byId.get(tweet.id_str);
    }

    return originalText;
}

// Main import function
async function importTweets() {
    console.log('📂 Loading Twitter archive from:', ARCHIVE_PATH);

    const tweetsPath = path.join(ARCHIVE_PATH, 'tweets.js');
    if (!fs.existsSync(tweetsPath)) {
        console.error('❌ tweets.js not found at:', tweetsPath);
        process.exit(1);
    }

    const noteTweets = loadNoteTweets();
    const existingIds = isUpdate ? getExistingTweetIds() : new Set();
    if (isUpdate) {
        console.log(`📊 Found ${existingIds.size} existing tweets in database`);
    }

    console.log('📖 Parsing tweets.js...');
    const tweetsData = parseTwitterJS(tweetsPath);
    console.log(`📊 Found ${tweetsData.length} tweets in archive`);

    // Build ID map for thread detection
    const tweetIdMap = buildTweetIdMap(tweetsData);

    // Prepare insert statement with new fields
    const insertTweet = db.prepare(`
        INSERT OR REPLACE INTO tweets (
            id, full_text, created_at, favorite_count, retweet_count,
            is_reply, is_quote_tweet, is_retweet, is_thread, has_media, 
            media_type, media_url, lang, source, 
            in_reply_to_user, in_reply_to_tweet_id, quoted_tweet_id, tweet_url,
            char_count, length_category, tweet_type
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?
        )
    `);

    const insertMany = db.transaction((tweets) => {
        let imported = 0;
        let skipped = 0;
        let duplicates = 0;
        let longTweets = 0;
        let threads = 0;

        for (const item of tweets) {
            const tweet = item.tweet;

            if (!tweet || !tweet.id_str) {
                skipped++;
                continue;
            }

            /*
            if (existingIds.has(tweet.id_str)) {
                duplicates++;
                // continue; // Commented out to allow updates
            }
            */

            try {
                let fullText = getFullTextFromNotes(tweet, noteTweets);

                if (fullText.length > (tweet.full_text || '').length) {
                    longTweets++;
                }

                const tweetType = getTweetType(tweet, tweetIdMap);
                if (tweetType === 'thread') threads++;

                const charCount = fullText.length;
                const mediaInfo = getMediaInfo(tweet);
                const hasMedia = mediaInfo.type !== null;
                const quotedTweetId = getQuotedTweetId(tweet);

                // Clean up source
                let source = tweet.source || '';
                const sourceMatch = source.match(/>([^<]+)</);
                if (sourceMatch) {
                    source = sourceMatch[1];
                }

                insertTweet.run(
                    tweet.id_str,
                    fullText,
                    parseTwitterDate(tweet.created_at),
                    parseInt(tweet.favorite_count) || 0,
                    parseInt(tweet.retweet_count) || 0,
                    tweet.in_reply_to_status_id ? 1 : 0,
                    tweetType === 'quote' ? 1 : 0,
                    tweetType === 'retweet' ? 1 : 0,
                    tweetType === 'thread' ? 1 : 0,
                    hasMedia ? 1 : 0,
                    mediaInfo.type,
                    mediaInfo.url,
                    tweet.lang || 'en',
                    source,
                    tweet.in_reply_to_screen_name || null,
                    tweet.in_reply_to_status_id_str || null,
                    quotedTweetId,
                    getTweetUrl(tweet.id_str),
                    charCount,
                    getLengthCategory(charCount),
                    tweetType
                );

                imported++;
            } catch (err) {
                console.error(`⚠️  Error importing tweet ${tweet.id_str}:`, err.message);
                skipped++;
            }
        }

        return { imported, skipped, duplicates, longTweets, threads };
    });

    console.log('💾 Importing to database...');
    const startTime = Date.now();
    const result = insertMany(tweetsData);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Import complete!`);
    console.log(`   📥 New tweets imported: ${result.imported.toLocaleString()}`);
    console.log(`   📜 Long tweets matched: ${result.longTweets.toLocaleString()}`);
    console.log(`   🧵 Thread tweets found: ${result.threads.toLocaleString()}`);
    if (result.duplicates > 0) {
        console.log(`   🔄 Duplicates skipped: ${result.duplicates.toLocaleString()}`);
    }
    console.log(`   ⏭️  Errors skipped: ${result.skipped}`);
    console.log(`   ⏱️  Duration: ${duration}s`);

    // Show stats
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN tweet_type = 'text_only' THEN 1 ELSE 0 END) as text_only,
            SUM(CASE WHEN tweet_type = 'reply' THEN 1 ELSE 0 END) as replies,
            SUM(CASE WHEN tweet_type = 'retweet' THEN 1 ELSE 0 END) as retweets,
            SUM(CASE WHEN tweet_type = 'media' THEN 1 ELSE 0 END) as with_media,
            SUM(CASE WHEN tweet_type = 'quote' THEN 1 ELSE 0 END) as quotes,
            SUM(CASE WHEN tweet_type = 'thread' THEN 1 ELSE 0 END) as threads,
            SUM(CASE WHEN length_category = 'short' THEN 1 ELSE 0 END) as short,
            SUM(CASE WHEN length_category = 'medium' THEN 1 ELSE 0 END) as medium,
            SUM(CASE WHEN length_category = 'long' THEN 1 ELSE 0 END) as long_tweets
        FROM tweets
    `).get();

    console.log(`\n📊 Tweet Statistics (Total in DB):`);
    console.log(`   Total: ${stats.total.toLocaleString()}`);
    console.log(`   ├── Text only: ${stats.text_only.toLocaleString()}`);
    console.log(`   ├── With media: ${stats.with_media.toLocaleString()}`);
    console.log(`   ├── Replies: ${stats.replies.toLocaleString()}`);
    console.log(`   ├── Retweets: ${stats.retweets.toLocaleString()}`);
    console.log(`   ├── Quote tweets: ${stats.quotes.toLocaleString()}`);
    console.log(`   └── Threads: ${stats.threads.toLocaleString()}`);
    console.log(`\n📏 Length Distribution:`);
    console.log(`   ├── Short (≤280): ${stats.short.toLocaleString()}`);
    console.log(`   ├── Medium (281-1000): ${stats.medium.toLocaleString()}`);
    console.log(`   └── Long (>1000): ${stats.long_tweets.toLocaleString()}`);

    db.close();
}

// Run import
importTweets().catch(err => {
    console.error('❌ Import failed:', err);
    process.exit(1);
});
