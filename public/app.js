/**
 * Tweet Curator - Content Directory App
 */

// State
let state = {
    tweets: [],
    tags: { topic: [], pattern: [], use: [], custom: [] },
    allTags: [],
    stats: {},
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    filters: {
        search: '',
        type: '',
        length: '',
        // quality: '', REMOVED
        swipe: '',
        tags: [], // Changed to array for multi-tag filtering
        excludeRetweets: true,
        excludeReplies: true,
        excludeThreads: false // Changed to false - show thread starters
    },
    sort: { by: 'created_at', order: 'desc' },
    selectedTweet: null
};

// DOM Elements
const elements = {
    tweetGrid: document.getElementById('tweetGrid'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    filterType: document.getElementById('filterType'),
    filterLength: document.getElementById('filterLength'),
    filterQuality: null, // REMOVED
    filterSwipe: document.getElementById('filterSwipe'),
    excludeRetweets: document.getElementById('excludeRetweets'),
    filterSwipe: document.getElementById('filterSwipe'),
    excludeRetweets: document.getElementById('excludeRetweets'),
    excludeReplies: document.getElementById('excludeReplies'),
    excludeThreads: document.getElementById('excludeThreads'),
    sortBy: document.getElementById('sortBy'),
    sortOrder: document.getElementById('sortOrder'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    pageInfo: document.getElementById('pageInfo'),
    resultCount: document.getElementById('resultCount'),
    clearFilters: document.getElementById('clearFilters'),
    topicTags: document.getElementById('topicTags'),
    patternTags: document.getElementById('patternTags'),
    useTags: document.getElementById('useTags'),
    customTags: document.getElementById('customTags'),
    modal: document.getElementById('tweetModal'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.querySelector('.modal-close'),
    importBtn: document.getElementById('importBtn'),
    archiveInput: document.getElementById('archiveInput'),
    importStatus: document.getElementById('importStatus'),
    // Stats
    totalTweets: document.getElementById('totalTweets'),
    superlikedCount: document.getElementById('superlikedCount'),
    likedCount: document.getElementById('likedCount'),
    reviewedCount: document.getElementById('reviewedCount'),
    todayCount: document.getElementById('todayCount')
};

// ============================================
// API Functions
// ============================================

async function fetchTweets() {
    const params = new URLSearchParams({
        page: state.pagination.page,
        limit: state.pagination.limit,
        sort: state.sort.by,
        order: state.sort.order,
        search: state.filters.search,
        type: state.filters.type,
        length: state.filters.length,
        // quality removed
        swipe: state.filters.swipe,
        tag: state.filters.tags.join(','), // Send as comma-separated for multi-tag
        excludeRetweets: state.filters.excludeRetweets,
        excludeReplies: state.filters.excludeReplies,
        excludeThreads: state.filters.excludeThreads
    });

    try {
        const response = await fetch(`/api/tweets?${params}`);
        const data = await response.json();
        state.tweets = data.tweets;
        state.pagination = data.pagination;
        renderTweets();
        updatePaginationUI();
    } catch (err) {
        console.error('Error fetching tweets:', err);
        elements.tweetGrid.innerHTML = `
            <div class="empty-state">
                <h3>Error loading tweets</h3>
                <p>${err.message}</p>
            </div>
        `;
    }
}

async function fetchTags() {
    try {
        const response = await fetch('/api/tags');
        state.tags = await response.json();
        state.allTags = [
            ...state.tags.topic,
            ...state.tags.pattern,
            ...(state.tags.use || []),
            ...state.tags.custom
        ];
        renderTags();
    } catch (err) {
        console.error('Error fetching tags:', err);
    }
}

async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        state.stats = data.stats;
        state.todayStats = data.todayStats || { tweets_swiped: 0 };
        updateStatsUI();
    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

async function updateTweet(tweetId, updates) {
    try {
        await fetch(`/api/tweets/${tweetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        // Refresh data
        fetchTweets();
        fetchStats();
    } catch (err) {
        console.error('Error updating tweet:', err);
    }
}

async function addTag(tweetId, tagName, category = 'custom') {
    try {
        const response = await fetch(`/api/tweets/${tweetId}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tagName, tagCategory: category })
        });

        if (!response.ok) {
            const err = await response.json();
            console.error('Error adding tag:', err);
            return false;
        }

        // Update local state for the tweet so UI reflects change immediately
        const tweet = state.tweets.find(t => t.id === tweetId);
        if (tweet) {
            if (!tweet.tags) tweet.tags = [];
            // Avoid duplicates
            if (!tweet.tags.some(t => t.name === tagName.toLowerCase())) {
                tweet.tags.push({ name: tagName.toLowerCase(), category, color: '#30363d' });
            }
        }

        // Also update selectedTweet if open
        if (state.selectedTweet && state.selectedTweet.id === tweetId) {
            if (!state.selectedTweet.tags) state.selectedTweet.tags = [];
            if (!state.selectedTweet.tags.some(t => t.name === tagName.toLowerCase())) {
                state.selectedTweet.tags.push({ name: tagName.toLowerCase(), category, color: '#30363d' });
            }
        }

        // Refresh tags sidebar (async, don't wait)
        fetchTags();
        return true;
    } catch (err) {
        console.error('Error adding tag:', err);
        return false;
    }
}

