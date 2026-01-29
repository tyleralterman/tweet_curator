#!/usr/bin/env node
/**
 * Generate header images for blog posts
 * Uses a consistent style template
 * 
 * Usage:
 *   node generate_header_images.js "Post Title" [output_filename]
 *   node generate_header_images.js --batch blog_posts.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Style guide (customize these!)
const STYLE = {
    // Color palette - dark academia inspired
    primaryColor: '#8B4513',    // Saddle brown
    accentColor: '#D4AF37',     // Gold
    backgroundColor: '#1a1a2e', // Dark blue-gray
    textColor: '#f5f5f5',       // Off-white

    // Typography style
    font: 'serif',              // serif, sans-serif, display

    // Visual motifs
    motifs: [
        'vintage book pages',
        'coffee and notebook',
        'moody library aesthetic',
        'typewriter keys',
        'constellation pattern'
    ]
};

// Image generation prompt template
function generatePrompt(title) {
    const motif = STYLE.motifs[Math.floor(Math.random() * STYLE.motifs.length)];

    return `Create a sophisticated blog header image with:
- Dark academia aesthetic
- ${motif} as visual element
- Muted, warm color palette (browns, golds, deep blues)
- Subtle texture or grain
- Clean, minimal composition
- NO text or typography
- Aspect ratio: 16:9 (landscape)
- Moody, intellectual atmosphere

This is for a blog post titled: "${title}"

Style: editorial, thoughtful, premium quality`;
}

// ============================================
// Main
// ============================================

const args = process.argv.slice(2);

if (args.length === 0) {
    console.log(`
📸 Blog Header Image Generator

Usage:
  node generate_header_images.js "Post Title"              Generate single image
  node generate_header_images.js --batch posts.json        Generate batch from JSON
  
Example posts.json format:
[
  { "title": "Why Threads Aren't Blog Posts", "filename": "threads-vs-blogs" },
  { "title": "The Malleability of Social Reality", "filename": "social-reality" }
]

Current style preset: Dark Academia
`);
    process.exit(0);
}

if (args[0] === '--batch' && args[1]) {
    // Batch mode
    const jsonPath = args[1];
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ File not found: ${jsonPath}`);
        process.exit(1);
    }

    const posts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`📚 Processing ${posts.length} posts...`);

    for (const post of posts) {
        console.log(`\n🎨 Generating: ${post.title}`);
        const prompt = generatePrompt(post.title);
        console.log(`   Prompt: ${prompt.substring(0, 100)}...`);
        console.log(`   Output: header_images/${post.filename}.png`);

        // Note: Actual image generation would happen here via API
        // This is a placeholder for the workflow
    }

    console.log(`\n✅ Processing complete!`);
    console.log(`\n💡 To actually generate images:`);
    console.log(`   1. Use Claude with the prompts above`);
    console.log(`   2. Or use DALL-E/Midjourney/Ideogram API`);

} else {
    // Single image mode
    const title = args[0];
    const filename = args[1] || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    console.log(`🎨 Generating header for: "${title}"`);
    console.log(`\n📝 Image Prompt:\n`);
    console.log(generatePrompt(title));
    console.log(`\n📁 Suggested filename: ${filename}.png`);
}
