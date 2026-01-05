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

// ============================================
// Database Setup - with Render persistent disk support
// ============================================

console.log('🚀 Starting Tweet Curator Server...');
console.log('📍 Environment:', process.env.NODE_ENV || 'development');
console.log('📍 Render detected:', process.env.RENDER ? 'yes' : 'no');

// For Render: Check if persistent disk is mounted
const RENDER_DISK_PATH = '/data';
const isOnRender = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';

// Log disk status for debugging
if (isOnRender) {
    console.log('🔍 Checking persistent disk at /data...');
    console.log('   /data exists:', fs.existsSync(RENDER_DISK_PATH));
    if (fs.existsSync(RENDER_DISK_PATH)) {
        try {
            const files = fs.readdirSync(RENDER_DISK_PATH);
            console.log('   /data contents:', files.length > 0 ? files : '(empty)');
        } catch (e) {
            console.log('   /data read error:', e.message);
        }
    }
}

// Database location priority:
// 1. If /data exists (Render persistent disk) - USE IT
// 2. Otherwise local development paths
let DB_PATH;
const SEED_DB_PATH = path.join(__dirname, 'data_tweets.db');

if (fs.existsSync(RENDER_DISK_PATH)) {
    // Render persistent disk is available - always use it
    DB_PATH = path.join(RENDER_DISK_PATH, 'tweets.db');
    console.log('✅ Using Render persistent disk:', DB_PATH);

    // If database doesn't exist on disk, initialize it
    if (!fs.existsSync(DB_PATH)) {
        console.log('📦 No database on persistent disk, initializing...');
        if (fs.existsSync(SEED_DB_PATH)) {
            console.log('   Copying seed database...');
            fs.copyFileSync(SEED_DB_PATH, DB_PATH);
            console.log('   ✅ Seed database copied to persistent disk!');
        } else {
            console.log('   No seed database found, will create fresh.');
        }
    } else {
        console.log('   Database already exists on disk, using existing data.');
    }
} else {
    // Local development - use project directory
    const localPaths = [
        path.join(__dirname, 'tweets.db'),
        path.join(__dirname, 'database/tweets.db')
    ];

    DB_PATH = localPaths.find(p => fs.existsSync(p));

    if (!DB_PATH) {
        DB_PATH = localPaths[0];
        if (fs.existsSync(SEED_DB_PATH)) {
            console.log('📦 Copying seed database to', DB_PATH);
            fs.copyFileSync(SEED_DB_PATH, DB_PATH);
        }
    }
    console.log('📂 Using local database:', DB_PATH);
}

console.log('🔗 Final database path:', DB_PATH);

const db = new Database(DB_PATH, { readonly: false });
db.pragma('journal_mode = WAL');
console.log('✅ Database connection established');

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
// Search Utilities - Google-style search with stemming
// ============================================

/**
 * Simple Porter Stemmer for English
 * Handles common word endings: -ing, -ed, -s, -es, -ies, -tion, -ness, etc.
 */
