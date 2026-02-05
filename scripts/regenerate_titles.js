#!/usr/bin/env node

/**
 * Regenerate AI titles in sentence case for existing blog-ready items
 * 
 * Usage: node scripts/regenerate_titles.js
 * 
 * This script re-generates title options for all tweets tagged 'blog-ready'
 * that currently have title options, using the updated sentence case prompt.
 */

const Database = require('better-sqlite3');
const path = require('path');
const { generateTitleOptions } = require('../utils/ai');

const dbPath = path.join(__dirname, '..', 'data', 'tweets.db');
const db = new Database(dbPath);

async function regenerateTitles() {
    console.log('🔄 Regenerating titles in sentence case...\n');

    // Get all blog-ready items with existing title options
    const items = db.prepare(`
        SELECT t.id, t.blog_text, t.combined_text, t.full_text, t.title_options, t.selected_title
        FROM tweets t
        JOIN tweet_tags tt ON t.id = tt.tweet_id
        JOIN tags tg ON tt.tag_id = tg.id
        WHERE tg.name = 'blog-ready' AND t.title_options IS NOT NULL
        ORDER BY t.queue_order ASC
    `).all();

    console.log(`Found ${items.length} items with existing titles\n`);

    let updated = 0;
    let errors = 0;

    for (const item of items) {
        const content = item.blog_text || item.combined_text || item.full_text;
        if (!content) {
            console.log(`⏭️ Skipping ${item.id} - no content`);
            continue;
        }

        console.log(`📝 Regenerating titles for: ${item.id}...`);

        try {
            const newOptions = await generateTitleOptions(content);

            if (newOptions && newOptions.length > 0) {
                // Merge with any custom titles the user may have added
                let existingOptions = [];
                try {
                    existingOptions = JSON.parse(item.title_options || '[]');
                } catch (e) { }

                // Keep custom (non-AI) options
                const customOptions = existingOptions.filter(opt => opt.source !== 'ai');
                const finalOptions = [...customOptions, ...newOptions];

                db.prepare('UPDATE tweets SET title_options = ? WHERE id = ?')
                    .run(JSON.stringify(finalOptions), item.id);

                console.log(`  ✅ Updated with ${newOptions.length} new AI titles`);
                newOptions.forEach((opt, i) => {
                    console.log(`     ${i + 1}. "${opt.title}"`);
                });
                updated++;
            } else {
                console.log(`  ⚠️ No titles generated`);
            }
        } catch (err) {
            console.error(`  ❌ Error: ${err.message}`);
            errors++;
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n✅ Done! Updated ${updated} items, ${errors} errors`);
}

regenerateTitles().catch(console.error);
