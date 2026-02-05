const elements = {
    list: document.getElementById('scheduler-list'),
    queueCount: document.getElementById('queue-count'),
    saveBtn: document.getElementById('save-order-btn')
};

let state = {
    items: [],
    hasChanges: false
};

// Start Date: Feb 15, 2026
const START_DATE = new Date('2026-02-15T00:00:00');

// Weekly on Sundays = 7 days
const INTERVAL_DAYS = 7;

async function init() {
    console.log('🚀 Scheduler v4 Initializing...');

    // Compact Mode Toggle
    const toggleBtn = document.getElementById('toggle-compact');
    const queueContainer = document.getElementById('scheduler-list');

    console.log('Toggle:', toggleBtn, 'List:', queueContainer);

    if (toggleBtn && queueContainer) {
        toggleBtn.addEventListener('click', () => {
            queueContainer.classList.toggle('compact-mode');
            const isCompact = queueContainer.classList.contains('compact-mode');
            toggleBtn.innerHTML = isCompact ?
                '<span class="icon">↕️</span> Expand All' :
                '<span class="icon">↕️</span> Minimize All';
        });
    }

    // Initial Render
    await fetchQueue();
    setupSortable();

    elements.saveBtn.addEventListener('click', saveOrder);
}

async function fetchQueue() {
    try {
        const response = await fetch('/api/scheduler/queue');
        const data = await response.json();

        // Initial Client-side Date Calculation
        calculateDates(data);

        state.items = data;
        renderList();
        updateCount();
    } catch (err) {
        console.error('Error fetching queue:', err);
        elements.list.innerHTML = '<div class="loading">Error loading queue. Is the server running?</div>';
    }
}

function calculateDates(items) {
    const baseDate = new Date(START_DATE);

    items.forEach((item, index) => {
        // e.g. index 0 -> 0 days
        // index 1 -> 7 days
        const daysToAdd = Math.floor(index * INTERVAL_DAYS);
        const itemDate = new Date(baseDate);
        itemDate.setDate(itemDate.getDate() + daysToAdd);
        item.scheduledDate = itemDate;
    });
}

function renderList() {
    if (state.items.length === 0) {
        elements.list.innerHTML = '<div class="loading">Queue is empty. Tag tweets as "blog-ready" to see them here.</div>';
        return;
    }

    elements.list.innerHTML = state.items.map(item => createItemHtml(item)).join('');

    // Add expand/collapse click handlers
    setupExpandCollapse();
}

function createItemHtml(item) {
    const date = item.scheduledDate;
    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();

    // Image logic - check header_image (uploaded) first, then media_url (tweet media)
    let imageHtml = '';
    const imageUrl = item.header_image || item.media_url;

    if (imageUrl) {
        imageHtml = `
            <div class="item-has-media">
                <div class="item-image-area" onclick="triggerImageUpload('${item.id}')">
                    <img src="${imageUrl}" class="media-preview" alt="Header Image">
                </div>
            </div>
        `;
    } else {
        imageHtml = `
            <div class="item-image-area" onclick="triggerImageUpload('${item.id}')">
                <span class="image-placeholder-text">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                        <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    Add Header Image
                </span>
            </div>
        `;
    }

    return `
        <div class="schedule-item" data-id="${item.id}">
            <div class="drag-handle">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
            </div>
            
            <div class="item-date">
                <span class="date-day">${day}</span>
                <span class="date-month">${month}</span>
                <span class="date-year">${year}</span>
            </div>
            
            <div class="item-content">
                ${imageHtml}
                <div class="title-section">
                    ${renderTitleOptions(item)}
                </div>
                <div class="item-text">${linkify(item.cleaned_text || item.combined_text || item.full_text)}</div>
                <div class="item-actions">
                    <button class="btn-substack" onclick="pushToSubstack('${item.id}', event)">
                        <span class="icon">📝</span> Push to Substack
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderTitleOptions(item) {
    let options = [];
    try { options = JSON.parse(item.title_options || '[]'); } catch (e) { }

    let selected = null;
    try { selected = item.selected_title ? JSON.parse(item.selected_title) : null; } catch (e) { }

    const currentTitle = selected ? selected.title : '';
    const currentSubtitle = selected ? selected.subtitle : '';

    let html = '<div class="title-container">';

    // 1. AI Options
    if (options.length > 0) {
        html += '<div class="title-options">';
        html += '<label class="title-label">Suggested Titles:</label>';
        options.forEach((opt, idx) => {
            // Check if current manual title matches this option exactly
            const isChecked = (currentTitle === opt.title && currentSubtitle === opt.subtitle);
            html += `
                <div class="title-option" onclick="useTitle('${item.id}', ${idx})">
                    <input type="radio" name="t-opt-${item.id}" ${isChecked ? 'checked' : ''}>
                    <div class="title-text-group">
                        <span class="main-title">${opt.title}</span>
                        <span class="sub-title">${opt.subtitle}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // 2. Manual Inputs
    html += `
        <div class="manual-title-inputs">
            <label class="title-label">Post Title & Subtitle:</label>
            <input type="text" class="title-input main" 
                   value="${(currentTitle || '').replace(/"/g, '&quot;')}" 
                   placeholder="Enter Title..." 
                   onchange="saveManualTitle('${item.id}', this.value, null)">
                   
            <input type="text" class="title-input sub" 
                   value="${(currentSubtitle || '').replace(/"/g, '&quot;')}" 
                   placeholder="Enter Subtitle..." 
                   onchange="saveManualTitle('${item.id}', null, this.value)">
        </div>
    </div>`;

    return html;
}

