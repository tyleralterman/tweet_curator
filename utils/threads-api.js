/**
 * Threads API Client
 * 
 * Handles Meta OAuth 2.0, token exchange, and posting to Threads.
 * Uses the Threads Publishing API (two-step: create container → publish).
 * 
 * Environment Variables Required:
 *   THREADS_APP_ID
 *   THREADS_APP_SECRET
 *   THREADS_REDIRECT_URI (default: http://localhost:3000/api/auth/threads/callback)
 *   THREADS_ACCESS_TOKEN (stored after auth)
 *   THREADS_USER_ID (stored after auth)
 */

const axios = require('axios');
require('dotenv').config();

const THREADS_BASE = 'https://graph.threads.net/v1.0';
const THREADS_AUTH_BASE = 'https://threads.net';

class ThreadsAPI {
    constructor() {
        this.appId = process.env.THREADS_APP_ID;
        this.appSecret = process.env.THREADS_APP_SECRET;
        this.redirectUri = process.env.THREADS_REDIRECT_URI || 'http://localhost:3000/api/auth/threads/callback';
        this.accessToken = process.env.THREADS_ACCESS_TOKEN;
        this.userId = process.env.THREADS_USER_ID;
    }

    /**
     * Generate the authorization URL
     */
    getAuthUrl() {
        const scope = 'threads_basic,threads_content_publish';
        const state = Math.random().toString(36).substring(7);
        return `${THREADS_AUTH_BASE}/oauth/authorize?client_id=${this.appId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code&state=${state}`;
    }

    /**
     * Exchange authorization code for short-lived token, then swap for long-lived
     */
    async exchangeCodeForTokens(code) {
        try {
            // Step 1: Get short-lived token
            const params = new URLSearchParams();
            params.append('client_id', this.appId);
            params.append('client_secret', this.appSecret);
            params.append('grant_type', 'authorization_code');
            params.append('redirect_uri', this.redirectUri);
            params.append('code', code);

            const shortResponse = await axios.post(`${THREADS_BASE}/oauth/access_token`, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const shortLivedToken = shortResponse.data.access_token;
            const userId = shortResponse.data.user_id;

            // Step 2: Exchange for long-lived token (60 days)
            const longResponse = await axios.get(`${THREADS_BASE}/access_token`, {
                params: {
                    grant_type: 'th_exchange_token',
                    client_secret: this.appSecret,
                    access_token: shortLivedToken
                }
            });

            this.accessToken = longResponse.data.access_token;
            this.userId = userId;

            return {
                accessToken: this.accessToken,
                userId: this.userId,
                expiresIn: longResponse.data.expires_in
            };
        } catch (error) {
            console.error('Threads Token Exchange Error:', error.response?.data || error.message);
            throw new Error(`Failed to exchange code for tokens: ${error.response?.data?.error_message || error.message}`);
        }
    }

    /**
     * Refresh a long-lived token (before it expires)
     */
    async refreshToken() {
        if (!this.accessToken) throw new Error('No access token');

        try {
            const response = await axios.get(`${THREADS_BASE}/refresh_access_token`, {
                params: {
                    grant_type: 'th_refresh_token',
                    access_token: this.accessToken
                }
            });

            this.accessToken = response.data.access_token;
            return {
                accessToken: this.accessToken,
                expiresIn: response.data.expires_in
            };
        } catch (error) {
            console.error('Threads Token Refresh Error:', error.response?.data || error.message);
            throw new Error('Failed to refresh token');
        }
    }

    /**
     * Get authenticated user profile
     */
    async getProfile() {
        if (!this.accessToken) throw new Error('No access token');

        try {
            const response = await axios.get(`${THREADS_BASE}/me`, {
                params: {
                    fields: 'id,username,threads_profile_picture_url,threads_biography',
                    access_token: this.accessToken
                }
            });

            this.userId = response.data.id;
            return response.data;
        } catch (error) {
            console.error('Threads Profile Error:', error.response?.data || error.message);
            throw new Error('Failed to get profile');
        }
    }

    /**
     * Two-step publish: Create text container → Publish
     * @param {string} text - Post text (max 500 chars)
     */
    async createPost(text) {
        if (!this.accessToken || !this.userId) throw new Error('Not authenticated');

        try {
            // Step 1: Create media container
            const containerResponse = await axios.post(`${THREADS_BASE}/${this.userId}/threads`, null, {
                params: {
                    media_type: 'TEXT',
                    text: text,
                    access_token: this.accessToken
                }
            });

            const containerId = containerResponse.data.id;

            // Step 2: Publish the container
            const publishResponse = await axios.post(`${THREADS_BASE}/${this.userId}/threads_publish`, null, {
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
            console.error('Threads Post Error:', error.response?.data || error.message);
            throw new Error(`Failed to create post: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    /**
     * Create a post with an image
     * @param {string} text - Post text
     * @param {string} imageUrl - Publicly accessible image URL
     */
    async createImagePost(text, imageUrl) {
        if (!this.accessToken || !this.userId) throw new Error('Not authenticated');

        try {
            // Step 1: Create media container with image
            const containerResponse = await axios.post(`${THREADS_BASE}/${this.userId}/threads`, null, {
                params: {
                    media_type: 'IMAGE',
                    image_url: imageUrl,
                    text: text,
                    access_token: this.accessToken
                }
            });

            const containerId = containerResponse.data.id;

            // Wait for media processing
            await this._waitForProcessing(containerId);

            // Step 2: Publish
            const publishResponse = await axios.post(`${THREADS_BASE}/${this.userId}/threads_publish`, null, {
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
            console.error('Threads Image Post Error:', error.response?.data || error.message);
            throw new Error(`Failed to create image post: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    /**
     * Wait for media container to finish processing
     */
    async _waitForProcessing(containerId, maxWait = 30000) {
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            const status = await axios.get(`${THREADS_BASE}/${containerId}`, {
                params: {
                    fields: 'status',
                    access_token: this.accessToken
                }
            });
            if (status.data.status === 'FINISHED') return;
            if (status.data.status === 'ERROR') throw new Error('Media processing failed');
            await new Promise(r => setTimeout(r, 2000));
        }
        throw new Error('Media processing timeout');
    }
}

module.exports = ThreadsAPI;
