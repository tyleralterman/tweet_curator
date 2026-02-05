#!/usr/bin/env node
/**
 * Sync blog_text - verbose version
 */
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH, { fileMustExist: true });

async function patchTweet(tweetId, blogText) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ blog_text: blogText });

        const req = https.request({
            hostname: 'tweet-curator.onrender.com',
            path: `/api/tweets/${tweetId}`,
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
                    resolve(body);
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    // Get just 5 tweets to test
    const tweets = db.prepare(`
        SELECT DISTINCT t.id, t.blog_text
        FROM tweets t
        JOIN tweet_tags tt ON t.id = tt.tweet_id
        JOIN tags tag ON tt.tag_id = tag.id
        WHERE tag.name IN ('blog-post', 'blog-candidate', 'blog-ready')
        AND t.blog_text IS NOT NULL
        AND t.blog_text != ''
        LIMIT 5
    `).all();

    console.log(`Testing ${tweets.length} tweets:\n`);

    for (const tweet of tweets) {
        console.log(`\n--- Tweet ${tweet.id} ---`);
        console.log(`Local blog_text: "${tweet.blog_text.substring(0, 50)}..."`);

        try {
            const result = await patchTweet(tweet.id, tweet.blog_text);
            console.log(`PATCH response: ${result}`);

            // Wait a moment then verify
            await new Promise(r => setTimeout(r, 500));

            const verify = await new Promise((resolve, reject) => {
                https.get(`https://tweet-curator.onrender.com/api/tweets/${tweet.id}`, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(body);
                            resolve(parsed.blog_text || 'EMPTY');
                        } catch (e) {
                            resolve('PARSE_ERROR');
                        }
                    });
                }).on('error', reject);
            });

            console.log(`Verify blog_text: "${(verify || 'EMPTY').substring(0, 50)}..."`);
            console.log(`Match: ${verify === tweet.blog_text ? '✅' : '❌'}`);
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
        }
    }
}

main().catch(console.error);
