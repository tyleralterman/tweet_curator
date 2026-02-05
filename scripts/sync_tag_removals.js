#!/usr/bin/env node
/**
 * Remove blog-candidate tag from tweets on Render that no longer have it locally
 */
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH, { fileMustExist: true });

async function deleteTag(tweetId, tagName) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'tweet-curator.onrender.com',
            path: `/api/tweets/${tweetId}/tags/${encodeURIComponent(tagName)}`,
            method: 'DELETE'
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
        req.end();
    });
}

async function main() {
    console.log('🧹 Syncing blog-candidate tag removals to Render...\n');

    // Get all tweets that SHOULD have blog-candidate locally
    const localBlogCandidates = new Set(
        db.prepare(`
            SELECT tt.tweet_id 
            FROM tweet_tags tt
            JOIN tags t ON tt.tag_id = t.id
            WHERE t.name = 'blog-candidate'
        `).all().map(r => r.tweet_id)
    );

    console.log(`Local blog-candidates: ${localBlogCandidates.size}`);

    // Get all tweets from Render that have blog-candidate
    const renderTweets = await new Promise((resolve, reject) => {
        https.get('https://tweet-curator.onrender.com/api/tweets?tag=blog-candidate&limit=5000', (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data.tweets || []);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });

    console.log(`Render blog-candidates: ${renderTweets.length}`);

    // Find tweets that have the tag on Render but not locally (need to remove)
    const toRemove = renderTweets.filter(t => !localBlogCandidates.has(t.id));
    console.log(`Tags to remove: ${toRemove.length}\n`);

    let removed = 0;
    let errors = 0;

    for (const tweet of toRemove) {
        try {
            await deleteTag(tweet.id, 'blog-candidate');
            process.stdout.write('.');
            removed++;
        } catch (err) {
            process.stdout.write('x');
            errors++;
        }

        if (removed % 50 === 0) {
            console.log(` ${removed}/${toRemove.length}`);
        }
    }

    console.log(`\n\n✅ Done! Removed: ${removed}, Errors: ${errors}`);
}

main().catch(console.error);
