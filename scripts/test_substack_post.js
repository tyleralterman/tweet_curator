#!/usr/bin/env node
/**
 * FINAL ATTEMPT - Substack Notes posting via Puppeteer
 * Mimics Chrome extension behavior as closely as possible
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Real tweet content
const TEST_CONTENT = "People are playing life as it's a linear narrative-driven game when it's actually an open world game";

// Puppeteer profile for persistent login
const PUPPETEER_PROFILE = path.join(__dirname, '../.puppeteer-profile');

async function postToSubstack(content) {
    console.log('🚀 Launching browser (VISIBLE for debugging)...');

    const browser = await puppeteer.launch({
        headless: false, // MUST be visible to debug
        userDataDir: PUPPETEER_PROFILE,
        args: ['--no-first-run', '--disable-default-apps', '--no-sandbox'],
        defaultViewport: null // Use full window
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    try {
        console.log('📖 Navigating to Substack home...');
        await page.goto('https://substack.com/home', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(4000); // Extra wait for React

        // Find and click compose button
        console.log('🔍 Looking for compose button...');
        const composeBtn = await page.$('button');
        const buttons = await page.$$('button');

        let composeFound = false;
        for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text.includes("What's on your mind")) {
                console.log('✅ Found compose button, clicking...');
                await btn.click();
                composeFound = true;
                break;
            }
        }

        if (!composeFound) {
            throw new Error('Could not find compose button. Please run with --login first.');
        }

        await sleep(2500); // Wait for dialog to fully render

        // Find the editor using the same logic as Chrome extension
        console.log('📝 Finding ProseMirror editor...');
        const editors = await page.$$('.ProseMirror');
        let editorHandle = null;

        for (const ed of editors) {
            const box = await ed.boundingBox();
            if (box && box.width > 0 && box.height > 0 && box.y > 50 && box.y < 500) {
                editorHandle = ed;
                break;
            }
        }

        if (!editorHandle) {
            throw new Error('Could not find compose editor');
        }

        // Click and focus editor
        await editorHandle.click();
        await sleep(300);

        // Clear any existing content (Ctrl+A, then delete)
        console.log('🧹 Clearing editor...');
        await page.keyboard.down('Meta');
        await page.keyboard.press('a');
        await page.keyboard.up('Meta');
        await page.keyboard.press('Backspace');
        await sleep(300);

        // TYPE USING execCommand - exactly like Chrome extension!
        console.log(`📤 Typing: "${content.substring(0, 50)}..."`);
        await page.evaluate((text) => {
            document.execCommand('insertText', false, text);
        }, content);

        await sleep(1500); // Let React fully process the input

        // Find Post button and get its coordinates
        console.log('🎯 Finding Post button...');
        let postBtn = null;
        const allButtons = await page.$$('button');

        for (const btn of allButtons) {
            const text = await page.evaluate(el => el.textContent.trim(), btn);
            if (text === 'Post') {
                postBtn = btn;
                break;
            }
        }

        if (!postBtn) {
            throw new Error('Could not find Post button');
        }

        // Get button coordinates
        const box = await postBtn.boundingBox();
        console.log(`📍 Post button at: x=${box.x + box.width / 2}, y=${box.y + box.height / 2}`);

        // Move mouse to button (hover), then click
        console.log('🖱️ Moving mouse to Post button...');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(300);

        console.log('🖱️ Clicking Post button with real mouse click...');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

        // Wait and observe
        console.log('⏳ Waiting 8 seconds to observe result...');
        await sleep(8000);

        // Take screenshot of result
        const screenshotPath = path.join(__dirname, 'substack_result.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);

        console.log('✅ Attempt complete - check Substack for post!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        const screenshotPath = path.join(__dirname, 'substack_error.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Error screenshot: ${screenshotPath}`);
        throw error;
    } finally {
        await browser.close();
    }
}

console.log('='.repeat(60));
console.log('🔥 FINAL ATTEMPT - Substack Notes Posting');
console.log('   Using document.execCommand + real mouse coordinates');
console.log('='.repeat(60));

postToSubstack(TEST_CONTENT)
    .then(() => {
        console.log('\n✨ Script completed!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n💥 Failed:', err.message);
        process.exit(1);
    });
