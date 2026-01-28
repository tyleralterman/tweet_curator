#!/usr/bin/env node
/**
 * Download media files from Twitter for media tweets
 * 
 * This script:
 * 1. Finds tweets with media_url that are t.co links or Twitter media URLs
 * 2. Resolves and downloads the actual image/video files
 * 3. Saves them locally for use in Substack
 * 
 * Usage:
 *   node download_media.js           # Process all media tweets
 *   node download_media.js --dry-run # Preview without downloading
 *   node download_media.js --limit 5 # Process only 5 tweets
 */

const Database = require('better-sqlite3');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf('--limit') + 1]) : null;

// Database path
const RENDER_DISK_PATH = '/data';
let DB_PATH;
if (fs.existsSync(RENDER_DISK_PATH) && fs.existsSync(path.join(RENDER_DISK_PATH, 'tweets.db'))) {
    DB_PATH = path.join(RENDER_DISK_PATH, 'tweets.db');
} else {
    DB_PATH = path.join(__dirname, '../tweets.db');
}

// Media output path
const MEDIA_DIR = path.join(__dirname, '../media/downloaded');
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

console.log('📂 Using database:', DB_PATH);
console.log('📁 Media will be saved to:', MEDIA_DIR);
if (dryRun) console.log('🔍 DRY RUN - no downloads will happen');
if (limit) console.log(`📊 Limiting to ${limit} tweets`);

const db = new Database(DB_PATH);

// ============================================
// Get Media Tweets to Process
// ============================================

// Find tweets with media that haven't been downloaded yet
// Include liked/superliked AND manual-media tagged tweets
let query = `
    SELECT DISTINCT t.id, t.media_url, t.full_text
    FROM tweets t
    LEFT JOIN tweet_tags tt ON t.id = tt.tweet_id
    LEFT JOIN tags tg ON tt.tag_id = tg.id
    WHERE t.media_url IS NOT NULL
    AND t.media_url LIKE 'http%'
    AND t.media_url NOT LIKE '%/media/downloaded/%'
    AND t.media_url NOT LIKE '%/quote_screenshots/%'
    AND (t.swipe_status IN ('like', 'superlike') OR tg.name = 'manual-media')
`;

if (limit) {
    query += ` LIMIT ${limit}`;
}

const mediaTweets = db.prepare(query).all();
console.log(`\n📋 Found ${mediaTweets.length} media tweets to process\n`);

if (mediaTweets.length === 0) {
    console.log('No media tweets to process.');
    db.close();
    process.exit(0);
}

// ============================================
// Download Functions
// ============================================

function followRedirects(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects === 0) {
            return reject(new Error('Too many redirects'));
        }

        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirect
                const newUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                resolve(followRedirects(newUrl, maxRedirects - 1));
            } else if (res.statusCode === 200) {
                resolve({ url, response: res });
            } else {
                reject(new Error(`HTTP ${res.statusCode}`));
            }
        }).on('error', reject);
    });
}

function downloadFile(url, destPath) {
    return new Promise(async (resolve, reject) => {
        try {
            const { response } = await followRedirects(url);
            const file = fs.createWriteStream(destPath);
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(destPath);
            });
            file.on('error', (err) => {
                fs.unlink(destPath, () => { }); // Delete partial file
                reject(err);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function getExtensionFromUrl(url) {
    // Try to get extension from URL
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath).split('?')[0];
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.webp'].includes(ext.toLowerCase())) {
        return ext.toLowerCase();
    }
    // Default to jpg for Twitter images
    if (url.includes('pbs.twimg.com')) return '.jpg';
    if (url.includes('video.twimg.com')) return '.mp4';
    return '.jpg';
}

// ============================================
// Main Processing
// ============================================

async function main() {
    if (dryRun) {
        console.log('📋 Would process these tweets:\n');
        for (const tweet of mediaTweets) {
            console.log(`ID: ${tweet.id}`);
            console.log(`Media URL: ${tweet.media_url}`);
            console.log(`Text: ${tweet.full_text?.substring(0, 80)}...`);
            console.log('---');
        }
        db.close();
        return;
    }

    const stats = { downloaded: 0, failed: 0, skipped: 0 };

    for (const tweet of mediaTweets) {
        console.log(`\n📥 Processing: ${tweet.id}`);
        console.log(`   URL: ${tweet.media_url.substring(0, 60)}...`);

        try {
            // Resolve the actual media URL (t.co links redirect)
            let mediaUrl = tweet.media_url;

            // If it's a t.co link, we need to resolve it
            if (mediaUrl.includes('t.co/')) {
                console.log('   🔗 Resolving t.co link...');
                const resolved = await followRedirects(mediaUrl);
                mediaUrl = resolved.url;
                console.log(`   → ${mediaUrl.substring(0, 60)}...`);
            }

            // Check if it's actually a media URL we can download
            if (!mediaUrl.includes('twimg.com') && !mediaUrl.match(/\.(jpg|jpeg|png|gif|mp4|webp)/i)) {
                console.log('   ⏭️  Skipped - not a direct media URL');
                stats.skipped++;
                continue;
            }

            // Get extension and create local path
            const ext = getExtensionFromUrl(mediaUrl);
            const localPath = path.join(MEDIA_DIR, `${tweet.id}${ext}`);

            // Download the file
            await downloadFile(mediaUrl, localPath);
            console.log(`   💾 Saved: ${localPath}`);

            // Update database with local path
            db.prepare('UPDATE tweets SET media_url = ? WHERE id = ?').run(localPath, tweet.id);
            console.log('   ✅ Database updated');

            stats.downloaded++;

        } catch (error) {
            console.log(`   ❌ Failed: ${error.message}`);
            stats.failed++;
        }

        // Small delay to be nice to Twitter
        await new Promise(r => setTimeout(r, 500));
    }

    db.close();

    console.log('\n📊 Results:');
    console.log(`   ✅ Downloaded: ${stats.downloaded}`);
    console.log(`   ❌ Failed: ${stats.failed}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log('\n✨ Media download complete!');
}

main().catch(console.error);
