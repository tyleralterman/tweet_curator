/**
 * Tag New Tweets Script (OpenAI)
 * Tags only tweets that don't have any AI tags yet
 */

const Database = require('better-sqlite3');
const path = require('path');

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.error('❌ Please set OPENAI_API_KEY environment variable');
    process.exit(1);
}
const BATCH_SIZE = 25;
const DELAY_MS = 500;
const MAX_RETRIES = 3;

// Database
const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

const SYSTEM_PROMPT = `You are a semantic tweet analyzer. Analyze each tweet and assign relevant tags based on the actual MEANING and CONTEXT, not just keywords.

TOPIC TAGS (pick 0-3 that genuinely fit):
art, aesthetics, romance, friendship, religion, spirituality, nyc, psychospiritual-practices, psychospiritual-theory, media-commentary, life-hacks, technology, performing-arts, community, woo-wizardry, philosophy, psychology, politics, culture, productivity, creativity, health, career, education, science, economics, depression, strategy, sociology, entities, history, writing, design, awe

PATTERN TAGS (pick 0-2 that fit):
hot-take, theory, observation, question, advice, story, joke, rant, insight, thread, list, framework, definition, prediction, engagement-bait, dated-reference, promotion, announcement

NOTE: DO NOT assign any "use" tags - those are for manual assignment only.

RULES:
1. Analyze the FULL meaning, not keywords
2. Be conservative - only tag what truly fits
3. Consider intent and main message

Respond ONLY with valid JSON array:
[{"id":"tweet_id","topics":["tag1"],"patterns":["tag1"]},...]`;

async function callOpenAI(tweets, retries = 0) {
    const tweetText = tweets.map(t => `[${t.id}] ${t.full_text.substring(0, 500)}`).join('\n---\n');

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Analyze these ${tweets.length} tweets:\n\n${tweetText}` }
                ],
                temperature: 0.3,
                max_tokens: 4096,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            if (response.status === 429 && retries < MAX_RETRIES) {
                console.log(`\n⏸️  Rate limited, waiting 30s...`);
                await new Promise(r => setTimeout(r, 30000));
                return callOpenAI(tweets, retries + 1);
            }
            throw new Error(`OpenAI API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) throw new Error('Empty response from OpenAI');

        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : (parsed.results || parsed.tweets || []);
    } catch (err) {
        if (retries < MAX_RETRIES) {
            console.log(`\n⚠️  Error, retrying (${retries + 1}/${MAX_RETRIES})...`);
            await new Promise(r => setTimeout(r, 2000));
            return callOpenAI(tweets, retries + 1);
        }
        throw err;
    }
}

function ensureTagsExist(tagNames, category) {
    const insert = db.prepare('INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)');
    tagNames.forEach(name => {
        if (name && typeof name === 'string') {
            insert.run(name.toLowerCase().trim(), category);
        }
    });
}

function applyTags(tweetId, tags, category) {
    const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTag = db.prepare("INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, 'ai')");

    if (!Array.isArray(tags)) return;

    tags.forEach(tagName => {
        if (tagName && typeof tagName === 'string') {
            const tag = getTagId.get(tagName.toLowerCase().trim());
            if (tag) {
                linkTag.run(tweetId, tag.id);
            }
        }
    });
}

async function tagNewTweets() {
    console.log('🏷️  Finding untagged tweets...\n');

    // Find tweets that have NO AI-generated tags
    const untaggedTweets = db.prepare(`
        SELECT t.id, t.full_text 
        FROM tweets t
        WHERE t.tweet_type NOT IN ('retweet', 'reply')
        AND NOT EXISTS (
            SELECT 1 FROM tweet_tags tt 
            WHERE tt.tweet_id = t.id AND tt.source = 'ai'
        )
        ORDER BY t.created_at DESC
    `).all();

    if (untaggedTweets.length === 0) {
        console.log('✅ All tweets are already tagged!');
        return 0;
    }

    console.log(`📊 Found ${untaggedTweets.length} untagged tweets. Processing...\n`);

    let processed = 0;
    let errors = 0;
    const startTime = Date.now();

    for (let i = 0; i < untaggedTweets.length; i += BATCH_SIZE) {
        const batch = untaggedTweets.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(untaggedTweets.length / BATCH_SIZE);

        process.stdout.write(`\r⏳ Batch ${batchNum}/${totalBatches} | ${processed}/${untaggedTweets.length} tweets`);

        try {
            const results = await callOpenAI(batch);

            db.transaction(() => {
                for (const item of results) {
                    if (!item || !item.id) continue;

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
        }

        if (i + BATCH_SIZE < untaggedTweets.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n\n✅ Tagged ${processed} new tweets in ${totalTime} minutes.`);

    return processed;
}

// Export for use by import script
module.exports = { tagNewTweets };

// Run if called directly
if (require.main === module) {
    tagNewTweets().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
