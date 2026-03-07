/**
 * Instagram API Client
 * 
 * Handles:
 *   1. Quote card generation (Puppeteer → 1080×1080 JPEG)
 *   2. Image upload to Imgur (free, anonymous, public URL)
 *   3. Instagram Graph API posting (two-step: container → publish)
 *
 * Environment Variables Required:
 *   INSTAGRAM_ACCESS_TOKEN
 *   INSTAGRAM_USER_ID (Instagram Business/Creator account ID)
 */

const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const GRAPH_API = 'https://graph.instagram.com/v21.0';
const CARD_TEMPLATE = path.join(__dirname, '../public/templates/quote-card.html');
const CARDS_DIR = path.join(__dirname, '../media/quote_cards');

// Ensure output dir exists
if (!fs.existsSync(CARDS_DIR)) {
    fs.mkdirSync(CARDS_DIR, { recursive: true });
}

class InstagramAPI {
    constructor() {
        this.accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
        this.userId = process.env.INSTAGRAM_USER_ID;
    }

    // ============================================
    // Quote Card Generation
    // ============================================

    /**
     * Generate a 1080×1080 quote card image from text
     * @param {string} text - The quote text
     * @param {string} attribution - Attribution line (e.g. "Tyler Alterman")
     * @param {string} id - Unique ID for filename
     * @returns {string} Path to the generated JPEG
     */
    async generateQuoteCard(text, attribution = 'Tyler Alterman', id = null) {
        const filename = `${id || Date.now()}.jpg`;
        const outputPath = path.join(CARDS_DIR, filename);

        // Read template
        let html = fs.readFileSync(CARD_TEMPLATE, 'utf-8');

        // Determine font size class based on text length
        let sizeClass = 'size-xl'; // < 80 chars
        if (text.length > 280) sizeClass = 'size-sm';
        else if (text.length > 180) sizeClass = 'size-md';
        else if (text.length > 80) sizeClass = 'size-lg';

        // Inject content
        html = html.replace('{{QUOTE_TEXT}}', text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        html = html.replace('{{ATTRIBUTION}}', attribution);
        html = html.replace('class="quote-text"', `class="quote-text ${sizeClass}"`);

        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1080, height: 1080 });
            await page.setContent(html, { waitUntil: 'networkidle0' });

            // Wait for fonts to load
            await page.evaluate(() => document.fonts.ready);

            await page.screenshot({
                path: outputPath,
                type: 'jpeg',
                quality: 95,
                clip: { x: 0, y: 0, width: 1080, height: 1080 }
            });

            await page.close();
            console.log(`📸 Quote card generated: ${outputPath}`);
            return outputPath;
        } finally {
            await browser.close();
        }
    }

    // ============================================
    // Image Upload (Imgur - free anonymous uploads)
    // ============================================

    /**
     * Upload an image to Imgur and get a public URL
     * Uses anonymous uploads (no API key needed for basic usage)
     * @param {string} imagePath - Path to the image file
     * @returns {string} Public URL of the uploaded image
     */
    async uploadImage(imagePath) {
        const imageData = fs.readFileSync(imagePath);
        const base64 = imageData.toString('base64');

        try {
            const response = await axios.post('https://api.imgur.com/3/image', {
                image: base64,
                type: 'base64'
            }, {
                headers: {
                    'Authorization': 'Client-ID 546c25a59c58ad7' // Anonymous public client ID
                }
            });

            const url = response.data.data.link;
            console.log(`🌐 Image uploaded: ${url}`);
            return url;
        } catch (error) {
            console.error('Imgur upload error:', error.response?.data || error.message);
            throw new Error('Failed to upload image to Imgur');
        }
    }

    // ============================================
    // Instagram Graph API
    // ============================================

    /**
     * Get user profile info
     */
    async getProfile() {
        if (!this.accessToken) throw new Error('No access token');

        const response = await axios.get(`${GRAPH_API}/me`, {
            params: {
                fields: 'id,username,account_type,media_count',
                access_token: this.accessToken
            }
        });

        this.userId = response.data.id;
        return response.data;
    }

    /**
     * Post an image to Instagram (two-step flow)
     * @param {string} imageUrl - Publicly accessible image URL  
     * @param {string} caption - Post caption
     * @returns {object} { success, postId }
     */
    async createPost(imageUrl, caption) {
        if (!this.accessToken || !this.userId) throw new Error('Not authenticated');

        try {
            // Step 1: Create media container
            const containerResponse = await axios.post(`${GRAPH_API}/${this.userId}/media`, null, {
                params: {
                    image_url: imageUrl,
                    caption: caption,
                    access_token: this.accessToken
                }
            });

            const containerId = containerResponse.data.id;
            console.log(`📦 Container created: ${containerId}`);

            // Wait for processing
            await this._waitForProcessing(containerId);

            // Step 2: Publish
            const publishResponse = await axios.post(`${GRAPH_API}/${this.userId}/media_publish`, null, {
                params: {
                    creation_id: containerId,
                    access_token: this.accessToken
                }
            });

            return {
                success: true,
                postId: publishResponse.data.id,
                containerId
            };
        } catch (error) {
            console.error('Instagram Post Error:', error.response?.data || error.message);
            throw new Error(`Failed to create post: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    /**
     * Full pipeline: text → quote card → upload → post
     * @param {string} text - Tweet text
     * @param {string} caption - Instagram caption (can differ from card text)
     * @param {string} id - Tweet ID for filename
     */
    async postQuoteCard(text, caption, id) {
        // 1. Generate quote card
        const imagePath = await this.generateQuoteCard(text, 'Tyler Alterman', id);

        // 2. Upload to get public URL
        const publicUrl = await this.uploadImage(imagePath);

        // 3. Post to Instagram
        const result = await this.createPost(publicUrl, caption || text);

        return result;
    }

    /**
     * Wait for media container to finish processing
     */
    async _waitForProcessing(containerId, maxWait = 60000) {
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            try {
                const status = await axios.get(`${GRAPH_API}/${containerId}`, {
                    params: {
                        fields: 'status_code',
                        access_token: this.accessToken
                    }
                });
                if (status.data.status_code === 'FINISHED') return;
                if (status.data.status_code === 'ERROR') {
                    throw new Error('Media processing failed');
                }
            } catch (err) {
                if (err.message === 'Media processing failed') throw err;
                // Status check may fail for a moment, continue waiting
            }
            await new Promise(r => setTimeout(r, 3000));
        }
        throw new Error('Media processing timeout');
    }
}

module.exports = InstagramAPI;