window.useTitle = function (id, idx) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    let options = [];
    try { options = JSON.parse(item.title_options); } catch (e) { }

    const choice = options[idx];
    if (choice) {
        saveToDb(id, choice.title, choice.subtitle);

        // Update UI Inputs
        const container = document.querySelector(`.schedule-item[data-id="${id}"]`);
        if (container) {
            const titleInput = container.querySelector('.title-input.main');
            const subInput = container.querySelector('.title-input.sub');
            if (titleInput) titleInput.value = choice.title;
            if (subInput) subInput.value = choice.subtitle;

            const radios = container.querySelectorAll('input[type="radio"]');
            radios.forEach((r, i) => r.checked = (i === idx));
        }
    }
}

window.saveManualTitle = function (id, newTitle, newSubtitle) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    let current = {};
    try { current = JSON.parse(item.selected_title || '{}'); } catch (e) { }

    const title = newTitle !== null ? newTitle : (current.title || '');
    const subtitle = newSubtitle !== null ? newSubtitle : (current.subtitle || '');

    // Uncheck radios
    const container = document.querySelector(`.schedule-item[data-id="${id}"]`);
    if (container) {
        const radios = container.querySelectorAll('input[type="radio"]');
        radios.forEach(r => r.checked = false);
    }

    saveToDb(id, title, subtitle);
}

async function saveToDb(id, title, subtitle) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    try {
        const res = await fetch('/api/scheduler/update-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, title, subtitle })
        });
        if (res.ok) {
            item.selected_title = JSON.stringify({ title, subtitle });
            showToast('Title saved ✓');
        } else {
            showToast('Save failed!', true);
        }
    } catch (err) {
        console.error('Failed to save title', err);
        showToast('Save failed!', true);
    }
}

// Toast notification for feedback
function showToast(message, isError = false) {
    let toast = document.getElementById('save-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'save-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast' + (isError ? ' toast-error' : ' toast-success');
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// Expand/collapse individual cards
function setupExpandCollapse() {
    const items = elements.list.querySelectorAll('.schedule-item');
    items.forEach(item => {
        // Click on card content (not drag handle) to toggle expand
        const content = item.querySelector('.item-content');
        if (content) {
            content.addEventListener('click', (e) => {
                // Don't toggle if clicking on inputs or buttons
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' ||
                    e.target.closest('.title-option') || e.target.closest('.item-image-area')) {
                    return;
                }
                item.classList.toggle('expanded');
            });
        }
    });
}

function setupSortable() {
    new Sortable(elements.list, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: function () {
            updateOrderFromDom();
            enableSave();
        }
    });
}

function updateOrderFromDom() {
    const newItems = [];
    const itemEls = elements.list.querySelectorAll('.schedule-item');

    itemEls.forEach((el, index) => {
        const id = el.dataset.id;
        const item = state.items.find(i => i.id === id);
        if (item) newItems.push(item);
    });

    state.items = newItems;
    calculateDates(state.items);
    updateDatesInDom();
}

