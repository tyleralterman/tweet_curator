/**
 * Tweet Curator Server
 * Express API for managing and curating tweets
 */

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const extractZip = require('extract-zip');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// File upload setup
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

// Database setup - check multiple locations
const DB_PATHS = [
    path.join(__dirname, 'tweets.db'),           // Root level (Railway)
    path.join(__dirname, 'database/tweets.db')   // Subdirectory (local dev)
];

let DB_PATH = DB_PATHS.find(p => fs.existsSync(p));

// If no database exists, create one at root level
if (!DB_PATH) {
    DB_PATH = DB_PATHS[0]; // Default to root
    console.log('📝 No database found. A new one will be created when you import tweets.');
}

const db = new Database(DB_PATH, { readonly: false });
db.pragma('journal_mode = WAL');

// Run schema to add any new columns/tables
const SCHEMA_PATH = path.join(__dirname, 'database/schema.sql');
try {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
} catch (e) {
    // Schema already applied
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// API Routes
// ============================================

// Get tweets with filters, sorting, and pagination
app.get('/api/tweets', (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            search = '',
            type = '',
            length = '',
            swipe = '',
            tag = '',
            reviewed = '',
            excludeRetweets = 'true',
            excludeReplies = 'true',
            excludeThreads = 'false',
            sort = 'created_at',
            order = 'desc'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const conditions = [];
        const params = [];

        if (search) {
            conditions.push(`t.full_text LIKE ?`);
            params.push(`%${search}%`);
        }

        if (type) {
            conditions.push(`t.tweet_type = ?`);
            params.push(type);
        }

        if (length) {
            conditions.push(`t.length_category = ?`);
            params.push(length);
        }

        // Quality check removed

        if (swipe) {
            if (swipe === 'unreviewed') {
                conditions.push(`t.swipe_status IS NULL`);
            } else {
                conditions.push(`t.swipe_status = ?`);
                params.push(swipe);
            }
        }

        if (reviewed === 'true') {
            conditions.push(`t.is_reviewed = 1`);
        } else if (reviewed === 'false') {
            conditions.push(`t.is_reviewed = 0`);
        }

        if (excludeRetweets === 'true') {
            conditions.push(`t.tweet_type != 'retweet'`);
        }

        if (excludeReplies === 'true') {
            conditions.push(`t.tweet_type != 'reply'`);
        }

        if (excludeThreads === 'true') {
            conditions.push(`t.tweet_type != 'thread'`);
        }

        let joinClause = '';
        if (tag) {
            joinClause = `
                INNER JOIN tweet_tags tt_filter ON t.id = tt_filter.tweet_id
                INNER JOIN tags tag_filter ON tag_filter.id = tt_filter.tag_id AND tag_filter.name = ?
            `;
            params.unshift(tag);
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        const validSorts = ['created_at', 'favorite_count', 'retweet_count', 'char_count', 'ai_quality_score'];
        const sortColumn = validSorts.includes(sort) ? sort : 'created_at';
        const sqlSortOrder = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        const countQuery = `SELECT COUNT(DISTINCT t.id) as total FROM tweets t ${joinClause} ${whereClause}`;
        const { total } = db.prepare(countQuery).get(...params);

        const tweetsQuery = `
            SELECT 
                t.*,
                GROUP_CONCAT(DISTINCT tags.name) as tag_names,
                GROUP_CONCAT(DISTINCT tags.category || ':' || tags.name || ':' || COALESCE(tags.color, '#666')) as tag_details,
                quoted.full_text as quoted_text,
                quoted.media_url as quoted_media,
                quoted.id as quoted_id
            FROM tweets t
            LEFT JOIN tweets quoted ON t.quoted_tweet_id = quoted.id
            ${joinClause}
            LEFT JOIN tweet_tags tt ON t.id = tt.tweet_id
            LEFT JOIN tags ON tags.id = tt.tag_id
            ${whereClause}
            GROUP BY t.id
            ORDER BY t.${sortColumn} ${sqlSortOrder}
            LIMIT ? OFFSET ?
        `;

        const tweets = db.prepare(tweetsQuery).all(...params, parseInt(limit), offset);

        const tweetsWithTags = tweets.map(tweet => {
            const tags = [];
            if (tweet.tag_details) {
                tweet.tag_details.split(',').forEach(detail => {
                    const [category, name, color] = detail.split(':');
                    if (name) tags.push({ category, name, color });
                });
            }
            delete tweet.tag_names;
            delete tweet.tag_details;
            return { ...tweet, tags };
        });

        res.json({
            tweets: tweetsWithTags,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) {
        console.error('Error fetching tweets:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get single tweet
app.get('/api/tweets/:id', (req, res) => {
    try {
        const tweet = db.prepare(`
            SELECT t.*,
                GROUP_CONCAT(DISTINCT tags.name) as tag_names,

                GROUP_CONCAT(DISTINCT tags.category || ':' || tags.name || ':' || COALESCE(tags.color, '#666')) as tag_details,
                quoted.full_text as quoted_text,
                quoted.media_url as quoted_media,
                quoted.id as quoted_id
            FROM tweets t
            LEFT JOIN tweets quoted ON t.quoted_tweet_id = quoted.id
            LEFT JOIN tweet_tags tt ON t.id = tt.tweet_id
            LEFT JOIN tags ON tags.id = tt.tag_id
            WHERE t.id = ?
            GROUP BY t.id
        `).get(req.params.id);

        if (!tweet) {
            return res.status(404).json({ error: 'Tweet not found' });
        }

        const tags = [];
        if (tweet.tag_details) {
            tweet.tag_details.split(',').forEach(detail => {
                const [category, name, color] = detail.split(':');
                if (name) tags.push({ category, name, color });
            });
        }
        delete tweet.tag_names;
        delete tweet.tag_details;

        res.json({ ...tweet, tags });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get thread chain for a tweet
app.get('/api/tweets/:id/thread', (req, res) => {
    try {
        const { id } = req.params;

        // Recursive CTE to get the thread chain (replies to this tweet, and replies to those replies)
        // We only care about tweets by the author (self-thread) which are marked as 'thread' or 'reply'
        const query = `
            WITH RECURSIVE thread_chain AS (
                -- Base case: Direct replies to the given tweet
                SELECT * FROM tweets 
                WHERE in_reply_to_tweet_id = ?
                
                UNION ALL
                
                -- Recursive step: Replies to tweets in the chain
                SELECT t.* FROM tweets t
                JOIN thread_chain tc ON t.in_reply_to_tweet_id = tc.id
            )
            SELECT * FROM thread_chain ORDER BY created_at ASC;
        `;

        const thread = db.prepare(query).all(id);
        res.json(thread);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update tweet
app.patch('/api/tweets/:id', (req, res) => {
    try {
        const { quality_rating, swipe_status, notes, is_reviewed } = req.body;
        const updates = [];
        const params = [];

        if (quality_rating !== undefined) {
            updates.push('quality_rating = ?');
            params.push(quality_rating);
        }
        if (swipe_status !== undefined) {
            updates.push('swipe_status = ?');
            params.push(swipe_status);
            updates.push('is_reviewed = 1');
            updates.push('reviewed_at = ?');
            params.push(new Date().toISOString());

            // Auto-set quality rating based on swipe status
            if (swipe_status === 'dislike') {
                updates.push('quality_rating = ?');
                params.push('low');
            } else if (swipe_status === 'like') {
                updates.push('quality_rating = ?');
                params.push('medium');
            } else if (swipe_status === 'superlike') {
                updates.push('quality_rating = ?');
                params.push('high');
            }

            // Update session stats
            updateSessionStats(swipe_status);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }
        if (is_reviewed !== undefined) {
            updates.push('is_reviewed = ?');
            params.push(is_reviewed ? 1 : 0);
            if (is_reviewed) {
                updates.push('reviewed_at = ?');
                params.push(new Date().toISOString());
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        params.push(req.params.id);
        db.prepare(`UPDATE tweets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper function to update session stats
function updateSessionStats(swipeStatus) {
    const today = new Date().toISOString().split('T')[0];

    // Get or create today's session
    let session = db.prepare('SELECT * FROM swipe_sessions WHERE session_date = ?').get(today);

    if (!session) {
        db.prepare('INSERT INTO swipe_sessions (session_date, tweets_swiped) VALUES (?, 0)').run(today);
        session = { tweets_swiped: 0, likes: 0, superlikes: 0, dislikes: 0, review_later: 0 };
    }

    // Update counts
    const column = swipeStatus === 'like' ? 'likes' :
        swipeStatus === 'superlike' ? 'superlikes' :
            swipeStatus === 'dislike' ? 'dislikes' :
                swipeStatus === 'review_later' ? 'review_later' : null;

    if (column) {
        db.prepare(`UPDATE swipe_sessions SET tweets_swiped = tweets_swiped + 1, ${column} = ${column} + 1 WHERE session_date = ?`).run(today);
    }
}

// Get all tags
app.get('/api/tags', (req, res) => {
    try {
        const tags = db.prepare(`
            SELECT t.*, COUNT(tt.tweet_id) as tweet_count
            FROM tags t
            LEFT JOIN tweet_tags tt ON t.id = tt.tag_id
            GROUP BY t.id
            ORDER BY t.category, t.name
        `).all();

        const grouped = {
            topic: tags.filter(t => t.category === 'topic'),
            pattern: tags.filter(t => t.category === 'pattern'),
            use: tags.filter(t => t.category === 'use'),
            custom: tags.filter(t => t.category === 'custom')
        };

        res.json(grouped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search tags for autocomplete
app.get('/api/tags/search', (req, res) => {
    try {
        const { q = '' } = req.query;
        const tags = db.prepare(`
            SELECT * FROM tags 
            WHERE name LIKE ?
            ORDER BY category, name
            LIMIT 20
        `).all(`%${q}%`);
        res.json(tags);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add tag to tweet
app.post('/api/tweets/:id/tags', (req, res) => {
    try {
        const { tagName, tagCategory = 'custom' } = req.body;

        if (!tagName) {
            return res.status(400).json({ error: 'Tag name required' });
        }

        db.prepare(`
            INSERT OR IGNORE INTO tags (name, category)
            VALUES (?, ?)
        `).run(tagName.toLowerCase(), tagCategory);

        const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(tagName.toLowerCase());

        db.prepare(`
            INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source)
            VALUES (?, ?, 'manual')
        `).run(req.params.id, tag.id);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove tag from tweet
app.delete('/api/tweets/:id/tags/:tagName', (req, res) => {
    try {
        const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(req.params.tagName.toLowerCase());

        if (!tag) {
            return res.status(404).json({ error: 'Tag not found' });
        }

        db.prepare(`DELETE FROM tweet_tags WHERE tweet_id = ? AND tag_id = ?`)
            .run(req.params.id, tag.id);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get stats
app.get('/api/stats', (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN tweet_type = 'text_only' THEN 1 ELSE 0 END) as text_only,
                SUM(CASE WHEN tweet_type = 'reply' THEN 1 ELSE 0 END) as replies,
                SUM(CASE WHEN tweet_type = 'retweet' THEN 1 ELSE 0 END) as retweets,
                SUM(CASE WHEN tweet_type = 'media' THEN 1 ELSE 0 END) as with_media,
                SUM(CASE WHEN tweet_type = 'quote' THEN 1 ELSE 0 END) as quotes,
                SUM(CASE WHEN tweet_type = 'thread' THEN 1 ELSE 0 END) as threads,
                SUM(CASE WHEN length_category = 'short' THEN 1 ELSE 0 END) as short,
                SUM(CASE WHEN length_category = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN length_category = 'long' THEN 1 ELSE 0 END) as long_tweets,
                SUM(CASE WHEN quality_rating = 'high' THEN 1 ELSE 0 END) as high_quality,
                SUM(CASE WHEN quality_rating = 'medium' THEN 1 ELSE 0 END) as medium_quality,
                SUM(CASE WHEN quality_rating = 'low' THEN 1 ELSE 0 END) as low_quality,
                SUM(CASE WHEN swipe_status = 'like' THEN 1 ELSE 0 END) as liked,
                SUM(CASE WHEN swipe_status = 'superlike' THEN 1 ELSE 0 END) as superliked,
                SUM(CASE WHEN swipe_status = 'dislike' THEN 1 ELSE 0 END) as disliked,
                SUM(CASE WHEN swipe_status = 'review_later' THEN 1 ELSE 0 END) as review_later,
                SUM(CASE WHEN swipe_status IS NOT NULL THEN 1 ELSE 0 END) as reviewed
            FROM tweets
        `).get();

        // Get today's session stats
        const today = new Date().toISOString().split('T')[0];
        const todayStats = db.prepare('SELECT * FROM swipe_sessions WHERE session_date = ?').get(today) || {
            tweets_swiped: 0, likes: 0, superlikes: 0, dislikes: 0, review_later: 0
        };

        const topTags = db.prepare(`
            SELECT tags.name, tags.category, tags.color, COUNT(*) as count
            FROM tweet_tags
            JOIN tags ON tags.id = tweet_tags.tag_id
            GROUP BY tags.id
            ORDER BY count DESC
            LIMIT 20
        `).all();

        res.json({ stats, topTags, todayStats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get swipe queue (unreviewed)
app.get('/api/swipe/queue', (req, res) => {
    try {
        const { limit = 10, tag = '', length = '' } = req.query;

        const conditions = [
            "t.swipe_status IS NULL",
            "t.tweet_type NOT IN ('retweet', 'reply', 'thread')"
        ];
        const params = [];

        // Helper for IN clause (only for WHERE conditions)
        const addInCondition = (col, valString) => {
            if (!valString) return;
            const values = valString.split(',').filter(v => v);
            if (values.length === 0) return;
            const placeHolders = values.map(() => '?').join(',');
            conditions.push(`${col} IN (${placeHolders})`);
            params.push(...values);
        };

        addInCondition('t.length_category', length);
        // Quality condition REMOVED

        let joinClause = '';
        const joinParams = []; // Separate params for JOIN

        if (tag) {
            const tags = tag.split(',').filter(t => t);
            if (tags.length > 0) {
                const tagPlaceholders = tags.map(() => '?').join(',');
                joinClause = `
                    INNER JOIN tweet_tags tt ON t.id = tt.tweet_id
                    INNER JOIN tags ON tags.id = tt.tag_id AND tags.name IN (${tagPlaceholders})
                `;
                joinParams.push(...tags);
            }
        }

        const whereClause = conditions.join(' AND ');

        // Combined params: JOIN params first, then WHERE params
        const finalParams = [...joinParams, ...params];

        // Get unreviewed tweets
        const query = `
            SELECT DISTINCT t.*, 
                quoted.full_text as quoted_text,
                quoted.media_url as quoted_media,
                quoted.id as quoted_id
            FROM tweets t
            LEFT JOIN tweets quoted ON t.quoted_tweet_id = quoted.id
            ${joinClause}
            WHERE ${whereClause}
            ORDER BY 
                t.favorite_count DESC,
                t.created_at DESC
            LIMIT ?
        `;

        // Add limit to params
        const queryParams = [...finalParams, parseInt(limit)];
        const tweets = db.prepare(query).all(...queryParams);

        // Count remaining
        const countQuery = `
            SELECT COUNT(DISTINCT t.id) as count FROM tweets t
            ${joinClause}
            WHERE ${whereClause}
        `;
        // Count query uses same params (minus limit)
        const remaining = db.prepare(countQuery).get(...finalParams);

        res.json({ tweets, remaining: remaining.count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get today's session stats
app.get('/api/swipe/today', (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const stats = db.prepare('SELECT * FROM swipe_sessions WHERE session_date = ?').get(today) || {
            tweets_swiped: 0, likes: 0, superlikes: 0, dislikes: 0, review_later: 0
        };
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Archive Upload
// ============================================

app.post('/api/import/upload', upload.single('archive'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const zipPath = req.file.path;
    const extractPath = path.join(__dirname, 'uploads', `extract_${Date.now()}`);

    try {
        // Extract the zip
        await extractZip(zipPath, { dir: extractPath });

        // Find the data directory (might be nested)
        let dataPath = extractPath;
        const findDataDir = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name === 'data') {
                    return path.join(dir, entry.name);
                }
                if (entry.isDirectory()) {
                    const found = findDataDir(path.join(dir, entry.name));
                    if (found) return found;
                }
            }
            return null;
        };

        const foundDataPath = findDataDir(extractPath);
        if (!foundDataPath) {
            throw new Error('Could not find data directory in archive');
        }

        // Run the import script
        const importScript = path.join(__dirname, 'scripts/import.js');
        const output = execSync(`node "${importScript}" "${foundDataPath}"`, {
            timeout: 120000 // 2 minute timeout
        });

        // Run auto-tagging immediately after
        console.log('🤖 Running auto-tagging...');
        const autoTagScript = path.join(__dirname, 'scripts/auto_tag_heuristics.js');
        const tagOutput = execSync(`node "${autoTagScript}"`, { encoding: 'utf8' });
        console.log('✅ Auto-tagging complete');

        // Cleanup
        fs.rmSync(zipPath, { force: true });
        fs.rmSync(extractPath, { recursive: true, force: true });

        res.json({ success: true, output });
    } catch (err) {
        // Cleanup on error
        fs.rmSync(zipPath, { force: true });
        if (fs.existsSync(extractPath)) {
            fs.rmSync(extractPath, { recursive: true, force: true });
        }
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Export Endpoints
// ============================================

app.get('/api/export/json', (req, res) => {
    try {
        const {
            quality = '',
            swipe = '',
            tag = '',
            type = '',
            length = '',
            excludeRetweets = 'true',
            excludeReplies = 'true'
        } = req.query;

        const conditions = [];
        const params = [];

        if (quality) {
            conditions.push('t.quality_rating = ?');
            params.push(quality);
        }
        if (swipe) {
            conditions.push('t.swipe_status = ?');
            params.push(swipe);
        }
        if (type) {
            conditions.push('t.tweet_type = ?');
            params.push(type);
        }
        if (length) {
            conditions.push('t.length_category = ?');
            params.push(length);
        }
        if (excludeRetweets === 'true') {
            conditions.push("t.tweet_type != 'retweet'");
        }
        if (excludeReplies === 'true') {
            conditions.push("t.tweet_type != 'reply'");
        }
        if (excludeThreads === 'true') {
            conditions.push("t.tweet_type != 'thread'");
        }

        let joinClause = '';
        if (tag) {
            joinClause = `
                INNER JOIN tweet_tags tt ON t.id = tt.tweet_id
                INNER JOIN tags ON tags.id = tt.tag_id AND tags.name = ?
            `;
            params.unshift(tag);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const tweets = db.prepare(`
            SELECT DISTINCT t.id, t.full_text, t.created_at, t.favorite_count, t.retweet_count,
                   t.tweet_type, t.length_category, t.quality_rating, t.swipe_status, t.tweet_url
            FROM tweets t
            ${joinClause}
            ${whereClause}
            ORDER BY t.created_at DESC
        `).all(...params);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="tweets_export.json"');
        res.json(tweets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/export/csv', (req, res) => {
    try {
        const {
            quality = '',
            swipe = '',
            tag = '',
            type = '',
            length = '',
            excludeRetweets = 'true',
            excludeReplies = 'true'
        } = req.query;

        const conditions = [];
        const params = [];

        if (quality) {
            conditions.push('t.quality_rating = ?');
            params.push(quality);
        }
        if (swipe) {
            conditions.push('t.swipe_status = ?');
            params.push(swipe);
        }
        if (type) {
            conditions.push('t.tweet_type = ?');
            params.push(type);
        }
        if (length) {
            conditions.push('t.length_category = ?');
            params.push(length);
        }
        if (excludeRetweets === 'true') {
            conditions.push("t.tweet_type != 'retweet'");
        }
        if (excludeReplies === 'true') {
            conditions.push("t.tweet_type != 'reply'");
        }

        let joinClause = '';
        if (tag) {
            joinClause = `
                INNER JOIN tweet_tags tt ON t.id = tt.tweet_id
                INNER JOIN tags ON tags.id = tt.tag_id AND tags.name = ?
            `;
            params.unshift(tag);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const tweets = db.prepare(`
            SELECT DISTINCT t.id, t.full_text, t.created_at, t.favorite_count, t.retweet_count,
                   t.tweet_type, t.length_category, t.quality_rating, t.swipe_status, t.tweet_url
            FROM tweets t
            ${joinClause}
            ${whereClause}
            ORDER BY t.created_at DESC
        `).all(...params);

        const headers = ['id', 'full_text', 'created_at', 'favorite_count', 'retweet_count', 'tweet_type', 'length_category', 'quality_rating', 'swipe_status', 'tweet_url'];
        const escapeCSV = (str) => {
            if (str === null || str === undefined) return '';
            const s = String(str);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        let csv = headers.join(',') + '\n';
        for (const tweet of tweets) {
            csv += headers.map(h => escapeCSV(tweet[h])).join(',') + '\n';
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="tweets_export.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    console.log(`
🐦 Tweet Curator Server Running!
   
   📂 Content Directory: http://localhost:${PORT}
   💫 Swipe Interface:   http://localhost:${PORT}/swipe.html
   📊 API:               http://localhost:${PORT}/api/stats
   
   Press Ctrl+C to stop
`);
});

process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});
