#!/usr/bin/env node
/**
 * Substack Blog Poster
 * 
 * Posts full articles to Substack (not Notes) using Puppeteer.
 * Handles: title, subtitle, header image, body content, subscribe buttons.
 * 
 * Environment variables needed:
 * - SUBSTACK_EMAIL: Your Substack login email
 * - SUBSTACK_PASSWORD: Your Substack password
 * - SUBSTACK_PUBLICATION: Your publication subdomain (e.g., "yourname" for yourname.substack.com)
 * 
 * Usage:
 *   node scripts/substack_blog_poster.js [--dry-run] [--force]
 */

const puppeteer = require('puppeteer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Config from environment
const SUBSTACK_EMAIL = process.env.SUBSTACK_EMAIL;
const SUBSTACK_PASSWORD = process.env.SUBSTACK_PASSWORD;
const SUBSTACK_PUBLICATION = process.env.SUBSTACK_PUBLICATION || 'tyleralterman';

// Database path
const RENDER_DISK_PATH = '/data';
let DB_PATH;
if (fs.existsSync(RENDER_DISK_PATH) && fs.existsSync(path.join(RENDER_DISK_PATH, 'tweets.db'))) {
    DB_PATH = path.join(RENDER_DISK_PATH, 'tweets.db');
} else {
    DB_PATH = path.join(__dirname, '../tweets.db');
}

// Parse args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

// Helper for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Logging
function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

// Subscribe button HTML templates
const SUBSCRIBE_BUTTON_TOP = (pub) => `
<div style="text-align: right; margin-bottom: 24px;">
    <a href="https://${pub}.substack.com/subscribe" 
       style="display: inline-block; padding: 8px 16px; background: #ff6719; color: white; 
              text-decoration: none; border-radius: 20px; font-size: 14px; font-weight: 600;">
        Subscribe
    </a>
</div>
`;

const SUBSCRIBE_BUTTON_BOTTOM = (pub) => `
<div style="text-align: center; margin-top: 48px; padding: 32px; background: #f7f7f7; border-radius: 12px;">
    <p style="margin: 0 0 16px 0; font-size: 18px; color: #333;">
        If you enjoyed this, subscribe for more!
    </p>
    <a href="https://${pub}.substack.com/subscribe" 
       style="display: inline-block; padding: 12px 32px; background: #ff6719; color: white; 
              text-decoration: none; border-radius: 24px; font-size: 16px; font-weight: 700;">
        Subscribe Now
    </a>
</div>
`;

// Format body content with paragraphs and subscribe buttons
function formatArticleBody(content, publication) {
    // Split into paragraphs
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim());

    // Convert to HTML paragraphs
    let html = paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n');

    // Add subscribe buttons
    html = SUBSCRIBE_BUTTON_TOP(publication) + html + SUBSCRIBE_BUTTON_BOTTOM(publication);

    return html;
}

// ============================================
// Main Poster Function
// ============================================