function updateDatesInDom() {
    const itemEls = elements.list.querySelectorAll('.schedule-item');
    itemEls.forEach((el, index) => {
        const item = state.items[index];
        const date = item.scheduledDate;

        el.querySelector('.date-day').textContent = date.getDate();
        el.querySelector('.date-month').textContent = date.toLocaleString('default', { month: 'short' });
        el.querySelector('.date-year').textContent = date.getFullYear();
    });
}

function enableSave() {
    state.hasChanges = true;
    elements.saveBtn.disabled = false;
    elements.saveBtn.textContent = 'Save Changes';
}

async function saveOrder() {
    if (!state.hasChanges) return;

    const orderedIds = state.items.map(i => i.id);
    elements.saveBtn.textContent = 'Saving...';

    try {
        const response = await fetch('/api/scheduler/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderedIds })
        });

        if (response.ok) {
            state.hasChanges = false;
            elements.saveBtn.textContent = 'Saved';
            elements.saveBtn.disabled = true;
        } else {
            elements.saveBtn.textContent = 'Error';
        }
    } catch (err) {
        console.error('Save failed:', err);
        elements.saveBtn.textContent = 'Error';
    }
}

function updateCount() {
    elements.queueCount.textContent = `${state.items.length} items`;
}

function linkify(text) {
    if (!text) return '';
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener('DOMContentLoaded', init);


// Image upload handler
window.triggerImageUpload = function (id) {
    // Create a hidden file input
    let fileInput = document.getElementById('header-image-input');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'header-image-input';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
    }

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('image', file);

        showToast('Uploading image...');

        try {
            const res = await fetch(`/api/scheduler/upload-image/${id}`, {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                showToast('Image uploaded ✓');
                // Update the item in state and re-render that card
                const item = state.items.find(i => i.id === id);
                if (item) {
                    item.header_image = data.path;
                    // Re-render just this card
                    const cardEl = document.querySelector(`.schedule-item[data-id="${id}"]`);
                    if (cardEl) {
                        cardEl.outerHTML = createItemHtml(item);
                        setupExpandCollapse();
                    }
                }
            } else {
                showToast('Upload failed!', true);
            }
        } catch (err) {
            console.error('Upload error:', err);
            showToast('Upload failed!', true);
        }

        fileInput.value = ''; // Reset for next upload
    };

    fileInput.click();
};

// Push item to Substack queue
window.pushToSubstack = async function (id, event) {
    event.stopPropagation(); // Don't trigger expand/collapse

    const btn = event.target.closest('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="icon">⏳</span> Pushing...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/scheduler/push-to-substack/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (res.ok) {
            const data = await res.json();
            const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt).toLocaleDateString() : null;
            const msg = scheduledDate ? `Scheduled for ${scheduledDate} ✓` : 'Added to queue ✓';
            showToast(msg);
            btn.innerHTML = scheduledDate
                ? `<span class="icon">📅</span> ${scheduledDate}`
                : '<span class="icon">✅</span> In Queue';
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.error || 'Push failed!', true);
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Push error:', err);
        showToast('Push failed!', true);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// Batch schedule next month's posts
window.batchSchedule = async function () {
    const btn = document.getElementById('batch-schedule-btn');
    const originalText = btn.innerHTML;

    // Calculate next month
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const targetMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

    const confirmed = confirm(`Schedule all pending items for ${nextMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}?\n\nThis will create drafts on Substack scheduled 2x/week (Sun + Wed).`);
    if (!confirmed) return;

    btn.innerHTML = '<span class="icon">⏳</span> Scheduling...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/scheduler/batch-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetMonth })
        });

        const data = await res.json();

        if (res.ok) {
            const msg = `Scheduled ${data.totalScheduled} posts! ${data.totalErrors > 0 ? `(${data.totalErrors} errors)` : ''}`;
            showToast(msg);
            btn.innerHTML = `<span class="icon">✅</span> ${data.totalScheduled} Scheduled`;

            // Refresh the list to show updated statuses
            setTimeout(() => location.reload(), 2000);
        } else {
            showToast(data.error || 'Batch scheduling failed!', true);
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Batch schedule error:', err);
        showToast('Batch scheduling failed!', true);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};
