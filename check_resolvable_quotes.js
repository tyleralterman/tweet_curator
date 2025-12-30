const Database = require('better-sqlite3');
const db = new Database('database/tweets.db');

const totalQuotes = db.prepare("SELECT COUNT(*) as c FROM tweets WHERE tweet_type = 'quote'").get().c;
const resolvableQuotes = db.prepare(`
    SELECT COUNT(*) as c 
    FROM tweets t 
    JOIN tweets q ON t.quoted_tweet_id = q.id 
    WHERE t.tweet_type = 'quote'
`).get().c;

console.log(`Total Quote Tweets: ${totalQuotes}`);
console.log(`Resolvable Internal Quotes: ${resolvableQuotes}`);
console.log(`Unresolvable External Quotes: ${totalQuotes - resolvableQuotes}`);

const example = db.prepare(`
    SELECT t.id 
    FROM tweets t 
    JOIN tweets q ON t.quoted_tweet_id = q.id 
    WHERE t.tweet_type = 'quote'
    LIMIT 1
`).get();

if (example) {
    console.log(`Example Resolvable Quote ID: ${example.id}`);
}
