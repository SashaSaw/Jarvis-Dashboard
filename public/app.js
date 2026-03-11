const REFRESH_INTERVAL = 30000;

// --- State ---
let boardsData = null;
let activeTab = 0;
let currentCard = null;
let currentBoardLists = null;
let newCardListId = null;
let boardLabelsCache = {}; // boardId -> labels array
let editingDesc = false;

// --- Helpers ---

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDue(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((d - now) / 86400000);
  const text = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  if (diffDays < 0) return { text, cls: 'overdue' };
  if (diffDays <= 2) return { text, cls: 'soon' };
  return { text, cls: '' };
}

function labelColorClass(color) {
  const map = { green: 'label-green', yellow: 'label-yellow', orange: 'label-orange',
    red: 'label-red', purple: 'label-purple', blue: 'label-blue', sky: 'label-sky',
    lime: 'label-lime', pink: 'label-pink', black: 'label-black' };
  return map[color] || 'label-blue';
}

function eventDotClass(type) {
  if (type === 'TaskCompleted') return 'task';
  if (type.startsWith('PostToolUse')) return 'tool';
  if (type === 'SessionStart') return 'session-start';
  if (type === 'SessionEnd') return 'session-end';
  if (type.includes('Subagent')) return 'subagent';
  if (type.includes('Failure') || type.includes('Error')) return 'error';
  return 'default';
}

function eventTagClass(type) {
  if (type === 'TaskCompleted') return 'task';
  if (type.startsWith('PostToolUse')) return 'tool';
  if (type.includes('Session')) return 'session';
  if (type.includes('Subagent')) return 'subagent';
  if (type.includes('Failure') || type.includes('Error')) return 'error';
  return '';
}

async function fetchJSON(url, opts) {
  try {
    const res = await fetch(url, opts);
    return await res.json();
  } catch (err) {
    console.error(`Failed: ${url}`, err);
    return null;
  }
}

// --- Board Rendering ---

function renderTabs(boards) {
  const tabsEl = document.getElementById('project-tabs');
  tabsEl.innerHTML = boards.map((b, i) => `
    <div class="project-tab ${i === activeTab ? 'active' : ''}" onclick="switchTab(${i})">
      ${b.name}
      <span class="tab-count">${b.totalCards}</span>
    </div>
  `).join('');
}