async function postToSubstack(post) {
    log(`Posting article: "${post.title}"`);

    let browser;
    try {
        // Try to connect to existing Chrome session
        browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null,
            protocolTimeout: 180000  // 3 minute timeout
        });
        log('Connected to existing Chrome session');
    } catch (e) {
        log('Could not connect to Chrome. Start Chrome with:');
        log('/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug');
        throw e;
    }

    try {
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        // Navigate to the new post page
        const postUrl = `https://${SUBSTACK_PUBLICATION}.substack.com/publish/post`;
        log(`Navigating to ${postUrl}...`);
        await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(3000);

        // Check if logged in
        const pageContent = await page.content();
        if (pageContent.includes('Sign in') || pageContent.includes('Log in')) {
            throw new Error('NOT LOGGED IN - Please log into Substack in the Chrome window first');
        }
        log('✓ User appears to be logged in');

        // Set Title
        log('Setting title...');
        const titleInput = await page.$('[placeholder="Title"]');
        if (titleInput) {
            await titleInput.click();
            await titleInput.type(post.title);
            log(`✓ Title set: "${post.title}"`);
        } else {
            log('⚠️ Could not find title input');
        }
        await delay(500);

        // Set Subtitle
        if (post.subtitle) {
            log('Setting subtitle...');
            const subtitleInput = await page.$('[placeholder="Add a subtitle…"]');
            if (subtitleInput) {
                await subtitleInput.click();
                await subtitleInput.type(post.subtitle);
                log(`✓ Subtitle set: "${post.subtitle}"`);
            }
        }
        await delay(500);

        // Upload header image if provided
        if (post.header_image) {
            log('Uploading header image...');
            // Find the cover image upload area
            const coverBtn = await page.$('button:has-text("Add cover image")');
            if (coverBtn) {
                await coverBtn.click();
                await delay(1000);

                // Handle file input
                const [fileChooser] = await Promise.all([
                    page.waitForFileChooser(),
                    page.click('button:has-text("Upload")')
                ]);

                // Get absolute path to image
                const imagePath = path.join(__dirname, '..', post.header_image);
                if (fs.existsSync(imagePath)) {
                    await fileChooser.accept([imagePath]);
                    await delay(3000); // Wait for upload
                    log(`✓ Header image uploaded: ${post.header_image}`);
                } else {
                    log(`⚠️ Image not found: ${imagePath}`);
                }
            }
        }

        // Set body content
        log('Setting body content...');
        const formattedBody = formatArticleBody(post.body_content, SUBSTACK_PUBLICATION);

        // Find the main editor
        const editor = await page.$('.ProseMirror[contenteditable="true"]');
        if (editor) {
            await editor.click();
            await delay(200);

            // Use clipboard to paste formatted HTML
            await page.evaluate((html) => {
                const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
                if (editor) {
                    // Simple approach: type content (HTML will be converted)
                    editor.innerHTML = html;
                    // Dispatch input event
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, formattedBody);

            log('✓ Body content set');
        } else {
            log('⚠️ Could not find body editor');
        }
        await delay(1000);

        if (DRY_RUN) {
            log('🧪 DRY RUN - Would publish now. Taking screenshot...');
            await page.screenshot({ path: '/tmp/substack-blog-preview.png', fullPage: true });
            log('Screenshot saved to /tmp/substack-blog-preview.png');
            return { success: true, dryRun: true };
        }

        // Click Publish button
        log('Looking for publish options...');
        const publishBtn = await page.$('button:has-text("Publish")');
        if (publishBtn) {
            await publishBtn.click();
            await delay(2000);

            // Confirm in dialog if needed
            const confirmBtn = await page.$('button:has-text("Publish now")');
            if (confirmBtn) {
                await confirmBtn.click();
                await delay(5000);
            }

            log('✅ POST PUBLISHED');
            return { success: true };
        } else {
            throw new Error('Could not find Publish button');
        }

    } catch (error) {
        log(`❌ Error: ${error.message}`);
        try {
            const pages = await browser.pages();
            if (pages.length > 0) {
                await pages[0].screenshot({ path: '/tmp/substack-blog-error.png', fullPage: true });
                log('Error screenshot saved to /tmp/substack-blog-error.png');
            }
        } catch (e) { }
        return { success: false, error: error.message };

    } finally {
        browser.disconnect();
    }
}

// ============================================
// Queue Processing
// ============================================

async function processQueue() {
    log('📝 Substack Blog Poster starting...');

    if (!SUBSTACK_PUBLICATION) {
        log('❌ SUBSTACK_PUBLICATION not set');
        process.exit(1);
    }

    const db = new Database(DB_PATH);

    // Get next pending post
    const now = new Date().toISOString();
    let query = `
        SELECT * FROM substack_blog_queue 
        WHERE status = 'pending'
    `;

    if (!FORCE) {
        query += ` AND (scheduled_at IS NULL OR scheduled_at <= '${now}')`;
    }

    query += ` ORDER BY scheduled_at ASC LIMIT 1`;

    const nextPost = db.prepare(query).get();

    if (!nextPost) {
        log('No articles due right now');
        db.close();
        return;
    }

    log(`Found article to publish: "${nextPost.title}"`);
    log(`Tweet ID: ${nextPost.tweet_id}`);
    log(`Scheduled: ${nextPost.scheduled_at || 'ASAP'}`);
    log(`Content preview: ${nextPost.body_content?.substring(0, 100)}...`);

    if (DRY_RUN) {
        log('🧪 DRY RUN - Would post the above article');
        db.close();
        return;
    }

    // Post to Substack
    const result = await postToSubstack(nextPost);

    // Update queue status
    if (result.success) {
        db.prepare(`
            UPDATE substack_blog_queue 
            SET status = 'posted', posted_at = ?
            WHERE id = ?
        `).run(new Date().toISOString(), nextPost.id);
        log('Queue updated: marked as posted');
    } else {
        db.prepare(`
            UPDATE substack_blog_queue 
            SET status = 'failed', error_message = ?
            WHERE id = ?
        `).run(result.error, nextPost.id);
        log('Queue updated: marked as failed');
    }

    db.close();
    log('📝 Poster finished');
}

// ============================================
// Entry Point
// ============================================

if (DRY_RUN) {
    log('🧪 Running in DRY RUN mode - no actual posts will be made');
}

processQueue().catch(err => {
    log(`Fatal error: ${err.message}`);
    process.exit(1);
});
