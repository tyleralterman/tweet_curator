/**
 * LinkedIn Auth Generator
 * 
 * Helper script to guide user through LinkedIn OAuth flow.
 * 
 * Usage:
 *   node scripts/auth_linkedin.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const clientId = process.env.LINKEDIN_CLIENT_ID;
const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
const redirectUri = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/auth/linkedin/callback';

console.log('\n👔 LinkedIn Authentication Setup\n');

if (!clientId || !clientSecret) {
    console.error('❌ Error: Missing credentials in .env');
    console.log('Please add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to your .env file.');
    process.exit(1);
}

console.log('1. Ensure your server is running (npm start)');
console.log('2. Open the following URL in your browser to authorize:');
console.log(`\n   http://localhost:3000/api/auth/linkedin\n`);
console.log('3. After authorizing, you will be shown the tokens.');
console.log('4. Copy the tokens into your .env file.');
