const fs = require('fs');
const path = require('path');

const ARCHIVE_PATH = path.join(__dirname, '../twitter_archive/data/tweets.js');

try {
    const content = fs.readFileSync(ARCHIVE_PATH, 'utf8');
    const jsonStart = content.indexOf('[');
    const tweets = JSON.parse(content.slice(jsonStart));

    let quotedCount = 0;
    let withStatusCount = 0;

    for (const item of tweets) {
        const t = item.tweet;
        if (t.quoted_status_id_str) {
            quotedCount++;
            if (t.quoted_status) { // Check if embedded object exists (it usually doesn't in standard archive)
                withStatusCount++;
            }
        }
    }

    console.log(`Total tweets: ${tweets.length}`);
    console.log(`Quoted tweets: ${quotedCount}`);
    console.log(`With quoted_status object: ${withStatusCount}`);

} catch (e) {
    console.error(e);
}
