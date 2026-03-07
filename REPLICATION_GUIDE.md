# Tweet Curator — Complete Replication Guide

> A comprehensive, step-by-step guide to rebuild the Tweet Curator application from scratch. This app imports a Twitter/X archive, lets you curate tweets via a Tinder-style swipe interface, manages tags with AI assistance, schedules blog posts to Substack, and broadcasts short-form content to Bluesky, LinkedIn, Threads, and Instagram.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Project Structure](#3-project-structure)
4. [Environment Variables](#4-environment-variables)
5. [Database Schema](#5-database-schema)
6. [Server Setup (server.js)](#6-server-setup-serverjs)
7. [API Routes Reference](#7-api-routes-reference)
8. [Frontend: Content Directory](#8-frontend-content-directory)
9. [Frontend: Swipe Interface](#9-frontend-swipe-interface)
10. [Frontend: Blog Scheduler](#10-frontend-blog-scheduler)
11. [Frontend: Broadcast Queue](#11-frontend-broadcast-queue)
12. [Twitter Archive Import Pipeline](#12-twitter-archive-import-pipeline)
13. [Utility Modules (API Clients)](#13-utility-modules-api-clients)
14. [Automation Scripts](#14-automation-scripts)
15. [Deployment (Render)](#15-deployment-render)
16. [Key Design Decisions](#16-key-design-decisions)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ Directory │  │  Swipe   │  │ Scheduler │  │ Notes Queue   │  │
│  │ index.html│  │swipe.html│  │scheduler. │  │notes-queue.   │  │
│  │ app.js    │  │swipe.js  │  │html/js    │  │html/js        │  │
│  │ styles.css│  │swipe.css │  │scheduler. │  │notes-queue.css│  │
│  │           │  │hammer.js │  │css        │  │               │  │
│  └─────┬─────┘  └─────┬────┘  └─────┬─────┘  └──────┬────────┘  │
└────────┼───────────────┼────────────┼───────────────┼────────────┘
         │               │            │               │
         └───────────────┴─────┬──────┴───────────────┘
                               │ REST API (JSON)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Express Server (server.js)                     │
│  3048 lines │ 154+ functions │ ~50 API endpoints                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Core Services:                                           │    │
│  │  • Tweet CRUD & filtering    • Tag management            │    │
│  │  • Search (text + AI/GPT-4)  • Session stats             │    │
│  │  • Thread detection          • Export (CSV/JSON/YAML)     │    │
│  │  • Archive upload/import     • Text cleaning pipeline     │    │
│  │  • Auto-tagging on startup   • Schema auto-migration      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Integration Modules (utils/):                            │    │
│  │  • ai.js           → OpenAI GPT-4o title generation      │    │
│  │  • substack-api.js  → Blog post scheduling               │    │
│  │  • bluesky-api.js   → AT Protocol posting                │    │
│  │  • linkedin-api.js  → OAuth 2.0 + Posts API              │    │
│  │  • threads-api.js   → Meta Graph API posting             │    │
│  │  • instagram-api.js → Quote cards + Graph API posting     │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   SQLite Database (better-sqlite3)                │
│  tweets.db │ WAL mode │ FTS5 full-text search                    │
│                                                                  │
│  Tables: tweets, tags, tweet_tags, swipe_sessions,               │
│          quoted_tweets, substack_blog_queue, substack_queue       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack & Dependencies

### Runtime
- **Node.js** (any recent LTS version)
- **npm** for package management

### package.json

```json
{
  "name": "tweet-curator",
  "version": "1.0.0",
  "description": "Tweet curation and categorization app",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "import": "node scripts/import.js",
    "postinstall": "npx puppeteer browsers install chrome"
  },
  "dependencies": {
    "@atproto/api": "^0.18.20",
    "better-sqlite3": "^11.0.0",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^4.18.2",
    "extract-zip": "^2.0.1",
    "multer": "^2.0.2",
    "node-cron": "^3.0.3",
    "puppeteer": "^22.15.0",
    "substack-api": "^2.2.1"
  }
}
```

### Dependency Purposes
| Package | Purpose |
|---------|---------|
| `express` | HTTP server and routing |
| `better-sqlite3` | Synchronous SQLite driver (fast, no async needed) |
| `cors` | Cross-origin resource sharing |
| `dotenv` | Environment variable loading from `.env` |
| `multer` | File upload middleware (archive ZIP, header images) |
| `extract-zip` | Unzipping uploaded Twitter archives |
| `@atproto/api` | Bluesky AT Protocol SDK for posting |
| `puppeteer` | Headless Chrome for quote card screenshot generation |
| `node-cron` | Scheduling (available but lightly used) |
| `substack-api` | Substack API wrapper |

### Client-Side Libraries (CDN)
| Library | Purpose |
|---------|---------|
| `Hammer.js` (local) | Touch gesture recognition for swipe cards |
| `canvas-confetti` (CDN) | Confetti animation on superlike |
| `Sortable.js` (CDN) | Drag-and-drop reordering in scheduler/queue |
| `Inter` + `Outfit` (Google Fonts) | Typography |

---

## 3. Project Structure

```
tweet_curator/
├── server.js                    # Main Express server (3048 lines)
├── package.json
├── .env                         # API keys and secrets
├── .gitignore
├── render.yaml                  # Render.com deployment config
├── README.md
├── data_tweets.db               # Seed database (committed to repo)
├── tweets.db                    # Runtime database (gitignored)
│
├── database/
│   ├── schema.sql               # Core database schema
│   └── substack_queue.sql       # Substack queue table schema
│
├── public/                      # Static frontend files
│   ├── index.html               # Content Directory page
│   ├── app.js                   # Directory logic (1529 lines)
│   ├── styles.css               # Directory styles (30KB)
│   ├── swipe.html               # Swipe Interface page
│   ├── swipe.js                 # Swipe logic (919 lines)
│   ├── swipe.css                # Swipe styles (23KB)
│   ├── hammer.min.js            # Touch gesture library
│   ├── scheduler.html           # Blog Scheduler page
│   ├── scheduler.js             # Scheduler logic (526 lines)
│   ├── scheduler.css            # Scheduler styles (13KB)
│   ├── notes-queue.html         # Broadcast Queue page
│   ├── notes-queue.js           # Broadcast logic (242 lines)
│   ├── notes-queue.css          # Broadcast styles (7KB)
│   └── templates/
│       └── quote-card.html      # Instagram quote card template
│
├── utils/                       # API client modules
│   ├── ai.js                    # OpenAI GPT-4o integration
│   ├── bluesky-api.js           # Bluesky AT Protocol client
│   ├── substack-api.js          # Substack internal API client
│   ├── linkedin-api.js          # LinkedIn OAuth + Posts API
│   ├── threads-api.js           # Meta Threads API client
│   └── instagram-api.js         # Instagram Graph API + quote cards
│
├── scripts/                     # CLI utility scripts (43 files)
│   ├── import.js                # Twitter archive importer
│   ├── auto_tag_heuristics.js   # Rule-based auto-tagging
│   ├── llm_tagger.js            # AI-powered tagging (Gemini)
│   ├── llm_tagger_openai.js     # AI-powered tagging (OpenAI)
│   ├── tag_new_tweets.js        # Tag newly imported tweets
│   ├── combine_threads.js       # Combine thread tweets into one
│   ├── detect_duplicates.js     # Find duplicate content
│   ├── download_media.js        # Download tweet media locally
│   ├── screenshot_quotes.js     # Generate quote card images
│   ├── process_manual_tweets.js # Process manually tagged tweets
│   ├── substack_poster.js       # Post to Substack Notes
│   ├── substack_blog_poster.js  # Post to Substack Blog
│   ├── build_substack_queue.js  # Build Substack posting queue
│   ├── analyze_for_substack.js  # Analyze tweets for Substack fit
│   ├── export_blog_candidates.js# Export blog-ready tweets
│   ├── prepare_blog_content.js  # Clean/format blog content
│   ├── push_generated_titles.js # Push AI titles to DB
│   ├── regenerate_titles.js     # Regenerate AI titles
│   ├── populate_titles.js       # Populate title fields
│   ├── migrate_schema.js        # Database schema migrations
│   ├── sync_*.js                # Various sync scripts (6 files)
│   ├── auto_recirculate_tags.js # Auto-tag for recirculation
│   ├── add_tbr_tags.js          # Add TBR (to-be-reviewed) tags
│   ├── clear_use_tags.js        # Clear use-category tags
│   ├── update_tag_category.js   # Bulk update tag categories
│   └── test_*.js                # Test scripts (6 files)
│
├── media/
│   └── downloaded/              # Downloaded tweet media files
│
└── uploads/                     # File upload staging directory
```

---

## 4. Environment Variables

Create a `.env` file in the project root:

```bash
# Required: OpenAI API Key (for semantic search + title generation)
OPENAI_API_KEY=sk-proj-...

# Bluesky API
BLUESKY_HANDLE=yourhandle.bsky.social
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# LinkedIn API (OAuth 2.0)
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/auth/linkedin/callback
LINKEDIN_ACCESS_TOKEN=  # Populated after OAuth flow
LINKEDIN_PERSON_URN=    # Populated after OAuth flow

# Threads / Meta API
THREADS_APP_ID=your_app_id
THREADS_APP_SECRET=your_app_secret
THREADS_REDIRECT_URI=http://localhost:3000/api/auth/threads/callback
THREADS_ACCESS_TOKEN=   # Populated after OAuth flow

# Substack (for blog posting)
SUBSTACK_SESSION_COOKIE= # Your substack.sid cookie value
SUBSTACK_PUBLICATION=    # Your publication subdomain
SUBSTACK_CUSTOM_DOMAIN=  # Optional custom domain
```

### How to Obtain Each Credential

| Service | How to Get |
|---------|-----------|
| **OpenAI** | Create account → API Keys → Create new key |
| **Bluesky** | Settings → App Passwords → Create app password |
| **LinkedIn** | Create app at developers.linkedin.com → OAuth 2.0 flow via `/api/auth/linkedin` |
| **Threads** | Create Meta Developer App → configure redirect URI → OAuth flow via `/api/auth/threads` |
| **Substack** | Open browser DevTools on your Substack → Application tab → Cookies → copy `substack.sid` value |

---

## 5. Database Schema

The app uses **SQLite** via `better-sqlite3` with **WAL mode** for concurrent reads.

### Core Tables

#### `tweets` — Main content table
```sql
CREATE TABLE IF NOT EXISTS tweets (
    id TEXT PRIMARY KEY,                -- Twitter snowflake ID
    full_text TEXT,                      -- Original tweet text (long-form from note-tweet.js)
    created_at DATETIME,
    favorite_count INTEGER DEFAULT 0,
    retweet_count INTEGER DEFAULT 0,
    is_reply BOOLEAN DEFAULT FALSE,
    is_quote_tweet BOOLEAN DEFAULT FALSE,
    is_retweet BOOLEAN DEFAULT FALSE,
    is_thread BOOLEAN DEFAULT FALSE,
    has_media BOOLEAN DEFAULT FALSE,
    media_type TEXT,                     -- 'photo', 'video', 'gif'
    media_url TEXT,
    lang TEXT,
    source TEXT,                         -- e.g., "Twitter Web App"
    in_reply_to_user TEXT,
    in_reply_to_tweet_id TEXT,
    quoted_tweet_id TEXT,
    tweet_url TEXT,
    -- Derived fields
    char_count INTEGER,
    length_category TEXT CHECK(length_category IN ('short', 'medium', 'long')),
    tweet_type TEXT CHECK(tweet_type IN ('text_only', 'media', 'quote', 'reply', 'retweet', 'thread')),
    -- Curation fields
    quality_rating TEXT CHECK(quality_rating IN ('high', 'medium', 'low')),
    ai_quality_score REAL,
    swipe_status TEXT CHECK(swipe_status IN ('dislike', 'like', 'superlike', 'review_later')),
    is_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_at DATETIME,
    notes TEXT,
    first_impressions TEXT,
    -- Blog fields (added via auto-migration)
    combined_text TEXT,                  -- Thread tweets combined
    blog_text TEXT,                      -- Cleaned/edited blog version
    title_options TEXT,                  -- JSON array of AI-generated titles
    selected_title TEXT,                 -- JSON object: {title, subtitle}
    header_image TEXT                    -- Path to uploaded header image
);
```

#### `tags` — Tag definitions (Dark Academia color palette)
```sql
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('topic', 'pattern', 'use', 'custom')),
    color TEXT
);
```

**Tag categories:**
- **topic** (31 tags): art, aesthetics, romance, philosophy, psychology, technology, etc.
- **pattern** (14 tags): hot-take, theory, observation, advice, story, joke, rant, etc.
- **use** (manual): book, blog-post, short-post, broadcast-ready, auto-like, auto-superlike, etc.
- **custom**: User-created tags

#### `tweet_tags` — Many-to-many relationship
```sql
CREATE TABLE IF NOT EXISTS tweet_tags (
    tweet_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    source TEXT DEFAULT 'manual' CHECK(source IN ('ai', 'manual')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tweet_id, tag_id)
);
```

#### `swipe_sessions` — Daily progress tracking
```sql
CREATE TABLE IF NOT EXISTS swipe_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date DATE DEFAULT (date('now')),
    tweets_swiped INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    superlikes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0,
    review_later INTEGER DEFAULT 0
);
```

#### `quoted_tweets` — Cached quoted tweet content
```sql
CREATE TABLE IF NOT EXISTS quoted_tweets (
    id TEXT PRIMARY KEY,
    author_name TEXT,
    author_username TEXT,
    content TEXT,
    created_at TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_available BOOLEAN DEFAULT TRUE
);
```

#### `substack_blog_queue` — Blog scheduling queue
```sql
CREATE TABLE IF NOT EXISTS substack_blog_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT NOT NULL,
    title TEXT,
    subtitle TEXT,
    body TEXT,
    scheduled_at DATETIME,
    status TEXT DEFAULT 'pending',
    substack_post_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `substack_queue` — Notes/short-form posting queue
```sql
CREATE TABLE IF NOT EXISTS substack_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'posted', 'failed', 'skipped')),
    scheduled_at DATETIME,
    posted_at DATETIME,
    post_content TEXT,
    media_path TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes & Full-Text Search
```sql
-- Performance indexes on: created_at, favorite_count, quality_rating,
-- ai_quality_score, swipe_status, length_category, tweet_type, tweet_tags

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts USING fts5(
    id, full_text, content='tweets', content_rowid='rowid'
);

-- Trigger to keep FTS in sync on INSERT
CREATE TRIGGER IF NOT EXISTS tweets_ai AFTER INSERT ON tweets BEGIN
    INSERT INTO tweets_fts(id, full_text) VALUES (new.id, new.full_text);
END;
```

---

## 6. Server Setup (server.js)

The server is a single 3048-line Express application. Here's the initialization sequence:

### 6.1 Database Initialization
```javascript
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database location priority:
// 1. /data (Render persistent disk) — for production
// 2. ./tweets.db (local development)
// 3. Falls back to copying data_tweets.db as seed
let DB_PATH;
if (fs.existsSync('/data')) {
    DB_PATH = path.join('/data', 'tweets.db');
    // Copy seed DB if runtime DB doesn't exist yet
} else {
    DB_PATH = path.join(__dirname, 'tweets.db');
    // Copy seed DB if runtime DB doesn't exist yet
}

const db = new Database(DB_PATH, { readonly: false });
db.pragma('journal_mode = WAL');
```

### 6.2 Auto-Migration System
On every startup, the server checks for missing columns and adds them:
```javascript
const columns = db.pragma('table_info(tweets)').map(c => c.name);
if (!columns.includes('first_impressions')) {
    db.prepare('ALTER TABLE tweets ADD COLUMN first_impressions TEXT').run();
}
if (!columns.includes('combined_text')) {
    db.prepare('ALTER TABLE tweets ADD COLUMN combined_text TEXT').run();
}
if (!columns.includes('blog_text')) { /* ... */ }
if (!columns.includes('title_options')) { /* ... */ }
if (!columns.includes('selected_title')) { /* ... */ }
if (!columns.includes('header_image')) { /* ... */ }
```

### 6.3 Startup Auto-Tagging
The server automatically applies heuristic tags on boot:
- **`auto-like`**: Tweets < 281 chars AND > 99 likes
- **`auto-superlike`**: Tweets < 281 chars AND > 299 likes
- **Substack-manual subcategories**: `manual-media`, `manual-quote-self`, `manual-quote-external`, `manual-thread`

### 6.4 Search Engine
A built-in Google-style search with:
- **Porter Stemmer**: Handles suffixes (-ing, -ed, -s, -es, -tion, -ness)
- **Multi-word AND logic**: All words must match
- **Quoted phrases**: `"exact phrase"` matching
- **Stemmed variants**: Each word generates stemmed alternatives

### 6.5 Text Cleaning Pipeline
A `cleanContent()` function that:
- Expands abbreviations (tbh → to be honest, imo → in my opinion, etc.)
- Fixes common spelling errors (definately → definitely, etc.)
- Strips trailing URLs (t.co links)
- Normalizes whitespace and punctuation

### 6.6 Middleware
```javascript
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

---

## 7. API Routes Reference

### Tweet CRUD
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tweets` | List tweets with filters, search, pagination, sorting |
| `GET` | `/api/tweets/:id` | Get single tweet with tags |
| `GET` | `/api/tweets/:id/thread` | Get thread chain (recursive CTE) |
| `PATCH` | `/api/tweets/:id` | Update swipe_status, notes, quality_rating, blog_text, etc. |

**GET /api/tweets query params:**
`page`, `limit`, `search`, `type`, `length`, `swipe`, `tag` (comma-separated), `excludeTag` (comma-separated), `reviewed`, `excludeRetweets`, `excludeReplies`, `excludeThreads`, `excludeDuplicates`, `sort`, `order`

### Tag Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tags` | Get all tags grouped by category with tweet counts |
| `POST` | `/api/tags` | Create new tag |
| `PATCH` | `/api/tags/:id` | Update tag name/category/color |
| `GET` | `/api/tags/search` | Autocomplete tag search |
| `POST` | `/api/tweets/:id/tags` | Add tag to tweet (auto-generates titles if "blog-ready") |
| `DELETE` | `/api/tweets/:id/tags/:tagName` | Remove tag from tweet |
| `POST` | `/api/batch/tags` | Batch add tag to multiple tweets |
| `DELETE` | `/api/batch/tags` | Batch remove tag from multiple tweets |

### Stats & Sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Global stats: counts by type, swipe status, today's session |

### Scheduler (Blog Posts)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/scheduler/queue` | Get blog-ready tweets ordered by position |
| `POST` | `/api/scheduler/reorder` | Reorder queue items |
| `POST` | `/api/scheduler/select-title` | Select a title option for a post |
| `POST` | `/api/scheduler/update-options` | Update title options |
| `POST` | `/api/scheduler/upload-image/:id` | Upload header image |
| `POST` | `/api/scheduler/push-to-substack/:id` | Create draft + schedule on Substack |
| `POST` | `/api/scheduler/batch-schedule` | Schedule next month's posts in batch |

### Broadcast Queue (Notes/Short-form)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/notes/queue` | Get tweets tagged "broadcast-ready" |
| `POST` | `/api/notes/add/:id` | Tag tweet as "broadcast-ready" |
| `DELETE` | `/api/posts/remove/:id` | Remove from broadcast queue |
| `GET` | `/api/notes/export-yaml` | Export as YAML for Substack Notes scheduler extension |

### Social Media Broadcasting
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/broadcast/bluesky/test` | Test Bluesky connection |
| `POST` | `/api/broadcast/bluesky/batch` | Batch post to Bluesky |
| `GET` | `/api/auth/linkedin` | Start LinkedIn OAuth flow |
| `GET` | `/api/auth/linkedin/callback` | LinkedIn OAuth callback |
| `POST` | `/api/broadcast/linkedin` | Post to LinkedIn |
| `GET` | `/api/auth/threads` | Start Threads OAuth flow |
| `GET` | `/api/auth/threads/callback` | Threads OAuth callback |
| `POST` | `/api/broadcast/threads/:id` | Post tweet to Threads |
| `GET` | `/api/auth/instagram` | Start Instagram OAuth flow |
| `POST` | `/api/broadcast/instagram/:id` | Post quote card to Instagram |
| `GET` | `/api/broadcast/instagram/preview/:id` | Preview quote card without posting |

### Search & AI
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/semantic-search` | GPT-4o powered semantic search (generates SQL from natural language) |

### Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/export/json` | Export filtered tweets as JSON download |
| `GET` | `/api/export/csv` | Export filtered tweets as CSV download |

### Import & Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/import/upload` | Upload Twitter archive ZIP (extracts + imports) |
| `GET` | `/api/quoted-tweet/:id` | Fetch quoted tweet content (syndication API + oEmbed fallback) |
| `POST` | `/api/quoted-tweets/batch` | Batch fetch multiple quoted tweets |
| `POST` | `/api/admin/migrate-to-persistent` | Copy local DB to Render persistent disk |

---

## 8. Frontend: Content Directory

**Files:** `index.html`, `app.js` (1529 lines), `styles.css` (30KB)

### Layout
- **Left Sidebar**: Stats panel, filter dropdowns (type, length, swipe status), checkbox filters (hide retweets/replies/threads/duplicates), tag sections (topic/pattern/use/custom), import section, export buttons
- **Main Content**: AI semantic search bar, text search bar, sort controls, tweet card grid, pagination

### Key Features
- **Tag Filtering**: Click to include, right-click/long-press to exclude. Comma-separated multi-tag support.
- **Batch Operations**: Select multiple tweets → bulk add/remove tags
- **Tweet Modal**: Full tweet detail view with inline editing of notes, first impressions, quality rating, blog text, and tag management
- **AI Semantic Search**: Natural language queries processed by GPT-4o that generates SQL dynamically
- **Export**: Current filter state applied to CSV/JSON exports
- **Archive Upload**: ZIP file upload → server-side extraction → import pipeline

### State Management (app.js)
```javascript
let state = {
    tweets: [],
    tags: { topic: [], pattern: [], use: [], custom: [] },
    allTags: [],
    stats: {},
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    filters: {
        search: '', type: '', length: '', swipe: '', reviewed: '',
        tag: '', excludeTag: '',
        excludeRetweets: true, excludeReplies: true,
        excludeThreads: false, excludeDuplicates: true
    },
    sort: { by: 'created_at', order: 'desc' },
    selectedTweet: null,
    selectedTweets: new Set()
};
```

---

## 9. Frontend: Swipe Interface

**Files:** `swipe.html`, `swipe.js` (919 lines), `swipe.css` (23KB), `hammer.min.js`

### Tinder-Style Card Swiping
- **Left swipe / ← key**: Pass (dislike)
- **Right swipe / → key**: Like
- **Up swipe / ↑ key**: Superlike (auto-sets quality to "high")
- **Down swipe / ↓ key**: Review Later
- **Z key**: Undo last swipe
- **B key**: Send to broadcast queue

### Card Stack Rendering
- Cards stack 3-deep with CSS transforms for depth effect
- Touch gestures via Hammer.js with `SWIPE_THRESHOLD = 120px`
- Visual feedback: tilt angle, color overlay (green/red/gold/blue)
- Confetti animation on superlike, heart animation on like

### Tag System in Swipe Mode
- Sidebar with topic tags for quick-tagging
- Inline tag input with autocomplete suggestions
- Tag filter dropdown to focus on specific categories (e.g., "blog-candidate")
- Tags display on each card with removable chips

### Queue Loading
- Fetches unreviewed tweets in batches of 10
- Supports tag-based filtering of the queue
- Progress bar showing remaining/total
- Session stats (today's count)

### Auto-Tag on Swipe
When you like or superlike a tweet tagged "blog-candidate", it automatically adds the "blog-ready" tag, making it appear in the Blog Scheduler.

---

## 10. Frontend: Blog Scheduler

**Files:** `scheduler.html`, `scheduler.js` (526 lines), `scheduler.css` (13KB)

### Purpose
Manages the queue of "blog-ready" tweets that will be published as Substack blog posts.

### Features
- **Drag-and-drop reordering** via Sortable.js
- **Auto-calculated dates**: Starting from Feb 15, 2026, weekly on Sundays
- **AI Title Generation**: 3 title/subtitle options per post (GPT-4o)
- **Manual Title Override**: Edit title and subtitle inline
- **Header Image Upload**: Upload custom images per post
- **Expand/Collapse Cards**: Minimize for overview, expand for editing
- **Push to Substack**: One-click creates draft + schedules on Substack via internal API
- **Batch Schedule**: Schedule all pending posts for the next month

### Title Options System
Each blog post gets 3 AI-generated title/subtitle pairs. The user can:
1. Click "Use" on any AI option
2. Manually edit the title and subtitle
3. Save the selected title to the database

---

## 11. Frontend: Broadcast Queue

**Files:** `notes-queue.html`, `notes-queue.js` (242 lines), `notes-queue.css` (7KB)

### Purpose
Manages short-form content broadcasting to multiple platforms.

### Platform Integrations
| Platform | Status | Method |
|----------|--------|--------|
| Substack Notes | Ready | YAML export → Finn Tropy Chrome extension |
| Bluesky | Connected | Direct API posting via AT Protocol |
| LinkedIn | Coming Soon | OAuth 2.0 integrated but UI disabled |
| Threads | Coming Soon | Meta API integrated but UI disabled |

### Features
- **Drag-and-drop reorder** the queue
- **Scheduling options**: Start date, posts/day (1-5), time window (e.g., 9AM-9PM)
- **Schedule preview**: Shows date range and distribution
- **Export YAML**: Generates YAML file compatible with Finn Tropy's Substack Notes Scheduler
- **Batch Bluesky posting**: Posts all items with 1-minute delays between posts
- **Character count display**: Warning at 250+, error at 300+ (Bluesky limit)

---

## 12. Twitter Archive Import Pipeline

**File:** `scripts/import.js` (393 lines)

### How It Works

1. **Parse Twitter's JS format**: Twitter archives use `window.YTD.tweets.part0 = [...]` format. The script strips the JS wrapper and parses the JSON array.

2. **Load Note Tweets**: Long-form tweets (>280 chars) have their full text in a separate `note-tweet.js` file. The importer builds a prefix-based lookup to match truncated tweets with their full content.

3. **Thread Detection**: Replies to yourself (same username) are classified as `thread` type.

4. **Tweet Type Classification** (priority order):
   - Starts with "RT @" → `retweet`
   - Reply to self → `thread`
   - Has `in_reply_to_status_id` → `reply`
   - Has quoted status → `quote`
   - Has media → `media`
   - Otherwise → `text_only`

5. **Media Info Extraction**: Gets best quality URL for photos/videos/GIFs from `extended_entities`.

6. **Length Categories**: short (≤280), medium (281-1000), long (>1000)

7. **Deduplication**: Uses `INSERT OR IGNORE` to skip existing tweet IDs.

8. **Auto-tagging**: After import, runs `tag_new_tweets.js` for heuristic tagging.

### Usage
```bash
# From extracted archive
node scripts/import.js /path/to/twitter_archive/data

# Or upload via web UI (index.html → Import section)
```

---

## 13. Utility Modules (API Clients)

### 13.1 `utils/ai.js` — OpenAI GPT-4o
- **`generateTitleOptions(text)`**: Generates 3 title/subtitle pairs for blog posts
- Uses `gpt-4o` model with JSON response format
- Sentence case enforcement in prompt
- Truncates input to 8000 chars to avoid token limits

### 13.2 `utils/bluesky-api.js` — Bluesky AT Protocol
```javascript
class BlueskyAPI {
    async login()              // Authenticate with handle + app password
    async testConnection()     // Get profile info
    async post(text)           // Post text (300 char limit, auto-truncate)
    async postBatch(texts, delayMs=60000) // Batch post with delays
}
```
- Uses `@atproto/api` SDK
- `RichText` for auto-detecting links, mentions, hashtags

### 13.3 `utils/substack-api.js` — Substack Internal API
```javascript
class SubstackAPI {
    async request(method, path, body)  // Authenticated HTTP request
    async getScheduledPosts()          // List scheduled posts
    async getDrafts()                  // List drafts
    async getLatestScheduledDate()     // Find last scheduled date
    async createDraft(title, subtitle, bodyHtml, coverImageUrl)
    async scheduleDraft(draftId, scheduledDate)
    async createAndSchedule(title, subtitle, bodyHtml, date, coverImage)
    calculateNextSlot(lastDate)        // 2x/week: Sun + Wed at 9am
    async getNextAvailableSlot()
    async testConnection()
}
```
- **Authentication**: Session cookie (`substack.sid`) — no CSRF token needed
- **Custom Domain Support**: Works with both `pub.substack.com` and custom domains
- **Key Insight**: Origin/Referer headers must match the publication domain exactly
- Includes `formatArticleBody()` and subscribe button HTML generators

### 13.4 `utils/linkedin-api.js` — LinkedIn OAuth 2.0
```javascript
class LinkedInAPI {
    getAuthUrl()                    // Generate OAuth authorization URL
    async exchangeCodeForTokens(code)
    async refreshAccessToken()
    async getProfile()              // Get Person URN
    async createPost(text, mediaUrn)
    async uploadImage(imagePath)    // Register upload → upload file
}
```
- Scopes: `openid profile w_member_social email`
- Uses Unified Posts API v2

### 13.5 `utils/threads-api.js` — Meta Threads API
```javascript
class ThreadsAPI {
    getAuthUrl()                    // OAuth authorization URL
    async exchangeCodeForTokens(code) // Short-lived → long-lived (60 days)
    async refreshToken()
    async getProfile()
    async createPost(text)          // Two-step: container → publish
    async createImagePost(text, imageUrl)
}
```
- Two-step publish flow: create media container → publish container
- 500 char limit for text posts

### 13.6 `utils/instagram-api.js` — Instagram + Quote Cards
```javascript
class InstagramAPI {
    async generateQuoteCard(text, attribution, id)  // Puppeteer → 1080x1080 JPEG
    async uploadImage(imagePath)    // Upload to Imgur for public URL
    async createPost(imageUrl, caption)  // Two-step Graph API post
    async postQuoteCard(text, caption, id)  // Full pipeline
}
```
- **Quote Card Generation**: Uses Puppeteer to render `templates/quote-card.html` at 1080×1080
- **Dynamic Font Sizing**: XL (<80 chars), LG (80-180), MD (180-280), SM (280+)
- **Image Hosting**: Uploads to Imgur (anonymous, free) to get public URLs required by Instagram Graph API
- **Design**: Dark gradient background, accent line, corner decorations, Inter font

---

## 14. Automation Scripts

### Tagging Scripts
| Script | Purpose |
|--------|---------|
| `auto_tag_heuristics.js` | Rule-based tagging using keyword matching (17KB of rules) |
| `llm_tagger.js` | AI tagging using Google Gemini |
| `llm_tagger_openai.js` | AI tagging using OpenAI GPT-4 |
| `tag_new_tweets.js` | Tags newly imported tweets (runs after import) |
| `auto_recirculate_tags.js` | Auto-tag tweets for recirculation based on engagement metrics |
| `add_tbr_tags.js` | Add "to-be-reviewed" tags |

### Content Processing
| Script | Purpose |
|--------|---------|
| `combine_threads.js` | Combines sequential thread tweets into single `combined_text` |
| `detect_duplicates.js` | Finds duplicate tweet content and tags them |
| `download_media.js` | Downloads tweet media files locally |
| `screenshot_quotes.js` | Generates quote card images via Puppeteer |
| `process_manual_tweets.js` | Processes manually tagged tweets into subcategories |

### Substack Integration
| Script | Purpose |
|--------|---------|
| `analyze_for_substack.js` | Analyzes tweets for Substack suitability |
| `build_substack_queue.js` | Builds the Substack posting queue |
| `substack_poster.js` | Posts to Substack Notes |
| `substack_blog_poster.js` | Posts to Substack Blog |
| `prepare_blog_content.js` | Cleans and formats content for blog posts |
| `export_blog_candidates.js` | Exports blog-ready tweets to markdown |

### Sync & Maintenance
| Script | Purpose |
|--------|---------|
| `sync_tags.js` | Sync tags between databases |
| `sync_titles.js` | Sync title data |
| `sync_blog_text.js` | Sync blog text fields |
| `sync_duplicate_tags.js` | Sync duplicate tags |
| `sync_tag_removals.js` | Sync tag removals |
| `sync_substack.js` | Sync Substack queue status |
| `migrate_schema.js` | Run database migrations |
| `clear_use_tags.js` | Clear use-category tags |
| `update_tag_category.js` | Bulk update tag categories |
| `populate_titles.js` | Populate title fields |
| `regenerate_titles.js` | Regenerate AI titles |
| `push_generated_titles.js` | Push generated titles to DB |

---

## 15. Deployment (Render)

### `render.yaml`
```yaml
services:
  - type: web
    name: tweet-curator
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: OPENAI_API_KEY
        sync: false
    disk:
      name: tweet-data
      mountPath: /data
      sizeGB: 1
```

### Deployment Steps
1. Push code to GitHub (include `data_tweets.db` as seed)
2. Create Render Web Service → connect GitHub repo
3. Add environment variables (OPENAI_API_KEY, etc.)
4. Enable 1GB persistent disk at `/data`
5. Deploy — the server auto-detects `/data` and copies the seed DB there on first run

### Database Strategy
- **`data_tweets.db`**: Committed to repo as seed database
- **`tweets.db`**: Runtime database, gitignored
- On Render: Uses `/data/tweets.db` on persistent disk
- Auto-migration ensures schema stays current across deployments

---

## 16. Key Design Decisions

### Why SQLite (not PostgreSQL)?
- **Zero infrastructure**: No separate database server needed
- **Speed**: `better-sqlite3` is synchronous — no async overhead for DB queries
- **Portability**: Single file, easy to backup/restore/copy
- **WAL mode**: Enables concurrent reads while writing
- **FTS5**: Built-in full-text search, no external search engine needed

### Why a Single server.js (not split)?
- The entire API lives in one file for simplicity and quick iteration
- Auto-migration and startup logic benefit from running in sequence
- Trade-off: 3000+ lines is large, but the code is well-sectioned with comment headers

### Why Vanilla JS Frontend (no React/Vue)?
- **Zero build step**: Edit JS → refresh browser → see changes
- **No framework overhead**: Faster initial load for a personal tool
- **Direct DOM manipulation**: Simple state → render cycle without virtual DOM

### Tag System Design
Tags have 4 categories with distinct purposes:
- **topic**: What the tweet is about (AI-assigned)
- **pattern**: How the tweet is structured (AI-assigned)
- **use**: What to do with the tweet (manually assigned: book, blog, broadcast)
- **custom**: Freeform user tags

The `use` category drives the content pipeline:
1. AI tags tweets with topic + pattern
2. User swipes to curate (like/superlike/pass)
3. User tags best ones as `blog-candidate` or `broadcast-ready`
4. `blog-candidate` + like/superlike → auto-tagged `blog-ready` → appears in Scheduler
5. `broadcast-ready` → appears in Notes Queue

### Quoted Tweet Fetching Strategy
1. First check if it's a self-quote (in the tweets table)
2. Then check the `quoted_tweets` cache table
3. Then try Twitter's syndication API (no auth required)
4. Then try Twitter's oEmbed API
5. Cache result in `quoted_tweets` for future lookups
6. Mark as unavailable if all methods fail

### Semantic Search Architecture
The AI search doesn't use embeddings. Instead:
1. User types natural language query
2. GPT-4o generates a SQL WHERE clause + ORDER BY
3. Server executes the generated SQL against the database
4. This allows combining text search, tag filters, and sorting in one query
5. The prompt includes the full tag list so GPT-4o can reference real tags

---

## Getting Started (Quick Replication)

```bash
# 1. Clone/create the project
mkdir tweet_curator && cd tweet_curator

# 2. Initialize with package.json (copy from section 2)
npm init -y
# Edit package.json to match the spec above

# 3. Install dependencies
npm install

# 4. Create the directory structure
mkdir -p database public/templates scripts utils media/downloaded uploads

# 5. Create database schema (copy schema.sql from section 5)
# Create .env with your API keys (section 4)

# 6. Build the server (copy/adapt server.js patterns from sections 6-7)
# Build the frontend files (sections 8-11)
# Build the utility modules (section 13)

# 7. Import your Twitter archive
# Download from twitter.com/settings → Your Account → Download Archive
node scripts/import.js /path/to/twitter_archive/data

# 8. Start the server
npm start
# Open http://localhost:3000
```

---

*This guide was generated from the complete Tweet Curator codebase as of March 2026.*
