#!/usr/bin/env node
/**
 * Detect Near-Duplicate Tweets
 * 
 * Finds tweets that share 50%+ of their text (likely revisions)
 * and tags the older ones as 'duplicate' so they can be hidden
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

// Jaccard similarity for word bags
function jaccardSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

// Get first N words for grouping (reduces comparison space)
function getPrefix(text, n = 5) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    return words.slice(0, n).join(' ');
}

console.log('🔍 Detecting near-duplicate tweets...\n');

// Get all tweets, sorted by created_at
const tweets = db.prepare(`
    SELECT t.id, t.full_text, t.created_at, t.favorite_count
    FROM tweets t
    WHERE t.full_text IS NOT NULL
    AND LENGTH(t.full_text) > 50
    AND t.tweet_type NOT IN ('retweet', 'reply')
    ORDER BY t.created_at DESC
`).all();

console.log(`Analyzing ${tweets.length} tweets...\n`);

// Group tweets by prefix to reduce comparisons
const prefixGroups = new Map();
for (const tweet of tweets) {
    const prefix = getPrefix(tweet.full_text);
    if (!prefixGroups.has(prefix)) {
        prefixGroups.set(prefix, []);
    }
    prefixGroups.get(prefix).push(tweet);
}

const duplicates = [];
const checked = new Set();

// Only compare within groups that have multiple tweets
for (const [prefix, group] of prefixGroups) {
    if (group.length < 2) continue;

    // Compare all pairs within group
    for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
            const t1 = group[i];
            const t2 = group[j];

            const pairKey = [t1.id, t2.id].sort().join('-');
            if (checked.has(pairKey)) continue;
            checked.add(pairKey);

            const similarity = jaccardSimilarity(t1.full_text, t2.full_text);

            if (similarity >= 0.5) {
                // Mark the older one (or one with fewer likes) as duplicate
                const newer = new Date(t1.created_at) > new Date(t2.created_at) ? t1 : t2;
                const older = newer === t1 ? t2 : t1;

                // Prefer keeping the one with more engagement
                const keep = newer.favorite_count >= older.favorite_count ? newer : older;
                const hide = keep === newer ? older : newer;

                duplicates.push({
                    keepId: keep.id,
                    hideId: hide.id,
                    similarity: similarity,
                    keepText: keep.full_text.substring(0, 60) + '...',
                    hideText: hide.full_text.substring(0, 60) + '...'
                });
            }
        }
    }
}

console.log(`Found ${duplicates.length} duplicate pairs.\n`);

// Create or get the 'duplicate' tag
let duplicateTag = db.prepare("SELECT id FROM tags WHERE name = 'duplicate'").get();
if (!duplicateTag) {
    db.prepare("INSERT INTO tags (name, category) VALUES ('duplicate', 'pattern')").run();
    duplicateTag = db.prepare("SELECT id FROM tags WHERE name = 'duplicate'").get();
    console.log("Created 'duplicate' tag.\n");
}

// Tag duplicates
const insertTag = db.prepare(`
    INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id) VALUES (?, ?)
`);

let tagged = 0;
for (const dup of duplicates) {
    insertTag.run(dup.hideId, duplicateTag.id);
    tagged++;
}

console.log(`✅ Tagged ${tagged} tweets as 'duplicate'`);
console.log(`\nSample duplicates found:`);
duplicates.slice(0, 5).forEach((d, i) => {
    console.log(`\n${i + 1}. Similarity: ${(d.similarity * 100).toFixed(0)}%`);
    console.log(`   Keep: ${d.keepText}`);
    console.log(`   Hide: ${d.hideText}`);
});
