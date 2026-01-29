const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

// Config
const DB_PATH = path.join(__dirname, '../tweets.db');
const API_BASE = 'https://tweet-curator.onrender.com/api';
const CONCURRENCY = 5;

// Open DB
const db = new Database(DB_PATH, { fileMustExist: true });

async function postTag(tweetId, tagName) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            tagName: tagName,
            tagCategory: 'use'
        });

        const req = https.request(`${API_BASE}/tweets/${tweetId}/tags`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
            } else {
                reject(new Error(`Status ${res.statusCode}`));
            }
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function syncTags() {
    console.log('🔄 Syncing tags to Render...');

    // 1. Get blog-ready tweets
    const blogReady = db.prepare(`
        SELECT tweet_id FROM tweet_tags 
        WHERE tag_id = (SELECT id FROM tags WHERE name='blog-ready')
    `).all().map(r => r.tweet_id);

    console.log(`Found ${blogReady.length} blog-ready tweets`);

    // 2. Get blog-candidate tweets
    const blogCandidate = db.prepare(`
        SELECT tweet_id FROM tweet_tags 
        WHERE tag_id = (SELECT id FROM tags WHERE name='blog-candidate')
    `).all().map(r => r.tweet_id);

    console.log(`Found ${blogCandidate.length} blog-candidate tweets`);

    // Combine tasks
    const queue = [
        ...blogReady.map(id => ({ id, tag: 'blog-ready' })),
        ...blogCandidate.map(id => ({ id, tag: 'blog-candidate' }))
    ];

    console.log(`Queueing ${queue.length} tag operations...`);

    let active = 0;
    let completed = 0;
    let errors = 0;

    // Process queue with concurrency
    while (queue.length > 0 || active > 0) {
        while (active < CONCURRENCY && queue.length > 0) {
            const item = queue.shift();
            active++;

            postTag(item.id, item.tag)
                .then(() => {
                    completed++;
                    if (completed % 20 === 0) process.stdout.write('.');
                })
                .catch(err => {
                    console.error(`\n❌ Failed ${item.id} ${item.tag}: ${err.message}`);
                    errors++;
                })
                .finally(() => {
                    active--;
                });
        }
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n✅ Done! Completed: ${completed}, Errors: ${errors}`);
}

syncTags().catch(console.error);
