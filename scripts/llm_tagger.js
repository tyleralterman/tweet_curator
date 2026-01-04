/**
 * LLM-Based Semantic Tagging Script (Gemini)
 * Analyzes tweets using AI to assign accurate tags based on meaning
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('❌ Please set GEMINI_API_KEY environment variable');
    process.exit(1);
}
const BATCH_SIZE = 20; // Tweets per API call
const DELAY_MS = 2000; // Delay between batches to avoid rate limits

// Database
const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

// Tag definitions for the LLM
const TAG_DEFINITIONS = `
TOPIC TAGS (pick 0-3 that fit):
- art: Visual arts, paintings, sculpture, museums, galleries, art history
- aesthetics: Beauty, style, vibes, moodboards, taste, visual curation
- romance: Dating, relationships, love, marriage, breakups, attraction
- friendship: Friends, platonic bonds, social circles, companionship
- religion: Christianity, Islam, Buddhism, faith traditions, churches, theology
- spirituality: Meditation, mindfulness, soul, inner life, contemplation
- nyc: New York City, Manhattan, Brooklyn, subway, NYC life
- psychospiritual-practices: Breathwork, psychedelics, plant medicine, ceremonies
- psychospiritual-theory: Consciousness, awakening, non-dual, transpersonal
- media-commentary: Journalism, news, media criticism, mainstream media
- life-hacks: Tips, tricks, shortcuts, optimization, productivity hacks
- technology: AI, software, apps, digital tools, tech industry
- performing-arts: Theater, dance, improv, standup, live performance
- community: Groups, gatherings, belonging, social dynamics, tribes
- woo-wizardry: Astrology, tarot, manifestation, crystals, occult
- philosophy: Ethics, meaning, consciousness, wisdom traditions
- psychology: Mental health, therapy, habits, mindset, behavior
- politics: Government, elections, policy, political ideology
- culture: Zeitgeist, generational trends, pop culture, social norms
- productivity: Focus, habits, workflow, time management, getting things done
- creativity: Creative process, imagination, innovation, artistic expression
- health: Fitness, nutrition, sleep, longevity, wellness
- career: Jobs, work, professional growth, salary, office life
- education: Learning, schools, teaching, academia
- science: Physics, biology, research, scientific method
- economics: Money, markets, finance, economic theory
- depression: Mental illness, sadness, struggle, despair
- strategy: Business strategy, game theory, planning, competition
- sociology: Social dynamics, status, signaling, group behavior
- entities: Egregores, archetypes, thoughtforms, collective consciousness
- history: Historical events, eras, ancient history, modernity
- writing: Prose, essays, blogging, newsletters, storytelling
- design: UI/UX, typography, visual design, interfaces
- awe: Wonder, transcendence, sublime, breathtaking moments

PATTERN TAGS (pick 0-2 that fit):
- hot-take: Controversial opinion, unpopular stance, provocative claim
- theory: Explaining a framework or model, systematic thinking
- observation: Noticing a pattern, trend, or phenomenon
- question: Asking something, seeking answers
- advice: Giving recommendations, how-to guidance
- story: Personal narrative, anecdote, experience
- joke: Humor, satire, comedy, memes
- rant: Venting, frustration, strong emotional criticism
- insight: Revelation, realization, wisdom nugget
- thread: Multi-part connected tweets
- list: Numbered or bulleted items
- framework: Mental model, system, structured approach
- definition: Explaining what something means
- prediction: Forecasting future events
- engagement-bait: Asking for likes/RTs, "who else" prompts
- dated-reference: References specific past dates/events
- promotion: Selling something, self-promotion
- announcement: Sharing news, launching something

NOTE: DO NOT assign any "use" tags - those are for manual assignment only.
`;

const SYSTEM_PROMPT = `You are a semantic tweet analyzer. Given a batch of tweets, analyze each one and assign relevant tags based on the actual MEANING and CONTEXT of the tweet, not just keyword matching.

${TAG_DEFINITIONS}

IMPORTANT RULES:
1. Read the FULL tweet and understand its meaning before tagging
2. Don't tag "romance" just because it says "beautiful" - understand context
3. A tweet can have multiple topic tags if it genuinely spans topics
4. Be conservative - only tag what truly fits
5. Consider the author's intent and the tweet's main message

Respond in JSON format:
{
  "results": [
    {"id": "tweet_id", "topics": ["tag1", "tag2"], "patterns": ["tag1"]},
    ...
  ]
}

Only include tags that genuinely fit.`;

// ==========================================
// Gemini API Call
// ==========================================

async function callGemini(tweets) {
    const tweetText = tweets.map(t => `[ID: ${t.id}]\n${t.full_text}`).join('\n\n---\n\n');

    const requestBody = {
        contents: [{
            parts: [{
                text: `Analyze these ${tweets.length} tweets and assign tags:\n\n${tweetText}`
            }]
        }],
        systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
        },
        generationConfig: {
            temperature: 0.3,
            topP: 0.8,
            maxOutputTokens: 4096,
            responseMimeType: "application/json"
        }
    };

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw new Error('Empty response from Gemini');
    }

    return JSON.parse(text);
}

// ==========================================
// Database Operations
// ==========================================

function ensureTagsExist(tagNames, category) {
    const insert = db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)');
    tagNames.forEach(name => insert.run(name.toLowerCase(), category));
}

function applyTags(tweetId, tags, category) {
    const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTag = db.prepare("INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, 'ai')");

    tags.forEach(tagName => {
        const tag = getTagId.get(tagName.toLowerCase());
        if (tag) {
            linkTag.run(tweetId, tag.id);
        }
    });
}

// ==========================================
// Main Processing
// ==========================================

async function processAllTweets() {
    console.log('🤖 Starting LLM-based semantic tagging...\n');

    // Clear old AI tags
    console.log('🧹 Clearing previous AI tags...');
    db.prepare("DELETE FROM tweet_tags WHERE source = 'ai'").run();

    // Get all tweets
    const tweets = db.prepare(`
        SELECT id, full_text 
        FROM tweets 
        WHERE tweet_type NOT IN ('retweet', 'reply')
        ORDER BY favorite_count DESC
    `).all();

    console.log(`📊 Processing ${tweets.length} tweets in batches of ${BATCH_SIZE}...\n`);

    let processed = 0;
    let errors = 0;

    // Process in batches
    for (let i = 0; i < tweets.length; i += BATCH_SIZE) {
        const batch = tweets.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(tweets.length / BATCH_SIZE);

        process.stdout.write(`\r⏳ Batch ${batchNum}/${totalBatches} (${processed}/${tweets.length} tweets)...`);

        try {
            const result = await callGemini(batch);

            // Apply tags from results
            db.transaction(() => {
                for (const item of result.results || []) {
                    if (item.topics?.length) {
                        ensureTagsExist(item.topics, 'topic');
                        applyTags(item.id, item.topics, 'topic');
                    }
                    if (item.patterns?.length) {
                        ensureTagsExist(item.patterns, 'pattern');
                        applyTags(item.id, item.patterns, 'pattern');
                    }
                    // USE TAGS REMOVED - now manual-only
                    processed++;
                }
            })();

        } catch (err) {
            console.error(`\n❌ Error in batch ${batchNum}: ${err.message}`);
            errors++;
            // Continue with next batch
        }

        // Rate limiting delay
        if (i + BATCH_SIZE < tweets.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    console.log(`\n\n✅ Done! Processed ${processed} tweets with ${errors} batch errors.`);

    // Show tag counts
    const counts = db.prepare(`
        SELECT t.name, t.category, COUNT(tt.tweet_id) as count
        FROM tags t
        LEFT JOIN tweet_tags tt ON t.id = tt.tag_id
        WHERE tt.source = 'ai'
        GROUP BY t.id
        ORDER BY count DESC
        LIMIT 20
    `).all();

    console.log('\n📊 Top 20 tags assigned:');
    counts.forEach(t => console.log(`   ${t.category.padEnd(8)} ${t.name.padEnd(25)} ${t.count}`));
}

// Run
processAllTweets().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
