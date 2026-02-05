#!/usr/bin/env node
/**
 * Sync Duplicate Tags to Render
 * 
 * Pushes the 'duplicate' tags detected by detect_duplicates.js to the production database
 */
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH, { fileMustExist: true });

async function addTag(tweetId, tagName) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'tweet-curator.onrender.com',
            path: `/api/tweets/${tweetId}/tags`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify({ tagName }));
        req.end();
    });
}

async function main() {
    console.log('🔄 Syncing duplicate tags to Render...\n');

    // Get all tweets tagged as 'duplicate' locally
    const duplicateTweets = db.prepare(`
        SELECT t.id
        FROM tweets t
        JOIN tweet_tags tt ON t.id = tt.tweet_id
        JOIN tags tag ON tt.tag_id = tag.id
        WHERE tag.name = 'duplicate'
    `).all();

    console.log(`Found ${duplicateTweets.length} duplicate tweets to sync.`);

    // Check which ones already have the tag on Render (optimization)
    // For now, we'll just try to add them all - the API handles duplicates gracefully usually
    // Or we could fetch existing duplicates first

    console.log('Fetching existing duplicate tags from Render...');
    let existingDuplicates = new Set();
    try {
        const renderTweets = await new Promise((resolve, reject) => {
            const req = https.get('https://tweet-curator.onrender.com/api/tweets?tag=duplicate&limit=5000', (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        resolve(data.tweets || []);
                    } catch (e) {
                        resolve([]); // If error or empty, assume none
                    }
                });
            });
            req.on('error', () => resolve([]));
        });
        existingDuplicates = new Set(renderTweets.map(t => t.id));
        console.log(`Render already has ${existingDuplicates.size} duplicate tags.`);
    } catch (e) {
        console.log('Could not fetch existing tags, proceeding with full sync.');
    }

    const toSync = duplicateTweets.filter(t => !existingDuplicates.has(t.id));
    console.log(`Queueing ${toSync.length} tags to add...\n`);

    let processed = 0;
    let errors = 0;
    const CONCURRENCY = 2; // Reduced concurrency
    const DELAY_MS = 100; // Delay between requests

    for (let i = 0; i < toSync.length; i += CONCURRENCY) {
        const batch = toSync.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (tweet) => {
            try {
                await addTag(tweet.id, 'duplicate');
                process.stdout.write('.');
                await new Promise(r => setTimeout(r, DELAY_MS));
            } catch (err) {
                // process.stdout.write('x');
                console.error(`\nError for ${tweet.id}: ${err.message}`);
                errors++;
            }
        }));
        processed += batch.length;
        if (processed % 20 === 0) console.log(` ${processed}/${toSync.length}`);
    }

    console.log(`\n\n✅ Done! Synced: ${processed - errors}, Errors: ${errors}`);
}

main().catch(console.error);