async function removeTag(tweetId, tagName) {
    try {
        const response = await fetch(`/api/tweets/${tweetId}/tags/${tagName}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            console.error('Error removing tag');
            return false;
        }

        // Update local state for the tweet
        const tweet = state.tweets.find(t => t.id === tweetId);
        if (tweet && tweet.tags) {
            tweet.tags = tweet.tags.filter(t => t.name !== tagName.toLowerCase());
        }

        // Also update selectedTweet if open
        if (state.selectedTweet && state.selectedTweet.id === tweetId && state.selectedTweet.tags) {
            state.selectedTweet.tags = state.selectedTweet.tags.filter(t => t.name !== tagName.toLowerCase());
        }

        fetchTags();
        return true;
    } catch (err) {
        console.error('Error removing tag:', err);
        return false;
    }
}

async function uploadArchive(file) {
    const formData = new FormData();
    formData.append('archive', file);

    elements.importBtn.disabled = true;
    elements.importStatus.textContent = 'Uploading and importing...';
    elements.importStatus.className = 'import-status';

    try {
        const response = await fetch('/api/import/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            elements.importStatus.textContent = '✓ Import complete!';
            elements.importStatus.className = 'import-status success';
            // Refresh data
            fetchTweets();
            fetchStats();
            fetchTags();
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        elements.importStatus.textContent = `✗ ${err.message}`;
        elements.importStatus.className = 'import-status error';
    } finally {
        elements.importBtn.disabled = false;
    }
}

// ============================================
// Render Functions
// ============================================

function renderTweets() {
    if (state.tweets.length === 0) {
        elements.tweetGrid.innerHTML = `
            <div class="empty-state">
                <h3>No tweets found</h3>
                <p>Try adjusting your filters</p>
            </div>
        `;
        return;
    }

    elements.tweetGrid.innerHTML = state.tweets.map(tweet => {
        const swipeClass = tweet.swipe_status === 'superlike' ? 'superliked' :
            tweet.swipe_status === 'like' ? 'liked' : '';

        const swipeBadge = tweet.swipe_status === 'superlike' ? '⭐' :
            tweet.swipe_status === 'like' ? '❤️' :
                tweet.swipe_status === 'dislike' ? '👎' :
                    tweet.swipe_status === 'review_later' ? '🔄' : '';

        // In createTweetElement:
        // Quality Badge REMOVED
        const qualityBadge = '';

        // In openTweetModal:
        // Quality Buttons REMOVED
        /*
                    <h4>Quality Rating</h4>
                    <div class="quality-buttons">
                        ...
                    </div>
        */

        const date = new Date(tweet.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const tagsHtml = tweet.tags.slice(0, 3).map(tag =>
            `<span class="tweet-tag ${tag.category}">${tag.name}</span>`
        ).join('');

        // Media preview
        const mediaHtml = tweet.media_url ? `
            <div class="tweet-media">
                <img src="${tweet.media_url}" alt="Media" loading="lazy" onerror="this.parentElement.style.display='none'">
            </div>
        ` : '';

        // Tweet URL link
        const tweetLink = tweet.tweet_url ? `
            <a href="${tweet.tweet_url}" target="_blank" class="tweet-link" onclick="event.stopPropagation()">View on X →</a>
        ` : '';

        // Quoted Tweet
        let quotedHtml = '';
        if (tweet.quoted_tweet_id) {
            if (tweet.quoted_text) {
                const quotedMedia = tweet.quoted_media ? `
                    <div class="quoted-media">
                        <img src="${tweet.quoted_media}" loading="lazy" alt="Quoted Media" onerror="this.parentElement.style.display='none'">
                    </div>
                ` : '';

                quotedHtml = `
                    <div class="quoted-tweet">
                        <div class="quoted-user">@tyleralterman</div>
                        <div class="quoted-text">${linkify(tweet.quoted_text)}</div>
                        ${quotedMedia}
                    </div>
                `;
            } else {
                // Placeholder for external quote - will be lazy loaded
                quotedHtml = `
                    <div class="quoted-tweet" data-quoted-id="${tweet.quoted_tweet_id}">
                        <div class="quoted-loading">Loading quoted tweet...</div>
                    </div>
                `;
            }
        }

        return `
            <div class="tweet-card ${swipeClass}" data-id="${tweet.id}">
                <div class="tweet-header">
                    <div class="tweet-badges">
                        ${swipeBadge ? `<span class="swipe-badge">${swipeBadge}</span>` : ''}
                        ${qualityBadge}
                    </div>
                </div>
                <div class="tweet-text">${linkify(tweet.full_text)}</div>
                ${mediaHtml}
                ${quotedHtml}
                <div class="tweet-footer">
                    <div class="tweet-meta">
                        <span>${date}</span>
                        <div class="tweet-stats">
                            <span class="tweet-stat">❤️ ${tweet.favorite_count}</span>
                            <span class="tweet-stat">🔁 ${tweet.retweet_count}</span>
                        </div>
                    </div>
                    <div class="tweet-tags">${tagsHtml}</div>
                    ${tweetLink}
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    document.querySelectorAll('.tweet-card').forEach(card => {
        card.addEventListener('click', () => openTweetModal(card.dataset.id));
    });

    // Lazy load quoted tweets
    loadQuotedTweets();
}

// Fetch and render quoted tweet content
async function loadQuotedTweets() {
    const quotedElements = document.querySelectorAll('.quoted-tweet[data-quoted-id]');
    if (quotedElements.length === 0) return;

    for (const el of quotedElements) {
        const quotedId = el.dataset.quotedId;
        if (!quotedId) continue;

        try {
            const response = await fetch(`/api/quoted-tweet/${quotedId}`);
            const data = await response.json();

            if (data.is_available && data.content) {
                el.innerHTML = `
                    <div class="quoted-user">@${data.author_username || 'unknown'}</div>
                    <div class="quoted-text">${linkify(data.content)}</div>
                    ${data.media_url ? `<div class="quoted-media"><img src="${data.media_url}" loading="lazy" alt="Media" onerror="this.parentElement.style.display='none'"></div>` : ''}
                `;
            } else {
                el.innerHTML = `
                    <div class="quoted-user">Quoted Tweet</div>
                    <div class="quoted-unavailable">
                        <span>Tweet unavailable</span>
                        <a href="https://x.com/i/web/status/${quotedId}" target="_blank" onclick="event.stopPropagation()">Try viewing on X →</a>
                    </div>
                `;
            }
        } catch (err) {
            console.error('Error loading quoted tweet:', err);
            el.innerHTML = `
                <div class="quoted-user">Quoted Tweet</div>
                <a href="https://x.com/i/web/status/${quotedId}" target="_blank" onclick="event.stopPropagation()">View on X →</a>
            `;
        }
    }
}

function renderTags() {
    // Helper to check if tag is selected
    const isSelected = (tagName) => state.filters.tags.includes(tagName);

    // Topic tags
    elements.topicTags.innerHTML = state.tags.topic.map(tag => `
        <button class="tag-btn ${isSelected(tag.name) ? 'active' : ''}" 
                data-tag="${tag.name}"
                style="border-color: ${tag.color}">
            ${tag.name} <span class="count">${tag.tweet_count}</span>
        </button>
    `).join('');

    // Pattern tags
    elements.patternTags.innerHTML = state.tags.pattern.map(tag => `
        <button class="tag-btn ${isSelected(tag.name) ? 'active' : ''}" 
                data-tag="${tag.name}"
                style="border-color: ${tag.color}">
            ${tag.name} <span class="count">${tag.tweet_count}</span>
        </button>
    `).join('');

    // Use tags
    if (elements.useTags && state.tags.use) {
        elements.useTags.innerHTML = state.tags.use.map(tag => `
            <button class="tag-btn use ${isSelected(tag.name) ? 'active' : ''}" 
                    data-tag="${tag.name}"
                    style="border-color: ${tag.color}">
                ${tag.name} <span class="count">${tag.tweet_count}</span>
            </button>
        `).join('');
    }

    // Custom tags
    if (elements.customTags && state.tags.custom && state.tags.custom.length > 0) {
        elements.customTags.innerHTML = state.tags.custom.map(tag => `
            <button class="tag-btn custom ${isSelected(tag.name) ? 'active' : ''}" 
                    data-tag="${tag.name}"
                    style="border-color: ${tag.color || '#8e44ad'}">
                ${tag.name} <span class="count">${tag.tweet_count}</span>
            </button>
        `).join('');
    } else if (elements.customTags) {
        elements.customTags.innerHTML = '<span class="no-tags">No custom tags yet</span>';
    }

    // Add click handlers - toggle tags in/out of array
    document.querySelectorAll('.tag-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tagName = btn.dataset.tag;
            const idx = state.filters.tags.indexOf(tagName);
            if (idx >= 0) {
                // Remove tag from filter
                state.filters.tags.splice(idx, 1);
            } else {
                // Add tag to filter
                state.filters.tags.push(tagName);
            }
            state.pagination.page = 1;
            fetchTweets();
            renderTags();
        });
    });
}

