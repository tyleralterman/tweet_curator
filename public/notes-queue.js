/**
 * Broadcast Hub - JavaScript
 * Unified multi-platform broadcast queue management
 */

// State
let posts = [];
let broadcastHistory = {};
let platformStatus = {};
let sortable = null;

// Platform config
const PLATFORMS = {
    bluesky: { icon: '🦋', name: 'Bluesky', api: true },
    linkedin: { icon: '💼', name: 'LinkedIn', api: true },
    threads: { icon: '🧵', name: 'Threads', api: true },
    substack: { icon: '📝', name: 'Substack', api: false } // export-only
};

// DOM refs
const notesList = document.getElementById('notes-list');
const emptyState = document.getElementById('empty-state');
const queueCount = document.getElementById('queue-count');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        checkAllPlatforms(),
        loadNotes()
    ]);
    updateSchedulePreview();

    document.querySelectorAll('.option-group select').forEach(select => {
        select.addEventListener('change', updateSchedulePreview);
    });
});

// ============================================
// Platform Status
// ============================================

async function checkAllPlatforms() {
    // Set all to checking
    ['bluesky', 'linkedin', 'threads'].forEach(p => {
        const el = document.getElementById(`status-${p}`);
        if (el) {
            el.textContent = 'Checking...';
            el.className = 'platform-status checking';
        }
    });

    try {
        const res = await fetch('/api/broadcast/status');
        platformStatus = await res.json();

        // Update each platform card
        for (const [platform, status] of Object.entries(platformStatus)) {
            const statusEl = document.getElementById(`status-${platform}`);
            const cardEl = document.getElementById(`platform-${platform}`);
            const toggleEl = document.getElementById(`toggle-${platform}`);

            if (!statusEl) continue;

            if (status.connected) {
                let label = 'Connected';
                if (status.handle) label = `@${status.handle}`;
                else if (status.username) label = `@${status.username}`;
                else if (status.name) label = status.name;
                else if (status.method === 'yaml-export') label = 'Ready';

                statusEl.textContent = label;
                statusEl.className = 'platform-status connected';
                if (cardEl) cardEl.classList.add('connected');
                if (cardEl) cardEl.classList.remove('disconnected');
                if (toggleEl) { toggleEl.checked = true; toggleEl.disabled = false; }
            } else {
                statusEl.textContent = 'Disconnected';
                statusEl.className = 'platform-status error';
                if (cardEl) cardEl.classList.add('disconnected');
                if (cardEl) cardEl.classList.remove('connected');
                if (toggleEl) { toggleEl.checked = false; toggleEl.disabled = true; }
            }
        }
    } catch (err) {
        console.error('Failed to check platforms:', err);
        ['bluesky', 'linkedin', 'threads'].forEach(p => {
            const el = document.getElementById(`status-${p}`);
            if (el) {
                el.textContent = 'Error';
                el.className = 'platform-status error';
            }
        });
    }
}

// Get list of enabled API platforms from global toggles
function getEnabledPlatforms() {
    return ['bluesky', 'linkedin', 'threads'].filter(p => {
        const toggle = document.getElementById(`toggle-${p}`);
        return toggle && toggle.checked;
    });
}

// ============================================
// Queue Loading & Rendering
// ============================================

async function loadNotes() {
    try {
        const [queueRes, historyRes] = await Promise.all([
            fetch('/api/notes/queue'),
            fetch('/api/broadcast/history')
        ]);
        posts = await queueRes.json();
        broadcastHistory = await historyRes.json();
        renderNotes();
    } catch (err) {
        console.error('Failed to load queue:', err);
        showToast('Failed to load queue', 'error');
    }
}

