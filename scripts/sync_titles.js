const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');

// Config
const DB_PATH = path.join(__dirname, '../tweets.db');
const API_BASE = 'https://tweet-curator.onrender.com/api';

const db = new Database(DB_PATH, { fileMustExist: true });

async function syncTitles() {
    console.log('🔄 Syncing titles to Render...');

    // Get tweets with title info
    const tweets = db.prepare(`
        SELECT id, title_options, selected_title
        FROM tweets
        WHERE title_options IS NOT NULL OR selected_title IS NOT NULL
    `).all();

    console.log(`Found ${tweets.length} tweets to sync.`);

    let success = 0;
    let failed = 0;

    for (const t of tweets) {
        try {
            // 1. Sync Options
            if (t.title_options) {
                await postData('/scheduler/update-options', {
                    id: t.id,
                    title_options: t.title_options
                });
            }

            // 2. Sync Selected Title (if any)
            if (t.selected_title) {
                const sel = JSON.parse(t.selected_title);
                await postData('/scheduler/update-title', {
                    id: t.id,
                    title: sel.title,
                    subtitle: sel.subtitle
                });
            }

            process.stdout.write('.');
            success++;
        } catch (err) {
            process.stdout.write('X');
            console.error(`\nFailed for ${t.id}:`, err.message);
            failed++;
        }
    }

    console.log(`\n\n✅ Done! Synced: ${success}, Failed: ${failed}`);
}

function postData(endpoint, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = https.request(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
            } else {
                reject(new Error(`Status ${res.statusCode}`));
            }
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

syncTitles();