function updateStatsUI() {
    const s = state.stats;
    elements.totalTweets.textContent = formatNumber(s.total - (s.retweets || 0));
    elements.superlikedCount.textContent = formatNumber(s.superliked || 0);
    elements.likedCount.textContent = formatNumber(s.liked || 0);
    elements.reviewedCount.textContent = formatNumber(s.reviewed || 0);

    // Today's swipe count
    if (elements.todayCount && state.todayStats) {
        elements.todayCount.textContent = formatNumber(state.todayStats.tweets_swiped || 0);
    }
}

function updatePaginationUI() {
    const { page, total, totalPages } = state.pagination;

    elements.pageInfo.textContent = `Page ${page} of ${totalPages}`;
    elements.prevPage.disabled = page <= 1;
    elements.nextPage.disabled = page >= totalPages;
    elements.resultCount.textContent = `${formatNumber(total)} tweets`;

    // Update export URLs with current filters
    updateExportUrls();
}

function updateExportUrls() {
    const params = new URLSearchParams();

    // quality removed
    if (state.filters.swipe) params.set('swipe', state.filters.swipe);
    if (state.filters.type) params.set('type', state.filters.type);
    if (state.filters.length) params.set('length', state.filters.length);
    if (state.filters.tags.length > 0) params.set('tag', state.filters.tags.join(','));
    params.set('excludeRetweets', state.filters.excludeRetweets);
    params.set('excludeReplies', state.filters.excludeReplies);
    params.set('excludeThreads', state.filters.excludeThreads);

    const queryString = params.toString();

    const csvLink = document.getElementById('exportCSV');
    const jsonLink = document.getElementById('exportJSON');

    if (csvLink) csvLink.href = `/api/export/csv?${queryString}`;
    if (jsonLink) jsonLink.href = `/api/export/json?${queryString}`;
}

