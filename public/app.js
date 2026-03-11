// ===== STATE =====
const REFRESH_INTERVAL = 30000;
const AGENT_REFRESH_INTERVAL = 15000;

let boardsData = null;
let activeTab = 0;
let currentCard = null;
let currentBoardLists = null;
let newCardListId = null;
let boardLabelsCache = {};
let editingDesc = false;
let currentView = 'overview';
let expandedTaskId = null;
let inboxPriority = 'normal';
let editingTaskId = null;

// ===== HELPERS =====

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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function priorityBadgeHtml(priority) {
  return `<span class="priority-badge ${priority}">${priority}</span>`;
}

function categoryTagHtml(category) {
  if (!category) return '';
  return `<span class="category-tag">${escapeHtml(category)}</span>`;
}

// ===== ROUTING =====

function getView() {
  const hash = location.hash.replace('#', '') || 'overview';
  return hash;
}

function navigate(view) {
  location.hash = '#' + view;
}

function updateNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    const v = link.dataset.view;
    link.classList.toggle('active', v === currentView);
  });
}

function route() {
  currentView = getView();
  updateNav();
  const main = document.getElementById('main-content');

  switch (currentView) {
    case 'overview': renderOverview(main); break;
    case 'inbox': renderInbox(main); break;
    case 'kanban': renderKanban(main); break;
    case 'projects': renderProjects(main); break;
    case 'docs': renderDocs(main); break;
    case 'log': renderLog(main); break;
    default: renderOverview(main); break;
  }
}

// ===== SIDEBAR AGENT STATUS =====

async function refreshAgentSidebar() {
  const [jarvis, klaus] = await Promise.all([
    fetchJSON('/api/agent/jarvis/status'),
    fetchJSON('/api/agent/klaus/status')
  ]);
  updateSidebarAgent('jarvis', jarvis);
  updateSidebarAgent('klaus', klaus);
}

function updateSidebarAgent(name, status) {
  const dot = document.getElementById(`agent-dot-${name}`);
  const text = document.getElementById(`agent-status-${name}`);

  if (!status || status.error) {
    dot.className = 'agent-dot offline';
    text.textContent = 'Offline';
    return;
  }

  const updatedAgo = status.updated_at ? (Date.now() - new Date(status.updated_at).getTime()) / 60000 : 999;

  if (updatedAgo > 5) {
    dot.className = 'agent-dot idle';
    text.textContent = `Idle · ${timeAgo(status.updated_at)}`;
  } else {
    dot.className = 'agent-dot online';
    text.textContent = status.status_text || status.task || status.model || 'Online';
  }
}

// ===== VIEW: OVERVIEW =====

async function renderOverview(container) {
  container.innerHTML = `
    <div class="view-container">
      <div class="overview-grid">
        <div class="stats-row">
          <div class="stat-card green">
            <div class="stat-value" id="stat-tasks">-</div>
            <div class="stat-label">Tasks Completed</div>
          </div>
          <div class="stat-card blue">
            <div class="stat-value" id="stat-tool-uses">-</div>
            <div class="stat-label">Tool Uses Today</div>
          </div>
          <div class="stat-card accent">
            <div class="stat-value" id="stat-sessions">-</div>
            <div class="stat-label">Active Sessions</div>
          </div>
          <div class="stat-card orange">
            <div class="stat-value" id="stat-events">-</div>
            <div class="stat-label">Events Today</div>
          </div>
        </div>

        <div class="card agent-status-card">
          <div class="card-header">
            <span class="card-title">🐶 Jarvis</span>
            <span class="card-badge" id="jarvis-status-badge" style="background:var(--green-dim);color:var(--green)">Online</span>
          </div>
          <div id="jarvis-status-content">
            <div class="empty-state">Waiting for status...</div>
          </div>
        </div>

        <div class="card agent-status-card">
          <div class="card-header">
            <span class="card-title">⚡ Klaus</span>
            <span class="card-badge" id="klaus-status-badge" style="background:var(--red-dim);color:var(--red)">Offline</span>
          </div>
          <div id="klaus-status-content">
            <div class="empty-state">No activity yet</div>
          </div>
        </div>

        <div class="card" id="sessions-card">
          <div class="card-header">
            <span class="card-title">⚡ Active Agent Sessions</span>
          </div>
          <div id="sessions-content">
            <div class="loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>

        <div class="card" id="calendar-card">
          <div class="card-header">
            <span class="card-title">📅 Upcoming Schedule</span>
            <span class="card-badge" style="background:var(--blue-dim);color:var(--blue)">7 days</span>
          </div>
          <div id="calendar-content">
            <div class="loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>

        <div class="card activity-feed-card">
          <div class="card-header">
            <span class="card-title">📡 Agent Activity Feed</span>
            <span class="card-badge" style="background:var(--green-dim);color:var(--green)" id="feed-count">0 events</span>
          </div>
          <ul class="feed-list" id="activity-feed">
            <li class="empty-state">No agent activity yet.</li>
          </ul>
        </div>
      </div>
    </div>
  `;
  refreshOverviewData();
}

