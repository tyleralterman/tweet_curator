/**
 * Tweet Curator - Swipe Interface Logic
 */

// State
const state = {
    queue: [],
    history: [],
    loading: false,
    stats: { total: 0, remaining: 0, today: 0 },
    currentCard: null
};

// DOM Elements
const elements = {
    cardStack: document.getElementById('cardStack'),
    btnDislike: document.getElementById('btnDislike'),
    btnLike: document.getElementById('btnLike'),
    btnSuperlike: document.getElementById('btnSuperlike'),
    btnReviewLater: document.getElementById('btnReviewLater'),
    btnUndo: document.getElementById('btnUndo'),
    progressBar: document.getElementById('progressBar'),
    remainingCount: document.getElementById('remainingCount'),
    todayCount: document.getElementById('todayCount')
};

// Config
const BATCH_SIZE = 10;
const SWIPE_THRESHOLD = 80;

// ============================================
// Initialization
// ============================================

async function init() {
    await fetchStats();
    await loadMoreTweets();
    setupEventHandlers();
    setupKeyboardShortcuts();

    // Load Twitter Widgets
    if (!window.twttr) {
        const script = document.createElement('script');
        script.src = "https://platform.twitter.com/widgets.js";
        script.async = true;
        document.body.appendChild(script);
    }
}

// ============================================
// Data Fetching
// ============================================

async function fetchStats() {
    try {
        const [queueRes, sessionRes] = await Promise.all([
            fetch('/api/swipe/queue?limit=1'), // Just to get remaining count
            fetch('/api/swipe/today')
        ]);
        const queueData = await queueRes.json();
        const sessionData = await sessionRes.json();
        state.stats.remaining = queueData.remaining;
        state.stats.today = sessionData.tweets_swiped || 0;
        updateStatsUI();
    } catch (err) { console.error('Error fetching stats:', err); }
}

async function loadMoreTweets() {
    if (state.loading) return;
    state.loading = true;

    try {
        const params = new URLSearchParams({ limit: BATCH_SIZE });
        const response = await fetch(`/api/swipe/queue?${params}`);
        const data = await response.json();

        if (data.tweets && data.tweets.length > 0) {
            // Filter duplicates if any remain (though we cleared queue)
            const newTweets = data.tweets; // .filter(t => !state.queue.find(q => q.id === t.id));
            state.queue.push(...newTweets);
            renderCards();
        } else if (state.queue.length === 0) {
            renderCards(); // Force empty state render
        }

        state.stats.remaining = data.remaining;
        updateStatsUI();
        updateProgress(data.remaining);
    } catch (err) {
        console.error('Error loading tweets:', err);
    } finally {
        state.loading = false;
    }
}

