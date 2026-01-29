const puppeteer = require('puppeteer');
const https = require('https');

// Config
const SUBSTACK_DOMAIN = 'tyleralterman.substack.com'; // Should be customizable
const API_BASE = 'https://tweet-curator.onrender.com/api';

async function fetchBlogReadyPosts() {
    console.log('📥 Fetching blog-ready posts...');

    // 1. Get the tag ID
    const tags = await new Promise((resolve, reject) => {
        https.get(`${API_BASE}/tags`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        });
    });

    // Find blog-ready tag ID
    // Check all categories
    let tagId = null;
    const allTags = [...tags.topic, ...tags.pattern, ...(tags.use || []), ...tags.custom];
    const tag = allTags.find(t => t.name === 'blog-ready');
    if (!tag) throw new Error('Tag blog-ready not found');
    tagId = tag.id;

    // 2. Fetch tweets with this tag
    // We need an endpoint for this or filter locally
    // Since API filters by tag name, we can just use that
    return new Promise((resolve, reject) => {
        https.get(`${API_BASE}/tweets?tag=blog-ready&limit=100`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                const json = JSON.parse(data);
                resolve(json.tweets);
            });
        });
    });
}

async function syncToSubstack() {
    const posts = await fetchBlogReadyPosts();
    console.log(`Found ${posts.length} posts ready for Substack`);

    if (posts.length === 0) {
        console.log('No posts to sync!');
        return;
    }

    console.log('🚀 Launching browser...');
    const browser = await puppeteer.launch({
        headless: false, // Visible so you can login
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();

    console.log('🔑 Please log in to Substack (you have 2 minutes)...');
    await page.goto(`https://${SUBSTACK_DOMAIN}/publish/dashboard`);

    // Wait for login (check for "New Post" button or similar dashboard element)
    try {
        await page.waitForSelector('a[href*="/publish/post"]', { timeout: 120000 });
        console.log('✅ Logged in!');
    } catch (e) {
        console.error('❌ Login timeout. Please try again.');
        await browser.close();
        return;
    }

    for (const post of posts) {
        console.log(`📝 Drafting: ${post.full_text.substring(0, 30)}...`);

        await page.goto(`https://${SUBSTACK_DOMAIN}/publish/post`);

        // Wait for editor
        await page.waitForSelector('.p-name', { timeout: 10000 }); // Title input

        // Use blog_text if available, else raw text
        const content = post.blog_text || post.combined_text || post.full_text;

        // TODO: Insert content (this is tricky with ProseMirror editors, often need clipboard paste or specific keypresses)

        // For now just pausing to verify
        // await new Promise(r => setTimeout(r, 2000));

        console.log('✅ Draft created (placeholder)');
    }

    console.log('🎉 Done!');
    // await browser.close();
}

if (require.main === module) {
    syncToSubstack().catch(console.error);
}