// ============================================
// Modal Functions
// ============================================

async function openTweetModal(tweetId) {
    let tweet = state.tweets.find(t => t.id === tweetId);
    if (!tweet) {
        try {
            const response = await fetch(`/api/tweets/${tweetId}`);
            tweet = await response.json();
        } catch (err) {
            console.error('Error fetching tweet:', err);
            return;
        }
    }

    state.selectedTweet = tweet;

    const date = new Date(tweet.created_at).toLocaleString();

    // Media display
    const mediaHtml = tweet.media_url ? `
        <div class="modal-media">
            <img src="${tweet.media_url}" alt="Media">
        </div>
    ` : '';

    // Quoted Tweet
    let quotedHtml = '';
    if (tweet.quoted_tweet_id) {
        if (tweet.quoted_text) {
            const quotedMedia = tweet.quoted_media ? `
                <div class="quoted-media">
                    <img src="${tweet.quoted_media}" loading="lazy" alt="Quoted Media" onerror="this.parentElement.style.display='none'">
                </div>
            ` : '';

            quotedHtml = `
                <div class="quoted-tweet">
                    <div class="quoted-user">@tyleralterman</div>
                    <div class="quoted-text">${linkify(tweet.quoted_text)}</div>
                    ${quotedMedia}
                </div>
            `;
        } else {
            // Placeholder for external quote - will be fetched
            quotedHtml = `
                <div class="quoted-tweet" id="modal-quoted-tweet" data-quoted-id="${tweet.quoted_tweet_id}">
                    <div class="quoted-loading">Loading quoted tweet...</div>
                </div>
            `;
        }
    }

    // Build tag list for clicking
    const allTagsHtml = state.allTags.map(tag => `
        <span class="tag-chip" data-tag="${tag.name}" data-category="${tag.category}">${tag.name}</span>
    `).join('');

    elements.modalBody.innerHTML = `
        <p class="modal-tweet-text">${linkify(tweet.full_text)}</p>
        ${mediaHtml}
        ${quotedHtml}
        
        <div class="modal-section">
            <div class="modal-stats">
                <span>❤️ ${tweet.favorite_count} likes</span>
                <span>🔁 ${tweet.retweet_count} retweets</span>
                <span>📅 ${date}</span>
            </div>
            ${tweet.tweet_url ? `<a href="${tweet.tweet_url}" target="_blank" class="modal-link">View on X →</a>` : ''}
        </div>
        
        <div class="modal-section">
            <h4>Swipe Status</h4>
            <div class="swipe-buttons">
                <button class="swipe-btn pass ${tweet.swipe_status === 'dislike' ? 'active' : ''}" 
                        data-status="dislike">Pass</button>
                <button class="swipe-btn like ${tweet.swipe_status === 'like' ? 'active' : ''}" 
                        data-status="like">Like</button>
                <button class="swipe-btn superlike ${tweet.swipe_status === 'superlike' ? 'active' : ''}" 
                        data-status="superlike">Superlike</button>
                <button class="swipe-btn review-later ${tweet.swipe_status === 'review_later' ? 'active' : ''}" 
                        data-status="review_later">🔄 Review Later</button>
            </div>
        </div>

        <div id="thread-section" class="modal-section" style="display: none;">
             <h4>Thread</h4>
             <div class="thread-chain" id="threadChain"></div>
        </div>
        
        <div class="modal-section">
            <h4>Quality Rating</h4>
            <div class="quality-buttons">
                <button class="quality-btn high ${tweet.quality_rating === 'high' ? 'active' : ''}" 
                        data-quality="high">⭐ High</button>
                <button class="quality-btn medium ${tweet.quality_rating === 'medium' ? 'active' : ''}" 
                        data-quality="medium">Medium</button>
                <button class="quality-btn low ${tweet.quality_rating === 'low' ? 'active' : ''}" 
                        data-quality="low">Low</button>
            </div>
        </div>
        
        <div class="modal-section">
            <h4>First Impressions</h4>
            <textarea id="firstImpressionsInput" class="notes-textarea" 
                      placeholder="Write your initial thoughts about this tweet..."
                      rows="3">${tweet.first_impressions || ''}</textarea>
            <button id="saveFirstImpressions" class="save-notes-btn">Save</button>
        </div>
        
        <div class="modal-section">
            <h4>Notes</h4>
            <textarea id="notesInput" class="notes-textarea" 
                      placeholder="Add detailed notes, ideas for use, etc..."
                      rows="4">${tweet.notes || ''}</textarea>
            <button id="saveNotes" class="save-notes-btn">Save</button>
        </div>
        
        <div class="modal-section">
            <h4>Tags</h4>
            <div class="modal-tags" id="modalTags">
                ${(tweet.tags || []).map(tag => `
                    <span class="modal-tag" style="border-color: ${tag.color || '#30363d'}">
                        ${tag.name}
                        <span class="remove-tag" data-tag="${tag.name}">×</span>
                    </span>
                `).join('')}
            </div>
            <div class="add-tag-container">
                <div class="add-tag-input">
                    <input type="text" id="newTagInput" placeholder="Type to search tags...">
                    <button id="addTagBtn">Add</button>
                </div>
                <div class="tag-suggestions" id="tagSuggestions"></div>
            </div>
            <div class="all-tags-list">
                ${allTagsHtml}
            </div>
        </div>
    `;

    // Add event handlers
    document.querySelectorAll('.swipe-btn').forEach(btn => {
        // ... handled below ...
    });

    // Fetch and render thread if applicable (async but doesn't block modal open)
    fetch(`/api/tweets/${tweet.id}/thread`)
        .then(res => res.json())
        .then(thread => {
            if (thread && thread.length > 0) {
                const threadSection = document.getElementById('thread-section');
                const threadContainer = document.getElementById('threadChain');
                threadSection.style.display = 'block';
                threadContainer.innerHTML = thread.map(t => `
                    <div class="thread-tweet">
                        <div class="thread-line"></div>
                        <div class="tweet-text">${linkify(t.full_text)}</div>
                        <div class="tweet-meta">
                            <span>❤️ ${t.favorite_count}</span>
                            <span>📅 ${new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                `).join('');
            }
        })
        .catch(err => console.error('Error fetching thread:', err));

    // Fetch quoted tweet if needed
    const modalQuotedEl = document.getElementById('modal-quoted-tweet');
    if (modalQuotedEl) {
        const quotedId = modalQuotedEl.dataset.quotedId;
        fetch(`/api/quoted-tweet/${quotedId}`)
            .then(res => res.json())
            .then(data => {
                if (data.is_available && data.content) {
                    modalQuotedEl.innerHTML = `
                        <div class="quoted-user">@${data.author_username || 'unknown'}</div>
                        <div class="quoted-text">${linkify(data.content)}</div>
                        ${data.media_url ? `<div class="quoted-media"><img src="${data.media_url}" loading="lazy" alt="Media" onerror="this.parentElement.style.display='none'"></div>` : ''}
                    `;
                } else {
                    modalQuotedEl.innerHTML = `
                        <div class="quoted-user">Quoted Tweet</div>
                        <div class="quoted-unavailable">
                            <span>Tweet unavailable</span>
                            <a href="https://x.com/i/web/status/${quotedId}" target="_blank">Try viewing on X →</a>
                        </div>
                    `;
                }
            })
            .catch(err => {
                console.error('Error fetching quoted tweet:', err);
                modalQuotedEl.innerHTML = `
                    <div class="quoted-user">Quoted Tweet</div>
                    <a href="https://x.com/i/web/status/${quotedId}" target="_blank">View on X →</a>
                `;
            });
    }

    // Add event handlers
    document.querySelectorAll('.swipe-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            updateTweet(tweet.id, { swipe_status: status });
            // Update local state for persistence
            if (state.selectedTweet) {
                state.selectedTweet.swipe_status = status;
            }
            document.querySelectorAll('.swipe-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const quality = btn.dataset.quality;
            updateTweet(tweet.id, { quality_rating: quality });
            document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Save First Impressions
    document.getElementById('saveFirstImpressions').addEventListener('click', async () => {
        const value = document.getElementById('firstImpressionsInput').value;
        await updateTweet(tweet.id, { first_impressions: value });
        // Update local state
        if (state.selectedTweet) state.selectedTweet.first_impressions = value;
        const btn = document.getElementById('saveFirstImpressions');
        btn.textContent = 'Saved!';
        setTimeout(() => btn.textContent = 'Save', 1500);
    });

    // Save Notes
    document.getElementById('saveNotes').addEventListener('click', async () => {
        const value = document.getElementById('notesInput').value;
        await updateTweet(tweet.id, { notes: value });
        // Update local state
        if (state.selectedTweet) state.selectedTweet.notes = value;
        const btn = document.getElementById('saveNotes');
        btn.textContent = 'Saved!';
        setTimeout(() => btn.textContent = 'Save', 1500);
    });

    document.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const tagName = btn.dataset.tag;
            if (await removeTag(tweet.id, tagName)) {
                btn.parentElement.remove();
            }
        });
    });

    // Tag autocomplete
    const tagInput = document.getElementById('newTagInput');
    const suggestionsEl = document.getElementById('tagSuggestions');

    tagInput.addEventListener('input', () => {
        const query = tagInput.value.toLowerCase();
        if (query.length < 1) {
            suggestionsEl.classList.remove('visible');
            return;
        }

        const matches = state.allTags.filter(t => t.name.includes(query)).slice(0, 10);
        if (matches.length === 0) {
            suggestionsEl.classList.remove('visible');
            return;
        }

        suggestionsEl.innerHTML = matches.map(t => `
            <div class="tag-suggestion" data-tag="${t.name}" data-category="${t.category}">
                ${t.name}
                <span class="tag-category">${t.category}</span>
            </div>
        `).join('');
        suggestionsEl.classList.add('visible');

        // Add click handlers to suggestions
        document.querySelectorAll('.tag-suggestion').forEach(s => {
            s.addEventListener('click', async () => {
                const tagName = s.dataset.tag;
                const category = s.dataset.category;
                if (await addTag(tweet.id, tagName, category)) {
                    const tagsContainer = document.getElementById('modalTags');
                    tagsContainer.innerHTML += `
                        <span class="modal-tag">
                            ${tagName}
                            <span class="remove-tag" data-tag="${tagName}">×</span>
                        </span>
                    `;
                    tagInput.value = '';
                    suggestionsEl.classList.remove('visible');
                }
            });
        });
    });

    // Click on all-tags-list chips
    document.querySelectorAll('.all-tags-list .tag-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
            const tagName = chip.dataset.tag;
            const category = chip.dataset.category;
            if (await addTag(tweet.id, tagName, category)) {
                const tagsContainer = document.getElementById('modalTags');
                tagsContainer.innerHTML += `
                    <span class="modal-tag">
                        ${tagName}
                        <span class="remove-tag" data-tag="${tagName}">×</span>
                    </span>
                `;
            }
        });
    });

    document.getElementById('addTagBtn').addEventListener('click', async () => {
        const input = document.getElementById('newTagInput');
        const tagName = input.value.trim().toLowerCase();
        if (tagName && await addTag(tweet.id, tagName)) {
            const tagsContainer = document.getElementById('modalTags');
            tagsContainer.innerHTML += `
                <span class="modal-tag">
                    ${tagName}
                    <span class="remove-tag" data-tag="${tagName}">×</span>
                </span>
            `;
            input.value = '';
            suggestionsEl.classList.remove('visible');
        }
    });

    document.getElementById('newTagInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('addTagBtn').click();
        }
    });

    elements.modal.classList.add('active');
}