function stem(word) {
    if (!word || word.length < 3) return word.toLowerCase();

    let w = word.toLowerCase();

    // Common irregular forms
    const irregulars = {
        'ran': 'run', 'running': 'run', 'runs': 'run',
        'children': 'child', 'childs': 'child',
        'men': 'man', 'women': 'woman',
        'feet': 'foot', 'teeth': 'tooth',
        'mice': 'mouse', 'geese': 'goose',
        'was': 'be', 'were': 'be', 'been': 'be', 'being': 'be', 'is': 'be', 'are': 'be', 'am': 'be',
        'had': 'have', 'has': 'have', 'having': 'have',
        'did': 'do', 'does': 'do', 'doing': 'do',
        'went': 'go', 'goes': 'go', 'going': 'go', 'gone': 'go',
        'said': 'say', 'says': 'say', 'saying': 'say',
        'made': 'make', 'makes': 'make', 'making': 'make',
        'took': 'take', 'takes': 'take', 'taking': 'take', 'taken': 'take',
        'came': 'come', 'comes': 'come', 'coming': 'come',
        'saw': 'see', 'sees': 'see', 'seeing': 'see', 'seen': 'see',
        'knew': 'know', 'knows': 'know', 'knowing': 'know', 'known': 'know',
        'thought': 'think', 'thinks': 'think', 'thinking': 'think',
        'got': 'get', 'gets': 'get', 'getting': 'get', 'gotten': 'get',
        'gave': 'give', 'gives': 'give', 'giving': 'give', 'given': 'give',
        'told': 'tell', 'tells': 'tell', 'telling': 'tell',
        'felt': 'feel', 'feels': 'feel', 'feeling': 'feel',
        'became': 'become', 'becomes': 'become', 'becoming': 'become',
        'left': 'leave', 'leaves': 'leave', 'leaving': 'leave',
        'brought': 'bring', 'brings': 'bring', 'bringing': 'bring',
        'wrote': 'write', 'writes': 'write', 'writing': 'write', 'written': 'write',
        'sat': 'sit', 'sits': 'sit', 'sitting': 'sit',
        'stood': 'stand', 'stands': 'stand', 'standing': 'stand',
        'lost': 'lose', 'loses': 'lose', 'losing': 'lose',
        'paid': 'pay', 'pays': 'pay', 'paying': 'pay',
        'met': 'meet', 'meets': 'meet', 'meeting': 'meet',
        'set': 'set', 'sets': 'set', 'setting': 'set',
        'learned': 'learn', 'learns': 'learn', 'learning': 'learn', 'learnt': 'learn',
        'kept': 'keep', 'keeps': 'keep', 'keeping': 'keep',
        'built': 'build', 'builds': 'build', 'building': 'build',
        'sent': 'send', 'sends': 'send', 'sending': 'send',
        'spent': 'spend', 'spends': 'spend', 'spending': 'spend',
        'understood': 'understand', 'understands': 'understand', 'understanding': 'understand',
        'began': 'begin', 'begins': 'begin', 'beginning': 'begin', 'begun': 'begin',
        'held': 'hold', 'holds': 'hold', 'holding': 'hold',
        'heard': 'hear', 'hears': 'hear', 'hearing': 'hear',
        'found': 'find', 'finds': 'find', 'finding': 'find',
        'read': 'read', 'reads': 'read', 'reading': 'read',
        'meant': 'mean', 'means': 'mean', 'meaning': 'mean',
        'led': 'lead', 'leads': 'lead', 'leading': 'lead',
        'put': 'put', 'puts': 'put', 'putting': 'put',
        'showed': 'show', 'shows': 'show', 'showing': 'show', 'shown': 'show',
        'moved': 'move', 'moves': 'move', 'moving': 'move',
        'lived': 'live', 'lives': 'live', 'living': 'live',
        'believed': 'believe', 'believes': 'believe', 'believing': 'believe',
        'loved': 'love', 'loves': 'love', 'loving': 'love'
    };

    if (irregulars[w]) return irregulars[w];

    // Remove common suffixes
    if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('ied') && w.length > 4) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);

    if (w.endsWith('ing') && w.length > 5) {
        w = w.slice(0, -3);
        // Handle doubling: running -> run, sitting -> sit
        if (w.length > 2 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
    }
    else if (w.endsWith('ed') && w.length > 4) {
        w = w.slice(0, -2);
        if (w.length > 2 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
    }
    else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('ment') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith('ful') && w.length > 5) w = w.slice(0, -3);
    else if (w.endsWith('less') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('tion') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('er') && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith('est') && w.length > 5) w = w.slice(0, -3);
    else if (w.endsWith('able') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('ible') && w.length > 6) w = w.slice(0, -4);

    return w;
}

/**
 * Parse search query Google-style:
 * - Multiple words = AND (tweet must contain ALL words)
 * - "quoted phrase" = exact phrase match
 * - Each word generates stemmed variants for near-matches
 */
