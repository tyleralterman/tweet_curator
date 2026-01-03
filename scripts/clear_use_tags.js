/**
 * Clear Use Tag Assignments
 * Removes all tweet_tags entries where the tag category is 'use'
 * Use tags (book, blog-post, short-post) should only be manually assigned
 */

const Database = require('better-sqlite3');
const path = require('path');

// Try multiple database locations
const DB_PATHS = [
    path.join(__dirname, '../database/tweets.db'),
    path.join(__dirname, '../tweets.db'),
    '/data/tweets.db'
];

const DB_PATH = DB_PATHS.find(p => require('fs').existsSync(p));

if (!DB_PATH) {
    console.error('❌ Database not found at any expected location');
    process.exit(1);
}

console.log(`📂 Using database: ${DB_PATH}`);
const db = new Database(DB_PATH);

// Get count before
const beforeCount = db.prepare(`
    SELECT COUNT(*) as count FROM tweet_tags 
    WHERE tag_id IN (SELECT id FROM tags WHERE category = 'use')
`).get();

console.log(`📊 Found ${beforeCount.count} use tag assignments to remove`);

if (beforeCount.count > 0) {
    // Delete the assignments
    const result = db.prepare(`
        DELETE FROM tweet_tags 
        WHERE tag_id IN (SELECT id FROM tags WHERE category = 'use')
    `).run();

    console.log(`✅ Removed ${result.changes} use tag assignments`);
} else {
    console.log('✅ No use tag assignments found - already clean!');
}

// Verify
const afterCount = db.prepare(`
    SELECT COUNT(*) as count FROM tweet_tags 
    WHERE tag_id IN (SELECT id FROM tags WHERE category = 'use')
`).get();

console.log(`📊 After cleanup: ${afterCount.count} use tag assignments remain`);
console.log('');
console.log('Note: The use tag definitions (book, blog-post, short-post) still exist.');
console.log('You can manually assign them to tweets through the UI.');
