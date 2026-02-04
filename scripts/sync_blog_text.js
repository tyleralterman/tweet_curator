#!/usr/bin/env node
/**
 * Sync blog_text field to Render
 * 
 * Pushes cleaned blog_text from local DB to production
 */

const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../tweets.db');
const API_BASE = 'https://tweet-curator.onrender.com/api';
const CONCURRENCY = 3; // Lower to avoid 502s

const db = new Database(DB_PATH, { fileMustExist: true });

async function patchTweet(tweetId, blogText) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ blog_text: blogText });

        const url = new URL(`${API_BASE}/tweets/${tweetId}`);

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                } else {
                    reject(new Error(`Status ${res.statusCode}`));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function syncBlogText() {
    console.log('🔄 Syncing blog_text to Render...\n');

    // Get all tweets with blog_text
    const tweets = db.prepare(`
        SELECT DISTINCT t.id, t.blog_text
        FROM tweets t
        JOIN tweet_tags tt ON t.id = tt.tweet_id
        JOIN tags tag ON tt.tag_id = tag.id
        WHERE tag.name IN ('blog-post', 'blog-candidate', 'blog-ready')
        AND t.blog_text IS NOT NULL
        AND t.blog_text != ''
    `).all();

    console.log(`Found ${tweets.length} tweets with blog_text to sync.\n`);

    let completed = 0;
    let errors = 0;

    // Process in batches
    for (let i = 0; i < tweets.length; i += CONCURRENCY) {
        const batch = tweets.slice(i, i + CONCURRENCY);

        const promises = batch.map(async (tweet) => {
            try {
                await patchTweet(tweet.id, tweet.blog_text);
                process.stdout.write('.');
            } catch (err) {
                process.stdout.write('x');
                console.error(`\n❌ Failed ${tweet.id}: ${err.message}`);
                errors++;
            }
            completed++;
        });

        await Promise.all(promises);

        if (completed % 100 === 0) {
            console.log(` ${completed}/${tweets.length}`);
        }
    }

    console.log(`\n\n✅ Done! Completed: ${completed}, Errors: ${errors}`);
}

syncBlogText().catch(console.error);
