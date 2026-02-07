/**
 * Bluesky API Client
 * 
 * Posts content to Bluesky using the AT Protocol (@atproto/api)
 * 
 * Environment Variables Required:
 *   BLUESKY_HANDLE - Your Bluesky handle (e.g., "yourname.bsky.social")
 *   BLUESKY_APP_PASSWORD - App password from bsky.app/settings/app-passwords
 */

const { BskyAgent, RichText } = require('@atproto/api');

class BlueskyAPI {
    constructor(handle = null, appPassword = null) {
        this.handle = handle || process.env.BLUESKY_HANDLE;
        this.appPassword = appPassword || process.env.BLUESKY_APP_PASSWORD;
        this.agent = new BskyAgent({
            service: 'https://bsky.social'
        });
        this.isLoggedIn = false;
    }

    /**
     * Authenticate with Bluesky
     */
    async login() {
        if (this.isLoggedIn) return true;

        if (!this.handle || !this.appPassword) {
            throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD environment variables required');
        }

        try {
            await this.agent.login({
                identifier: this.handle,
                password: this.appPassword
            });
            this.isLoggedIn = true;
            console.log(`✅ Bluesky: Logged in as @${this.handle}`);
            return true;
        } catch (err) {
            console.error('❌ Bluesky login failed:', err.message);
            throw err;
        }
    }

    /**
     * Test connection to Bluesky
     */
    async testConnection() {
        try {
            await this.login();
            const profile = await this.agent.getProfile({ actor: this.handle });
            return {
                success: true,
                handle: profile.data.handle,
                displayName: profile.data.displayName,
                followersCount: profile.data.followersCount,
                postsCount: profile.data.postsCount
            };
        } catch (err) {
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Post text content to Bluesky
     * @param {string} text - The text to post (max 300 chars)
     * @returns {object} - Post result with uri and cid
     */
    async post(text) {
        await this.login();

        // Bluesky has a 300 character limit
        if (text.length > 300) {
            console.warn(`⚠️ Bluesky: Text truncated from ${text.length} to 300 chars`);
            text = text.substring(0, 297) + '...';
        }

        // Use RichText to parse links, mentions, hashtags
        const rt = new RichText({ text });
        await rt.detectFacets(this.agent);

        const result = await this.agent.post({
            text: rt.text,
            facets: rt.facets,
            createdAt: new Date().toISOString()
        });

        console.log(`✅ Bluesky: Posted successfully (${text.length} chars)`);
        return {
            success: true,
            uri: result.uri,
            cid: result.cid,
            text: text.substring(0, 50) + '...'
        };
    }

    /**
     * Post multiple items with delay between posts
     * @param {string[]} texts - Array of texts to post
     * @param {number} delayMs - Delay between posts in milliseconds
     */
    async postBatch(texts, delayMs = 60000) {
        await this.login();
        const results = [];

        for (let i = 0; i < texts.length; i++) {
            try {
                const result = await this.post(texts[i]);
                results.push(result);

                // Wait between posts (except for last one)
                if (i < texts.length - 1) {
                    console.log(`⏳ Bluesky: Waiting ${delayMs / 1000}s before next post...`);
                    await new Promise(r => setTimeout(r, delayMs));
                }
            } catch (err) {
                results.push({
                    success: false,
                    error: err.message,
                    text: texts[i].substring(0, 50) + '...'
                });
            }
        }

        return results;
    }

    /**
     * Schedule a post for later (stores in queue, posts at scheduled time)
     * Note: Bluesky doesn't have native scheduling, so this is for our internal queue
     */
    schedulePost(text, scheduledAt) {
        return {
            platform: 'bluesky',
            text: text,
            scheduledAt: scheduledAt,
            status: 'pending'
        };
    }
}

module.exports = BlueskyAPI;
