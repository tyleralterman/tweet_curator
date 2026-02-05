const https = require('https');

const API_BASE = 'https://tweet-curator.onrender.com/api';

const DATA = [
    {
        id: '2003645956533744077',
        options: [
            { title: "Non-Domestic Partnership", subtitle: "A Love Story for the Incompatible", source: "ai", id: "gen_1" },
            { title: "Why We Can't Live Together", subtitle: "But we can't live apart", source: "ai", id: "gen_2" },
            { title: "Love without the Netflix Password", subtitle: "A modern romance", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '2001132671024472170',
        options: [
            { title: "How to Find a Great Therapist", subtitle: "My Hardcore Process", source: "ai", id: "gen_1" },
            { title: "Don't Settle for Sucky Therapy", subtitle: "A 5-step finding guide", source: "ai", id: "gen_2" },
            { title: "The Therapist Vibe Check", subtitle: "Finding one who actually helps", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1990087010703364354',
        options: [
            { title: "Religion as a Mental Executable", subtitle: "Why simplicity survives", source: "ai", id: "gen_1" },
            { title: "The .exe of Enlightenment", subtitle: "Downloading the Dharma", source: "ai", id: "gen_2" },
            { title: "Buddhism's Installer File", subtitle: "Four Noble Truths as code", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1989001549708714159',
        options: [
            { title: "Were Miracles Real?", subtitle: "Theory B vs Theory C", source: "ai", id: "gen_1" },
            { title: "Jesus and the Golden Thigh", subtitle: "Mythologizing the divine", source: "ai", id: "gen_2" },
            { title: "The Conditions for Miracles", subtitle: "Why they stopped happening", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1981783166797946951',
        options: [
            { title: "Grateful for Depression", subtitle: "Why I needed to be immobilized", source: "ai", id: "gen_1" },
            { title: "The Wisdom of Immobilization", subtitle: "When your Self stops you", source: "ai", id: "gen_2" },
            { title: "Smashing Into Walls", subtitle: "How depression saved me", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1980720042573771187',
        options: [
            { title: "Why Religion Beats 'Spirituality'", subtitle: "The power of shared mythos", source: "ai", id: "gen_1" },
            { title: "Collective Reverence", subtitle: "Why we need specific traditions", source: "ai", id: "gen_2" },
            { title: "Gathering the Tolkien Fans", subtitle: "Specific love needs specific forms", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1979655243932832094',
        options: [
            { title: "My Religious History", subtitle: "From Atheist to Vajrayana to Jesus", source: "ai", id: "gen_1" },
            { title: "Vajrayana for Westerners?", subtitle: "Why I'm exploring Christianity", source: "ai", id: "gen_2" },
            { title: "The Psychotechnology of Prayer", subtitle: "Finding a local mystic group", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1977841263559979276',
        options: [
            { title: "Share Your Happiness", subtitle: "Don't turn it down", source: "ai", id: "gen_1" },
            { title: "The Rebellion of Joy", subtitle: "Being happy in a dark zeitgeist", source: "ai", id: "gen_2" },
            { title: "Is Happiness Cringe?", subtitle: "Why we need to shine anyway", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1977041333983281317',
        options: [
            { title: "How I Hurt Myself Meditating", subtitle: "The trap of instrumentalism", source: "ai", id: "gen_1" },
            { title: "Meditation for Fun", subtitle: "vs Meditation for Perfection", source: "ai", id: "gen_2" },
            { title: "Craving Enlightenment", subtitle: "And why it backfires", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1956488467078115431',
        options: [
            { title: "3 Unusual Habits", subtitle: "Museums, Babysitting, and Buddies", source: "ai", id: "gen_1" },
            { title: "Work in a Museum", subtitle: "And other life hacks", source: "ai", id: "gen_2" },
            { title: "Accountability Buddies", subtitle: "Socializing discipline", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1955269551551123614',
        options: [
            { title: "Play Your Role", subtitle: "Availability vs Approach", source: "ai", id: "gen_1" },
            { title: "The Vibe of Availability", subtitle: "Why no one approaches you", source: "ai", id: "gen_2" },
            { title: "Dating Mechanics", subtitle: "Signaling you are open", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1951686435960135694',
        options: [
            { title: "Defining 'God'", subtitle: "Beyond the man in the sky", source: "ai", id: "gen_1" },
            { title: "God as Concrescence", subtitle: "The flower's fragrance", source: "ai", id: "gen_2" },
            { title: "Why I Pray", subtitle: "Engaging the benevolence", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1935723918603501652',
        options: [
            { title: "The Rise of Friendship", subtitle: "Replacing lost community", source: "ai", id: "gen_1" },
            { title: "Choosing Your Family", subtitle: "New structures for connection", source: "ai", id: "gen_2" },
            { title: "Fractal Communities", subtitle: "Building on flexible bonds", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1907134588473819537',
        options: [
            { title: "Superglue vs WD-40", subtitle: "Two types of social capital", source: "ai", id: "gen_1" },
            { title: "Rebuilding Bonding Capital", subtitle: "Without the oppression", source: "ai", id: "gen_2" },
            { title: "The Loneliness of Liberalism", subtitle: "Why we need strong tribes", source: "ai", id: "gen_3" }
        ]
    },
    {
        id: '1897765780303004149',
        options: [
            { title: "What Makes Art Great?", subtitle: "Annealing the emotion body", source: "ai", id: "gen_1" },
            { title: "The Emotion Body", subtitle: "How art reshapes us", source: "ai", id: "gen_2" },
            { title: "Epics, Dramas, and Expanders", subtitle: "Three types of annealing", source: "ai", id: "gen_3" }
        ]
    }
];

function postData(endpoint, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = https.request(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
            } else {
                reject(new Error(`Status ${res.statusCode}`));
            }
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function run() {
    console.log(`Pushing ${DATA.length} title sets to Render...`);
    let success = 0;

    for (const item of DATA) {
        try {
            await postData('/scheduler/update-options', {
                id: item.id,
                title_options: item.options
            });
            process.stdout.write('.');
            success++;
        } catch (err) {
            console.error(`\nFailed for ${item.id}:`, err.message);
        }
    }
    console.log(`\nDone. Success: ${success}/${DATA.length}`);
}

run();
