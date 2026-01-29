const https = require('https');

const API_BASE = 'https://tweet-curator.onrender.com/api';

async function fetchTags() {
    return new Promise((resolve, reject) => {
        https.get(`${API_BASE}/tags`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
            res.on('error', reject);
        });
    });
}

function updateTag(id, category) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ category });

        const req = https.request(`${API_BASE}/tags/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(body));
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

async function run() {
    console.log('Fetching tags...');
    const tags = await fetchTags(); // returns { topic: [], pattern: [], use: [], custom: [] }

    // Flatten tags
    const allTags = [
        ...tags.topic,
        ...tags.pattern,
        ...(tags.use || []),
        ...tags.custom
    ];

    // Find our targets
    const targets = ['blog-candidate', 'blog-ready'];

    for (const name of targets) {
        const tag = allTags.find(t => t.name === name);
        if (tag) {
            console.log(`Found ${name} (id: ${tag.id}, category: ${tag.category})`);
            if (tag.category !== 'use') {
                console.log(`Updating ${name} to 'use' category...`);
                await updateTag(tag.id, 'use');
                console.log('✅ Updated');
            } else {
                console.log('Already in use category');
            }
        } else {
            console.log(`❌ Tag ${name} not found`);
        }
    }
}

run().catch(console.error);
