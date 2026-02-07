/**
 * Substack Internal API Client
 * 
 * Uses Substack's internal (unofficial) API to create and schedule posts.
 * Authentication via session cookie (substack.sid).
 * 
 * Based on actual network traffic analysis from browser debugging:
 * - NO CSRF token is required
 * - Origin/Referer headers are strictly validated
 * - Cookie-based authentication is sufficient
 * 
 * Environment variables:
 * - SUBSTACK_SESSION_COOKIE: The substack.sid cookie value
 * - SUBSTACK_PUBLICATION: Your publication subdomain (e.g., "lalachimera")
 * - SUBSTACK_CUSTOM_DOMAIN: Optional custom domain (e.g., "lalachimera.com")
 */

const https = require('https');

class SubstackAPI {
    constructor(publication, sessionCookie, customDomain = null) {
        this.publication = publication;
        // URL-decode the session cookie if needed
        this.sessionCookie = sessionCookie.includes('%')
            ? decodeURIComponent(sessionCookie)
            : sessionCookie;
        // Use custom domain if provided, otherwise use substack.com subdomain
        this.baseUrl = customDomain || `${publication}.substack.com`;

        console.log(`🔌 SubstackAPI initialized: ${this.baseUrl}`);
    }

    /**
     * Make authenticated request to Substack API
     * Replicates exact browser request structure based on traffic analysis
     */
    async request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            // Headers exactly as captured from browser network traffic
            const headers = {
                'Content-Type': 'application/json',
                'Cookie': `connect.sid=${this.sessionCookie}`,
                'Origin': `https://${this.baseUrl}`,
                'Referer': `https://${this.baseUrl}/publish/post/`,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty'
            };

            if (body) {
                headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
            }

            const options = {
                hostname: this.baseUrl,
                port: 443,
                path: path,
                method: method,
                headers: headers
            };

