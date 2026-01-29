const ABBREVIATIONS = { 'ppl': 'people' }; // minimal mock

function cleanContent(text) {
    if (!text) return '';
    let cleaned = text;

    // Recursive loop
    let previous;
    let iterations = 0;
    do {
        previous = cleaned;
        cleaned = cleaned.replace(/^(\d+)[.)\/:]\s*/gm, '');
        cleaned = cleaned.replace(/^[🧵]\s*/gm, '');
        cleaned = cleaned.replace(/\b(thread|THREAD|Thread):?\s*/gi, '');
        cleaned = cleaned.trim();
        iterations++;
    } while (cleaned !== previous && iterations < 5);

    return cleaned;
}

const input = `1. 1/ I'm coming to the opinion that critiquing Effective Altruism is very hard. Perhaps a fool's endeavor. Maybe you can change my mind. [thread]

https://t.co/PJA1BIGsQX

2. 2/ Firstly, it is too hard to pin down the philosophical foundations to precisely critique them`;

console.log('--- INPUT ---');
console.log(input);
console.log('\n--- CLEANED ---');
console.log(cleanContent(input));
