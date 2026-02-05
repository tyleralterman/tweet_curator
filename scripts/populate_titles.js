const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../tweets.db');
const db = new Database(DB_PATH);

console.log('🤖 Running "Title Algo" (Manual Batch)...');

const updates = [
    {
        id: '1832186842810139013',
        titles: [
            { title: "The Woman Who Belonged Everywhere", subtitle: "Learning confidence through non-verbal transmission" },
            { title: "Nonverbal Charisma", subtitle: "How to transmit a feeling without words" },
            { title: "Belonging Everywhere You Go", subtitle: "A lesson from a stranger at a party" }
        ]
    },
    {
        id: '1811174935705874509',
        titles: [
            { title: "Daniel Radcliffe vs. a Bookstore Baby", subtitle: "Even wizards can't cast 'Silence' on a toddler" },
            { title: "The Boy Who Lived... Through a Tantrum", subtitle: "Celebrity parenting in the wild" },
            { title: "Stars: They're Just Like Us (Stressed)", subtitle: "An overheard moment in a NYC bookstore" }
        ]
    },
    {
        id: '1798389150728765926',
        titles: [
            { title: "The Appreciated Tweet", subtitle: "A meta-experiment in viral success" },
            { title: "A Self-Fulfilling Prophecy", subtitle: "What happens when you ask for appreciation" },
            { title: "The Power of Suggestion", subtitle: "How this became my 2nd most popular tweet" }
        ]
    },
    {
        id: '1693648303706058820',
        titles: [
            { title: "The Malleability of Social Reality", subtitle: "How I decided to just ask for free lumber" },
            { title: "Asking Lumberyards for Free Wood", subtitle: "A 17-year-old's lesson in audacity" },
            { title: "How I Learned the World Says Yes", subtitle: "Discovering that rules are often suggestions" }
        ]
    }
];

const updateStmt = db.prepare('UPDATE tweets SET title_options = ? WHERE id = ?');
let count = 0;

for (const item of updates) {
    updateStmt.run(JSON.stringify(item.titles), item.id);
    count++;
}

console.log(`✅ Updated titles for ${count} items.`);
