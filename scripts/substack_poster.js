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

        // Step 1: Go to Substack login page
        log('Navigating to Substack login...');
        await page.goto('https://substack.com/sign-in', { waitUntil: 'networkidle2' });

        // Wait for and fill email
        await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
        log('Entering email...');
        await page.type('input[type="email"], input[name="email"]', SUBSTACK_EMAIL);

        // Look for continue/submit button
        let buttons = await page.$$('button');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text && (text.includes('Continue') || text.includes('Sign in') || text.includes('Submit'))) {
                await button.click();
                break;
            }
        }

        await delay(2000);

        // Check for password field
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
            log('Entering password...');
            await page.type('input[type="password"]', SUBSTACK_PASSWORD);

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

        log('Logged in successfully');
        await delay(2000);

        // Step 2: Navigate to home feed where the Notes composer is inline
        // The home feed has a "What's on your mind?" box at the top
        log('Navigating to https://substack.com/home');
        await page.goto('https://substack.com/home', { waitUntil: 'networkidle2' });
        await delay(3000);

        // Take screenshot for debugging
        await page.screenshot({ path: '/tmp/substack-home.png' });
        log('Screenshot saved: /tmp/substack-home.png');

        // Step 3: Click on the composer area to open it
        // Look for "What's on your mind?" placeholder or similar composer trigger
        log('Looking for composer trigger...');

        let composerOpened = await page.evaluate(() => {
            // Try clicking on various composer triggers
            const selectors = [
                '[placeholder*="mind"]',
                '[data-testid="notes-composer"]',
                '[contenteditable="true"]',
                '.ProseMirror',
                'div[role="textbox"]'
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.offsetParent !== null) {
                    el.click();
                    return { found: true, selector: selector };
                }
            }

            // Try finding any clickable area that looks like a composer
            const divs = document.querySelectorAll('div');
            for (const div of divs) {
                const text = div.textContent.trim().toLowerCase();
                if (text.includes("what's on your mind") || text.includes('write a note')) {
                    div.click();
                    return { found: true, selector: 'text-match' };
                }
            }

            return { found: false };
        });

        if (!composerOpened.found) {
            // Maybe the composer is already visible, let's just look for contenteditable
            log('Direct composer not found, looking for any editable area...');
        } else {
            log(`Clicked on composer trigger: ${composerOpened.selector}`);
        }

        await delay(2000);

        // Take screenshot after clicking
        await page.screenshot({ path: '/tmp/substack-composer-opened.png' });
        log('Screenshot saved: /tmp/substack-composer-opened.png');

        // Step 4: Find the actual composer and type content
        log('Looking for composer to type in...');
        const composerSelectors = [
            '[contenteditable="true"]',
            '.ProseMirror',
            'div[role="textbox"]',
            'textarea',
            '[data-testid="notes-composer"]'
        ];

        let composer = null;
        for (const selector of composerSelectors) {
            const elements = await page.$$(selector);
            if (elements.length > 0) {
                // Use the last one (usually the active/focused one)
                composer = elements[elements.length - 1];
                log(`Found composer with selector: ${selector} (${elements.length} matches)`);
                break;
            }
        }

        if (!composer) {
            await page.screenshot({ path: '/tmp/substack-no-composer.png' });
            throw new Error('Could not find composer. Screenshot saved.');
        }

        // Click to focus the composer
        await composer.click();
        await delay(500);

        // Type the content
        log(`Typing content (${content.length} chars)...`);
        await page.keyboard.type(content);
        await delay(1000);

        if (mediaPath && fs.existsSync(mediaPath)) {
            log(`Uploading media: ${mediaPath}`);
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.uploadFile(mediaPath);
                await delay(2000);
            }
        }

        // Step 6: Click the Post button in the overlay
        log('Looking for Post button in overlay...');
        await delay(1000);

        // Take screenshot before clicking Post
        await page.screenshot({ path: '/tmp/substack-before-post.png' });
        log('Screenshot saved: /tmp/substack-before-post.png');

        // Log all visible buttons for debugging
        const buttonInfo = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.map(btn => ({
                text: btn.textContent.trim().substring(0, 30),
                disabled: btn.disabled,
                visible: btn.offsetParent !== null
            })).filter(b => b.visible);
        });
        log(`Found ${buttonInfo.length} visible buttons: ${JSON.stringify(buttonInfo.slice(-10))}`);

        let postClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            // Look from the end (overlay buttons are usually last in DOM)
            for (let i = buttons.length - 1; i >= 0; i--) {
                const btn = buttons[i];
                const text = btn.textContent.trim().toLowerCase();
                if (text === 'post' && !btn.disabled && btn.offsetParent !== null) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (!postClicked) {
            log('Direct Post button click failed, trying alternative selectors...');
            // Try finding button near Cancel (they're usually together)
            postClicked = await page.evaluate(() => {
                const allButtons = Array.from(document.querySelectorAll('button'));
                for (const btn of allButtons) {
                    const text = btn.textContent.trim();
                    // Look for Post that's near Cancel
                    if (text === 'Post' && btn.offsetParent !== null) {
                        const rect = btn.getBoundingClientRect();
                        // Make sure it's visible in viewport
                        if (rect.top > 0 && rect.left > 0) {
                            btn.click();
                            return true;
                        }
                    }
                }
                return false;
            });
        }

        await delay(5000); // Wait for post to submit

        // Take screenshot after
        await page.screenshot({ path: '/tmp/substack-after-post.png' });
        log('Screenshot saved: /tmp/substack-after-post.png');

        // Verify the post went through
        const postVerified = await page.evaluate(() => {
            // Check if overlay closed (no more modal)
            const overlay = document.querySelector('[class*="modal"], [class*="overlay"], [role="dialog"]');
            if (!overlay || overlay.offsetParent === null) {
                return true; // Overlay closed = likely success
            }
            // Check for success indicators
            const page = document.body.textContent.toLowerCase();
            if (page.includes('posted') || page.includes('your note')) {
                return true;
            }
            return false;
        });

        if (postClicked || postVerified) {
            log('✅ Posted successfully!');
            return { success: true };
        } else {
            log('⚠️ Could not verify post was submitted. Check screenshots.');
            return { success: false, error: 'Could not verify post submission' };
        }

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
