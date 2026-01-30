const elements = {
    list: document.getElementById('scheduler-list'),
    queueCount: document.getElementById('queue-count'),
    saveBtn: document.getElementById('save-order-btn')
};

let state = {
    items: [],
    hasChanges: false
};

// Start Date: Calculate the next Monday or tomorrow?
// Let's default to Tomorrow for now.
const START_DATE = new Date();
START_DATE.setDate(START_DATE.getDate() + 1);

// 2 posts per week = 1 post every 3.5 days
const INTERVAL_DAYS = 3.5;

async function init() {
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
        elements.list.innerHTML = '<div class="loading">Error loading queue</div>';
    }
}

function calculateDates(items) {
    const baseDate = new Date(START_DATE);

    items.forEach((item, index) => {
        // e.g. index 0 -> 0 days
        // index 1 -> 3.5 days -> +3 days (floor)
        // index 2 -> 7 days
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
}

function createItemHtml(item) {
    const date = item.scheduledDate;
    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();

    // Image logic
    let imageHtml = '';
    if (item.media_url) {
        imageHtml = `
            <div class="item-has-media">
                <div class="item-image-area">
                    <img src="${item.media_url}" class="media-preview" alt="Media">
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
                <div class="item-text">${linkify(item.cleaned_text || item.combined_text || item.full_text)}</div>
            </div>
        </div>
    `;
}

function setupSortable() {
    new Sortable(elements.list, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: function () {
            // Re-calculate dates based on new DOM order
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

    // Recalculate dates for visual feedback
    calculateDates(state.items);

    // Re-render DATES only? Or full list?
    // Full list re-render kills the drag state if done incorrectly, but we are inside 'onEnd'.
    // Better to update dates specifically in DOM to avoid flash.
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
    // Simple mock for now - you might want to reuse the one from app.js or import utils
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// TODO: Implement image upload
window.triggerImageUpload = function (id) {
    alert('Image upload coming soon! (ID: ' + id + ')');
}

// Start
init();
