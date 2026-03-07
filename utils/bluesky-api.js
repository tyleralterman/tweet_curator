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

// Global cache to avoid hitting login rate limits on Render
let globalAgent = null;
let globalIsLoggedIn = false;

class BlueskyAPI {
    constructor(handle = null, appPassword = null) {
        this.handle = handle || process.env.BLUESKY_HANDLE;
        this.appPassword = appPassword || process.env.BLUESKY_APP_PASSWORD;

        if (!globalAgent) {
            globalAgent = new BskyAgent({
                service: 'https://bsky.social'
            });
        }
        this.agent = globalAgent;
    }

    /**
     * Authenticate with Bluesky
     */
    async login() {
        if (globalIsLoggedIn) return true;

        // 1. Try resuming from a stored session JSON first (bypasses IP login rate limits)
        if (process.env.BLUESKY_SESSION_JSON) {
            try {
                const sessionStr = process.env.BLUESKY_SESSION_JSON;
                const sessionData = typeof sessionStr === 'string' ? JSON.parse(sessionStr) : sessionStr;
                await this.agent.resumeSession(sessionData);
                globalIsLoggedIn = true;
                this.handle = sessionData.handle || this.handle;
                console.log(`✅ Bluesky: Resumed session for @${this.handle} from JSON`);
                return true;
            } catch (err) {
                console.warn('⚠️ Bluesky: Failed to resume session, falling back to login:', err.message);
            }
        }

        // 2. Fallback to password login
        if (!this.handle || !this.appPassword) {
            throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD environment variables required');
        }

        try {
            await this.agent.login({
                identifier: this.handle,
                password: this.appPassword
            });
            globalIsLoggedIn = true;
            console.log(`✅ Bluesky: Logged in as @${this.handle}`);
            return true;
        } catch (err) {
            console.error('❌ Bluesky login failed:', err.message);
            throw err;
        }
    }

    /**
     * Force a login refresh (e.g. after a rate limit)
     */
    resetLogin() {
        globalIsLoggedIn = false;
    }

    /**
     * Test connection to Bluesky (with retry for rate limits)
     */
    async testConnection() {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
                const isRateLimit = err.message?.includes('Rate Limit') ||
                    err.status === 429 ||
                    err.message?.includes('rate limit');
                if (isRateLimit && attempt < maxRetries) {
                    console.log(`⏳ Bluesky: Rate limited, retry ${attempt}/${maxRetries} in ${attempt * 2}s...`);
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    globalIsLoggedIn = false; // Reset login state for retry
                    continue;
                }
                // If we have credentials but can't connect, still report as configured
                if (isRateLimit && this.handle) {
                    return {
                        success: true,
                        handle: this.handle,
                        rateLimited: true
                    };
                }
                return {
                    success: false,
                    error: err.message
                };
            }
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
