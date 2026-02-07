#!/usr/bin/env node

/**
 * Test Substack API connection
 * 
 * Usage: 
 *   export SUBSTACK_SESSION_COOKIE="your_cookie_value"
 *   export SUBSTACK_CUSTOM_DOMAIN="lalachimera.com"
 *   node scripts/test_substack_api.js
 */

const { SubstackAPI } = require('../utils/substack-api');

async function main() {
    const sessionCookie = process.env.SUBSTACK_SESSION_COOKIE;
    const publication = process.env.SUBSTACK_PUBLICATION || 'lalachimera';
    const customDomain = process.env.SUBSTACK_CUSTOM_DOMAIN || 'lalachimera.com';

    if (!sessionCookie) {
        console.error('❌ SUBSTACK_SESSION_COOKIE not set');
        console.log('');
        console.log('Usage:');
        console.log('  export SUBSTACK_SESSION_COOKIE="s:R4UTOX..."');
        console.log('  node scripts/test_substack_api.js');
        process.exit(1);
    }

    console.log('🧪 Testing Substack API connection...\n');
    console.log(`Publication: ${publication}`);
    console.log(`Domain: ${customDomain}`);
    console.log(`Cookie: ${sessionCookie.substring(0, 20)}...`);
    console.log('');

    const api = new SubstackAPI(publication, sessionCookie, customDomain);

    // Test 1: Connection test (get drafts)
    console.log('📋 Test 1: Fetching drafts...');
    const success = await api.testConnection();

    if (!success) {
        console.log('\n❌ Connection test failed. Check cookie and domain.');
        process.exit(1);
    }

    // Test 2: Get scheduled posts
    console.log('\n📅 Test 2: Fetching scheduled posts...');
    try {
        const scheduled = await api.getScheduledPosts();
        console.log(`Found ${scheduled.length} scheduled posts`);
        if (scheduled.length > 0) {
            scheduled.slice(0, 3).forEach(post => {
                console.log(`  - ${post.title || post.draft_title} (${post.post_date || post.scheduled_for})`);
            });
        }
    } catch (e) {
        console.error(`Error: ${e.message}`);
    }

    // Test 3: Calculate next slot
    console.log('\n🕐 Test 3: Calculating next available slot...');
    try {
        const nextSlot = await api.getNextAvailableSlot();
        console.log(`Next slot: ${nextSlot.toISOString()}`);
        console.log(`Formatted: ${nextSlot.toDateString()} at ${nextSlot.toLocaleTimeString()}`);
    } catch (e) {
        console.error(`Error: ${e.message}`);
    }

    console.log('\n✅ All tests completed!');
}

main().catch(console.error);
