require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');

async function test() {
    console.log("Starting test...");
    const agent = new BskyAgent({ service: 'https://bsky.social' });

    try {
        console.log("Attempting login...");
        await agent.login({
            identifier: process.env.BLUESKY_HANDLE,
            password: process.env.BLUESKY_APP_PASSWORD
        });
        console.log("Login successful.");
        console.log("SESSION_JSON=", JSON.stringify(agent.session));
    } catch (err) {
        console.error("Login Error:");
        console.error(err);
        return;
    }

    try {
        console.log("Attempting string post...");
        const text = "Test broadcast from API " + Date.now();
        const rt = new RichText({ text });

        console.log("Detecting facets...");
        await rt.detectFacets(agent);

        console.log("Calling agent.post()...");
        const res = await agent.post({
            text: rt.text,
            facets: rt.facets,
            createdAt: new Date().toISOString()
        });
        console.log("Post successful:", res.uri);
    } catch (err) {
        console.error("Post Error:");
        console.error(err);
    }
}

test();
