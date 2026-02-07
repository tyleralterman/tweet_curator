#!/usr/bin/env node

/**
 * Test the substack-api npm package connectivity
 * 
 * Usage: 
 *   export SUBSTACK_SESSION_COOKIE="your_substack.sid_cookie_value"
 *   node scripts/test_substack_lib.js
 */

const { SubstackClient } = require('substack-api');

async function main() {
    const sessionCookie = process.env.SUBSTACK_SESSION_COOKIE;
    const publicationUrl = process.env.SUBSTACK_CUSTOM_DOMAIN || 'lalachimera.com';

    if (!sessionCookie) {
        console.error('❌ SUBSTACK_SESSION_COOKIE not set');
        process.exit(1);
    }

    console.log('🧪 Testing substack-api library...\n');
    console.log(`Publication URL: ${publicationUrl}`);
    console.log(`Cookie: ${sessionCookie.substring(0, 30)}...`);
    console.log('');

    try {
        const client = new SubstackClient({
            token: sessionCookie,
            publicationUrl: publicationUrl
        });

        // Test 1: Connectivity
        console.log('📋 Test 1: Testing connectivity...');
        const isConnected = await client.testConnectivity();
        console.log(`Connected: ${isConnected}`);

        if (!isConnected) {
            console.log('\n❌ Connection test failed. Cookie may be invalid.');
            process.exit(1);
        }

        // Test 2: Get own profile
        console.log('\n👤 Test 2: Getting own profile...');
        const profile = await client.ownProfile();
        console.log(`Profile: ${profile.name} (@${profile.handle})`);
        console.log(`User ID: ${profile.id}`);

        // Test 3: List recent posts
        console.log('\n📝 Test 3: Getting recent posts...');
        let postCount = 0;
        for await (const post of profile.posts({ limit: 3 })) {
            console.log(`  - "${post.title}" (${post.publishedAt?.toLocaleDateString()})`);
            postCount++;
        }
        console.log(`Found ${postCount} posts`);

        // Test 4: Try creating a note (if possible)
        console.log('\n📝 Test 4: Note creation capability...');
        console.log('OwnProfile has newNote(): ' + (typeof profile.newNote === 'function'));
        console.log('OwnProfile has newNoteWithLink(): ' + (typeof profile.newNoteWithLink === 'function'));

        console.log('\n✅ All tests passed! Library authentication works.');
        console.log('\n⚠️  NOTE: This library supports Notes (short-form), not full blog Posts.');

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
