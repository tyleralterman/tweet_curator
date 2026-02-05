#!/usr/bin/env node
/**
 * Prepare Blog Content for Substack
 * 
 * Processes all tweets tagged with blog-post, blog-candidate, or blog-ready:
 * - Expands abbreviations (ppl → people, rn → right now, etc.)
 * - Ensures paragraphs end with proper punctuation
 * - Fixes common spelling/grammar issues
 * - Removes thread numbering artifacts
 * - Stores cleaned text in blog_text column
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

// ============================================
// ABBREVIATION EXPANSIONS (Extended List)
// ============================================
const ABBREVIATIONS = {
    // Common Twitter abbreviations
    'ppl': 'people',
    'rn': 'right now',
    'bc': 'because',
    'b/c': 'because',
    'w/': 'with',
    'w/o': 'without',
    'w/in': 'within',
    'thru': 'through',
    'tho': 'though',
    'altho': 'although',
    'tbh': 'to be honest',
    'imo': 'in my opinion',
    'imho': 'in my humble opinion',
    'idk': "I don't know",
    'idek': "I don't even know",
    'iirc': 'if I recall correctly',
    'afaik': 'as far as I know',
    'fwiw': 'for what it\'s worth',
    'btw': 'by the way',
    'atm': 'at the moment',
    'obv': 'obviously',
    'obvs': 'obviously',
    'prob': 'probably',
    'probs': 'probably',
    'def': 'definitely',
    'esp': 'especially',
    'govt': 'government',
    'gov': 'government',
    'govt.': 'government',
    'yr': 'year',
    'yrs': 'years',
    'mo': 'month',
    'mos': 'months',
    'min': 'minute',
    'mins': 'minutes',
    'hr': 'hour',
    'hrs': 'hours',
    'sec': 'second',
    'secs': 'seconds',
    'smth': 'something',
    'sth': 'something',
    'sb': 'somebody',
    'smb': 'somebody',
    'abt': 'about',
    // 'v': 'very', // REMOVED - too dangerous, matches 'v' in I've, you've, etc.
    'rly': 'really',
    'rlly': 'really',
    'obvi': 'obviously',
    'convo': 'conversation',
    'convos': 'conversations',
    'diff': 'different',
    'info': 'information',
    'msg': 'message',
    'msgs': 'messages',
    'pic': 'picture',
    'pics': 'pictures',
    'vid': 'video',
    'vids': 'videos',
    'fav': 'favorite',
    'favs': 'favorites',
    'ref': 'reference',
    'refs': 'references',
    'approx': 'approximately',
    'avg': 'average',
    'etc': 'etc.',
    'eg': 'e.g.',
    'e.g': 'e.g.',
    'ie': 'i.e.',
    'i.e': 'i.e.',
    'vs': 'versus',
    'v.': 'versus',
    'vs.': 'versus',
    // Contractions that need apostrophes
    'dont': "don't",
    'doesnt': "doesn't",
    'didnt': "didn't",
    'cant': "can't",
    'couldnt': "couldn't",
    'wouldnt': "wouldn't",
    'shouldnt': "shouldn't",
    'wont': "won't",
    'wasnt': "wasn't",
    'werent': "weren't",
    'isnt': "isn't",
    'arent': "aren't",
    'hasnt': "hasn't",
    'havent': "haven't",
    'hadnt': "hadn't",
    'thats': "that's",
    'whats': "what's",
    'heres': "here's",
    'theres': "there's",
    'wheres': "where's",
    'whos': "who's",
    'youre': "you're",
    'theyre': "they're",
    'were': "we're", // Only at word boundary
    'ive': "I've",
    'youve': "you've",
    'weve': "we've",
    'theyve': "they've",
    'ill': "I'll",
    'youll': "you'll",
    'well': "we'll",
    'theyll': "they'll",
    'itll': "it'll",
    'id': "I'd",
    'youd': "you'd",
    'wed': "we'd",
    'theyd': "they'd",
    'hed': "he'd",
    'shed': "she'd",
    'im': "I'm",
    'lets': "let's",
};

// ============================================
// SPELLING FIXES
// ============================================
const SPELLING_FIXES = {
    'recieve': 'receive',
    'beleive': 'believe',
    'occured': 'occurred',
    'seperate': 'separate',
    'definately': 'definitely',
    'accomodate': 'accommodate',
    'occassion': 'occasion',
    'occassionally': 'occasionally',
    'untill': 'until',
    'wierd': 'weird',
    'neccessary': 'necessary',
    'truely': 'truly',
    'embarass': 'embarrass',
    'occuring': 'occurring',
    'begining': 'beginning',
    'bizzare': 'bizarre',
    'calender': 'calendar',
    'collegue': 'colleague',
    'commited': 'committed',
    'concious': 'conscious',
    'existance': 'existence',
    'goverment': 'government',
    'independant': 'independent',
    'knowlege': 'knowledge',
    'liason': 'liaison',
    'millenium': 'millennium',
    'occurance': 'occurrence',
    'privelege': 'privilege',
    'publically': 'publicly',
    'recomend': 'recommend',
    'refered': 'referred',
    'succesful': 'successful',
    'tommorow': 'tomorrow',
    'alot': 'a lot',
    'noone': 'no one',
    'eachother': 'each other',
    'infact': 'in fact',
    'inspite': 'in spite',
    'infront': 'in front',
    'alright': 'all right',
    'thier': 'their',
    'wih': 'with',
    'teh': 'the',
    'nad': 'and',
    'adn': 'and',
    'taht': 'that',
    'hte': 'the',
    'jsut': 'just',
    'relaly': 'really',
    'peopel': 'people',
    'whcih': 'which',
    'beacuse': 'because',
    'becuase': 'because',
    'shoudl': 'should',
    'woudl': 'would',
    'cuold': 'could',
};

// ============================================
// MAIN CLEANING FUNCTION
// ============================================
function prepareBlogContent(text) {
    if (!text) return '';
    let cleaned = text;

    // 1. Remove thread numbering patterns (recursive)
    let previous;
    let iterations = 0;
    do {
        previous = cleaned;
        cleaned = cleaned.replace(/^(\d+)[.)\/:]\s*/gm, '');
        cleaned = cleaned.replace(/^[🧵]\s*/gm, '');
        cleaned = cleaned.replace(/\b(thread|THREAD|Thread):?\s*/gi, '');
        iterations++;
    } while (cleaned !== previous && iterations < 5);

    // 2. Fix HTML entities
    cleaned = cleaned.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

    // 3. Remove t.co links (but keep other URLs)
    cleaned = cleaned.replace(/\s*https?:\/\/t\.co\/\w+/g, '');

    // 4. Expand abbreviations (case-insensitive, word boundary)
    // Must avoid matching after apostrophes (e.g., I've should not become I'versus)
    for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
        // Handle special case for "were" which could be past tense
        if (abbr === 'were') continue; // Skip - too ambiguous

        // Skip any short replacements that could match contraction suffixes
        if (['vs', 've', 'd', 'll', 's', 're', 'm'].includes(abbr.toLowerCase())) continue;

        // Use negative lookbehind to avoid matching after apostrophe
        const regex = new RegExp(`(?<!')\\b${abbr}\\b`, 'gi');
        cleaned = cleaned.replace(regex, (match) => {
            // Preserve original capitalization for first letter
            if (match[0] === match[0].toUpperCase()) {
                return full.charAt(0).toUpperCase() + full.slice(1);
            }
            return full;
        });
    }

    // 5. Fix spelling errors
    for (const [wrong, right] of Object.entries(SPELLING_FIXES)) {
        const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
        cleaned = cleaned.replace(regex, right);
    }

    // 6. Ensure paragraphs end with punctuation
    // Split by double newlines (paragraph breaks)
    const paragraphs = cleaned.split(/\n\n+/);
    const fixedParagraphs = paragraphs.map(para => {
        para = para.trim();
        if (!para) return para;

        // Check if paragraph ends with punctuation
        const lastChar = para.slice(-1);
        const punctuation = ['.', '!', '?', ':', ';', '"', "'", ')', ']', '—', '…'];

        if (!punctuation.includes(lastChar)) {
            // Add period if missing
            para += '.';
        }

        return para;
    });
    cleaned = fixedParagraphs.join('\n\n');

    // 7. Fix common grammar issues
    // Capitalize I
    cleaned = cleaned.replace(/\bi\b/g, 'I');

    // Fix double spaces
    cleaned = cleaned.replace(/  +/g, ' ');

    // Fix space before punctuation
    cleaned = cleaned.replace(/ ([.,!?;:])/g, '$1');

    // Ensure space after punctuation (except for abbreviations)
    cleaned = cleaned.replace(/([.,!?;:])([A-Za-z])/g, '$1 $2');

    // Fix multiple periods
    cleaned = cleaned.replace(/\.{4,}/g, '...');

    // Capitalize first letter of sentences
    cleaned = cleaned.replace(/(^|[.!?]\s+)([a-z])/g, (match, p1, p2) => {
        return p1 + p2.toUpperCase();
    });

    // 8. Clean up whitespace
    cleaned = cleaned.trim();
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned;
}

