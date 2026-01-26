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
    // Connect to existing Chrome session (user must have started Chrome with --remote-debugging-port=9222)
    let browser;
    try {
        browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null,
            protocolTimeout: 120000  // 2 minute timeout
        });
        log('Connected to existing Chrome session');
    } catch (e) {
        log('Could not connect to Chrome. Start Chrome with: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug');
        throw e;
    }

    try {
        // Get the existing page or create new one
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        // Navigate to home (user should already be logged in)
        log('Navigating to Substack home...');
        await page.goto('https://substack.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
        await delay(2000);

        // VERIFICATION 1: Check if we're logged in by looking for "What's on your mind?"
        const isLoggedIn = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes("What's on your mind?");
        });

        if (!isLoggedIn) {
            throw new Error('NOT LOGGED IN - "What\'s on your mind?" not found. Please log into Substack in the Chrome window.');
        }
        log('✓ Verified: User is logged in');

        // Click the "What's on your mind?" text to open composer modal
        log('Clicking "What\'s on your mind?" to open composer...');
        await page.evaluate(() => {
            const elements = document.querySelectorAll('*');
            for (const el of elements) {
                if (el.textContent?.trim() === "What's on your mind?" && el.children.length === 0) {
                    el.click();
                    return;
                }
            }
        });
        await delay(2000);

        // VERIFICATION 2: Check if modal opened by looking for Post button
        const modalOpened = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.trim() === 'Post') {
                    return true;
                }
            }
            return false;
        });

        if (!modalOpened) {
            throw new Error('MODAL DID NOT OPEN - Post button not found. The composer modal may not have opened.');
        }
        log('✓ Verified: Composer modal is open (Post button visible)');

        // Find the text input area - it's the LARGEST ProseMirror (the dropdown is small)
        const allEditors = await page.$$('.ProseMirror');
        log(`Found ${allEditors.length} ProseMirror editors`);

        // Find the largest one by height - that's the actual text area
        let targetEditor = null;
        let maxHeight = 0;

        for (const editor of allEditors) {
            const dimensions = await editor.evaluate(el => {
                const rect = el.getBoundingClientRect();
                return {
                    width: rect.width,
                    height: rect.height,
                    visible: rect.width > 0 && rect.height > 0 && el.offsetParent !== null
                };
            });

            if (dimensions.visible && dimensions.height > maxHeight) {
                maxHeight = dimensions.height;
                targetEditor = editor;
                log(`Editor candidate: ${dimensions.width}x${dimensions.height}`);
            }
        }

        if (!targetEditor) {
            throw new Error('NO VISIBLE EDITOR - Could not find a visible ProseMirror editor');
        }
        log(`Selected editor with height ${maxHeight}px`);

        // Strip emojis
        const cleanContent = content.replace(/[\u{1F600}-\u{1F6FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}|\u{1F900}-\u{1F9FF}|\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
        log(`Will insert: "${cleanContent.substring(0, 50)}..."`);

        // Triple-click to select all in the editor (if any content), then type to replace
        const box = await targetEditor.boundingBox();
        if (box) {
            // Click 3 times quickly to select all
            await page.mouse.click(box.x + 10, box.y + 10, { clickCount: 3 });
        }
        await delay(200);

        // Type using page.type() which sends proper KeyboardEvent - NOT keyboard.type()
        log('Typing content...');
        await targetEditor.type(cleanContent);
        await delay(1000);

        // VERIFICATION 3: Check if content actually appeared in the editor
        const editorText = await targetEditor.evaluate(el => {
            return el.innerText?.trim() || '';
        });
        log(`Editor text after typing: "${editorText.substring(0, 50)}..."`);

        if (!editorText || editorText.length < 10) {
            throw new Error(`CONTENT NOT TYPED - Editor shows: "${editorText}"`);
        }
        log('✓ Verified: Content appears in editor');

        // Now click the Post button directly
        log('Looking for Post button...');

        // Debug: List all buttons with "Post" text
        const buttonInfo = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            const postButtons = [];
            for (const btn of buttons) {
                const text = btn.textContent?.trim();
                if (text?.toLowerCase().includes('post')) {
                    postButtons.push({
                        text: text,
                        disabled: btn.disabled,
                        visible: btn.offsetParent !== null,
                        className: btn.className
                    });
                }
            }
            return postButtons;
        });
        log(`Found Post-related buttons: ${JSON.stringify(buttonInfo)}`);

        // Try to find and click the Post button
        const postButton = await page.$('button:not([disabled])');
        const allButtons = await page.$$('button');

        for (const btn of allButtons) {
            const text = await btn.evaluate(el => el.textContent?.trim());
            if (text === 'Post') {
                const isDisabled = await btn.evaluate(el => el.disabled);
                log(`Found Post button, disabled=${isDisabled}`);
                if (!isDisabled) {
                    await btn.click();
                    log('Post button clicked');
                    break;
                }
            }
        }

        // Wait and verify post was submitted
        await delay(3000);

        // VERIFICATION 4: Check if modal closed (Post button should be gone)
        const modalClosed = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.trim() === 'Post') {
                    return false;  // Modal still open
                }
            }
            return true;  // Modal closed
        });

        if (!modalClosed) {
            throw new Error('POST MAY HAVE FAILED - Modal is still open after clicking Post');
        }
        log('✓ Verified: Modal closed (post likely submitted)');

        log('✅ POST SUCCESSFUL - Verified all steps completed');
        return { success: true };

    } catch (error) {
        log(`❌ Error: ${error.message}`);
        // Take screenshot on error
        try {
            const pages = await browser.pages();
            if (pages.length > 0) {
                await pages[0].screenshot({ path: '/tmp/substack-error.png' });
                log('Screenshot saved to /tmp/substack-error.png');
            }
        } catch (e) { }
        return { success: false, error: error.message };

    } finally {
        // Don't close the browser since we're using the user's session
        browser.disconnect();
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