async function refreshOverviewData() {
  if (currentView !== 'overview') return;

  const [stats, events, sessions, calendar, jarvis, klaus] = await Promise.all([
    fetchJSON('/api/events/stats'),
    fetchJSON('/api/events?limit=50'),
    fetchJSON('/api/sessions/active'),
    fetchJSON('/api/calendar?days=7'),
    fetchJSON('/api/agent/jarvis/status'),
    fetchJSON('/api/agent/klaus/status')
  ]);

  if (currentView !== 'overview') return; // view changed during fetch

  renderStats(stats);
  renderFeed(events);
  renderSessions(sessions);
  renderAgentStatus(jarvis, 'jarvis-status-content', 'jarvis-status-badge', 'Jarvis');
  renderAgentStatus(klaus, 'klaus-status-content', 'klaus-status-badge', 'Klaus');
  renderCalendar(calendar);
}

function renderStats(stats) {
  if (!stats) return;
  const el = (id) => document.getElementById(id);
  if (el('stat-tasks')) el('stat-tasks').textContent = stats.tasks_today || 0;
  if (el('stat-tool-uses')) el('stat-tool-uses').textContent = stats.tool_uses_today || 0;
  if (el('stat-sessions')) el('stat-sessions').textContent = stats.active_sessions || 0;
  if (el('stat-events')) el('stat-events').textContent = stats.events_today || 0;
}

function renderAgentStatus(status, contentId, badgeId, agentName) {
  const el = document.getElementById(contentId);
  const badge = document.getElementById(badgeId);
  if (!el || !badge) return;

  if (!status || status.error) {
    el.innerHTML = `<div class="empty-state">${agentName} status not available</div>`;
    badge.textContent = 'Offline';
    badge.style.background = 'var(--red-dim)';
    badge.style.color = 'var(--red)';
    return;
  }

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
      ${statsHtml ? `<div class="jarvis-meter-row">${statsHtml}</div>` : ''}
      <div class="jarvis-updated">Last updated: ${status.updated_at ? timeAgo(status.updated_at) : 'never'}</div>
    </div>
  `;
}

function renderFeed(events) {
  const feed = document.getElementById('activity-feed');
  const count = document.getElementById('feed-count');
  if (!feed || !count) return;

  if (!events || events.length === 0) {
    feed.innerHTML = '<li class="empty-state">No agent activity yet.</li>';
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
  if (!el) return;

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
  if (!el) return;

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

// ===== VIEW: INBOX =====

async function renderInbox(container) {
  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">📥 Inbox</h2>
      </div>
      <div class="inbox-input-row">
        <input type="text" class="inbox-input" id="inbox-input" placeholder="What needs to get done?" autocomplete="off">
        <button class="inbox-priority-btn active-normal" id="inbox-priority-btn" onclick="cyclePriority()">🔵</button>
      </div>
      <div class="inbox-list" id="inbox-list">
        <div class="loading"><div class="spinner"></div> Loading tasks...</div>
      </div>
    </div>
  `;

  // Set up enter handler
  document.getElementById('inbox-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = e.target;
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      await fetchJSON('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, priority: inboxPriority })
      });
      refreshInboxList();
    }
  });

  updatePriorityBtn();
  refreshInboxList();
}