// ============================================
// MAIN EXECUTION
// ============================================
console.log('📝 Preparing blog content for Substack...\n');

// Get ALL tweets that have combined_text (for complete reprocessing after bug fix)
const tweets = db.prepare(`
    SELECT id, full_text, combined_text, blog_text
    FROM tweets
    WHERE combined_text IS NOT NULL OR full_text IS NOT NULL
`).all();

console.log(`Found ${tweets.length} tweets to process.\n`);

const updateStmt = db.prepare('UPDATE tweets SET blog_text = ? WHERE id = ?');
let processed = 0;
let changed = 0;

for (const tweet of tweets) {
    // Use combined_text for threads, full_text for single tweets
    const sourceText = tweet.combined_text || tweet.full_text;
    const cleanedText = prepareBlogContent(sourceText);

    // Only update if different from existing blog_text
    if (cleanedText !== tweet.blog_text) {
        updateStmt.run(cleanedText, tweet.id);
        changed++;
    }

    processed++;

    if (processed % 200 === 0) {
        console.log(`  Processed ${processed}/${tweets.length}...`);
    }
}

console.log(`\n✅ Done!`);
console.log(`   Processed: ${processed}`);
console.log(`   Updated: ${changed}`);
console.log(`   Unchanged: ${processed - changed}`);