function renderBoard(board) {
  const container = document.getElementById('board-container');

  if (board.error) {
    container.innerHTML = `<div class="empty-state">${board.error}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="board">
      ${board.lists.map(list => `
        <div class="board-list">
          <div class="board-list-header">
            <span class="board-list-name">${list.name}</span>
            <span class="board-list-count">${list.cards.length}</span>
          </div>
          <div class="board-list-cards">
            ${list.cards.map(card => {
              const due = formatDue(card.due);
              const hasLabels = card.labels && card.labels.length > 0;
              const hasDesc = card.desc && card.desc.trim().length > 0;
              return `
                <div class="board-card" onclick='openCard(${JSON.stringify(card).replace(/'/g, "&#39;")})'>
                  ${hasLabels ? `
                    <div class="board-card-labels">
                      ${card.labels.map(l => `<div class="board-card-label ${labelColorClass(l.color)}" title="${l.name || ''}"></div>`).join('')}
                    </div>
                  ` : ''}
                  <div class="board-card-name">${card.name}</div>
                  ${(due || hasDesc) ? `
                    <div class="board-card-meta">
                      ${hasDesc ? '<span class="board-card-desc-indicator">📝</span>' : ''}
                      ${due ? `<span class="board-card-due ${due.cls}">🕐 ${due.text}</span>` : ''}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div class="add-card-btn" onclick="openNewCard('${list.id}')">+ Add card</div>
        </div>
      `).join('')}
    </div>
  `;
}

function switchTab(idx) {
  activeTab = idx;
  if (boardsData) {
    renderTabs(boardsData.boards);
    renderBoard(boardsData.boards[idx]);
  }
}

async function refreshProjects() {
  boardsData = await fetchJSON('/api/trello');
  if (boardsData && boardsData.boards) {
    renderTabs(boardsData.boards);
    renderBoard(boardsData.boards[activeTab]);
  }
}

// --- Card Modal ---

async function openCard(card) {
  currentCard = card;
  currentBoardLists = boardsData.boards[activeTab].lists;
  editingDesc = false;

  document.getElementById('modal-card-name').textContent = card.name;

  // Description
  document.getElementById('modal-card-desc').textContent = card.desc || 'No description';
  document.getElementById('modal-card-desc').style.display = '';
  document.getElementById('modal-desc-edit').style.display = 'none';
  document.getElementById('btn-edit-desc').textContent = '✏️ Edit';

  // Populate list dropdown and find current list index
  const select = document.getElementById('modal-card-list');
  let currentListIdx = 0;
  select.innerHTML = currentBoardLists.map((l, i) => {
    const isCurrent = l.cards.some(c => c.id === card.id);
    if (isCurrent) currentListIdx = i;
    return `<option value="${l.id}" ${isCurrent ? 'selected' : ''}>${l.name}</option>`;
  }).join('');

  // Arrow button states
  document.getElementById('btn-move-left').disabled = (currentListIdx === 0);
  document.getElementById('btn-move-right').disabled = (currentListIdx === currentBoardLists.length - 1);

  // Labels - always show
  const labelsField = document.getElementById('modal-labels-field');
  labelsField.style.display = '';

  const labelsEl = document.getElementById('modal-card-labels');
  if (card.labels && card.labels.length > 0) {
    labelsEl.innerHTML = card.labels.map(l =>
      `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.75rem;margin-right:0.25rem;" class="${labelColorClass(l.color)}">${l.name || l.color}</span>`
    ).join('');
  } else {
    labelsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">No labels</span>';
  }

  // Load and render label picker
  const boardId = boardsData.boards[activeTab].id;
  await loadBoardLabels(boardId);
  renderLabelPicker(boardId);

  // Due
  const dueEl = document.getElementById('modal-card-due');
  const dueField = document.getElementById('modal-due-field');
  if (card.due) {
    dueField.style.display = '';
    const d = new Date(card.due);
    dueEl.textContent = d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } else {
    dueField.style.display = 'none';
  }

  document.getElementById('card-modal').classList.add('visible');
}

// --- Label Picker ---

async function loadBoardLabels(boardId) {
  if (boardLabelsCache[boardId]) return;
  const labels = await fetchJSON(`/api/trello/boards/${boardId}/labels`);
  if (labels && Array.isArray(labels)) {
    boardLabelsCache[boardId] = labels.filter(l => l.color); // skip colorless labels
  }
}

function renderLabelPicker(boardId) {
  const picker = document.getElementById('modal-label-picker');
  const labels = boardLabelsCache[boardId] || [];
  if (labels.length === 0) { picker.innerHTML = ''; return; }

  const activeIds = new Set((currentCard.labels || []).map(l => l.id));

  picker.innerHTML = labels.map(l => {
    const isActive = activeIds.has(l.id);
    return `<div class="label-swatch ${labelColorClass(l.color)} ${isActive ? 'active' : ''}"
                 title="${l.name || l.color}"
                 onclick="toggleLabel('${l.id}', '${boardId}')"></div>`;
  }).join('');
}

async function toggleLabel(labelId, boardId) {
  if (!currentCard) return;
  const activeIds = (currentCard.labels || []).map(l => l.id);
  const isActive = activeIds.includes(labelId);
  let newIds;

  if (isActive) {
    newIds = activeIds.filter(id => id !== labelId);
  } else {
    newIds = [...activeIds, labelId];
  }

  // Update via Trello API
  await fetchJSON(`/api/trello/cards/${currentCard.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idLabels: newIds.join(',') })
  });

  // Update local card state from board labels cache
  const allLabels = boardLabelsCache[boardId] || [];
  currentCard.labels = allLabels.filter(l => newIds.includes(l.id)).map(l => ({ id: l.id, name: l.name, color: l.color }));

  // Re-render labels display and picker
  const labelsEl = document.getElementById('modal-card-labels');
  if (currentCard.labels.length > 0) {
    labelsEl.innerHTML = currentCard.labels.map(l =>
      `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.75rem;margin-right:0.25rem;" class="${labelColorClass(l.color)}">${l.name || l.color}</span>`
    ).join('');
  } else {
    labelsEl.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">No labels</span>';
  }
  renderLabelPicker(boardId);
  refreshProjects();
}

// --- Move Left/Right ---

async function moveCardLeft() {
  if (!currentCard || !currentBoardLists) return;
  const currentIdx = currentBoardLists.findIndex(l => l.cards.some(c => c.id === currentCard.id));
  if (currentIdx <= 0) return;
  const targetListId = currentBoardLists[currentIdx - 1].id;
  await fetchJSON(`/api/trello/cards/${currentCard.id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: targetListId })
  });
  closeModal();
  refreshProjects();
}

async function moveCardRight() {
  if (!currentCard || !currentBoardLists) return;
  const currentIdx = currentBoardLists.findIndex(l => l.cards.some(c => c.id === currentCard.id));
  if (currentIdx < 0 || currentIdx >= currentBoardLists.length - 1) return;
  const targetListId = currentBoardLists[currentIdx + 1].id;
  await fetchJSON(`/api/trello/cards/${currentCard.id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: targetListId })
  });
  closeModal();
  refreshProjects();
}

// --- Edit Description ---

function toggleDescEdit() {
  editingDesc = !editingDesc;
  if (editingDesc) {
    document.getElementById('modal-card-desc').style.display = 'none';
    document.getElementById('modal-desc-edit').style.display = '';
    document.getElementById('modal-desc-textarea').value = currentCard.desc || '';
    document.getElementById('btn-edit-desc').textContent = '✏️ Editing';
    setTimeout(() => document.getElementById('modal-desc-textarea').focus(), 50);
  } else {
    cancelDescEdit();
  }
}

function cancelDescEdit() {
  editingDesc = false;
  document.getElementById('modal-card-desc').style.display = '';
  document.getElementById('modal-desc-edit').style.display = 'none';
  document.getElementById('btn-edit-desc').textContent = '✏️ Edit';
}

async function saveDesc() {
  if (!currentCard) return;
  const newDesc = document.getElementById('modal-desc-textarea').value;
  await fetchJSON(`/api/trello/cards/${currentCard.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ desc: newDesc })
  });
  currentCard.desc = newDesc;
  document.getElementById('modal-card-desc').textContent = newDesc || 'No description';
  cancelDescEdit();
  refreshProjects();
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('card-modal').classList.remove('visible');
  currentCard = null;
}

async function moveCurrentCard() {
  if (!currentCard) return;
  const newListId = document.getElementById('modal-card-list').value;
  await fetchJSON(`/api/trello/cards/${currentCard.id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: newListId })
  });
  closeModal();
  refreshProjects();
}

