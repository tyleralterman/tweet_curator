const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/tweets.db');
const SCHEMA_PATH = path.join(__dirname, '../database/schema.sql');

if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found');
    process.exit(1);
}

const db = new Database(DB_PATH);
console.log('🔄 Starting migration...');

// 1. Rename existing table
try {
    db.prepare('ALTER TABLE tweets RENAME TO tweets_backup').run();
    console.log('✅ Renamed tweets to tweets_backup');
} catch (e) {
    if (e.message.includes('intro_backup')) { // Safety check
        // ignore
    } else {
        console.error('Error renaming:', e);
        // proceed if maybe already renamed?
    }
}

// 2. Create new table from schema
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
// unexpected: schema contains CREATE TABLE IF NOT EXISTS.
// We must ensure it runs.
db.exec(schema);
console.log('✅ Created new tweets table from schema');

// 3. Get columns from backup
const backupColumns = db.pragma('table_info(tweets_backup)').map(c => c.name);
const newColumns = db.pragma('table_info(tweets)').map(c => c.name);

// Find common columns
const commonColumns = backupColumns.filter(c => newColumns.includes(c));
console.log(`ℹ️  Copying data for ${commonColumns.length} common columns...`);

// 4. Copy data
const insertQuery = `
    INSERT INTO tweets (${commonColumns.join(', ')})
    SELECT ${commonColumns.join(', ')} FROM tweets_backup
`;

const result = db.prepare(insertQuery).run();
console.log(`✅ Copied ${result.changes} rows to new table`);

// 5. Cleanup
// Drop old indexes if they were on tweets_backup (they move with rename usually)
// We should check integrity
const countNew = db.prepare('SELECT COUNT(*) as c FROM tweets').get().c;
const countOld = db.prepare('SELECT COUNT(*) as c FROM tweets_backup').get().c;

if (countNew === countOld) {
    db.prepare('DROP TABLE tweets_backup').run();
    console.log('✅ Migration successful! Backup dropped.');
} else {
    console.error('⚠️  Row count mismatch!', countOld, 'vs', countNew);
    console.log('Keeping tweets_backup for safety.');
}

// Also ensure FTS is rebuilt
db.exec(`INSERT INTO tweets_fts(tweets_fts) VALUES('rebuild')`);
console.log('✅ FTS index rebuilt');

db.close();
