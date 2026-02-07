/**
 * Notes Queue - JavaScript
 * Manages the broadcast queue for Substack Notes and Bluesky
 */

// State
let notes = [];
let sortable = null;

// DOM Elements
const notesList = document.getElementById('notes-list');
const emptyState = document.getElementById('empty-state');
const queueCount = document.getElementById('queue-count');
const blueskyStatus = document.getElementById('bluesky-status');
const schedulePreview = document.getElementById('schedule-preview');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadNotes();
    await checkBlueskyStatus();
    updateSchedulePreview();

    // Listen for scheduling option changes
    document.querySelectorAll('.option-group select').forEach(select => {
        select.addEventListener('change', updateSchedulePreview);
    });
});

// Load notes from queue
async function loadNotes() {
    try {
        const res = await fetch('/api/notes/queue');
        notes = await res.json();
        renderNotes();
    } catch (err) {
        console.error('Failed to load notes:', err);
        showToast('Failed to load notes', 'error');
    }
}

// Render notes list
function renderNotes() {
    if (notes.length === 0) {
        notesList.innerHTML = '';
        emptyState.style.display = 'block';
        queueCount.textContent = '0 notes';
        return;
    }

    emptyState.style.display = 'none';
    queueCount.textContent = `${notes.length} notes`;

    notesList.innerHTML = notes.map((note, index) => {
        const text = note.cleaned_text || note.full_text;
        const charCount = text.length;
        const charClass = charCount > 300 ? 'error' : charCount > 250 ? 'warning' : '';

        return `
            <div class="note-item" data-id="${note.id}">
                <div class="note-order">${index + 1}</div>
                <div class="note-content">
                    <p class="note-text">${escapeHtml(text)}</p>
                    <div class="note-meta">
                        <span class="note-char-count ${charClass}">
                            ${charCount} chars ${charCount > 300 ? '(will truncate)' : ''}
                        </span>
                        <span>ID: ${note.id.substring(0, 12)}...</span>
                    </div>
                </div>
                <div class="note-actions">
                    <button onclick="removeFromQueue('${note.id}')" title="Remove from queue">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    // Initialize drag-drop
    if (sortable) sortable.destroy();
    sortable = new Sortable(notesList, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: handleReorder
    });
}

// Handle reorder
async function handleReorder(evt) {
    const newOrder = Array.from(notesList.children).map(el => el.dataset.id);

    // Update order numbers visually
    notesList.querySelectorAll('.note-order').forEach((el, i) => {
        el.textContent = i + 1;
    });

    // TODO: Save order to backend if needed
    updateSchedulePreview();
}

// Remove note from queue
async function removeFromQueue(id) {
    try {
        const res = await fetch(`/api/notes/remove/${id}`, { method: 'DELETE' });
        const result = await res.json();

        if (result.success) {
            notes = notes.filter(n => n.id !== id);
            renderNotes();
            showToast('Removed from queue', 'success');
        }
    } catch (err) {
        showToast('Failed to remove', 'error');
    }
}

// Check Bluesky connection status
async function checkBlueskyStatus() {
    try {
        const res = await fetch('/api/broadcast/bluesky/test');
        const result = await res.json();

        if (result.success) {
            blueskyStatus.textContent = `@${result.handle}`;
            blueskyStatus.className = 'platform-status connected';
        } else {
            blueskyStatus.textContent = 'Not Connected';
            blueskyStatus.className = 'platform-status error';
        }
    } catch (err) {
        blueskyStatus.textContent = 'Error';
        blueskyStatus.className = 'platform-status error';
    }
}

// Export YAML for Substack
async function exportYAML() {
    if (notes.length === 0) {
        showToast('No notes in queue', 'error');
        return;
    }

    const startDays = document.getElementById('start-days').value;
    const perDay = document.getElementById('notes-per-day').value;
    const hoursStart = document.getElementById('hours-start').value;
    const hoursEnd = document.getElementById('hours-end').value;

    // Trigger download
    const url = `/api/notes/export-yaml?startDays=${startDays}&perDay=${perDay}&hoursStart=${hoursStart}&hoursEnd=${hoursEnd}`;
    window.location.href = url;

    showToast(`Exporting ${notes.length} notes for Substack`, 'success');
}

// Post to Bluesky
async function postToBluesky() {
    if (notes.length === 0) {
        showToast('No notes in queue', 'error');
        return;
    }

    // Confirm before posting
    const confirmed = confirm(
        `⚠️ This will immediately post ${notes.length} notes to Bluesky with 1 minute delays.\n\n` +
        `Total time: ~${notes.length} minutes\n\n` +
        `Are you sure?`
    );

    if (!confirmed) return;

    showToast('Posting to Bluesky...', 'success');

    try {
        const res = await fetch('/api/broadcast/bluesky/batch', {
            method: 'POST'
        });
        const result = await res.json();

        if (result.success) {
            showToast(`✅ Posted ${result.successful} of ${result.total} notes to Bluesky`, 'success');
        } else {
            showToast(`Failed: ${result.error}`, 'error');
        }
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    }
}

// Update schedule preview
function updateSchedulePreview() {
    if (notes.length === 0) {
        schedulePreview.innerHTML = '<em>Add notes to see scheduling preview</em>';
        return;
    }

    const startDays = parseInt(document.getElementById('start-days').value);
    const perDay = parseInt(document.getElementById('notes-per-day').value);
    const hoursStart = parseInt(document.getElementById('hours-start').value);
    const hoursEnd = parseInt(document.getElementById('hours-end').value);

    const daysNeeded = Math.ceil(notes.length / perDay);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + startDays);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + daysNeeded - 1);

    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    schedulePreview.innerHTML = `
        <strong>${notes.length} notes</strong> scheduled over 
        <strong>${daysNeeded} day${daysNeeded > 1 ? 's' : ''}</strong> 
        (${startStr} → ${endStr}) • 
        ${perDay}/day at ${formatHour(hoursStart)}-${formatHour(hoursEnd)}
    `;
}

// Format hour
function formatHour(h) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h > 12 ? h - 12 : h;
    return `${hour}${ampm}`;
}

// Toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
