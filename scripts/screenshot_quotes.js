#!/usr/bin/env node
/**
 * Screenshot quoted tweets and convert to media posts
 * 
 * For quote tweets, this script:
 * 1. Takes a screenshot of the quoted tweet
 * 2. Saves screenshot to media/ folder
 * 3. Updates tweet's media_url to point to screenshot
 * 4. Creates combined text in Notes field
 * 5. Moves from substack-manual → broadcast-ready
 * 
 * Usage:
 *   node screenshot_quotes.js           # Process all quote tweets
 *   node screenshot_quotes.js --dry-run # Preview without changes
 *   node screenshot_quotes.js --limit 5 # Process only 5 tweets
 */

const Database = require('better-sqlite3');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

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
const MEDIA_DIR = path.join(__dirname, '../media/quote_screenshots');
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

console.log('📂 Using database:', DB_PATH);
console.log('📸 Screenshots will be saved to:', MEDIA_DIR);
if (dryRun) console.log('🔍 DRY RUN - no changes will be made');
if (limit) console.log(`📊 Limiting to ${limit} tweets`);

const db = new Database(DB_PATH);

// ============================================
// Get Quote Tweets to Process
// ============================================

// Get manual-quote-external and manual-quote-self tagged tweets
// that haven't been processed yet (no screenshot in media_url)
let query = `
    SELECT DISTINCT t.id, t.full_text, t.quoted_tweet_id, t.tweet_url
    FROM tweets t
    JOIN tweet_tags tt ON t.id = tt.tweet_id
    JOIN tags tg ON tt.tag_id = tg.id
    WHERE tg.name IN ('manual-quote-external', 'manual-quote-self')
    AND (t.media_url IS NULL OR t.media_url NOT LIKE '%quote_screenshots%')
`;

if (limit) {
    query += ` LIMIT ${limit}`;
}

const quoteTweets = db.prepare(query).all();
console.log(`\n📋 Found ${quoteTweets.length} quote tweets to process\n`);

if (quoteTweets.length === 0) {
    console.log('No quote tweets to process.');
    db.close();
    process.exit(0);
}

// ============================================
// Screenshot Function
// ============================================

async function screenshotQuotedTweet(browser, tweetUrl) {
    const page = await browser.newPage();
    await page.setViewport({ width: 550, height: 1000 });

    try {
        // Navigate directly to the quoted tweet
        await page.goto(tweetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for tweet content to load
        await page.waitForSelector('article', { timeout: 10000 });

        // Screenshot the main tweet article
        const article = await page.$('article');
        if (!article) {
            throw new Error('Could not find tweet article');
        }

        const screenshot = await article.screenshot({ type: 'png' });
        await page.close();
        return screenshot;
    } catch (error) {
        await page.close();
        throw error;
    }
}

// ============================================
// Main Processing
// ============================================

async function main() {
    if (dryRun) {
        console.log('📋 Would process these tweets:\n');
        for (const tweet of quoteTweets) {
            const quotedTweet = db.prepare('SELECT full_text FROM tweets WHERE id = ?').get(tweet.quoted_tweet_id);
            console.log(`ID: ${tweet.id}`);
            console.log(`Your text: ${tweet.full_text?.substring(0, 100)}...`);
            console.log(`Quoted: ${quotedTweet?.full_text?.substring(0, 100) || '[external tweet]'}...`);
            console.log('---');
        }
        db.close();
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const stats = { processed: 0, failed: 0, skipped: 0 };
    const readyTagId = db.prepare("SELECT id FROM tags WHERE name = 'broadcast-ready'").get()?.id;
    const manualTagId = db.prepare("SELECT id FROM tags WHERE name = 'substack-manual'").get()?.id;

    for (const tweet of quoteTweets) {
        console.log(`\n📸 Processing: ${tweet.id}`);

        // Construct the quoted tweet's URL from its ID
        if (!tweet.quoted_tweet_id) {
            console.log('   ⏭️  Skipped - no quoted tweet ID');
            stats.skipped++;
            continue;
        }

        // Use X's direct status URL for the QUOTED tweet (not your tweet)
        const quotedTweetUrl = `https://x.com/i/web/status/${tweet.quoted_tweet_id}`;

        try {
            // Take screenshot of the quoted tweet directly
            const screenshot = await screenshotQuotedTweet(browser, quotedTweetUrl);

            // Save screenshot
            const screenshotPath = path.join(MEDIA_DIR, `${tweet.id}.png`);
            fs.writeFileSync(screenshotPath, screenshot);
            console.log(`   💾 Saved: ${screenshotPath}`);

            // Get quoted tweet text if available in our DB
            const quotedTweet = db.prepare('SELECT full_text FROM tweets WHERE id = ?').get(tweet.quoted_tweet_id);
            const quotedText = quotedTweet?.full_text || '[See screenshot for quoted content]';

            // Clean our text (remove t.co links)
            const cleanText = tweet.full_text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, '').trim();

            // Create combined text
            const combinedText = `${cleanText}\n\n---\n\n${quotedText}`;

            // Update tweet
            db.prepare(`
                UPDATE tweets 
                SET media_url = ?, notes = ?
                WHERE id = ?
            `).run(screenshotPath, `[QUOTE SCREENSHOT]\n\n${combinedText}`, tweet.id);

            // Move to broadcast-ready if we have readyTagId
            if (readyTagId && manualTagId) {
                db.prepare('DELETE FROM tweet_tags WHERE tweet_id = ? AND tag_id = ?').run(tweet.id, manualTagId);
                db.prepare('INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, ?)').run(tweet.id, readyTagId, 'ai');
            }

            console.log(`   ✅ Updated and promoted to broadcast-ready`);
            stats.processed++;

        } catch (error) {
            console.log(`   ❌ Failed: ${error.message}`);
            stats.failed++;
        }

        // Small delay to be nice to Twitter
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
    db.close();

    console.log('\n📊 Results:');
    console.log(`   ✅ Processed: ${stats.processed}`);
    console.log(`   ❌ Failed: ${stats.failed}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log('\n✨ Screenshot processing complete!');
}

main().catch(console.error);