function cyclePriority() {
  const cycle = ['low', 'normal', 'high', 'urgent'];
  const idx = cycle.indexOf(inboxPriority);
  inboxPriority = cycle[(idx + 1) % cycle.length];
  updatePriorityBtn();
}

function updatePriorityBtn() {
  const btn = document.getElementById('inbox-priority-btn');
  if (!btn) return;
  const icons = { low: '🔘', normal: '🔵', high: '🟠', urgent: '🔴' };
  btn.textContent = icons[inboxPriority];
  btn.className = `inbox-priority-btn active-${inboxPriority}`;
}

async function refreshInboxList() {
  if (currentView !== 'inbox') return;
  const tasks = await fetchJSON('/api/tasks?status=inbox');
  const el = document.getElementById('inbox-list');
  if (!el || currentView !== 'inbox') return;

  if (!tasks || tasks.length === 0) {
    el.innerHTML = '<div class="empty-state">No tasks in inbox. Type above to add one!</div>';
    return;
  }

  el.innerHTML = tasks.map(t => `
    <div class="inbox-task" onclick="toggleTaskExpand(${t.id})">
      <div class="inbox-task-priority priority-${t.priority}"></div>
      <div class="inbox-task-content">
        <div class="inbox-task-title">${escapeHtml(t.title)}</div>
        <div class="inbox-task-meta">
          ${priorityBadgeHtml(t.priority)}
          ${categoryTagHtml(t.category)}
          <span>${timeAgo(t.created_at)}</span>
        </div>
        ${expandedTaskId === t.id && t.description ? `<div class="inbox-task-desc">${escapeHtml(t.description)}</div>` : ''}
      </div>
      <div class="inbox-task-actions" onclick="event.stopPropagation()">
        <button class="inbox-btn edit-btn" onclick="openTaskEdit(${t.id})" title="Edit">✏️</button>
        <button class="inbox-btn kanban-btn" onclick="moveToKanban(${t.id})" title="Move to Kanban">📋 Kanban</button>
        <button class="inbox-btn delete-btn" onclick="deleteInboxTask(${t.id})" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

function toggleTaskExpand(id) {
  expandedTaskId = expandedTaskId === id ? null : id;
  refreshInboxList();
}

async function moveToKanban(id) {
  await fetchJSON(`/api/tasks/${id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'todo' })
  });
  refreshInboxList();
}

async function deleteInboxTask(id) {
  await fetchJSON(`/api/tasks/${id}`, { method: 'DELETE' });
  refreshInboxList();
}

function openTaskEdit(id) {
  editingTaskId = id;
  // Fetch task data
  fetchJSON(`/api/tasks?status=inbox`).then(tasks => {
    const task = tasks?.find(t => t.id === id);
    if (!task) return;
    document.getElementById('task-modal-name').value = task.title || '';
    document.getElementById('task-modal-desc').value = task.description || '';
    document.getElementById('task-modal-priority').value = task.priority || 'normal';
    document.getElementById('task-modal-category').value = task.category || '';
    document.getElementById('task-modal').classList.add('visible');
  });
}