async function archiveCurrentCard() {
  if (!currentCard) return;
  if (!confirm(`Archive "${currentCard.name}"?`)) return;
  await fetchJSON(`/api/trello/cards/${currentCard.id}`, { method: 'DELETE' });
  closeModal();
  refreshProjects();
}

// --- New Card Modal ---

function openNewCard(listId) {
  newCardListId = listId;
  document.getElementById('new-card-name').value = '';
  document.getElementById('new-card-desc').value = '';
  document.getElementById('new-card-modal').classList.add('visible');
  setTimeout(() => document.getElementById('new-card-name').focus(), 100);
}

function closeNewCardModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('new-card-modal').classList.remove('visible');
  newCardListId = null;
}

async function submitNewCard() {
  const name = document.getElementById('new-card-name').value.trim();
  if (!name || !newCardListId) return;
  const desc = document.getElementById('new-card-desc').value.trim();
  await fetchJSON('/api/trello/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: newCardListId, name, desc })
  });
  closeNewCardModal();
  refreshProjects();
}

// Handle Enter key in new card name
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('new-card-modal').classList.contains('visible')) {
    e.preventDefault();
    submitNewCard();
  }
  if (e.key === 'Escape') {
    closeModal();
    closeNewCardModal();
  }
});

// --- Other Sections ---