function parseSearchQuery(query) {
    const conditions = [];
    const params = [];

    // Extract quoted phrases first
    const phrases = [];
    const quotedRegex = /"([^"]+)"/g;
    let match;
    let remaining = query;

    while ((match = quotedRegex.exec(query)) !== null) {
        phrases.push({ type: 'phrase', value: match[1] });
        remaining = remaining.replace(match[0], ' ');
    }

    // Split remaining into individual words
    const words = remaining.split(/\s+/).filter(w => w.length > 0);

    // Add each word as a token
    words.forEach(word => {
        // Skip very short words and common stop words
        if (word.length < 2) return;
        const stopWords = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'could', 'should', 'may', 'might', 'must', 'shall',
            'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
            'from', 'or', 'and', 'but', 'if', 'then', 'so', 'than',
            'that', 'this', 'these', 'those', 'it', 'its'];
        if (stopWords.includes(word.toLowerCase())) return;

        phrases.push({ type: 'word', value: word });
    });

    // Build conditions for each token
    phrases.forEach(token => {
        if (token.type === 'phrase') {
            // Exact phrase match (case-insensitive)
            conditions.push(`lower(t.full_text) LIKE ?`);
            params.push(`%${token.value.toLowerCase()}%`);
        } else {
            // For single words, match the word OR its stem
            const word = token.value.toLowerCase();
            const stemmed = stem(word);

            // Create conditions that match word boundaries better
            // Match: word at start, end, or surrounded by non-word chars
            if (word !== stemmed && stemmed.length >= 3) {
                // Match either the original word or the stem
                conditions.push(`(lower(t.full_text) LIKE ? OR lower(t.full_text) LIKE ?)`);
                params.push(`%${word}%`);
                params.push(`%${stemmed}%`);
            } else {
                conditions.push(`lower(t.full_text) LIKE ?`);
                params.push(`%${word}%`);
            }
        }
    });

    return { conditions, params };
}

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

        // Hide subsequent tweets in threads (tweets whose in_reply_to parent EXISTS in our database)
        // Thread-starters have NO parent in our database (their parent is external or deleted)
        // Requires LEFT JOIN tweets thread_parent ON t.in_reply_to_tweet_id = thread_parent.id
        conditions.push(`(t.tweet_type != 'thread' OR thread_parent.id IS NULL)`);



        if (search) {
            // Google-style search: 
            // - Multiple words = AND (all must be present)
            // - "quoted phrase" = exact phrase match
            // - Stemming for near-matches (children→child, ran→run)
            const searchConditions = parseSearchQuery(search);
            if (searchConditions.conditions.length > 0) {
                conditions.push(`(${searchConditions.conditions.join(' AND ')})`);
                params.push(...searchConditions.params);
            }
        }


        if (type) {
            if (type === 'thread') {
                // Special handling: show tweets that START threads
                // (tweets that have at least one child reply in our database)
                conditions.push(`EXISTS (SELECT 1 FROM tweets child WHERE child.in_reply_to_tweet_id = t.id)`);
            } else {
                conditions.push(`t.tweet_type = ?`);
                params.push(type);
            }
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
            // Only hide subsequent tweets in threads (those that are replies to another tweet)
            // Keep thread-starter tweets visible (they have tweet_type='thread' but no in_reply_to)
            conditions.push(`(t.tweet_type != 'thread' OR t.in_reply_to_tweet_id IS NULL)`);
        }

        let joinClause = '';
        let havingClause = '';
        if (tag) {
            // Split comma-separated tags for multi-tag filtering
            const tags = tag.split(',').filter(t => t.trim());
            if (tags.length > 0) {
                const tagPlaceholders = tags.map(() => '?').join(',');
                joinClause = `
                    INNER JOIN tweet_tags tt_filter ON t.id = tt_filter.tweet_id
                    INNER JOIN tags tag_filter ON tag_filter.id = tt_filter.tag_id AND tag_filter.name IN (${tagPlaceholders})
                `;
                // Require tweets to have ALL selected tags (not just one)
                havingClause = `HAVING COUNT(DISTINCT tag_filter.name) = ${tags.length}`;
                // Add tag params at the beginning
                params.unshift(...tags);
            }
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        const validSorts = ['created_at', 'favorite_count', 'retweet_count', 'char_count', 'ai_quality_score'];
        const sortColumn = validSorts.includes(sort) ? sort : 'created_at';
        const sqlSortOrder = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        // Count query needs to handle HAVING for multi-tag AND thread_parent join
        const threadParentJoin = 'LEFT JOIN tweets thread_parent ON t.in_reply_to_tweet_id = thread_parent.id';
        let countQuery;
        if (havingClause) {
            countQuery = `SELECT COUNT(*) as total FROM (
                SELECT t.id FROM tweets t ${threadParentJoin} ${joinClause} ${whereClause} GROUP BY t.id ${havingClause}
            )`;
        } else {
            countQuery = `SELECT COUNT(DISTINCT t.id) as total FROM tweets t ${threadParentJoin} ${joinClause} ${whereClause}`;
        }
        const { total } = db.prepare(countQuery).get(...params);

        // We join thread_parent to identify subsequent thread tweets
        // A subsequent thread tweet has a parent that is also a thread
        const tweetsQuery = `
            SELECT 
                t.*,
                GROUP_CONCAT(DISTINCT tags.name) as tag_names,
                GROUP_CONCAT(DISTINCT tags.category || ':' || tags.name || ':' || COALESCE(tags.color, '#666')) as tag_details,
                quoted.full_text as quoted_text,
                quoted.media_url as quoted_media,
                quoted.id as quoted_id,
                thread_parent.tweet_type as parent_tweet_type
            FROM tweets t
            LEFT JOIN tweets quoted ON t.quoted_tweet_id = quoted.id
            LEFT JOIN tweets thread_parent ON t.in_reply_to_tweet_id = thread_parent.id
            ${joinClause}
            LEFT JOIN tweet_tags tt ON t.id = tt.tweet_id
            LEFT JOIN tags ON tags.id = tt.tag_id
            ${whereClause}
            GROUP BY t.id
            ${havingClause}
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

// ============================================
// Quoted Tweet Fetching
// ============================================

// Get quoted tweet content - first checks DB, then fetches from Twitter
app.get('/api/quoted-tweet/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // First check if it's a self-quote (in tweets table)
        const selfQuote = db.prepare(`
            SELECT id, full_text as content, created_at, media_url
            FROM tweets WHERE id = ?
        `).get(id);

        if (selfQuote) {
            return res.json({
                id: selfQuote.id,
                content: selfQuote.content,
                author_username: 'tyleralterman',
                author_name: 'Tyler Alterman',
                created_at: selfQuote.created_at,
                media_url: selfQuote.media_url,
                is_self: true
            });
        }

        // Check cache
        const cached = db.prepare(`
            SELECT * FROM quoted_tweets WHERE id = ?
        `).get(id);

        if (cached) {
            return res.json({
                id: cached.id,
                content: cached.content,
                author_username: cached.author_username,
                author_name: cached.author_name,
                created_at: cached.created_at,
                is_available: cached.is_available,
                from_cache: true
            });
        }

        // Try to fetch from Twitter using oEmbed or syndication API
        const tweetUrl = `https://twitter.com/i/status/${id}`;

        // Method 1: Try using Twitter's syndication API (no auth required, works for public tweets)
        try {
            const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${Date.now()}`;
            const syndicationRes = await fetch(syndicationUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            if (syndicationRes.ok) {
                const data = await syndicationRes.json();

                if (data && data.text) {
                    // Cache the result
                    db.prepare(`
                        INSERT OR REPLACE INTO quoted_tweets (id, author_name, author_username, content, created_at, is_available)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(
                        id,
                        data.user?.name || 'Unknown',
                        data.user?.screen_name || 'unknown',
                        data.text,
                        data.created_at || null,
                        1
                    );

                    return res.json({
                        id: id,
                        content: data.text,
                        author_username: data.user?.screen_name || 'unknown',
                        author_name: data.user?.name || 'Unknown',
                        created_at: data.created_at,
                        media_url: data.photos?.[0]?.url || data.video?.poster || null,
                        is_available: true
                    });
                }
            }
        } catch (err) {
            console.log('Syndication API failed, trying oEmbed...');
        }

        // Method 2: Try oEmbed API
        try {
            const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
            const oembedRes = await fetch(oembedUrl);

            if (oembedRes.ok) {
                const data = await oembedRes.json();

                // Extract text from HTML (strip tags)
                let content = data.html || '';
                // Remove HTML tags except paragraphs
                content = content.replace(/<blockquote[^>]*>/gi, '');
                content = content.replace(/<\/blockquote>/gi, '');
                content = content.replace(/<p[^>]*>/gi, '');
                content = content.replace(/<\/p>/gi, '\n');
                content = content.replace(/<a[^>]*>([^<]*)<\/a>/gi, '$1');
                content = content.replace(/<[^>]+>/g, '');
                content = content.replace(/&mdash;.*/s, '').trim(); // Remove author attribution

                // Cache the result
                db.prepare(`
                    INSERT OR REPLACE INTO quoted_tweets (id, author_name, author_username, content, is_available)
                    VALUES (?, ?, ?, ?, ?)
                `).run(id, data.author_name || 'Unknown', data.author_url?.split('/').pop() || 'unknown', content, 1);

                return res.json({
                    id: id,
                    content: content,
                    author_username: data.author_url?.split('/').pop() || 'unknown',
                    author_name: data.author_name || 'Unknown',
                    html: data.html,
                    is_available: true
                });
            }
        } catch (err) {
            console.log('oEmbed failed:', err.message);
        }

        // Tweet not available
        db.prepare(`
            INSERT OR REPLACE INTO quoted_tweets (id, is_available)
            VALUES (?, ?)
        `).run(id, 0);

        res.json({
            id: id,
            is_available: false,
            message: 'Tweet may be deleted or private'
        });

    } catch (err) {
        console.error('Error fetching quoted tweet:', err);
        res.status(500).json({ error: err.message });
    }
});

