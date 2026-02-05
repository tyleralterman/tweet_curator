/**
 * Substack Internal API Client
 * 
 * Uses Substack's internal (unofficial) API to create and schedule posts.
 * Authentication via session cookie (substack.sid).
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
        this.sessionCookie = sessionCookie;
        // Use custom domain if provided, otherwise use substack.com subdomain
        this.baseUrl = customDomain || `${publication}.substack.com`;
    }

    /**
     * Make authenticated request to Substack API
     */
    async request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.baseUrl,
                port: 443,
                path: path,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': `substack.sid=${this.sessionCookie}`,
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            resolve(data);
                        }
                    } else {
                        console.error(`Substack API Error: ${res.statusCode}`, data);
                        reject(new Error(`API Error: ${res.statusCode} - ${data.substring(0, 200)}`));
                    }
                });
            });

            req.on('error', reject);

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
     * Create a draft post
     */
    async createDraft(title, subtitle, bodyHtml, coverImageUrl = null) {
        const payload = {
            title: title,
            subtitle: subtitle || '',
            body_html: bodyHtml,
            type: 'newsletter',
            audience: 'everyone',
            draft: true
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
     * Schedule a draft for publishing
     */
    async scheduleDraft(draftId, scheduledDate) {
        const payload = {
            draft_id: draftId,
            scheduled_for: scheduledDate.toISOString(),
            send_email: true,
            publish_to_web: true
        };

        try {
            const response = await this.request('POST', `/api/v1/drafts/${draftId}/schedule`, payload);
            console.log(`✅ Scheduled post for: ${scheduledDate.toISOString()}`);
            return response;
        } catch (e) {
            // Try alternative endpoint format
            try {
                const altPayload = {
                    post_date: scheduledDate.toISOString(),
                    audience: 'everyone'
                };
                const response = await this.request('PUT', `/api/v1/drafts/${draftId}`, altPayload);
                console.log(`✅ Updated draft with schedule: ${scheduledDate.toISOString()}`);
                return response;
            } catch (e2) {
                console.error('Failed to schedule draft:', e2.message);
                throw e2;
            }
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