async function saveTaskModal() {
  if (!editingTaskId) return;
  const data = {
    title: document.getElementById('task-modal-name').value.trim(),
    description: document.getElementById('task-modal-desc').value.trim(),
    priority: document.getElementById('task-modal-priority').value,
    category: document.getElementById('task-modal-category').value.trim() || null
  };
  await fetchJSON(`/api/tasks/${editingTaskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  closeTaskModal();
  refreshInboxList();
  if (currentView === 'kanban') refreshKanbanData();
}

function closeTaskModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('task-modal').classList.remove('visible');
  editingTaskId = null;
}

// ===== VIEW: KANBAN =====

async function renderKanban(container) {
  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">📋 Kanban</h2>
        <button class="btn-refresh" onclick="refreshKanbanData()" title="Refresh">↻</button>
      </div>
      <div class="kanban-board" id="kanban-board">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>
  `;
  refreshKanbanData();
}

async function refreshKanbanData() {
  if (currentView !== 'kanban') return;
  const tasks = await fetchJSON('/api/tasks?kanban=1');
  const el = document.getElementById('kanban-board');
  if (!el || currentView !== 'kanban') return;

  const columns = [
    { key: 'todo', name: 'To Do', tasks: [] },
    { key: 'in_progress', name: 'In Progress', tasks: [] },
    { key: 'done', name: 'Done', tasks: [] },
    { key: 'archived', name: 'Archive', tasks: [] }
  ];

  const today = new Date().toISOString().slice(0, 10);

  if (tasks) {
    tasks.forEach(t => {
      const col = columns.find(c => c.key === t.status);
      if (col) {
        // For archive, only show today's
        if (t.status === 'archived') {
          if (t.archived_at && t.archived_at.slice(0, 10) >= today) {
            col.tasks.push(t);
          }
        } else {
          col.tasks.push(t);
        }
      }
    });
  }

  const statusFlow = ['todo', 'in_progress', 'done', 'archived'];

  el.innerHTML = columns.map(col => `
    <div class="kanban-column">
      <div class="kanban-column-header">
        <span class="kanban-column-name">${col.name}</span>
        <span class="kanban-column-count">${col.tasks.length}</span>
      </div>
      <div class="kanban-cards">
        ${col.tasks.length === 0 ? '<div class="empty-state" style="text-align:center;padding:2rem 0.5rem">No tasks</div>' :
          col.tasks.map(t => {
            const idx = statusFlow.indexOf(t.status);
            const canLeft = idx > 0;
            const canRight = idx < statusFlow.length - 1;
            const isArchived = t.status === 'archived';
            return `
              <div class="kanban-card ${isArchived ? 'archived' : ''}" onclick="openKanbanTaskEdit(${t.id})">
                <div class="kanban-card-title">${escapeHtml(t.title)}</div>
                <div class="kanban-card-meta">
                  ${priorityBadgeHtml(t.priority)}
                  ${categoryTagHtml(t.category)}
                  <span class="kanban-card-time">${timeAgo(t.updated_at)}</span>
                </div>
                <div class="kanban-card-actions" onclick="event.stopPropagation()">
                  ${canLeft ? `<button class="kanban-move-btn" onclick="moveKanbanTask(${t.id}, '${statusFlow[idx - 1]}')">◀ ${columns[idx - 1].name}</button>` : ''}
                  ${canRight ? `<button class="kanban-move-btn" onclick="moveKanbanTask(${t.id}, '${statusFlow[idx + 1]}')">▶ ${columns[idx + 1].name}</button>` : ''}
                </div>
              </div>
            `;
          }).join('')}
      </div>
    </div>
  `).join('');
}

async function moveKanbanTask(id, newStatus) {
  await fetchJSON(`/api/tasks/${id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  refreshKanbanData();
}

function openKanbanTaskEdit(id) {
  editingTaskId = id;
  fetchJSON('/api/tasks?kanban=1').then(tasks => {
    const task = tasks?.find(t => t.id === id);
    if (!task) return;
    document.getElementById('task-modal-name').value = task.title || '';
    document.getElementById('task-modal-desc').value = task.description || '';
    document.getElementById('task-modal-priority').value = task.priority || 'normal';
    document.getElementById('task-modal-category').value = task.category || '';
    document.getElementById('task-modal').classList.add('visible');
  });
}

// ===== VIEW: PROJECTS =====

async function renderProjects(container) {
  container.innerHTML = `
    <div class="view-container">
      <div class="card projects-full">
        <div class="card-header">
          <div class="project-tabs" id="project-tabs"></div>
          <button class="btn-refresh" onclick="refreshProjects()" title="Refresh">↻</button>
        </div>
        <div id="board-container" class="board-container">
          <div class="loading"><div class="spinner"></div> Loading projects...</div>
        </div>
      </div>
    </div>
  `;
  refreshProjects();
}

// ===== VIEW: DOCS =====

let docsSelectedId = null;
let docsEditing = false;

const DOC_CATEGORIES = ['plan', 'notes', 'analytics', 'learning'];

function renderMarkdown(md) {
  if (!md) return '';
  let html = escapeHtml(md);

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="md-code-block"><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank">$1</a>');

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="md-li">$1</li>');
  html = html.replace(/((?:<li class="md-li">.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  html = html.replace(/((?:<li class="md-oli">.*<\/li>\n?)+)/g, '<ol class="md-ol">$1</ol>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr class="md-hr">');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  // Don't wrap block elements in p
  html = html.replace(/<p>\s*(<(?:h[1-4]|ul|ol|pre|hr))/g, '$1');
  html = html.replace(/(<\/(?:h[1-4]|ul|ol|pre|hr)>)\s*<\/p>/g, '$1');

  return html;
}

async function renderDocs(container) {
  container.innerHTML = `
    <div class="view-container docs-view">
      <div class="docs-layout">
        <div class="docs-sidebar">
          <div class="docs-sidebar-header">
            <h3 class="docs-sidebar-title">Documents</h3>
            <button class="btn-new-doc" onclick="newDocument()">+ New</button>
          </div>
          <div class="docs-list" id="docs-list">
            <div class="loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>
        <div class="docs-main" id="docs-main">
          <div class="docs-empty-state">
            <div class="placeholder-icon">📝</div>
            <div class="placeholder-text">Select a document</div>
            <div class="placeholder-sub">Or create a new one to get started</div>
          </div>
        </div>
      </div>
    </div>
  `;
  refreshDocsList();
}

async function refreshDocsList() {
  if (currentView !== 'docs') return;
  const docs = await fetchJSON('/api/docs');
  const el = document.getElementById('docs-list');
  if (!el || currentView !== 'docs') return;

  if (!docs || docs.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem;text-align:center">No documents yet</div>';
    return;
  }

  el.innerHTML = docs.map(d => `
    <div class="docs-list-item ${docsSelectedId === d.id ? 'active' : ''}" onclick="selectDoc(${d.id})">
      <div class="docs-list-title">${escapeHtml(d.title)}</div>
      <div class="docs-list-meta">
        ${d.category ? `<span class="docs-category-badge cat-${d.category}">${d.category}</span>` : ''}
        <span>${timeAgo(d.updated_at)}</span>
      </div>
    </div>
  `).join('');
}

async function selectDoc(id) {
  docsSelectedId = id;
  docsEditing = false;
  refreshDocsList();
  const doc = await fetchJSON(`/api/docs/${id}`);
  const main = document.getElementById('docs-main');
  if (!main || !doc || currentView !== 'docs') return;

  main.innerHTML = `
    <div class="docs-viewer">
      <div class="docs-viewer-header">
        <h2 class="docs-viewer-title">${escapeHtml(doc.title)}</h2>
        <div class="docs-viewer-actions">
          ${doc.category ? `<span class="docs-category-badge cat-${doc.category}">${doc.category}</span>` : ''}
          <button class="btn-doc-action" onclick="editDoc(${doc.id})">✏️ Edit</button>
        </div>
      </div>
      <div class="docs-viewer-meta">Updated ${timeAgo(doc.updated_at)} · Created ${timeAgo(doc.created_at)}</div>
      <div class="docs-content markdown-body">${renderMarkdown(doc.content)}</div>
    </div>
  `;
}

async function editDoc(id) {
  const doc = await fetchJSON(`/api/docs/${id}`);
  const main = document.getElementById('docs-main');
  if (!main || !doc) return;
  docsEditing = true;

  main.innerHTML = `
    <div class="docs-editor">
      <div class="docs-editor-header">
        <input type="text" class="docs-title-input" id="doc-edit-title" value="${escapeHtml(doc.title)}" placeholder="Document title...">
        <select class="docs-category-select" id="doc-edit-category">
          <option value="">No category</option>
          ${DOC_CATEGORIES.map(c => `<option value="${c}" ${doc.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <textarea class="docs-content-input" id="doc-edit-content" placeholder="Write in markdown...">${escapeHtml(doc.content)}</textarea>
      <div class="docs-editor-actions">
        <button class="btn-move" onclick="saveDoc(${doc.id})">Save</button>
        <button class="btn-archive" onclick="selectDoc(${doc.id})">Cancel</button>
        <button class="btn-doc-delete" onclick="deleteDoc(${doc.id})">🗑 Delete</button>
      </div>
    </div>
  `;
  document.getElementById('doc-edit-content').focus();
}

async function saveDoc(id) {
  const title = document.getElementById('doc-edit-title').value.trim();
  const content = document.getElementById('doc-edit-content').value;
  const category = document.getElementById('doc-edit-category').value || null;
  if (!title) return;

  await fetchJSON(`/api/docs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, category })
  });
  docsEditing = false;
  refreshDocsList();
  selectDoc(id);
}

async function deleteDoc(id) {
  if (!confirm('Delete this document?')) return;
  await fetchJSON(`/api/docs/${id}`, { method: 'DELETE' });
  docsSelectedId = null;
  docsEditing = false;
  renderDocs(document.getElementById('main-content'));
}

async function newDocument() {
  const doc = await fetchJSON('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled Document', content: '', category: null })
  });
  if (doc && doc.id) {
    docsSelectedId = doc.id;
    refreshDocsList();
    editDoc(doc.id);
  }
}

// ===== VIEW: ACTIVITY LOG =====

let logAutoRefreshTimer = null;
let logFilterAgent = '';
let logFilterSearch = '';

async function renderLog(container) {
  // Clear any existing auto-refresh
  if (logAutoRefreshTimer) clearInterval(logAutoRefreshTimer);

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">📜 Activity Log</h2>
        <button class="btn-refresh" onclick="refreshLogData()" title="Refresh">↻</button>
      </div>
      <div class="log-filters">
        <select class="log-filter-select" id="log-filter-agent" onchange="logFilterAgent=this.value;refreshLogData()">
          <option value="">All Agents</option>
          <option value="jarvis">🐶 Jarvis</option>
          <option value="klaus">⚡ Klaus</option>
        </select>
        <input type="text" class="log-filter-search" id="log-filter-search" placeholder="Search actions..." oninput="logFilterSearch=this.value;refreshLogData()">
      </div>
      <div class="log-stats-row" id="log-stats"></div>
      <div class="log-entries" id="log-entries">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>
  `;
  refreshLogData();
  logAutoRefreshTimer = setInterval(() => {
    if (currentView === 'log') refreshLogData();
  }, 30000);
}

function getDateGroup(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (itemDate.getTime() === today.getTime()) return 'Today';
  if (itemDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function logStatusBadge(status) {
  const cls = status === 'completed' ? 'log-status-completed' :
              status === 'failed' ? 'log-status-failed' : 'log-status-progress';
  return `<span class="log-status-badge ${cls}">${status}</span>`;
}

function logAgentBadge(agent) {
  const isJarvis = agent.toLowerCase() === 'jarvis';
  const icon = isJarvis ? '🐶' : '⚡';
  const cls = isJarvis ? 'log-agent-jarvis' : 'log-agent-klaus';
  return `<span class="log-agent-badge ${cls}">${icon} ${agent}</span>`;
}

async function refreshLogData() {
  if (currentView !== 'log') return;

  const params = new URLSearchParams();
  if (logFilterAgent) params.set('agent', logFilterAgent);
  params.set('limit', '200');

  const [entries, stats] = await Promise.all([
    fetchJSON(`/api/log?${params}`),
    fetchJSON('/api/log/stats')
  ]);

  if (currentView !== 'log') return;

  // Render stats
  const statsEl = document.getElementById('log-stats');
  if (statsEl && stats) {
    const agents = stats.agents || [];
    statsEl.innerHTML = agents.map(a => `
      <div class="log-stat-card">
        <span class="log-stat-agent">${a.agent === 'jarvis' ? '🐶' : '⚡'} ${a.agent}</span>
        <span class="log-stat-value">${a.today} today</span>
        <span class="log-stat-sub">${a.total} total · avg ${formatDuration(a.avg_duration_ms)}</span>
      </div>
    `).join('');
  }

  // Render entries
  const el = document.getElementById('log-entries');
  if (!el) return;

  let filtered = entries || [];
  if (logFilterSearch) {
    const q = logFilterSearch.toLowerCase();
    filtered = filtered.filter(e =>
      (e.action && e.action.toLowerCase().includes(q)) ||
      (e.description && e.description.toLowerCase().includes(q)) ||
      (e.reason && e.reason.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    el.innerHTML = `
      <div class="docs-empty-state" style="padding:3rem;text-align:center">
        <div class="placeholder-icon">📜</div>
        <div class="placeholder-text">No log entries</div>
        <div class="placeholder-sub">Activity will appear here as Jarvis and Klaus take actions</div>
      </div>
    `;
    return;
  }

  // Group by date
  const groups = {};
  filtered.forEach(e => {
    const group = getDateGroup(e.started_at);
    if (!groups[group]) groups[group] = [];
    groups[group].push(e);
  });

  let html = '';
  for (const [group, items] of Object.entries(groups)) {
    html += `<div class="log-date-group"><div class="log-date-label">${group}</div>`;
    html += items.map((e, i) => `
      <div class="log-entry ${i % 2 === 0 ? 'log-entry-even' : ''}">
        <div class="log-entry-agent">${logAgentBadge(e.agent)}</div>
        <div class="log-entry-content">
          <div class="log-entry-action">${escapeHtml(e.action)}</div>
          ${e.description ? `<div class="log-entry-desc">${escapeHtml(e.description)}</div>` : ''}
          ${e.reason ? `<div class="log-entry-reason">↳ ${escapeHtml(e.reason)}</div>` : ''}
        </div>
        <div class="log-entry-meta">
          ${logStatusBadge(e.status || 'completed')}
          <span class="log-entry-time">${formatTime(e.started_at)}</span>
          <span class="log-entry-duration">${formatDuration(e.duration_ms)}</span>
        </div>
      </div>
    `).join('');
    html += '</div>';
  }

  el.innerHTML = html;
}

// ===== VIEW: PLACEHOLDER =====

function renderPlaceholder(container, icon, title, subtitle) {
  container.innerHTML = `
    <div class="view-container">
      <div class="placeholder-page">
        <div class="placeholder-icon">${icon}</div>
        <div class="placeholder-text">${title}</div>
        <div class="placeholder-sub">${subtitle}</div>
      </div>
    </div>
  `;
}

// ===== TRELLO BOARD RENDERING =====

function renderTabs(boards) {
  const tabsEl = document.getElementById('project-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = boards.map((b, i) => `
    <div class="project-tab ${i === activeTab ? 'active' : ''}" onclick="switchTab(${i})">
      ${b.name}
      <span class="tab-count">${b.totalCards}</span>
    </div>
  `).join('');
}

function renderBoard(board) {
  const container = document.getElementById('board-container');
  if (!container) return;

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

// ===== TRELLO CARD MODAL =====

async function openCard(card) {
  currentCard = card;
  currentBoardLists = boardsData.boards[activeTab].lists;
  editingDesc = false;

  document.getElementById('modal-card-name').textContent = card.name;
  document.getElementById('modal-card-desc').textContent = card.desc || 'No description';
  document.getElementById('modal-card-desc').style.display = '';
  document.getElementById('modal-desc-edit').style.display = 'none';
  document.getElementById('btn-edit-desc').textContent = '✏️ Edit';

  const select = document.getElementById('modal-card-list');
  let currentListIdx = 0;
  select.innerHTML = currentBoardLists.map((l, i) => {
    const isCurrent = l.cards.some(c => c.id === card.id);
    if (isCurrent) currentListIdx = i;
    return `<option value="${l.id}" ${isCurrent ? 'selected' : ''}>${l.name}</option>`;
  }).join('');

  document.getElementById('btn-move-left').disabled = (currentListIdx === 0);
  document.getElementById('btn-move-right').disabled = (currentListIdx === currentBoardLists.length - 1);

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

  const boardId = boardsData.boards[activeTab].id;
  await loadBoardLabels(boardId);
  renderLabelPicker(boardId);

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

async function loadBoardLabels(boardId) {
  if (boardLabelsCache[boardId]) return;
  const labels = await fetchJSON(`/api/trello/boards/${boardId}/labels`);
  if (labels && Array.isArray(labels)) {
    boardLabelsCache[boardId] = labels.filter(l => l.color);
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
  const newIds = isActive ? activeIds.filter(id => id !== labelId) : [...activeIds, labelId];

  await fetchJSON(`/api/trello/cards/${currentCard.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idLabels: newIds.join(',') })
  });

  const allLabels = boardLabelsCache[boardId] || [];
  currentCard.labels = allLabels.filter(l => newIds.includes(l.id)).map(l => ({ id: l.id, name: l.name, color: l.color }));

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

async function moveCardLeft() {
  if (!currentCard || !currentBoardLists) return;
  const currentIdx = currentBoardLists.findIndex(l => l.cards.some(c => c.id === currentCard.id));
  if (currentIdx <= 0) return;
  await fetchJSON(`/api/trello/cards/${currentCard.id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: currentBoardLists[currentIdx - 1].id })
  });
  closeModal();
  refreshProjects();
}

async function moveCardRight() {
  if (!currentCard || !currentBoardLists) return;
  const currentIdx = currentBoardLists.findIndex(l => l.cards.some(c => c.id === currentCard.id));
  if (currentIdx < 0 || currentIdx >= currentBoardLists.length - 1) return;
  await fetchJSON(`/api/trello/cards/${currentCard.id}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: currentBoardLists[currentIdx + 1].id })
  });
  closeModal();
  refreshProjects();
}

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

// ===== NEW CARD MODAL =====

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

// ===== KEYBOARD SHORTCUTS =====

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('new-card-modal').classList.contains('visible')) {
    // Only if focus is on new card name input
    if (document.activeElement === document.getElementById('new-card-name')) {
      e.preventDefault();
      submitNewCard();
    }
  }
  if (e.key === 'Escape') {
    closeModal();
    closeNewCardModal();
    closeTaskModal();
  }
});

// ===== REFRESH LOOP =====

function updateTimestamp() {
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const el = document.getElementById('last-update');
  if (el) el.textContent = now;
}

async function periodicRefresh() {
  updateTimestamp();
  if (currentView === 'overview') {
    refreshOverviewData();
  }
}

// ===== INIT =====

window.addEventListener('hashchange', route);
route();
refreshAgentSidebar();
updateTimestamp();

// Periodic refreshes
setInterval(periodicRefresh, REFRESH_INTERVAL);
setInterval(refreshAgentSidebar, AGENT_REFRESH_INTERVAL);