function closeModal() {
    elements.modal.classList.remove('active');
    // Re-render tweets to show any tag changes made in modal
    renderTweets();
    state.selectedTweet = null;
}

// ============================================
// Event Handlers
// ============================================

function setupEventHandlers() {
    // Search
    elements.searchBtn.addEventListener('click', () => {
        state.filters.search = elements.searchInput.value;
        state.pagination.page = 1;
        fetchTweets();
    });

    elements.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') elements.searchBtn.click();
    });

    // Filters
    elements.filterType.addEventListener('change', () => {
        state.filters.type = elements.filterType.value;
        state.pagination.page = 1;
        fetchTweets();
    });

    elements.filterLength.addEventListener('change', () => {
        state.filters.length = elements.filterLength.value;
        state.pagination.page = 1;
        fetchTweets();
    });

    // Quality listener removed
    elements.filterSwipe.addEventListener('change', () => {
        state.filters.swipe = elements.filterSwipe.value;
        state.pagination.page = 1;
        fetchTweets();
    });

    elements.excludeRetweets.addEventListener('change', () => {
        state.filters.excludeRetweets = elements.excludeRetweets.checked;
        state.pagination.page = 1;
        fetchTweets();
    });

    elements.excludeReplies.addEventListener('change', () => {
        state.filters.excludeReplies = elements.excludeReplies.checked;
        state.pagination.page = 1;
        fetchTweets();
    });

    elements.excludeThreads.addEventListener('change', () => {
        state.filters.excludeThreads = elements.excludeThreads.checked;
        state.pagination.page = 1;
        fetchTweets();
    });

    // Sorting
    elements.sortBy.addEventListener('change', () => {
        state.sort.by = elements.sortBy.value;
        fetchTweets();
    });

    elements.sortOrder.addEventListener('click', () => {
        state.sort.order = state.sort.order === 'desc' ? 'asc' : 'desc';
        elements.sortOrder.textContent = state.sort.order === 'desc' ? '↓' : '↑';
        fetchTweets();
    });

    // Pagination
    elements.prevPage.addEventListener('click', () => {
        if (state.pagination.page > 1) {
            state.pagination.page--;
            fetchTweets();
        }
    });

    elements.nextPage.addEventListener('click', () => {
        if (state.pagination.page < state.pagination.totalPages) {
            state.pagination.page++;
            fetchTweets();
        }
    });

    // Clear filters
    elements.clearFilters.addEventListener('click', () => {
        state.filters = {
            search: '',
            type: '',
            length: '',
            // quality: '', REMOVED
            swipe: '',
            tag: '',
            excludeRetweets: true,
            excludeReplies: true,
            excludeThreads: true
        };
        state.pagination.page = 1;

        // Reset UI
        elements.searchInput.value = '';
        elements.filterType.value = '';
        elements.filterLength.value = '';
        // elements.filterQuality.value = ''; REMOVED
        elements.filterSwipe.value = '';
        elements.excludeRetweets.checked = true;
        elements.excludeReplies.checked = true;
        elements.excludeThreads.checked = true;

        fetchTweets();
        renderTags();
    });

    // Modal
    elements.modalClose.addEventListener('click', closeModal);
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) closeModal();
    });

    // Import
    elements.importBtn.addEventListener('click', () => {
        elements.archiveInput.click();
    });

    elements.archiveInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            uploadArchive(file);
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