function renderAgentStatus(status, contentId, badgeId, agentName) {
  const el = document.getElementById(contentId);
  const badge = document.getElementById(badgeId);

  if (!status || status.error) {
    el.innerHTML = `<div class="empty-state">${agentName} status not available</div>`;
    badge.textContent = 'Offline';
    badge.style.background = 'var(--red-dim)';
    badge.style.color = 'var(--red)';
    return;
  }

  // Check if status is stale (>5 min)
  const updatedAgo = status.updated_at ? (Date.now() - new Date(status.updated_at).getTime()) / 60000 : 999;
  if (updatedAgo > 5) {
    badge.textContent = 'Idle';
    badge.style.background = 'var(--yellow-dim)';
    badge.style.color = 'var(--yellow)';
  } else {
    badge.textContent = 'Online';
    badge.style.background = 'var(--green-dim)';
    badge.style.color = 'var(--green)';
  }

  const contextUsed = status.context_used || 0;
  const contextMax = status.context_max || 200000;
  const contextPct = Math.round((contextUsed / contextMax) * 100);
  const contextK = Math.round(contextUsed / 1000);
  const contextMaxK = Math.round(contextMax / 1000);

  let barClass = '';
  if (contextPct >= 80) barClass = 'danger';
  else if (contextPct >= 60) barClass = 'warning';

  // Build stats — only show what's available
  const statsHtml = [
    status.model ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Model</div><div class="jarvis-stat-value accent">${status.model}</div></div>` : '',
    status.tokens_in || status.tokens_out ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Tokens In / Out</div><div class="jarvis-stat-value blue">${status.tokens_in || '—'} / ${status.tokens_out || '—'}</div></div>` : '',
    status.cache_hit ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Cache</div><div class="jarvis-stat-value green">${status.cache_hit} hit · ${status.cache_cached || '—'} cached</div></div>` : '',
    status.compactions !== undefined ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Compactions</div><div class="jarvis-stat-value ${status.compactions > 0 ? 'orange' : 'green'}">${status.compactions}</div></div>` : '',
    status.task ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Current Task</div><div class="jarvis-stat-value" style="font-size:0.8rem">${status.task}</div></div>` : '',
    status.project ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Project</div><div class="jarvis-stat-value orange">${status.project}</div></div>` : '',
    status.session ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Session</div><div class="jarvis-stat-value" style="font-size:0.75rem">${status.session}</div></div>` : '',
    status.thinking ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Thinking</div><div class="jarvis-stat-value">${status.thinking}</div></div>` : '',
    status.status_text ? `<div class="jarvis-stat"><div class="jarvis-stat-label">Status</div><div class="jarvis-stat-value">${status.status_text}</div></div>` : '',
  ].filter(Boolean).join('');

  el.innerHTML = `
    <div class="jarvis-meter">
      ${contextUsed > 0 ? `
        <div class="context-bar-container">
          <div class="context-bar-label">
            <span>Context Window</span>
            <span>${contextK}k / ${contextMaxK}k tokens</span>
          </div>
          <div class="context-bar">
            <div class="context-bar-fill ${barClass}" style="width: ${contextPct}%"></div>
            <div class="context-bar-text">${contextPct}%</div>
          </div>
        </div>
      ` : ''}
      ${statsHtml ? `<div class="jarvis-meter-row">${statsHtml}</div>` : ''}
      <div class="jarvis-updated">Last updated: ${status.updated_at ? timeAgo(status.updated_at) : 'never'}</div>
    </div>
  `;
}

