/**
 * LinkedIn API Client
 * 
 * Handles OAuth 2.0 flow, token refresh, and posting to LinkedIn Profile.
 * Uses the Unified Posts API (v2).
 * 
 * Environment Variables Required:
 *   LINKEDIN_CLIENT_ID
 *   LINKEDIN_CLIENT_SECRET
 *   LINKEDIN_REDIRECT_URI (default: http://localhost:3000/api/auth/linkedin/callback)
 *   LINKEDIN_ACCESS_TOKEN (stored after auth)
 *   LINKEDIN_REFRESH_TOKEN (stored after auth)
 *   LINKEDIN_PERSON_URN (stored after auth)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class LinkedInAPI {
    constructor() {
        this.clientId = process.env.LINKEDIN_CLIENT_ID;
        this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
        this.redirectUri = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/auth/linkedin/callback';

        // State for storage
        this.accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
        this.refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;
        this.personUrn = process.env.LINKEDIN_PERSON_URN;
    }

    /**
     * Generate the authorization URL for user to click
     */
    getAuthUrl() {
        const scope = 'openid profile w_member_social email';
        const state = Math.random().toString(36).substring(7);
        return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${this.clientId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}`;
    }

    /**
     * Exchange authorization code for access and refresh tokens
     */
    async exchangeCodeForTokens(code) {
        try {
            const params = new URLSearchParams();
            params.append('grant_type', 'authorization_code');
            params.append('code', code);
            params.append('redirect_uri', this.redirectUri);
            params.append('client_id', this.clientId);
            params.append('client_secret', this.clientSecret);

            const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token;

            // Get user profile to get URN
            await this.getProfile();

            return {
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
                expiresIn: response.data.expires_in,
                refreshTokenExpiresIn: response.data.refresh_token_expires_in,
                personUrn: this.personUrn
            };
        } catch (error) {
            console.error('LinkedIn Token Exchange Error:', error.response?.data || error.message);
            throw new Error('Failed to exchange code for tokens');
        }
    }

    /**
     * Refresh the access token using the refresh token
     */
    async refreshAccessToken() {
        if (!this.refreshToken) throw new Error('No refresh token available');

        try {
            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', this.refreshToken);
            params.append('client_id', this.clientId);
            params.append('client_secret', this.clientSecret);

            const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token || this.refreshToken; // Use new one if provided

            return {
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
                expiresIn: response.data.expires_in
            };
        } catch (error) {
            console.error('LinkedIn Token Refresh Error:', error.response?.data || error.message);
            throw new Error('Failed to refresh access token');
        }
    }

    /**
     * Get authenticated user profile (to get Person URN)
     */
    async getProfile() {
        if (!this.accessToken) throw new Error('No access token');

        try {
            const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            });

            // The 'sub' field contains the ID, e.g. "782349"
            // We need to construct urn:li:person:{sub}
            this.personUrn = `urn:li:person:${response.data.sub}`;
            return {
                sub: response.data.sub,
                name: response.data.name,
                picture: response.data.picture,
                urn: this.personUrn
            };
        } catch (error) {
            console.error('LinkedIn Profile Error:', error.response?.data || error.message);
            throw new Error('Failed to get user profile');
        }
    }

    /**
     * Post text content to LinkedIn
     * @param {string} text - The text content
     * @param {string} [mediaUrn] - Optional URN of uploaded image/video
     */
    async createPost(text, mediaUrn = null) {
        if (!this.accessToken || !this.personUrn) throw new Error('Not authenticated');

        try {
            const postData = {
                author: this.personUrn,
                commentary: text,
                visibility: "PUBLIC",
                distribution: {
                    feedDistribution: "MAIN_FEED",
                    targetEntities: [],
                    thirdPartyDistributionChannels: []
                },
                lifecycleState: "PUBLISHED"
            };

            // Add media if provided
            if (mediaUrn) {
                postData.content = {
                    media: {
                        id: mediaUrn
                    }
                };
            }

            const response = await axios.post('https://api.linkedin.com/v2/posts', postData, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0'
                }
            });

            return response.data; // usually empty body on success? or URN?
        } catch (error) {
            console.error('LinkedIn Post Error:', error.response?.data || error.message);
            throw new Error('Failed to create post');
        }
    }

    /**
     * Upload an image to LinkedIn
     * 1. Register Upload -> Get upload URL
     * 2. Upload file
     * 3. Complete Upload
     */
    async uploadImage(imagePath) {
        if (!this.accessToken || !this.personUrn) throw new Error('Not authenticated');

        try {
            // 1. Register Upload
            const registerResponse = await axios.post('https://api.linkedin.com/v2/assets?action=registerUpload', {
                registerUploadRequest: {
                    recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
                    owner: this.personUrn,
                    serviceRelationships: [{
                        relationshipType: "OWNER",
                        identifier: "urn:li:userGeneratedContent"
                    }]
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0'
                }
            });

            const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
            const assetUrn = registerResponse.data.value.asset;

            // 2. Upload File
            const fileBuffer = fs.readFileSync(imagePath);
            await axios.put(uploadUrl, fileBuffer, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/octet-stream'
                }
            });

            return assetUrn;
        } catch (error) {
            console.error('LinkedIn Upload Error:', error.response?.data || error.message);
            throw new Error('Failed to upload image');
        }
    }
}

module.exports = LinkedInAPI;