            console.log(`📡 ${method} https://${this.baseUrl}${path}`);

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    console.log(`📥 Response: ${res.statusCode}`);

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            resolve(data);
                        }
                    } else {
                        console.error(`❌ Substack API Error: ${res.statusCode}`);
                        console.error(`Response: ${data.substring(0, 500)}`);
                        reject(new Error(`API Error: ${res.statusCode} - ${data.substring(0, 200)}`));
                    }
                });
            });

            req.on('error', (e) => {
                console.error(`❌ Request error: ${e.message}`);
                reject(e);
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Get list of scheduled posts
     */
    async getScheduledPosts() {
        try {
            const response = await this.request('GET', '/api/v1/posts?status=scheduled&limit=100');
            return response.posts || response || [];
        } catch (e) {
            console.error('Failed to get scheduled posts:', e.message);
            return [];
        }
    }

    /**
     * Get drafts list
     */
    async getDrafts() {
        try {
            const response = await this.request('GET', '/api/v1/drafts?limit=100');
            return response.drafts || response || [];
        } catch (e) {
            console.error('Failed to get drafts:', e.message);
            return [];
        }
    }

    /**
     * Get the latest scheduled post date
     * Returns null if no scheduled posts exist
     */
    async getLatestScheduledDate() {
        const posts = await this.getScheduledPosts();
        if (!posts || posts.length === 0) return null;

        // Find the latest scheduled_for date
        let latestDate = null;
        for (const post of posts) {
            if (post.scheduled_for || post.post_date) {
                const date = new Date(post.scheduled_for || post.post_date);
                if (!latestDate || date > latestDate) {
                    latestDate = date;
                }
            }
        }
        return latestDate;
    }

    /**
     * Create a new draft post
     * Based on actual Substack API structure
     */
    async createDraft(title, subtitle, bodyHtml, coverImageUrl = null) {
        const payload = {
            draft_title: title,
            draft_subtitle: subtitle || '',
            draft_body: JSON.stringify({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: bodyHtml }]
                    }
                ]
            }),
            type: 'newsletter',
            audience: 'everyone'
        };

        if (coverImageUrl) {
            payload.cover_image = coverImageUrl;
        }

        try {
            const response = await this.request('POST', '/api/v1/drafts', payload);
            console.log(`✅ Created draft: ${title} (ID: ${response.id})`);
            return response;
        } catch (e) {
            console.error('Failed to create draft:', e.message);
            throw e;
        }
    }

    /**
     * Update an existing draft
     */
    async updateDraft(draftId, updates) {
        try {
            const response = await this.request('PUT', `/api/v1/drafts/${draftId}`, updates);
            console.log(`✅ Updated draft: ${draftId}`);
            return response;
        } catch (e) {
            console.error('Failed to update draft:', e.message);
            throw e;
        }
    }

    /**
     * Schedule a draft for publishing
     */
    async scheduleDraft(draftId, scheduledDate) {
        const payload = {
            post_date: scheduledDate.toISOString(),
            audience: 'everyone'
        };

        try {
            // Use PUT to update the draft with a scheduled date
            const response = await this.request('PUT', `/api/v1/drafts/${draftId}`, payload);
            console.log(`✅ Scheduled post for: ${scheduledDate.toISOString()}`);
            return response;
        } catch (e) {
            console.error('Failed to schedule draft:', e.message);
            throw e;
        }
    }

    /**
     * Create and schedule a post in one workflow
     */
    async createAndSchedule(title, subtitle, bodyHtml, scheduledDate, coverImageUrl = null) {
        // 1. Create draft
        const draft = await this.createDraft(title, subtitle, bodyHtml, coverImageUrl);

        // 2. Schedule it
        await this.scheduleDraft(draft.id, scheduledDate);

        return {
            draftId: draft.id,
            scheduledFor: scheduledDate.toISOString(),
            title: title
        };
    }

    /**
     * Calculate next available slot based on schedule (2x/week: Sun + Wed at 9am)
     */
    calculateNextSlot(lastDate) {
        const next = lastDate ? new Date(lastDate) : new Date();

        // Add time to get to next slot
        const dayOfWeek = next.getDay();

        if (dayOfWeek === 0) {
            // Sunday -> next Wednesday (3 days)
            next.setDate(next.getDate() + 3);
        } else if (dayOfWeek === 3) {
            // Wednesday -> next Sunday (4 days)
            next.setDate(next.getDate() + 4);
        } else if (dayOfWeek < 3) {
            // Mon/Tue -> Wednesday
            next.setDate(next.getDate() + (3 - dayOfWeek));
        } else {
            // Thu/Fri/Sat -> Sunday
            next.setDate(next.getDate() + (7 - dayOfWeek));
        }

        // Set to 9am local time
        next.setHours(9, 0, 0, 0);

        return next;
    }

    /**
     * Get the next available slot after the last scheduled post
     */
    async getNextAvailableSlot() {
        const latestDate = await this.getLatestScheduledDate();
        return this.calculateNextSlot(latestDate);
    }

    /**
     * Test the connection by fetching drafts
     */
    async testConnection() {
        try {
            const drafts = await this.getDrafts();
            console.log(`✅ Connection test passed! Found ${drafts.length} drafts`);
            return true;
        } catch (e) {
            console.error(`❌ Connection test failed: ${e.message}`);
            return false;
        }
    }
}

// Subscribe button HTML templates
function getSubscribeButtonTop(publication) {
    return `
<div style="text-align: right; margin-bottom: 24px;">
    <a href="https://${publication}.substack.com/subscribe" 
       style="display: inline-block; padding: 8px 16px; background: #ff6719; color: white; 
              text-decoration: none; border-radius: 20px; font-size: 14px; font-weight: 600;">
        Subscribe
    </a>
</div>
`;
}

function getSubscribeButtonBottom(publication) {
    return `
<div style="text-align: center; margin-top: 48px; padding: 32px; background: #f7f7f7; border-radius: 12px;">
    <p style="margin: 0 0 16px 0; font-size: 18px; color: #333;">
        If you enjoyed this, subscribe for more!
    </p>
    <a href="https://${publication}.substack.com/subscribe" 
       style="display: inline-block; padding: 12px 32px; background: #ff6719; color: white; 
              text-decoration: none; border-radius: 24px; font-size: 16px; font-weight: 700;">
        Subscribe Now
    </a>
</div>
`;
}

/**
 * Format body content with paragraphs and subscribe buttons
 */
function formatArticleBody(content, publication) {
    // Split into paragraphs
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim());

    // Convert to HTML paragraphs
    let html = paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n');

    // Add subscribe buttons
    html = getSubscribeButtonTop(publication) + html + getSubscribeButtonBottom(publication);

    return html;
}

module.exports = {
    SubstackAPI,
    formatArticleBody,
    getSubscribeButtonTop,
    getSubscribeButtonBottom
};
