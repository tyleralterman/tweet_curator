const https = require('https');

/**
 * Generate 3 title options using OpenAI
 * @param {string} text - The blog post content
 * @returns {Promise<Array>} - Array of title objects or null
 */
async function generateTitleOptions(text) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ No OPENAI_API_KEY found. Skipping title generation.');
        return null; // Return null to indicate no AI generation
    }

    // Truncate to avoid context limits (approx 8000 chars is plenty)
    const cleanText = text.substring(0, 8000);

    const prompt = `
    You are an expert blog editor. 
    Generate 3 distinct, catchy title and subtitle pairs for the following blog post.
    
    Rules:
    1. Return ONLY a JSON object with a key "options" containing an array.
    2. Each item in the array must have: "title", "subtitle", "source": "ai", and a unique "id" (e.g. "gen_1").
    3. Make them punchy and optimized for clicks.
    
    Content:
    ${cleanText}
    `;

    const payload = JSON.stringify({
        model: "gpt-4o",
        messages: [
            { role: "system", content: "You are a helpful assistant that outputs JSON." },
            { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7
    });

    return new Promise((resolve, reject) => {
        const req = https.request('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const response = JSON.parse(data);
                        const content = response.choices[0].message.content;
                        const parsed = JSON.parse(content);
                        resolve(parsed.options || []);
                    } catch (e) {
                        console.error('❌ AI Parse Error:', e);
                        console.error('Raw Output:', data);
                        resolve([]); // Fallback to empty
                    }
                } else {
                    console.error(`❌ OpenAI Error: ${res.statusCode} - ${data}`);
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error('❌ Request Error:', e);
            resolve(null);
        });

        req.write(payload);
        req.end();
    });
}

module.exports = { generateTitleOptions };
