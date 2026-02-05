#!/usr/bin/env node
/**
 * Test sync of a single tweet
 */
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH, { fileMustExist: true });

// Get one tweet
const tweet = db.prepare("SELECT id, blog_text FROM tweets WHERE blog_text IS NOT NULL AND blog_text != '' LIMIT 1").get();

console.log('Tweet ID:', tweet.id);
console.log('Blog text length:', tweet.blog_text.length);
console.log('First 100 chars:', tweet.blog_text.substring(0, 100));

const data = JSON.stringify({ blog_text: tweet.blog_text });
console.log('\nJSON data length:', data.length);
console.log('JSON preview:', data.substring(0, 150));

const req = https.request({
    hostname: 'tweet-curator.onrender.com',
    path: `/api/tweets/${tweet.id}`,
    method: 'PATCH',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
}, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log('\nResponse status:', res.statusCode);
        console.log('Response body:', body);

        // Now verify
        https.get(`https://tweet-curator.onrender.com/api/tweets/${tweet.id}`, (verifyRes) => {
            let verifyBody = '';
            verifyRes.on('data', chunk => verifyBody += chunk);
            verifyRes.on('end', () => {
                const parsed = JSON.parse(verifyBody);
                console.log('\nVerify - blog_text stored:', parsed.blog_text ? parsed.blog_text.substring(0, 100) : 'EMPTY');
            });
        });
    });
});

req.on('error', (e) => console.error('Request error:', e));
req.write(data);
req.end();
