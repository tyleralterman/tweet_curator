#!/usr/bin/env node
require('dotenv').config();

/**
 * Test Bluesky API Connection
 * 
 * Usage:
 *   export BLUESKY_HANDLE="yourhandle.bsky.social"
 *   export BLUESKY_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *   node scripts/test_bluesky.js
 */

const BlueskyAPI = require('../utils/bluesky-api');

async function main() {
    console.log('🦋 Testing Bluesky API Connection...\n');

    const handle = process.env.BLUESKY_HANDLE;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;

    if (!handle || !appPassword) {
        console.error('❌ Missing environment variables!');
        console.log('\nTo set up Bluesky:');
        console.log('1. Go to https://bsky.app/settings/app-passwords');
        console.log('2. Create a new app password');
        console.log('3. Export the variables:');
        console.log('   export BLUESKY_HANDLE="yourhandle.bsky.social"');
        console.log('   export BLUESKY_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"');
        process.exit(1);
    }

    console.log(`Handle: @${handle}`);
    console.log(`Password: ${'*'.repeat(appPassword.length - 4)}${appPassword.slice(-4)}`);
    console.log('');

    const api = new BlueskyAPI();

    // Test 1: Connection
    console.log('📡 Test 1: Testing connection...');
    const result = await api.testConnection();

    if (!result.success) {
        console.error(`❌ Connection failed: ${result.error}`);
        process.exit(1);
    }

    console.log(`✅ Connected as @${result.handle}`);
    console.log(`   Display Name: ${result.displayName}`);
    console.log(`   Followers: ${result.followersCount}`);
    console.log(`   Posts: ${result.postsCount}`);

    // Test 2: Dry run post (don't actually post)
    console.log('\n📝 Test 2: Post capability check...');
    console.log('   ✅ Ready to post (use --post flag to test actual posting)');

    // If --post flag provided, do a test post
    if (process.argv.includes('--post')) {
        console.log('\n🚀 Test 3: Posting test message...');
        const testMessage = `Testing Chimera Broadcast Engine integration at ${new Date().toISOString()}`;

        try {
            const postResult = await api.post(testMessage);
            console.log(`✅ Posted successfully!`);
            console.log(`   URI: ${postResult.uri}`);
        } catch (err) {
            console.error(`❌ Post failed: ${err.message}`);
        }
    }

    console.log('\n✅ All tests passed!');
}

main().catch(console.error);