// Batch fetch multiple quoted tweets
app.post('/api/quoted-tweets/batch', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ error: 'ids array required' });
        }

        const results = {};

        for (const id of ids.slice(0, 20)) { // Limit to 20
            // Check self-quote first
            const selfQuote = db.prepare(`
                SELECT id, full_text as content, created_at, media_url
                FROM tweets WHERE id = ?
            `).get(id);

            if (selfQuote) {
                results[id] = {
                    id: selfQuote.id,
                    content: selfQuote.content,
                    author_username: 'tyleralterman',
                    author_name: 'Tyler Alterman',
                    is_self: true,
                    is_available: true
                };
                continue;
            }

            // Check cache
            const cached = db.prepare(`
                SELECT * FROM quoted_tweets WHERE id = ?
            `).get(id);

            if (cached) {
                results[id] = {
                    id: cached.id,
                    content: cached.content,
                    author_username: cached.author_username,
                    author_name: cached.author_name,
                    is_available: cached.is_available
                };
            } else {
                // Mark as needs fetch
                results[id] = { id, needs_fetch: true };
            }
        }

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
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

// Clear all use tag assignments (one-time cleanup endpoint)
app.post('/api/admin/clear-use-tags', (req, res) => {
    try {
        const beforeCount = db.prepare(`
            SELECT COUNT(*) as count FROM tweet_tags 
            WHERE tag_id IN (SELECT id FROM tags WHERE category = 'use')
        `).get();

        const result = db.prepare(`
            DELETE FROM tweet_tags 
            WHERE tag_id IN (SELECT id FROM tags WHERE category = 'use')
        `).run();

        res.json({
            success: true,
            message: `Removed ${result.changes} use tag assignments`,
            beforeCount: beforeCount.count,
            removed: result.changes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Run heuristic auto-tagging (FREE - no AI cost, just keyword matching)
app.post('/api/admin/run-auto-tag', (req, res) => {
    try {
        const { execSync } = require('child_process');
        const autoTagScript = path.join(__dirname, 'scripts/auto_tag_heuristics.js');

        console.log('🏷️ Running heuristic auto-tagging...');
        const output = execSync(`node "${autoTagScript}"`, {
            encoding: 'utf8',
            timeout: 120000 // 2 minute timeout
        });
        console.log('✅ Auto-tagging complete');

        res.json({
            success: true,
            message: 'Auto-tagging complete',
            output: output
        });
    } catch (err) {
        console.error('Auto-tag error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Run LLM-based semantic tagging (costs API $, but much more accurate)
// This is a long-running operation so it runs in the background
let llmTaggingStatus = { running: false, progress: '', startTime: null };

app.post('/api/admin/run-llm-tag', (req, res) => {
    if (llmTaggingStatus.running) {
        return res.json({
            success: false,
            message: 'LLM tagging already in progress',
            status: llmTaggingStatus
        });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(400).json({
            success: false,
            error: 'OPENAI_API_KEY not set. Add it in Render environment variables.'
        });
    }

    // Start LLM tagging in background
    llmTaggingStatus = { running: true, progress: 'Starting...', startTime: Date.now() };

    const { spawn } = require('child_process');
    const llmScript = path.join(__dirname, 'scripts/llm_tagger_openai.js');

    console.log('🤖 Starting LLM-based semantic tagging (background)...');

    const child = spawn('node', [llmScript], {
        env: { ...process.env, OPENAI_API_KEY: apiKey },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        console.log('[LLM-TAG]', msg);
        llmTaggingStatus.progress = msg;
    });

    child.stderr.on('data', (data) => {
        console.error('[LLM-TAG ERROR]', data.toString());
    });

    child.on('close', (code) => {
        const elapsed = ((Date.now() - llmTaggingStatus.startTime) / 1000 / 60).toFixed(1);
        llmTaggingStatus.running = false;
        llmTaggingStatus.progress = code === 0
            ? `✅ Completed in ${elapsed} minutes`
            : `❌ Failed with code ${code}`;
        console.log(`🤖 LLM tagging finished: ${llmTaggingStatus.progress}`);
    });

    res.json({
        success: true,
        message: 'LLM tagging started in background. Check /api/admin/llm-tag-status for progress.',
        estimatedTime: 'About 60-90 minutes for 35k tweets'
    });
});

// Check LLM tagging progress
app.get('/api/admin/llm-tag-status', (req, res) => {
    const elapsed = llmTaggingStatus.startTime
        ? ((Date.now() - llmTaggingStatus.startTime) / 1000 / 60).toFixed(1)
        : 0;

    res.json({
        ...llmTaggingStatus,
        elapsedMinutes: elapsed
    });
});

// Get current database info
app.get('/api/admin/db-info', (req, res) => {
    try {
        const stats = db.prepare('SELECT COUNT(*) as count FROM tweets').get();
        res.json({
            currentPath: DB_PATH,
            persistentDiskExists: fs.existsSync('/data'),
            tweetCount: stats.count
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Migrate database to persistent disk
app.post('/api/admin/migrate-to-persistent', (req, res) => {
    try {
        if (!fs.existsSync('/data')) {
            return res.json({ success: false, message: 'No /data directory - persistent disk not mounted' });
        }

        if (DB_PATH === '/data/tweets.db') {
            return res.json({ success: true, message: 'Already using persistent disk', path: DB_PATH });
        }

        const targetPath = '/data/tweets.db';
        console.log(`📦 Migrating database from ${DB_PATH} to ${targetPath}...`);

        // Close current connection, copy file, and restart will use new location
        db.close();
        fs.copyFileSync(DB_PATH, targetPath);

        res.json({
            success: true,
            message: `Database copied to ${targetPath}. Restart server for change to take effect.`,
            from: DB_PATH,
            to: targetPath
        });
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
// Semantic Search (AI-powered)
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post('/api/semantic-search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        if (!OPENAI_API_KEY) {
            return res.status(503).json({
                error: 'AI search is not configured. Please set OPENAI_API_KEY environment variable.'
            });
        }

        // Get available tags for context
        const tags = db.prepare(`
            SELECT t.name, t.category, COUNT(tt.tweet_id) as count
            FROM tags t
            LEFT JOIN tweet_tags tt ON t.id = tt.tag_id
            GROUP BY t.id
            HAVING count > 0
            ORDER BY count DESC
            LIMIT 50
        `).all();

        const tagList = tags.map(t => `${t.name} (${t.category})`).join(', ');

        const systemPrompt = `You are a SQL query generator for a tweet database. Convert natural language queries to SQLite WHERE clauses.

Available columns:
- full_text (tweet content)
- favorite_count (likes)
- retweet_count
- created_at (ISO date)
- tweet_type (text_only, reply, retweet, quote, media, thread)
- length_category (short, medium, long)
- swipe_status (liked, superliked, disliked, review_later, NULL)

Available tags (can filter via JOIN with tweet_tags): ${tagList}

RULES:
1. Return ONLY a JSON object with: {"where": "SQL WHERE clause", "orderBy": "optional ORDER BY", "tagFilter": "optional tag name"}
2. For SPECIFIC TOPIC queries (e.g. "effective altruism", "bitcoin", "meditation"), ALWAYS use full_text LIKE patterns, not tagFilter
3. Only use tagFilter if the query mentions a GENERAL category that matches an available tag name exactly
4. For emotional/sentiment queries, use LIKE patterns on full_text with multiple keywords
5. For engagement queries, use favorite_count or retweet_count
6. Keep it simple - SQLite compatible only
7. Use lower() for case-insensitive matching

Examples:
- "tweets about effective altruism" -> {"where": "lower(full_text) LIKE '%effective altruism%' OR lower(full_text) LIKE '%ea community%' OR lower(full_text) LIKE '%longtermism%'", "orderBy": "favorite_count DESC"}
- "tweets where I seem excited" -> {"where": "full_text LIKE '%!%' AND (lower(full_text) LIKE '%amazing%' OR lower(full_text) LIKE '%love%' OR lower(full_text) LIKE '%excited%')", "orderBy": "favorite_count DESC"}
- "spiritual tweets about Trump" -> {"where": "lower(full_text) LIKE '%trump%' AND lower(full_text) LIKE '%spirit%'", "orderBy": "favorite_count DESC"}
- "my most popular philosophy tweets" -> {"tagFilter": "philosophy", "orderBy": "favorite_count DESC"}`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: query }
                ],
                temperature: 0.3,
                max_tokens: 500,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('OpenAI error:', error);
            return res.status(500).json({ error: 'Failed to process query' });
        }

        const data = await response.json();
        const parsed = JSON.parse(data.choices[0].message.content);

        // Build and execute the query
        let conditions = [];
        let params = [];
        let joinClause = '';

        if (parsed.where) {
            conditions.push(`(${parsed.where})`);
        }

        if (parsed.tagFilter) {
            joinClause = `JOIN tweet_tags tt ON t.id = tt.tweet_id JOIN tags tg ON tt.tag_id = tg.id`;
            conditions.push(`lower(tg.name) = ?`);
            params.push(parsed.tagFilter.toLowerCase());
        }

        // Exclude retweets and replies by default
        conditions.push(`t.tweet_type NOT IN ('retweet', 'reply')`);

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderBy = parsed.orderBy || 't.created_at DESC';

        const sql = `
            SELECT DISTINCT t.id, t.full_text, t.created_at, t.favorite_count, t.retweet_count,
                   t.tweet_type, t.length_category, t.swipe_status, t.tweet_url
            FROM tweets t
            ${joinClause}
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT 50
        `;

        const tweets = db.prepare(sql).all(...params);

        // Get tags for each tweet
        const tweetIds = tweets.map(t => t.id);
        if (tweetIds.length > 0) {
            const tagStmt = db.prepare(`
                SELECT tt.tweet_id, tg.name, tg.category
                FROM tweet_tags tt
                JOIN tags tg ON tt.tag_id = tg.id
                WHERE tt.tweet_id IN (${tweetIds.map(() => '?').join(',')})
            `);
            const allTags = tagStmt.all(...tweetIds);

            const tagMap = {};
            allTags.forEach(t => {
                if (!tagMap[t.tweet_id]) tagMap[t.tweet_id] = [];
                tagMap[t.tweet_id].push({ name: t.name, category: t.category });
            });

            tweets.forEach(tweet => {
                tweet.tags = tagMap[tweet.id] || [];
            });
        }

        res.json({
            query: query,
            interpreted: parsed,
            count: tweets.length,
            tweets: tweets
        });

    } catch (err) {
        console.error('Semantic search error:', err);
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
