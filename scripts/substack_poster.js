#!/usr/bin/env node
/**
 * Substack Notes Poster
 * 
 * Uses Puppeteer to post notes to Substack automatically.
 * Runs on a schedule or can be triggered manually.
 * 
 * Environment variables needed:
 * - SUBSTACK_EMAIL: Your Substack login email
 * - SUBSTACK_PASSWORD: Your Substack password
 * - SUBSTACK_PUBLICATION: Your publication subdomain (e.g., "yourname" for yourname.substack.com)
 */

const puppeteer = require('puppeteer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Config from environment
const SUBSTACK_EMAIL = process.env.SUBSTACK_EMAIL;
const SUBSTACK_PASSWORD = process.env.SUBSTACK_PASSWORD;
const SUBSTACK_PUBLICATION = process.env.SUBSTACK_PUBLICATION;

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

// Helper for delays (replaces deprecated waitForTimeout)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// Logging
// ============================================

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

// ============================================
// Main Poster Function
// ============================================

async function postToSubstack(content, mediaPath = null) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Go to Substack login page directly first
        log('Navigating to Substack login...');
        await page.goto('https://substack.com/sign-in', { waitUntil: 'networkidle2' });

        // Wait for and fill email
        await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
        log('Entering email...');
        await page.type('input[type="email"], input[name="email"]', SUBSTACK_EMAIL);

        // Look for continue/submit button
        const buttons = await page.$$('button');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text && (text.includes('Continue') || text.includes('Sign in') || text.includes('Submit'))) {
                await button.click();
                break;
            }
        }

        await delay(2000);

        // Check for password field (some accounts use password, others use magic link)
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
            log('Entering password...');
            await page.type('input[type="password"]', SUBSTACK_PASSWORD);

            // Click sign in button
            const signInButtons = await page.$$('button');
            for (const button of signInButtons) {
                const text = await page.evaluate(el => el.textContent, button);
                if (text && (text.includes('Sign in') || text.includes('Continue') || text.includes('Log in'))) {
                    await button.click();
                    break;
                }
            }
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { });
        }

        log('Logged in, navigating to Notes...');
        await delay(2000);

        // Now go to Notes
        const notesUrl = `https://${SUBSTACK_PUBLICATION}.substack.com/notes`;
        log(`Navigating to ${notesUrl}`);
        await page.goto(notesUrl, { waitUntil: 'networkidle2' });
        await delay(3000);

        // Try multiple selectors for the composer
        const composerSelectors = [
            '[data-testid="notes-composer"]',
            '[contenteditable="true"]',
            'div[role="textbox"]',
            '.ProseMirror',
            'textarea'
        ];

        let composer = null;
        for (const selector of composerSelectors) {
            composer = await page.$(selector);
            if (composer) {
                log(`Found composer with selector: ${selector}`);
                break;
            }
        }

        if (!composer) {
            // Take screenshot for debugging
            await page.screenshot({ path: '/tmp/substack-debug.png' });
            throw new Error('Could not find notes composer. Screenshot saved to /tmp/substack-debug.png');
        }

        // Click to focus the composer
        await composer.click();
        await delay(500);

        // Type the content
        log(`Typing content (${content.length} chars)...`);
        await page.keyboard.type(content);
        await delay(1000);

        // Upload media if present
        if (mediaPath && fs.existsSync(mediaPath)) {
            log(`Uploading media: ${mediaPath}`);
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.uploadFile(mediaPath);
                await delay(2000); // Wait for upload
            }
        }

        // Click Post button - try multiple approaches
        log('Looking for Post button...');
        await delay(1000); // Wait for UI to settle

        // Take screenshot before attempting to click
        await page.screenshot({ path: '/tmp/substack-before-post.png' });
        log('Screenshot saved: /tmp/substack-before-post.png');

        let clicked = false;

        // Approach 1: Find button by exact text match
        clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
                const text = btn.textContent.trim();
                if (text === 'Post' || text === 'Post note') {
                    // Check if button is enabled
                    if (!btn.disabled) {
                        btn.click();
                        return true;
                    }
                }
            }
            return false;
        });

        if (!clicked) {
            log('Approach 1 failed, trying Approach 2...');
            // Approach 2: Find by aria-label or data attributes
            clicked = await page.evaluate(() => {
                const btn = document.querySelector('button[aria-label*="Post"], button[data-testid*="post"]');
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
                return false;
            });
        }

        if (!clicked) {
            log('Approach 2 failed, trying Approach 3...');
            // Approach 3: Look for submit-type button in form
            clicked = await page.evaluate(() => {
                const btn = document.querySelector('form button[type="submit"], .composer button, .notes-composer button');
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
                return false;
            });
        }

        if (!clicked) {
            log('Approach 3 failed, trying keyboard shortcut...');
            // Approach 4: Keyboard shortcut
            await page.keyboard.down('Meta');
            await page.keyboard.press('Enter');
            await page.keyboard.up('Meta');
            clicked = true;
        }

        await delay(5000); // Wait longer for post to actually submit

        // Take screenshot after to verify
        await page.screenshot({ path: '/tmp/substack-after-post.png' });
        log('Screenshot saved: /tmp/substack-after-post.png');

        log('✅ Posted successfully!');
        return { success: true };

    } catch (error) {
        log(`❌ Error: ${error.message}`);
        return { success: false, error: error.message };

    } finally {
        await browser.close();
    }
}

// ============================================
// Queue Processing
// ============================================

async function processQueue() {
    log('📫 Substack Poster starting...');

    // Validate config
    if (!SUBSTACK_EMAIL || !SUBSTACK_PASSWORD || !SUBSTACK_PUBLICATION) {
        log('❌ Missing required environment variables:');
        log('   SUBSTACK_EMAIL, SUBSTACK_PASSWORD, SUBSTACK_PUBLICATION');
        process.exit(1);
    }

    const db = new Database(DB_PATH);

    // Get next pending post that's due
    const now = new Date().toISOString();
    let query = `
        SELECT * FROM substack_queue 
        WHERE status = 'pending'
    `;

    if (!FORCE) {
        query += ` AND scheduled_at <= '${now}'`;
    }

    query += ` ORDER BY scheduled_at ASC LIMIT 1`;

    const nextPost = db.prepare(query).get();

    if (!nextPost) {
        log('No posts due right now');
        db.close();
        return;
    }

    log(`Found post to publish: ${nextPost.tweet_id}`);
    log(`Scheduled: ${nextPost.scheduled_at}`);
    log(`Content preview: ${nextPost.post_content.substring(0, 100)}...`);

    if (DRY_RUN) {
        log('🧪 DRY RUN - Would post the above content');
        db.close();
        return;
    }

    // Post to Substack
    const result = await postToSubstack(nextPost.post_content, nextPost.media_path);

    // Update queue status
    if (result.success) {
        db.prepare(`
            UPDATE substack_queue 
            SET status = 'posted', posted_at = ?
            WHERE id = ?
        `).run(new Date().toISOString(), nextPost.id);
        log('Queue updated: marked as posted');
    } else {
        db.prepare(`
            UPDATE substack_queue 
            SET status = 'failed', error_message = ?
            WHERE id = ?
        `).run(result.error, nextPost.id);
        log('Queue updated: marked as failed');
    }

    db.close();
    log('📫 Poster finished');
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