// ============================================
// Utility Functions
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function linkify(text) {
    // First escape HTML to prevent XSS
    const escaped = escapeHtml(text);
    // Then replace URLs with links
    return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-link" onclick="event.stopPropagation()">$1</a>');
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// ============================================
// AI Semantic Search
// ============================================

const aiElements = {
    input: document.getElementById('aiSearchInput'),
    button: document.getElementById('aiSearchBtn'),
    status: document.getElementById('aiSearchStatus'),
    results: document.getElementById('aiSearchResults'),
    grid: document.getElementById('aiTweetGrid'),
    resultCount: document.getElementById('aiResultCount'),
    clearBtn: document.getElementById('clearAiSearch')
};

async function performAiSearch() {
    const query = aiElements.input.value.trim();
    if (!query) return;

    aiElements.button.disabled = true;
    aiElements.status.textContent = '🔮 Analyzing your query...';
    aiElements.status.className = 'ai-search-status loading';

    try {
        const response = await fetch('/api/semantic-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            throw new Error('Search failed');
        }

        const data = await response.json();

        // Show results
        aiElements.results.style.display = 'block';
        aiElements.resultCount.textContent = `${data.count} tweets found`;
        aiElements.status.textContent = '';

        // Render tweets
        if (data.tweets.length === 0) {
            aiElements.grid.innerHTML = '<div class="empty-state"><p>No tweets match your query</p></div>';
        } else {
            aiElements.grid.innerHTML = data.tweets.map(tweet => createTweetCardHtml(tweet)).join('');

            // Add click handlers
            aiElements.grid.querySelectorAll('.tweet-card').forEach(card => {
                card.addEventListener('click', () => openTweetModal(card.dataset.id));
            });
        }

    } catch (err) {
        aiElements.status.textContent = '❌ ' + err.message;
        aiElements.status.className = 'ai-search-status error';
    } finally {
        aiElements.button.disabled = false;
    }
}

function clearAiSearch() {
    aiElements.results.style.display = 'none';
    aiElements.grid.innerHTML = '';
    aiElements.input.value = '';
    aiElements.status.textContent = '';
}

function createTweetCardHtml(tweet) {
    const date = new Date(tweet.created_at).toLocaleDateString();
    const swipeBadge = tweet.swipe_status === 'superliked' ? '⭐' :
        tweet.swipe_status === 'liked' ? '❤️' : '';

    const tagsHtml = (tweet.tags || []).slice(0, 4).map(tag =>
        `<span class="tweet-tag ${tag.category}">${tag.name}</span>`
    ).join('');

    return `
        <div class="tweet-card ${tweet.swipe_status || ''}" data-id="${tweet.id}">
            <div class="tweet-header">
                <span class="tweet-date">${date}</span>
                <span class="swipe-badge">${swipeBadge}</span>
            </div>
            <div class="tweet-text">${linkify(tweet.full_text)}</div>
            <div class="tweet-footer">
                <div class="tweet-meta">
                    <div class="tweet-stats">
                        <span class="tweet-stat">❤️ ${tweet.favorite_count}</span>
                        <span class="tweet-stat">🔄 ${tweet.retweet_count}</span>
                    </div>
                </div>
                <div class="tweet-tags">${tagsHtml}</div>
                <a href="${tweet.tweet_url}" target="_blank" class="tweet-link" onclick="event.stopPropagation()">View on X →</a>
            </div>
        </div>
    `;
}

function setupAiSearchHandlers() {
    if (aiElements.button) {
        aiElements.button.addEventListener('click', performAiSearch);
    }
    if (aiElements.input) {
        aiElements.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performAiSearch();
        });
    }
    if (aiElements.clearBtn) {
        aiElements.clearBtn.addEventListener('click', clearAiSearch);
    }
}

// ============================================
// Initialize
// ============================================

async function init() {
    elements.tweetGrid.innerHTML = '<div class="loading">Loading tweets...</div>';

    setupEventHandlers();
    setupAiSearchHandlers();

    // Load data
    await Promise.all([
        fetchTweets(),
        fetchTags(),
        fetchStats()
    ]);
}

// Start the app
init();