async function submitSwipe(tweetId, status) {
    try {
        await fetch(`/api/tweets/${tweetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ swipe_status: status })
        });
        state.stats.remaining--;
        state.stats.today++;
        updateStatsUI();
    } catch (err) {
        console.error('Error submitting swipe:', err);
    }
}

// ============================================
// UI Rendering
// ============================================

function updateStatsUI() {
    elements.remainingCount.textContent = state.stats.remaining;
    elements.todayCount.textContent = state.stats.today;

    // Progress calculation (just visual approximation based on remaining)
    // Assuming total start was higher, or just show remaining relative to batch
    const total = state.stats.remaining + state.stats.today;
    const progress = total > 0 ? (state.stats.today / total) * 100 : 0;
    elements.progressBar.style.width = `${progress}%`;
}

function renderCards() {
    const cardStack = elements.cardStack;
    const cards = Array.from(cardStack.children).filter(el => el.classList.contains('tweet-card'));

    if (cards.length >= 3) {
        document.querySelector('.loading-state')?.remove();
        return;
    }

    if (state.queue.length < 5) loadMoreTweets();

    const cardsNeeded = 3 - cards.length;
    let added = false;

    for (let i = 0; i < cardsNeeded; i++) {
        const tweet = state.queue.shift();
        if (!tweet) break;
        cardStack.appendChild(createCardElement(tweet));
        added = true;
    }

    if (added || cards.length > 0) document.querySelector('.loading-state')?.remove();

    if (cardStack.children.length === 0 && !state.loading && state.queue.length === 0) {
        cardStack.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>No tweets match your filters.</p>
            </div>
        `;
    } else if (state.loading && cardStack.children.length === 0) {
        // Show loading if empty and loading
        cardStack.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading curated tweets...</p>
        `;
    }
}

// Helper to remove media/quote links from text
function cleanText(text, mediaUrl, quotedId) {
    if (!text) return '';
    let cleaned = text;
    // Remove t.co links? 
    // Usually Twitter API provides `display_text_range` or `entities` to know what to cut.
    // Without those, simply removing the last link if it matches media is risky.
    // But typically `media_url` in our DB is the actual expanded URL, not the t.co one.
    // However, the `full_text` from archive often contains the t.co link at the end.
    // Let's use a heuristic: Remove links at the very end of the string.
    cleaned = cleaned.replace(/https:\/\/t\.co\/\w+\s*$/, '');
    // If there are multiple (quote + media), remove another one
    cleaned = cleaned.replace(/https:\/\/t\.co\/\w+\s*$/, '');
    return linkify(cleaned.trim());
}

function createCardElement(tweet) {
    const el = document.createElement('div');
    el.className = 'tweet-card';
    el.dataset.id = tweet.id;

    // Media
    let mediaHtml = '';
    if (tweet.media_url) {
        if (tweet.media_type === 'video') {
            mediaHtml = `<div class="card-media"><video src="${tweet.media_url}" class="media-content" controls muted loop></video></div>`;
        } else {
            mediaHtml = `<div class="card-media"><img src="${tweet.media_url}" class="media-content" alt="Tweet media"></div>`;
        }
    }

    // Quoted Tweet
    let quotedHtml = '';
    if (tweet.quoted_tweet_id) {
        if (tweet.quoted_text) {
            // Internal Quote
            const quotedMedia = tweet.quoted_media ? `<div class="quoted-media"><img src="${tweet.quoted_media}" loading="lazy"></div>` : '';
            quotedHtml = `
                <div class="quoted-tweet">
                    <div class="quoted-user">Quoted Tweet</div>
                    <div class="quoted-text">${linkify(tweet.quoted_text)}</div>
                    ${quotedMedia}
                </div>`;
        } else {
            // External Quote - Try OEmbed with container
            // Unique ID for this card's quote
            const containerId = `quote-${tweet.id}-${tweet.quoted_tweet_id}`;
            quotedHtml = `
                <div class="quoted-tweet external-quote" id="${containerId}">
                   <!-- Fallback content initially -->
                   <div class="quote-placeholder">
                       <div class="quoted-user">External Quote</div>
                       <a href="https://x.com/i/web/status/${tweet.quoted_tweet_id}" target="_blank" class="external-quote-link">
                           Loading Tweet... <span class="external-icon">↗</span>
                       </a>
                   </div>
                </div>`;

            // Try OEmbed
            setTimeout(() => {
                if (window.twttr && window.twttr.widgets) {
                    const container = document.getElementById(containerId);
                    if (container) {
                        window.twttr.widgets.createTweet(
                            tweet.quoted_tweet_id,
                            container,
                            { conversation: 'none', cards: 'hidden', theme: 'dark' }
                        ).then(el => {
                            if (el) {
                                const placeholder = container.querySelector('.quote-placeholder');
                                if (placeholder) placeholder.remove();
                                container.classList.remove('external-quote');
                            }
                        });
                    }
                }
            }, 500);
        }
    }

    // Tags
    const tagsHtml = (tweet.tags || '').split(',').filter(t => t).map(t => `<span class="tag-badge">${t}</span>`).join('');
    const textContent = cleanText(tweet.full_text, tweet.media_url, tweet.quoted_tweet_id);
    const dateStr = new Date(tweet.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const tweetUrl = `https://twitter.com/i/web/status/${tweet.id}`;

    el.innerHTML = `
        <div class="card-content">
            <!-- No Header Date (Moved to Footer) -->
            ${tweet.tweet_type === 'thread' ? '<div class="tweet-header"><span class="thread-badge">THREAD</span></div>' : ''}
            
            <div class="tweet-text">${textContent}</div>
            ${mediaHtml}
            ${quotedHtml}
            <div class="card-tags">${tagsHtml}</div>

            <div class="card-footer">
                <div class="stat-group">
                    <span>❤️ ${tweet.favorite_count}</span>
                    <span>🔁 ${tweet.retweet_count}</span>
                </div>
                <a href="${tweetUrl}" target="_blank" class="footer-date-link">
                    📅 ${dateStr} <span class="external-icon">↗</span>
                </a>
            </div>
        </div>
        <div class="card-overlay overlay-like">LIKE</div>
        <div class="card-overlay overlay-dislike">PASS</div>
        <div class="card-overlay overlay-superlike">SUPER</div>
    `;

    // Drag handlers
    initDrag(el);

    return el;
}

function linkify(text) {
    if (!text) return '';
    // Basic escape to prevent XSS
    const escaped = text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Basic linkification
    return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" onclick="event.stopPropagation()">$1</a>');
}

// ============================================
// Swipe Logic
// ============================================

function initDrag(el) {
    const hammertime = new Hammer(el, {
        recognizers: [
            [Hammer.Pan, { direction: Hammer.DIRECTION_ALL, threshold: 10 }]
        ]
    });

    hammertime.on('pan', (ev) => {
        el.classList.add('moving');

        const xPos = ev.deltaX;
        const yPos = ev.deltaY;
        const rotate = xPos * 0.05;

        el.style.transform = `translate(${xPos}px, ${yPos}px) rotate(${rotate}deg)`;

        // Get overlays (use correct class names)
        const likeOverlay = el.querySelector('.overlay-like');
        const dislikeOverlay = el.querySelector('.overlay-dislike');
        const superlikeOverlay = el.querySelector('.overlay-superlike');

        // Reset opacities
        if (likeOverlay) likeOverlay.style.opacity = 0;
        if (dislikeOverlay) dislikeOverlay.style.opacity = 0;
        if (superlikeOverlay) superlikeOverlay.style.opacity = 0;

        // Show appropriate overlay based on direction
        if (xPos > 0 && Math.abs(xPos) > Math.abs(yPos)) {
            // Swiping right = LIKE
            if (likeOverlay) likeOverlay.style.opacity = Math.min(xPos / 100, 1);
        } else if (xPos < 0 && Math.abs(xPos) > Math.abs(yPos)) {
            // Swiping left = DISLIKE
            if (dislikeOverlay) dislikeOverlay.style.opacity = Math.min(Math.abs(xPos) / 100, 1);
        } else if (yPos < 0 && Math.abs(yPos) > Math.abs(xPos)) {
            // Swiping up = SUPERLIKE
            if (superlikeOverlay) superlikeOverlay.style.opacity = Math.min(Math.abs(yPos) / 100, 1);
        }
        // Down = review later (no overlay currently, just action)
    });

    hammertime.on('panend', (ev) => {
        el.classList.remove('moving');

        const xPos = ev.deltaX;
        const yPos = ev.deltaY;
        const keep = Math.abs(xPos) < SWIPE_THRESHOLD && Math.abs(yPos) < SWIPE_THRESHOLD;

        if (keep) {
            // Not enough movement - reset position
            el.style.transform = '';
            el.querySelectorAll('.card-overlay').forEach(o => o.style.opacity = 0);
        } else {
            // Determine direction and swipe
            if (Math.abs(xPos) > Math.abs(yPos)) {
                if (xPos > 0) swipeCard('right');
                else swipeCard('left');
            } else {
                if (yPos < 0) swipeCard('up');
                else swipeCard('down');
            }
        }
    });
}

function swipeCard(direction) {
    const card = elements.cardStack.querySelector('.tweet-card');
    if (!card) return;

    const id = card.dataset.id;
    let status = '';
    let animationClass = '';

    switch (direction) {
        case 'right':
            status = 'like';
            animationClass = 'fly-right';
            triggerHeart();
            break;
        case 'left':
            status = 'dislike';
            animationClass = 'fly-left';
            break;
        case 'up':
            status = 'superlike';
            animationClass = 'fly-up';
            triggerConfetti();
            break;
        case 'down':
            status = 'review_later';
            animationClass = 'fly-down';
            break;
    }

    card.classList.add(animationClass);

    // Save to history for undo
    state.history.push({
        id,
        tweet: { ...state.currentCard }, // Store data if needed
        status
    });
    elements.btnUndo.disabled = false;

    // Submit to API
    submitSwipe(id, status);

    // Remove from DOM after animation
    setTimeout(() => {
        card.remove();
        renderCards();
    }, 300);
}

function undoSwipe() {
    if (state.history.length === 0) return;

    const lastAction = state.history.pop();
    if (state.history.length === 0) {
        elements.btnUndo.disabled = true;
    }

    // Revert API call
    fetch(`/api/tweets/${lastAction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swipe_status: null, is_reviewed: 0 }) // Reset
    });

    // Update stats
    state.stats.remaining++;
    state.stats.today--;
    updateStatsUI();

    // Reload cards to get it back (simplest way)
    state.queue = [];
    elements.cardStack.innerHTML = '';
    loadMoreTweets();
}

function triggerConfetti() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#d4a84b', '#803040', '#ede5d8']
        });
    }
}

function triggerHeart() {
    const heart = document.createElement('div');
    heart.className = 'floating-heart';
    heart.textContent = '❤️';
    document.body.appendChild(heart);

    // Remove after animation
    setTimeout(() => {
        heart.remove();
    }, 1000);
}

// ============================================
// Event Handlers
// ============================================

function setupEventHandlers() {
    elements.btnLike.addEventListener('click', () => swipeCard('right'));
    elements.btnDislike.addEventListener('click', () => swipeCard('left'));
    elements.btnSuperlike.addEventListener('click', () => swipeCard('up'));
    elements.btnReviewLater.addEventListener('click', () => swipeCard('down'));
    elements.btnUndo.addEventListener('click', undoSwipe);
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (state.loading) return;

        switch (e.key) {
            case 'ArrowRight':
                swipeCard('right');
                break;
            case 'ArrowLeft':
                swipeCard('left');
                break;
            case 'ArrowUp':
                swipeCard('up');
                break;
            case 'ArrowDown':
                swipeCard('down');
                break;
            case 'z':
            case 'Z':
                if (!elements.btnUndo.disabled) undoSwipe();
                break;
        }
    });
}

// Hammer.js dummy implementation if not present (for non-touch dev environment fallback)
if (typeof Hammer === 'undefined') {
    console.warn('Hammer.js not loaded, using fallback');
    window.Hammer = class {
        constructor(el, options) { this.el = el; }
        on(event, handler) {
            // No-op fallback
        }
    };
    // Add missing constants
    window.Hammer.DIRECTION_ALL = 30;
    window.Hammer.Pan = function () { };
}

// Start - ensure DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init().catch(err => console.error('Init error:', err));
    });
} else {
    init().catch(err => console.error('Init error:', err));
}