function renderNotes() {
    if (posts.length === 0) {
        notesList.innerHTML = '';
        emptyState.style.display = 'block';
        queueCount.textContent = '0 posts';
        return;
    }

    emptyState.style.display = 'none';
    queueCount.textContent = `${posts.length} posts`;

    const enabledPlatforms = getEnabledPlatforms();

    notesList.innerHTML = posts.map((post, index) => {
        const text = post.cleaned_text || post.full_text;
        const charCount = text.length;
        const charClass = charCount > 300 ? 'error' : charCount > 250 ? 'warning' : '';
        const history = broadcastHistory[post.id] || [];

        // Build broadcast badges
        const badges = history.map(h => {
            const icon = PLATFORMS[h.platform]?.icon || '📡';
            const cls = h.success ? 'success' : 'failed';
            return `<span class="broadcast-badge ${cls}" title="${h.platform}: ${h.success ? 'sent' : 'failed'} ${h.posted_at || ''}">${icon}✓</span>`;
        }).join('');

        // Per-card platform toggles
        const cardToggles = ['bluesky', 'linkedin', 'threads'].map(p => {
            const active = enabledPlatforms.includes(p);
            const connected = platformStatus[p]?.connected;
            return `<div class="card-platform-toggle ${active && connected ? 'active' : ''} ${p}" 
                         data-platform="${p}" data-tweet-id="${post.id}"
                         onclick="toggleCardPlatform(this)"
                         title="${PLATFORMS[p].name}${connected ? '' : ' (disconnected)'}">
                        <span>${PLATFORMS[p].icon}</span>
                        <span class="platform-check">✓</span>
                    </div>`;
        }).join('');

        return `
            <div class="note-item" data-id="${post.id}">
                <div class="note-main" onclick="toggleExpand(this.parentElement)">
                    <div class="note-order">${index + 1}</div>
                    <div class="note-content">
                        <p class="note-text">${escapeHtml(text)}</p>
                        <div class="note-meta">
                            <span class="note-char-count ${charClass}">
                                ${charCount} chars ${charCount > 300 ? '⚠️' : ''}
                            </span>
                            <span>ID: ${post.id.substring(0, 12)}…</span>
                            ${badges ? `<div class="broadcast-badges">${badges}</div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="note-controls">
                    <div class="card-platforms">${cardToggles}</div>
                    <div class="card-actions">
                        <button class="btn-card-broadcast" onclick="broadcastSingle('${post.id}')" id="broadcast-btn-${post.id}">
                            📡 Broadcast
                        </button>
                        <button class="btn-card-remove" onclick="removeFromQueue('${post.id}')" title="Remove">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Init drag-drop
    if (sortable) sortable.destroy();
    sortable = new Sortable(notesList, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        handle: '.note-main',
        onEnd: handleReorder
    });
}

// ============================================
// Card Interactions
// ============================================

function toggleExpand(el) {
    el.classList.toggle('expanded');
}

function toggleCardPlatform(el) {
    const platform = el.dataset.platform;
    const connected = platformStatus[platform]?.connected;
    if (!connected) {
        showToast(`${PLATFORMS[platform].name} is not connected`, 'error');
        return;
    }
    el.classList.toggle('active');
}

// Get selected platforms for a specific card
function getCardPlatforms(tweetId) {
    const card = document.querySelector(`.note-item[data-id="${tweetId}"]`);
    if (!card) return [];
    return Array.from(card.querySelectorAll('.card-platform-toggle.active'))
        .map(el => el.dataset.platform);
}

// ============================================
// Broadcasting
// ============================================

async function broadcastSingle(id) {
    const platforms = getCardPlatforms(id);
    if (platforms.length === 0) {
        showToast('Select at least one platform', 'error');
        return;
    }

    const platformNames = platforms.map(p => PLATFORMS[p].name).join(', ');
    if (!confirm(`Broadcast to ${platformNames}?`)) return;

    const btn = document.getElementById(`broadcast-btn-${id}`);
    if (btn) {
        btn.classList.add('broadcasting');
        btn.disabled = true;
        btn.innerHTML = '⏳ Sending...';
    }

    try {
        const res = await fetch(`/api/broadcast/multi/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platforms })
        });
        const result = await res.json();

        if (result.success) {
            showToast(`✅ Sent to ${result.successful}/${result.total} platforms`, 'success');
            // Refresh history
            const histRes = await fetch('/api/broadcast/history');
            broadcastHistory = await histRes.json();
            renderNotes();
        } else {
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.classList.remove('broadcasting');
            btn.disabled = false;
            btn.innerHTML = '📡 Broadcast';
        }
    }
}

async function broadcastAll() {
    const platforms = getEnabledPlatforms().filter(p => platformStatus[p]?.connected);

    if (platforms.length === 0) {
        showToast('No connected platforms enabled', 'error');
        return;
    }

    if (posts.length === 0) {
        showToast('No posts in queue', 'error');
        return;
    }

    const platformNames = platforms.map(p => PLATFORMS[p].name).join(', ');
    if (!confirm(
        `🚀 Broadcast ALL ${posts.length} posts to:\n${platformNames}\n\n` +
        `This will post with 30s delays between items.\nTotal time: ~${Math.ceil(posts.length * 0.5)} minutes\n\nAre you sure?`
    )) return;

    // Show progress overlay
    const overlay = document.getElementById('broadcast-overlay');
    const progressBar = document.getElementById('overlay-progress');
    const statusText = document.getElementById('overlay-status');
    const logEl = document.getElementById('overlay-log');

    overlay.style.display = 'flex';
    progressBar.style.width = '0%';
    statusText.textContent = `Broadcasting to ${platformNames}...`;
    logEl.innerHTML = '';

    try {
        // Kick off batch broadcast (returns immediately)
        const res = await fetch('/api/broadcast/multi/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platforms })
        });
        const result = await res.json();

        if (result.success) {
            logEl.innerHTML += `<div class="log-info">📡 ${result.message}</div>`;

            // Poll for progress by checking history
            let completed = 0;
            const total = posts.length * platforms.length;
            const checkInterval = setInterval(async () => {
                try {
                    const histRes = await fetch('/api/broadcast/history');
                    const newHistory = await histRes.json();

                    // Count new entries
                    let newCount = 0;
                    for (const entries of Object.values(newHistory)) {
                        newCount += entries.length;
                    }

                    let oldCount = 0;
                    for (const entries of Object.values(broadcastHistory)) {
                        oldCount += entries.length;
                    }

                    completed = newCount - oldCount;
                    const pct = Math.min(100, Math.round((completed / total) * 100));
                    progressBar.style.width = `${pct}%`;
                    statusText.textContent = `${completed}/${total} broadcasts complete (${pct}%)`;

                    if (completed >= total) {
                        clearInterval(checkInterval);
                        broadcastHistory = newHistory;
                        statusText.textContent = '✅ All broadcasts complete!';
                        logEl.innerHTML += `<div class="log-success">✅ Done! ${completed} broadcasts sent.</div>`;
                        progressBar.style.width = '100%';

                        setTimeout(() => {
                            overlay.style.display = 'none';
                            renderNotes();
                        }, 2000);
                    }
                } catch (err) {
                    // Polling error, continue
                }
            }, 5000);

            // Timeout after 30 min
            setTimeout(() => {
                clearInterval(checkInterval);
                overlay.style.display = 'none';
                showToast('Broadcast running in background', 'success');
                loadNotes();
            }, 30 * 60 * 1000);
        } else {
            showToast(`Failed: ${result.error}`, 'error');
            overlay.style.display = 'none';
        }
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
        overlay.style.display = 'none';
    }
}

// ============================================
// Queue Management
// ============================================

async function handleReorder(evt) {
    const items = Array.from(notesList.children);
    items.forEach((el, i) => {
        const orderEl = el.querySelector('.note-order');
        if (orderEl) orderEl.textContent = i + 1;
    });
    updateSchedulePreview();
}

async function removeFromQueue(id) {
    try {
        const res = await fetch(`/api/notes/remove/${id}`, { method: 'DELETE' });
        const result = await res.json();

        if (result.success) {
            posts = posts.filter(p => p.id !== id);
            renderNotes();
            showToast('Removed from queue', 'success');
        }
    } catch (err) {
        showToast('Failed to remove', 'error');
    }
}

// ============================================
// YAML Export (Substack Notes)
// ============================================

function exportYAML() {
    if (posts.length === 0) {
        showToast('No posts in queue', 'error');
        return;
    }

    const startDays = document.getElementById('start-days').value;
    const perDay = document.getElementById('notes-per-day').value;
    const hoursStart = document.getElementById('hours-start').value;
    const hoursEnd = document.getElementById('hours-end').value;

    const url = `/api/notes/export-yaml?startDays=${startDays}&perDay=${perDay}&hoursStart=${hoursStart}&hoursEnd=${hoursEnd}`;
    window.location.href = url;

    showToast(`Exporting ${posts.length} posts for Substack`, 'success');
}

// ============================================
// Schedule Options
// ============================================

function toggleScheduleOptions() {
    document.getElementById('schedule-section').classList.toggle('collapsed');
}

function updateSchedulePreview() {
    const preview = document.getElementById('schedule-preview');
    if (!preview) return;

    if (posts.length === 0) {
        preview.innerHTML = '<em>Add posts to see scheduling preview</em>';
        return;
    }

    const startDays = parseInt(document.getElementById('start-days').value);
    const perDay = parseInt(document.getElementById('notes-per-day').value);
    const hoursStart = parseInt(document.getElementById('hours-start').value);
    const hoursEnd = parseInt(document.getElementById('hours-end').value);

    const daysNeeded = Math.ceil(posts.length / perDay);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + startDays);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + daysNeeded - 1);

    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    preview.innerHTML = `
        <strong>${posts.length} posts</strong> scheduled over 
        <strong>${daysNeeded} day${daysNeeded > 1 ? 's' : ''}</strong> 
        (${startStr} → ${endStr}) • 
        ${perDay}/day at ${formatHour(hoursStart)}-${formatHour(hoursEnd)}
    `;
}

function formatHour(h) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h;
    return `${hour}${ampm}`;
}

// ============================================
// Utilities
// ============================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3500);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
