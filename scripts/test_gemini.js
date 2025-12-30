/**
 * Test Gemini API connection
 */

const API_KEY = 'AIzaSyBLSDpedulzhPafEQChi7egIm4LKj61les';

async function test() {
    const testTweet = "One thing I love about non-international cities is that the ppl arent sophisticated enough to believe that art shouldnt be beautiful";

    console.log("Testing Gemini API with tweet:", testTweet.substring(0, 50) + "...");

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Analyze this tweet and respond with ONLY a JSON object containing topic tags that fit (like aesthetics, art, culture, philosophy, etc). Format: {"topics": ["tag1", "tag2"]}

Tweet: ${testTweet}`
                        }]
                    }],
                    generationConfig: {
                        maxOutputTokens: 256,
                        responseMimeType: "application/json"
                    }
                })
            }
        );

        if (!response.ok) {
            console.log('Error:', response.status, await response.text());
            return;
        }

        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log('✅ API works!');
        console.log('Response:', result);

        // Verify it's not tagging this as "romance"
        if (result && result.includes('romance')) {
            console.log('⚠️ Still incorrectly tagged as romance');
        } else {
            console.log('✅ Correctly NOT tagged as romance!');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
