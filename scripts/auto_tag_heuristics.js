/**
 * Auto-Tagging Heuristics Script (Round 6 Overhaul)
 * Uses Token-Based Scoring System for precision.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/tweets.db');
const db = new Database(DB_PATH);

// ==========================================
// Configuration
// ==========================================

const ENGAGEMENT_HIGH = 24; // p90
const ENGAGEMENT_MID = 5;   // p50

// Scoring: 
// - match strict: +3 points
// - match broad: +1 point
// - threshold: > 0 points required to tag
const SCORE_THRESHOLD = 1;

const DEFINITIONS = {
    'Awe': {
        strict: ['sublime', 'transcendent', 'majestic', 'breathtaking', 'marvel', 'divine', 'sacred', 'numinous', 'epiphany'],
        broad: ['awe', 'wonder', 'beauty', 'stunning', 'incredible', 'magic', 'soul', 'god', 'spirit'],
        negative: ['awful', 'awesome job', 'thanks']
    },
    'Strategy': {
        strict: ['moat', 'flywheel', 'network effect', 'game theory', 'incentive structure', 'roadmap', 'strategic', 'go-to-market', 'business model'],
        broad: ['strategy', 'leverage', 'tactic', 'execution', 'vision', 'planning', 'competition', 'market', 'scale', 'growth'],
        negative: []
    },
    'Community': {
        strict: ['social capital', 'third place', 'communitas', 'dunbar', 'girl gang', 'squad'],
        broad: ['community', 'tribe', 'gathering', 'belonging', 'friendship', 'hosting', 'dinner', 'party', 'social', 'group', 'people', 'connection'],
        negative: ['community manager', 'community notes']
    },
    'Design': {
        strict: ['ui/ux', 'typography', 'typeface', 'kerning', 'affordance', 'skeuomorphic', 'figma', 'css', 'usability'],
        broad: ['design', 'interface', 'aesthetic', 'visual', 'style', 'layout', 'font', 'color', 'pixel', 'creative', 'art', 'beauty'],
        negative: ['designated', 'designing my life']
    },
    'Art': {
        strict: ['painting', 'sculpture', 'museum', 'gallery', 'masterpiece', 'canvas', 'exhibition', 'curator', 'art history'],
        broad: ['art', 'artist', 'creative', 'expression', 'drawing', 'sketch', 'illustration', 'create'],
        negative: ['art of war', 'state of the art']
    },
    'Aesthetics': {
        strict: ['moodboard', 'interior design', 'palette', 'atmospheric', 'cinematic', 'composition'],
        broad: ['aesthetic', 'vibe', 'mood', 'atmosphere', 'beauty', 'style', 'elegant', 'taste', 'curation', 'look'],
        negative: []
    },
    'Theory': {
        strict: ['epistemology', 'ontology', 'metaphysics', 'dialectics', 'phenomenology', 'axiom', 'first principles'],
        broad: ['theory', 'theoretical', 'hypothesis', 'framework', 'model', 'concept', 'analysis', 'thesis', 'principle', 'idea', 'system'],
        negative: ['conspiracy theory', 'in theory']
    },
    'Philosophy': {
        strict: ['stoicism', 'existentialism', 'nihilism', 'virtue ethics', 'categorical imperative', 'utilitarian', 'nietzsche'],
        broad: ['philosophy', 'stoic', 'ethics', 'virtue', 'meaning', 'consciousness', 'existential', 'mental model', 'wisdom', 'truth', 'life'],
        negative: []
    },
    'Tech': {
        strict: ['llm', 'generative ai', 'crypto', 'blockchain', 'saas', 'api', 'full stack', 'algorithm', 'neural net'],
        broad: ['tech', 'software', 'code', 'startup', 'engineering', 'product', 'developer', 'app', 'digital', 'internet', 'web'],
        negative: []
    },
    'Sociology': {
        strict: ['mimetic', 'signaling', 'status game', 'social dynamics', 'normie', 'egregore', 'girard'],
        broad: ['sociology', 'culture', 'status', 'norm', 'hierarchy', 'group', 'social', 'society', 'human', 'behavior'],
        negative: []
    },
    'Psychology': {
        strict: ['cognitive bias', 'trauma', 'neuroplasticity', 'dopamine', 'frontal cortex', 'attachment theory'],
        broad: ['psychology', 'mindset', 'healing', 'habits', 'flow', 'ego', 'subconscious', 'mental health', 'therapy', 'brain', 'mind'],
        negative: []
    },
    'Writing': {
        strict: ['copywriting', 'storytelling arc', 'narrative structure', 'prose', 'publishing', 'substack'],
        broad: ['writing', 'writer', 'blog', 'newsletter', 'author', 'essay', 'word', 'write', 'story'],
        negative: ['writing code']
    },
    // Missing Topics Restored
    'History': {
        strict: ['ancient rome', 'medieval', 'civil war', 'renaissance', 'industrial revolution', 'empire', 'archaeology', 'historian'],
        broad: ['history', 'historical', 'past', 'century', 'decade', 'era', 'ancient', 'modernity', 'tradition'],
        negative: []
    },
    'Science': {
        strict: ['physics', 'chemistry', 'biology', 'quantum', 'relativity', 'evolution', 'neuroscience', 'astronomy', 'scientific method'],
        broad: ['science', 'scientific', 'research', 'experiment', 'study', 'lab', 'evidence', 'data', 'nature'],
        negative: []
    },
    'Politics': {
        strict: ['democracy', 'republican', 'democrat', 'liberal', 'conservative', 'policy', 'legislation', 'election', 'voting', 'geopolitics'],
        broad: ['politics', 'political', 'government', 'state', 'power', 'law', 'regulation', 'campaign'],
        negative: []
    },
    'Economics': {
        strict: ['inflation', 'gdp', 'macroeconomics', 'microeconomics', 'supply and demand', 'monetary policy', 'fiscal', 'central bank'],
        broad: ['economics', 'economy', 'market', 'money', 'finance', 'capital', 'trade', 'price', 'cost'],
        negative: []
    },
    'Education': {
        strict: ['pedagogy', 'curriculum', 'university', 'college', 'schooling', 'literacy', 'student loan', 'academia'],
        broad: ['education', 'school', 'learn', 'teach', 'student', 'teacher', 'class', 'course', 'degree'],
        negative: []
    },
    'Health': {
        strict: ['nutrition', 'exercise', 'circadian rhythm', 'metabolism', 'longevity', 'supplement', 'biohacking', 'gym'],
        broad: ['health', 'fitness', 'diet', 'body', 'workout', 'sleep', 'wellness', 'medical', 'doctor'],
        negative: []
    },
    'Productivity': {
        strict: ['time blocking', 'deep work', 'notion', 'obsidian', 'workflow', 'pomodoro', 'getting things done'],
        broad: ['productivity', 'productive', 'focus', 'habit', 'goal', 'work', 'efficiency', 'schedule', 'task'],
        negative: []
    },
    'Spirituality': {
        strict: ['meditation', 'mindfulness', 'buddhism', 'christianity', 'mysticism', 'soul', 'prayer', 'contemplation'],
        broad: ['spiritual', 'faith', 'believe', 'god', 'sacred', 'ritual', 'practice', 'inner'],
        negative: []
    },
    'Romance': {
        strict: ['dating market', 'marriage', 'courtship', 'breakup', 'divorce', 'monogamy', 'polyamory'],
        broad: ['romance', 'love', 'date', 'relationship', 'partner', 'spouse', 'couple', 'intimacy'],
        negative: []
    },
    'Life Hacks': {
        strict: ['life hack', 'shortcut', 'cheat code', 'optimization', 'tip for', 'trick to'],
        broad: ['hack', 'tip', 'trick', 'advice', 'optimize', 'improve'],
        negative: []
    },
    // Previously missing topics - now added
    'Career': {
        strict: ['job interview', 'resume', 'linkedin', 'promotion', 'salary negotiation', 'career path', 'job search', 'hiring manager'],
        broad: ['career', 'job', 'profession', 'work', 'employer', 'employee', 'office', 'corporate', 'boss', 'coworker'],
        negative: []
    },
    'Creativity': {
        strict: ['creative process', 'brainstorm', 'ideation', 'muse', 'artistic vision', 'creative block'],
        broad: ['creativity', 'creative', 'create', 'imagination', 'inspiration', 'innovate', 'invent', 'original', 'novel'],
        negative: []
    },
    'Culture': {
        strict: ['cultural moment', 'zeitgeist', 'cultural shift', 'pop culture', 'subculture', 'counterculture', 'cultural capital'],
        broad: ['culture', 'cultural', 'mainstream', 'trend', 'generation', 'millennial', 'gen z', 'boomer', 'society'],
        negative: []
    },
    'Depression': {
        strict: ['depression', 'depressed', 'suicidal', 'antidepressant', 'ssri', 'mental illness', 'bipolar'],
        broad: ['sad', 'sadness', 'hopeless', 'despair', 'lonely', 'loneliness', 'emptiness', 'numb', 'struggle'],
        negative: []
    },
    'Entities': {
        strict: ['egregore', 'thoughtform', 'tulpa', 'collective consciousness', 'archetype', 'daemon', 'spirit', 'entity'],
        broad: ['entities', 'entity', 'being', 'presence', 'force', 'spirit', 'ghost', 'demon', 'angel'],
        negative: ['legal entity', 'corporate entity']
    },
    'Friendship': {
        strict: ['best friend', 'bff', 'friendship group', 'found family', 'chosen family', 'friend group'],
        broad: ['friend', 'friendship', 'friends', 'buddy', 'pal', 'companion', 'platonic', 'hangout'],
        negative: []
    },
    'Life-Hacks': {
        strict: ['life hack', 'shortcut', 'cheat code', 'optimization', 'tip for', 'trick to', 'pro tip'],
        broad: ['hack', 'tip', 'trick', 'advice', 'optimize', 'improve', 'efficient', 'easier'],
        negative: []
    },
    'Media-Commentary': {
        strict: ['media literacy', 'news cycle', 'mainstream media', 'journalism', 'clickbait', 'cable news'],
        broad: ['media', 'news', 'journalist', 'headline', 'coverage', 'narrative', 'press', 'outlet'],
        negative: ['social media']
    },
    'NYC': {
        strict: ['new york city', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten island', 'subway', 'nyc'],
        broad: ['ny', 'new york', 'east coast', 'downtown', 'uptown', 'williamsburg', 'soho', 'tribeca'],
        negative: []
    },
    'Performing-Arts': {
        strict: ['theater', 'theatre', 'broadway', 'ballet', 'opera', 'dance performance', 'improv', 'standup', 'circus'],
        broad: ['performance', 'performer', 'stage', 'act', 'acting', 'drama', 'play', 'show', 'audience'],
        negative: ['performance review', 'job performance']
    },
    'Psychospiritual-Practices': {
        strict: ['breathwork', 'psychedelic', 'ayahuasca', 'psilocybin', 'meditation retreat', 'vision quest', 'shamanic', 'plant medicine'],
        broad: ['practice', 'ritual', 'ceremony', 'healing', 'journey', 'integration', 'microdose', 'trip'],
        negative: []
    },
    'Psychospiritual-Theory': {
        strict: ['non-dual', 'kundalini', 'chakra', 'shadow work', 'ego dissolution', 'transpersonal', 'integral theory', 'spiral dynamics'],
        broad: ['awakening', 'enlightenment', 'consciousness', 'awareness', 'transcendence', 'self-realization', 'liberation'],
        negative: []
    },
    'Religion': {
        strict: ['christianity', 'islam', 'buddhism', 'hinduism', 'judaism', 'catholic', 'protestant', 'orthodox', 'church', 'mosque', 'temple', 'synagogue'],
        broad: ['religion', 'religious', 'god', 'faith', 'prayer', 'worship', 'scripture', 'bible', 'jesus', 'christ', 'allah'],
        negative: []
    },
    'Technology': {
        strict: ['artificial intelligence', 'machine learning', 'quantum computing', 'virtual reality', 'augmented reality', 'robotics', 'iot'],
        broad: ['technology', 'tech', 'digital', 'software', 'hardware', 'computer', 'device', 'innovation', 'future'],
        negative: []
    },
    'Woo-Wizardry': {
        strict: ['astrology', 'tarot', 'manifestation', 'law of attraction', 'oracle', 'divination', 'numerology', 'crystal', 'energy healing'],
        broad: ['woo', 'magic', 'magical', 'mystical', 'esoteric', 'occult', 'witchy', 'spell', 'moon', 'zodiac', 'mercury retrograde'],
        negative: []
    }
};

// Patterns Logic (Restored)
const PATTERNS = {
    'Thread': [/^\d+\/\s/, /^\d+\/\d+/, /🧵/, /thread/i, /below 👇/],
    'Question': [/\?$/, /^what/i, /^why/i, /^how/i, /anyone else/i],
    'List': [/^\d+\./m, /^[-•]/m, /top \d+/i, /reasons why/i],
    'Rant': [/fuck/i, /shit/i, /hate/i, /stop/i, /tired of/i, /annoying/i],
    'Joke': [/lol/i, /lmao/i, /funny/i, /meme/i, /satire/i],
    'Story': [/^i was/i, /^when i/i, /^years ago/i, /story time/i, /happened to me/i],
    'Insight': [/realization/i, /epiphany/i, /learned/i, /understand/i, /truth is/i],
    'Observation': [/noticed/i, /seems like/i, /trend/i, /people are/i, /interesting that/i],
    'Framework': [/framework/i, /model/i, /pyramid/i, /quadrant/i, /mental model/i],
    'Definition': [/means that/i, /defined as/i, /definition/i, /is simply/i],
    'Promotion': [/check out/i, /link in bio/i, /sign up/i, /buy/i, /course/i, /pre-order/i],
    'Announcement': [/announcing/i, /excited to/i, /launching/i, /live now/i],
    // Previously missing patterns - now added
    'Hot-Take': [/hot take/i, /unpopular opinion/i, /controversial/i, /actually,?\s+/i, /people will hate me for this/i, /i don't care what anyone says/i],
    'Engagement-Bait': [/drop a/i, /comment below/i, /tag someone/i, /retweet if/i, /like if you/i, /who else/i, /ratio/i, /boost this/i],
    'Dated-Reference': [/\b(2008|2009|2010|2011|2012|2013|2014|2015|2016|2017|2018|2019|2020|2021|2022)\b/, /years ago/i, /back in/i, /remember when/i, /throwback/i],
    'Prediction': [/i predict/i, /prediction:/i, /my prediction/i, /will happen/i, /gonna happen/i, /in \d+ years/i, /by 2\d{3}/i, /mark my words/i, /calling it now/i]
};

// New "Use" Tag Category
const USE_TAGS = ['book', 'blog-post', 'short-post'];

// ==========================================
// Helpers
// ==========================================

function normalize(text) {
    if (!text) return '';
    return text.toLowerCase()
        // Remove URLs
        .replace(/https?:\/\/\S+/g, '')
        // Remove punctuation
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
        // Extra spaces
        .replace(/\s{2,}/g, ' ');
}

function calculateScore(text, def) {
    const normalized = normalize(text);

    // Check negatives first
    for (const neg of def.negative) {
        if (normalized.includes(neg)) return -100;
    }

    let score = 0;

    // Strict matches (Whole words preferably, but simple includes for now with high weight)
    for (const word of def.strict) {
        if (normalized.includes(word)) score += 3;
    }

    // Broad matches
    for (const word of def.broad) {
        // Basic "includes" can be noisy for short words like "art" or "ui".
        // Regex word boundary check is better
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(normalized)) score += 1;
    }

    return score;
}

// ==========================================
// Main Execution
// ==========================================

function run() {
    console.log('🧪 Starting Round 8 Update (Use Tags + Quality Logic Removal)...');

    // 1. Wipe existing AI tags
    console.log('🧹 Clearing old AI tags...');
    db.prepare("DELETE FROM tweet_tags WHERE source = 'ai' OR source = 'auto'").run();

    const tweets = db.prepare("SELECT * FROM tweets").all();
    console.log(`📊 Processing ${tweets.length} tweets...`);

    const insertTag = db.prepare("INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)");
    const linkTag = db.prepare("INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id, source) VALUES (?, ?, 'ai')");
    const getTagId = db.prepare("SELECT id FROM tags WHERE name = ?");

    // Ensure tags exist (Topics)
    Object.keys(DEFINITIONS).forEach(t => insertTag.run(t.toLowerCase(), 'topic'));
    // Ensure tags exist (Patterns)
    Object.keys(PATTERNS).forEach(p => insertTag.run(p.toLowerCase(), 'pattern'));
    // Ensure tags exist (Use)
    USE_TAGS.forEach(u => insertTag.run(u, 'use'));

    let countTags = 0;

    db.transaction(() => {
        for (const tweet of tweets) {
            // Semantic Tags (Topics)
            for (const [topic, def] of Object.entries(DEFINITIONS)) {
                if (calculateScore(tweet.full_text, def) >= SCORE_THRESHOLD) {
                    const tagIdObj = getTagId.get(topic.toLowerCase());
                    if (tagIdObj) {
                        linkTag.run(tweet.id, tagIdObj.id);
                        countTags++;
                    }
                }
            }

            // Pattern Tags
            for (const [pattern, regexes] of Object.entries(PATTERNS)) {
                const isMatch = regexes.some(r => r.test(tweet.full_text));
                if (isMatch) {
                    const tagIdObj = getTagId.get(pattern.toLowerCase());
                    if (tagIdObj) {
                        linkTag.run(tweet.id, tagIdObj.id);
                        countTags++;
                    }
                }
            }
        }
    })();

    console.log(`✅ Done!`);
    console.log(`Added ${countTags} new semantic/pattern tags.`);
    console.log(`'Use' tags (book, blog-post, short-post) added to DB.`);
}

run();