function renderStats(stats) {
  if (!stats) return;
  document.getElementById('stat-tasks').textContent = stats.tasks_today || 0;
  document.getElementById('stat-tool-uses').textContent = stats.tool_uses_today || 0;
  document.getElementById('stat-sessions').textContent = stats.active_sessions || 0;
  document.getElementById('stat-events').textContent = stats.events_today || 0;
}

function renderFeed(events) {
  const feed = document.getElementById('activity-feed');
  const count = document.getElementById('feed-count');

  if (!events || events.length === 0) {
    feed.innerHTML = '<li class="empty-state">No agent activity yet. Configure Claude Code hooks to start seeing events here.</li>';
    count.textContent = '0 events';
    return;
  }

  count.textContent = `${events.length} events`;
  feed.innerHTML = events.map(e => `
    <li class="feed-item">
      <span class="feed-dot ${eventDotClass(e.event_type)}"></span>
      <div class="feed-content">
        <div class="feed-summary">
          <span class="feed-tag ${eventTagClass(e.event_type)}">${e.event_type}</span>
          ${e.summary || 'No description'}
        </div>
        <div class="feed-meta">
          <span>${timeAgo(e.created_at)}</span>
          ${e.project ? `<span>📁 ${e.project}</span>` : ''}
          ${e.session_id ? `<span>🔗 ${e.session_id.slice(0, 8)}</span>` : ''}
        </div>
      </div>
    </li>
  `).join('');
}

function renderSessions(sessions) {
  const el = document.getElementById('sessions-content');

  if (!sessions || sessions.length === 0) {
    el.innerHTML = '<div class="empty-state">No active sessions</div>';
    return;
  }

  el.innerHTML = sessions.map(s => `
    <div class="session-card">
      <div class="session-project">
        <span class="session-project-dot"></span>
        ${s.project || 'Unknown project'}
      </div>
      <div class="session-summary">${s.summary || 'Working...'}</div>
      <div class="session-time">Started ${timeAgo(s.started_at)}</div>
    </div>
  `).join('');
}

function renderCalendar(events) {
  const el = document.getElementById('calendar-content');

  if (!events || events.length === 0) {
    el.innerHTML = '<div class="empty-state">No upcoming events</div>';
    return;
  }

  el.innerHTML = events.map(e => {
    const startDate = e.start?.dateTime || e.start?.date || e.start;
    const isAllDay = e.allDay || (e.start?.date && !e.start?.dateTime);
    return `
      <div class="cal-event">
        <div class="cal-time">${isAllDay ? 'All day' : formatTime(startDate)}</div>
        <div>
          <div class="cal-title">${formatDate(startDate)} — ${e.summary}</div>
          ${e.location ? `<div class="cal-location">📍 ${e.location}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// --- Refresh ---

async function refreshAll() {
  const [stats, events, sessions, trello, calendar, jarvis, klaus] = await Promise.all([
    fetchJSON('/api/events/stats'),
    fetchJSON('/api/events?limit=50'),
    fetchJSON('/api/sessions/active'),
    fetchJSON('/api/trello'),
    fetchJSON('/api/calendar?days=7'),
    fetchJSON('/api/agent/jarvis/status'),
    fetchJSON('/api/agent/klaus/status')
  ]);

  renderStats(stats);
  renderFeed(events);
  renderSessions(sessions);
  renderAgentStatus(jarvis, 'jarvis-status-content', 'jarvis-status-badge', 'Jarvis');
  renderAgentStatus(klaus, 'klaus-status-content', 'klaus-status-badge', 'Klaus');

  if (trello && trello.boards) {
    boardsData = trello;
    renderTabs(trello.boards);
    renderBoard(trello.boards[activeTab]);
  }

  renderCalendar(calendar);

  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('last-update').textContent = now;
}

// --- Init ---
refreshAll();
setInterval(refreshAll, REFRESH_INTERVAL);
