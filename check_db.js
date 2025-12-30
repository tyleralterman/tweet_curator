const Database = require('better-sqlite3');
const db = new Database('database/tweets.db');

const columns = db.pragma('table_info(tweets)');
console.log('Columns:', columns.map(c => c.name));
