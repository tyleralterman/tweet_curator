# Tweet Curator - Content Directory

Your personal tweet archive manager with AI-powered tagging, semantic search, and swipe-based curation.

## Features

- 📚 **Content Directory** - Browse, search, and filter your tweet archive
- 💫 **Swipe Interface** - Tinder-style curation for reviewing tweets
- 🏷️ **Smart Tags** - AI-generated topic and pattern tags
- 🔍 **Semantic Search** - Natural language search powered by GPT-4
- 🐦 **Quote Tweets** - Embedded quoted tweet content

## Quick Start (Local)

```bash
npm install
npm start
```

Then open http://localhost:3000

## Deploy to Render

This app is configured for one-click deployment to Render:

1. Push this code to a GitHub repository
2. Go to [render.com](https://render.com) and sign up
3. Click "New" → "Web Service"
4. Connect your GitHub repository
5. Render will auto-detect the settings
6. Add your `OPENAI_API_KEY` in Environment Variables
7. Click "Deploy"

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key for semantic search |
| `PORT` | No | Server port (default: 3000) |

## Data Storage

The app uses SQLite for data storage. On Render, enable a persistent disk at `/data` to preserve your database across deployments.
