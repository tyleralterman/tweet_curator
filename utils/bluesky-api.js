/**
 * Bluesky API Client
 *
 * Posts content to Bluesky using the AT Protocol (@atproto/api)
 *
 * Environment Variables Required:
 *   BLUESKY_HANDLE - Your Bluesky handle (e.g., "yourname.bsky.social")
 *   BLUESKY_APP_PASSWORD - App password from bsky.app/settings/app-passwords
 *   BLUESKY_SESSION_JSON (optional) - Cached session for faster resume
 */

const { BskyAgent, RichText } = require('@atproto/api');

// Global state — shared across all BlueskyAPI instances within one server process
let globalAgent = null;
let globalIsLoggedIn = false;
let sessionResumeAttempted = false;  // Only try stale env-var session once
let latestSession = null;            // Captures refreshed tokens in memory

/**
 * Create a fresh BskyAgent with session persistence wired up
 */
function createAgent() {
    const agent = new BskyAgent({
        service: 'https://bsky.social',
        persistSession: (evt, sess) => {
            if (sess) {
                latestSession = sess;
                console.log(`🔑 Bluesky session event: ${evt} (tokens refreshed in memory)`);
            }
            if (evt === 'expired') {
                console.warn('⚠️ Bluesky session expired — will re-auth on next call');
                globalIsLoggedIn = false;
            }
        }
    });
    return agent;
}

class BlueskyAPI {
    constructor(handle = null, appPassword = null) {
        this.handle = BlueskyAPI.sanitize(handle || process.env.BLUESKY_HANDLE || '');
        this.appPassword = (appPassword || process.env.BLUESKY_APP_PASSWORD || '').trim();

        if (!globalAgent) {
            globalAgent = createAgent();
        }
        this.agent = globalAgent;
    }

    /**
     * Strip invisible unicode, directional marks, @-prefix, and whitespace from a handle
     */
    static sanitize(str) {
        return str
            .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
            .replace(/^@/, '')
            .trim();
    }

    /**
     * Authenticate with Bluesky — tries in-memory session, env-var session, then password
     */
    async login() {
        if (globalIsLoggedIn) return true;

        // Ensure agent exists (may have been reset)
        if (!globalAgent) {
            globalAgent = createAgent();
        }
        this.agent = globalAgent;

        // 1. Try resuming from an in-memory refreshed session (best option after a token refresh)
        if (latestSession) {
            try {
                await this.agent.resumeSession(latestSession);
                globalIsLoggedIn = true;
                this.handle = latestSession.handle || this.handle;
                console.log(`✅ Bluesky: Resumed from in-memory session for @${this.handle}`);
                return true;
            } catch (err) {
                console.warn('⚠️ Bluesky: In-memory session resume failed:', err.message);
                latestSession = null; // Discard stale in-memory session
            }
        }

        // 2. Try resuming from env-var session JSON (only once per server lifecycle)
        if (!sessionResumeAttempted && process.env.BLUESKY_SESSION_JSON) {
            sessionResumeAttempted = true;
            try {
                let sessionStr = process.env.BLUESKY_SESSION_JSON;

                // Clean invisible unicode, whitespace, and surrounding quotes
                sessionStr = sessionStr.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '');
                sessionStr = sessionStr.trim();
                if (sessionStr.startsWith("'") && sessionStr.endsWith("'")) sessionStr = sessionStr.slice(1, -1);
                if (sessionStr.startsWith('"') && sessionStr.endsWith('"')) sessionStr = sessionStr.slice(1, -1);

                const sessionData = typeof sessionStr === 'string' ? JSON.parse(sessionStr) : sessionStr;

                if (sessionData.handle) {
                    sessionData.handle = sessionData.handle.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '').trim();
                }

                await this.agent.resumeSession(sessionData);
                globalIsLoggedIn = true;
                this.handle = sessionData.handle || this.handle;
                console.log(`✅ Bluesky: Resumed session for @${this.handle} from env JSON`);
                return true;
            } catch (err) {
                console.warn('⚠️ Bluesky: Env session JSON resume failed, falling back to password login:', err.message);
                // Don't retry this — the env var tokens are stale
            }
        }

        // 3. Fallback: fresh password login (always works if not rate-limited)
        if (!this.handle || !this.appPassword) {
            throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD environment variables required');
        }

        try {
            await this.agent.login({
                identifier: this.handle,
                password: this.appPassword
            });
            globalIsLoggedIn = true;
            console.log(`✅ Bluesky: Logged in as @${this.handle} via password`);
            return true;
        } catch (err) {
            console.error('❌ Bluesky password login failed:', err.message);
            throw err;
        }
    }

    /**
     * Force full reset — destroys the agent so next call gets a clean slate
     */
    resetLogin() {
        globalIsLoggedIn = false;
        globalAgent = null;   // Force new agent creation on next use
        this.agent = null;
    }

    /**
     * Check if an error is an auth/session problem that can be fixed by re-login
     */
    _isAuthError(err) {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('rate limit') ||
               msg.includes('auth') ||
               msg.includes('token') ||
               msg.includes('expired') ||
               msg.includes('invalid') ||
               msg.includes('bad token') ||
               err.status === 401 ||
               err.status === 429;
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
                if (this._isAuthError(err) && attempt < maxRetries) {
                    console.log(`⏳ Bluesky: Connection issue (${err.message}), reset + retry ${attempt}/${maxRetries} in ${attempt * 2}s...`);
                    this.resetLogin();
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                // If we have credentials but can't connect, report as configured but limited
                if (this._isAuthError(err) && this.handle) {
                    return {
                        success: true,
                        handle: this.handle,
                        rateLimited: true,
                        connectionIssue: err.message
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
     * Post text content to Bluesky (self-healing: auto-retries on auth failure)
     * @param {string} text - The text to post (max 300 chars)
     * @returns {object} - Post result with uri and cid
     */
    async post(text) {
        if (text.length > 300) {
            throw new Error(`Text exceeds Bluesky limit of 300 characters (length: ${text.length}). Post skipped.`);
        }

        // Two attempts: first with current session, second after full reset
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await this.login();

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
            } catch (err) {
                if (attempt === 1 && this._isAuthError(err)) {
                    console.log(`⏳ Bluesky: Auth error on post (${err.message}), resetting session and retrying...`);
                    this.resetLogin();
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                throw err;
            }
        }
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
     * Schedule a post for later (internal queue, not Bluesky-native)
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
