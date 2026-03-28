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
let currentView = 'home';
let expandedTaskId = null;
let inboxPriority = 'normal';
let editingTaskId = null;

// Badge state
let navBadges = {};

// Schedule/Calendar state
let calViewMode = 'day'; // day, week, month
let calSelectedDate = new Date();
let editingScheduleId = null;
const SCHEDULE_COLORS = [
  { name: 'Purple', value: '#7c6bf0' },
  { name: 'Blue', value: '#60a5fa' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Red', value: '#f87171' },
  { name: 'Yellow', value: '#fbbf24' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Teal', value: '#2dd4bf' }
];
let selectedScheduleColor = '#7c6bf0';
let calCurrentTimeInterval = null;

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
  const hash = location.hash.replace('#', '') || 'home';
  return hash;
}

function navigate(view) {
  location.hash = '#' + view;
}

// ===== MOBILE SIDEBAR =====

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('open');
    backdrop.classList.add('visible');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar.classList.remove('open');
  backdrop.classList.remove('visible');
}

// Page name mapping for mobile top bar
const VIEW_NAMES = {
  home: 'Home',
  schedule: 'Schedule',
  inbox: 'Inbox',
  kanban: 'Kanban',
  projects: 'Projects',
  ideas: 'Ideas',
  workspace: 'Workspace',
  docs: 'Docs',
  finance: 'Finance',
  log: 'Activity Log'
};

function updateMobilePageName() {
  const el = document.getElementById('mobile-topbar-page');
  if (!el) return;
  if (currentView.startsWith('agent/')) {
    const name = currentView.split('/')[1];
    el.textContent = name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
  } else {
    el.textContent = VIEW_NAMES[currentView] || currentView;
  }
}

function updateNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    const v = link.dataset.view;
    link.classList.toggle('active', v === currentView);
  });
  // Clear sidebar agent active states when navigating to non-agent pages
  if (!currentView.startsWith('agent/')) {
    document.querySelectorAll('.sidebar-agent').forEach(el => el.classList.remove('sidebar-agent-active'));
  }
  updateMobilePageName();
}

async function fetchNavBadges() {
  try {
    navBadges = await fetchJSON('/api/notifications/badges') || {};
    renderNavBadges();
  } catch (e) { /* silent */ }
}

function renderNavBadges() {
  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    const tab = link.dataset.view;
    const count = navBadges[tab] || 0;
    let badge = link.querySelector('.nav-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        link.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : count;
    } else if (badge) {
      badge.remove();
    }
  });
}

async function markTabSeen(tab) {
  const tracked = ['inbox', 'ideas', 'projects', 'docs', 'kanban', 'schedule', 'log'];
  if (!tracked.includes(tab)) return;
  try {
    await fetch('/api/notifications/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab })
    });
    navBadges[tab] = 0;
    renderNavBadges();
  } catch (e) { /* silent */ }
}

function route() {
  currentView = getView();
  updateNav();
  markTabSeen(currentView);
  closeSidebar();
  const main = document.getElementById('main-content');

  // Handle agent profile routes like #agent/jarvis
  if (currentView.startsWith('agent/')) {
    const agentName = currentView.split('/')[1];
    if (agentName) {
      renderAgentProfile(main, agentName);
      return;
    }
  }

  if (currentView === 'overview') { navigate('home'); return; }

  switch (currentView) {
    case 'home': renderHome(main); break;
    case 'goals': renderGoals(main); break;
    case 'schedule': renderSchedule(main); break;
    case 'inbox': renderInbox(main); break;
    case 'kanban': renderKanban(main); break;
    case 'projects': renderProjects(main); break;
    case 'ideas': renderIdeas(main); break;
    case 'workspace': renderWorkspace(main); break;
    case 'docs': renderDocs(main); break;
    case 'finance': renderFinance(main); break;
    case 'log': renderLog(main); break;
    default: renderHome(main); break;
  }
}

// ===== SIDEBAR AGENT STATUS =====

async function refreshAgentSidebar() {
  const [jarvis, klaus, emily] = await Promise.all([
    fetchJSON('/api/agent/jarvis/status'),
    fetchJSON('/api/agent/klaus/status'),
    fetchJSON('/api/agent/emily/status')
  ]);
  updateSidebarAgent('jarvis', jarvis);
  updateSidebarAgent('klaus', klaus);
  updateSidebarAgent('emily', emily);
}

// Make sidebar agent cards clickable
document.getElementById('sidebar-agent-jarvis')?.addEventListener('click', () => { navigate('agent/jarvis'); closeSidebar(); });
document.getElementById('sidebar-agent-klaus')?.addEventListener('click', () => { navigate('agent/klaus'); closeSidebar(); });
document.getElementById('sidebar-agent-emily')?.addEventListener('click', () => { navigate('agent/emily'); closeSidebar(); });

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

// ===== VIEW: OVERVIEW (Original Dashboard) =====

// ===== HOME PAGE =====

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function relativeActivityTime(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function staleBadgeHtml(daysStr, staleLevel) {
  if (!staleLevel) return '';
  const days = daysStr;
  const cls = staleLevel === 'red' ? 'stale-red' : 'stale-amber';
  return `<span class="stale-badge ${cls}" title="No activity for ${days} day${days !== 1 ? 's' : ''}">⚠ ${days}d</span>`;
}

async function renderHome(container) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  container.innerHTML = `
    <div class="view-container home-view">
      <!-- 1. Header: greeting + stats pills -->
      <div class="home-header">
        <div class="home-greeting">
          <span class="home-greeting-text">${getGreeting()}, Sasha</span>
          <span class="home-datetime">${dateStr} &mdash; ${timeStr}</span>
        </div>
        <div class="home-header-stats" id="home-header-stats">
          <span class="home-stat-pill" id="home-stat-alerts">… alerts</span>
          <span class="home-stat-pill blue" id="home-stat-projects">… projects</span>
          <span class="home-stat-pill green" id="home-stat-tasks">… tasks</span>
        </div>
      </div>

      <!-- 2. Stats Row -->
      <div class="stats-row home-stats-row">
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

      <div class="home-body">
        <!-- 3. Goals Widget -->
        <section class="home-section home-goals-section">
          <div class="home-section-header">
            <span class="home-section-title">🎯 Today's Goals</span>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <span class="home-section-badge" id="home-goals-badge" style="display:none"></span>
              <button class="btn-ghost home-goals-set-btn" onclick="openGoalsModal()">+ Set Goals</button>
            </div>
          </div>
          <div id="home-goals-list" class="home-loading">Loading…</div>
        </section>

        <!-- 4. Alerts -->
        <section class="home-section" id="home-alerts-section">
          <div class="home-section-header">
            <span class="home-section-title">🔔 Alerts</span>
            <span class="home-section-badge" id="home-alerts-count">…</span>
          </div>
          <div id="home-alerts-list" class="home-loading">Loading…</div>
        </section>

        <!-- 5. Two-col: Agent Status (rich cards) + Active Tasks -->
        <div class="home-two-col">
          <section class="home-section" id="home-agents-section">
            <div class="home-section-header">
              <span class="home-section-title">🤖 Agent Status</span>
            </div>
            <div class="agent-cards-vertical">
              <div class="card agent-status-card">
                <div class="card-header">
                  <span class="card-title">🐶 Jarvis</span>
                  <span class="card-badge" id="jarvis-status-badge" style="background:var(--green-dim);color:var(--green)">Online</span>
                </div>
                <div id="jarvis-status-content"><div class="empty-state">Waiting for status...</div></div>
              </div>
              <div class="card agent-status-card">
                <div class="card-header">
                  <span class="card-title">⚡ Klaus</span>
                  <span class="card-badge" id="klaus-status-badge" style="background:var(--red-dim);color:var(--red)">Offline</span>
                </div>
                <div id="klaus-status-content"><div class="empty-state">No activity yet</div></div>
              </div>
              <div class="card agent-status-card">
                <div class="card-header">
                  <span class="card-title">📧 Emily</span>
                  <span class="card-badge" id="emily-status-badge" style="background:var(--red-dim);color:var(--red)">Offline</span>
                </div>
                <div id="emily-status-content"><div class="empty-state">No activity yet</div></div>
              </div>
            </div>
          </section>

          <section class="home-section" id="home-tasks-section">
            <div class="home-section-header">
              <span class="home-section-title">✅ Active Tasks</span>
            </div>
            <div id="home-tasks-list" class="home-loading">Loading…</div>
          </section>
        </div>

        <!-- 6. Today's Schedule -->
        <section class="home-section" id="home-schedule-section">
          <div class="home-section-header">
            <span class="home-section-title">🗓 Today's Schedule</span>
          </div>
          <div id="home-schedule-list" class="home-loading">Loading…</div>
        </section>

        <!-- 7. Projects Grid -->
        <section class="home-section" id="home-projects-section">
          <div class="home-section-header">
            <span class="home-section-title">📁 Projects</span>
          </div>
          <div id="home-projects-grid" class="home-loading">Loading…</div>
        </section>

        <!-- 8. Two-col: Activity Feed + Heartbeat & Deliverables -->
        <div class="home-two-col">
          <section class="home-section">
            <div class="home-section-header">
              <span class="home-section-title">📡 Activity Feed</span>
              <span class="home-section-badge" id="feed-count">0 events</span>
            </div>
            <ul class="feed-list" id="activity-feed">
              <li class="empty-state">No agent activity yet.</li>
            </ul>
          </section>

          <div class="home-right-col">
            <section class="home-section">
              <div class="home-section-header">
                <span class="home-section-title">💓 Heartbeat</span>
                <span class="card-badge" id="heartbeat-badge" style="background:var(--text-muted);color:var(--bg-card)">...</span>
              </div>
              <div id="heartbeat-content"><div class="home-loading">Loading…</div></div>
            </section>

            <section class="home-section">
              <div class="home-section-header">
                <span class="home-section-title">🚀 Scheduled Deliverables</span>
                <span class="home-section-badge" style="background:rgba(167,139,250,0.15);color:#a78bfa">automated</span>
              </div>
              <div id="deliverables-content"><div class="home-loading">Loading…</div></div>
            </section>
          </div>
        </div>

        <!-- 9. Quick Actions -->
        <section class="home-section home-quick-actions">
          <div class="home-section-header">
            <span class="home-section-title">⚡ Quick Actions</span>
          </div>
          <div class="quick-actions-row">
            <button class="quick-action-btn" onclick="navigate('inbox')">
              <span class="qa-icon">📥</span>
              <span>Add Task</span>
            </button>
            <button class="quick-action-btn" onclick="navigate('projects')">
              <span class="qa-icon">📁</span>
              <span>Projects</span>
            </button>
            <button class="quick-action-btn" onclick="navigate('kanban')">
              <span class="qa-icon">📋</span>
              <span>Kanban</span>
            </button>
            <button class="quick-action-btn" onclick="navigate('schedule')">
              <span class="qa-icon">🗓</span>
              <span>Schedule</span>
            </button>
            <button class="quick-action-btn" onclick="navigate('ideas')">
              <span class="qa-icon">💡</span>
              <span>Ideas</span>
            </button>
            <button class="quick-action-btn" onclick="navigate('log')">
              <span class="qa-icon">📜</span>
              <span>Activity Log</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  `;

  refreshHomeData();
}

async function refreshHomeData() {
  if (currentView !== 'home') return;

  const [homeData, stats, events, jarvis, klaus, emily, deliverables, heartbeat] = await Promise.all([
    fetchJSON('/api/home'),
    fetchJSON('/api/events/stats'),
    fetchJSON('/api/events?limit=50'),
    fetchJSON('/api/agent/jarvis/status'),
    fetchJSON('/api/agent/klaus/status'),
    fetchJSON('/api/agent/emily/status'),
    fetchJSON('/api/scheduled-deliverables'),
    fetchJSON('/api/heartbeat-status')
  ]);

  if (currentView !== 'home') return;

  if (homeData) {
    const alertEl = document.getElementById('home-stat-alerts');
    const projEl = document.getElementById('home-stat-projects');
    const taskEl = document.getElementById('home-stat-tasks');
    if (alertEl) {
      alertEl.textContent = `${homeData.stats.alerts_count} alert${homeData.stats.alerts_count !== 1 ? 's' : ''}`;
      alertEl.className = 'home-stat-pill' + (homeData.stats.alerts_count > 0 ? ' red' : '');
    }
    if (projEl) projEl.textContent = `${homeData.stats.projects_active} projects`;
    if (taskEl) taskEl.textContent = `${homeData.stats.tasks_in_progress + homeData.stats.tasks_todo} tasks`;

    renderHomeGoals(homeData.goals);
    renderHomeAlerts(homeData.alerts);
    renderHomeSchedule(homeData.schedule);
    renderHomeTasks(homeData.tasks);
    renderHomeProjects(homeData.projects);
  }

  renderStats(stats);
  renderFeed(events);
  renderAgentStatus(jarvis, 'jarvis-status-content', 'jarvis-status-badge', 'Jarvis');
  renderAgentStatus(klaus, 'klaus-status-content', 'klaus-status-badge', 'Klaus');
  renderAgentStatus(emily, 'emily-status-content', 'emily-status-badge', 'Emily');
  renderDeliverables(deliverables);
  renderHeartbeat(heartbeat);
}

function renderHomeAlerts(alerts) {
  const el = document.getElementById('home-alerts-list');
  const count = document.getElementById('home-alerts-count');
  if (!el) return;
  if (count) {
    count.textContent = alerts.length || '0';
    count.className = 'home-section-badge' + (alerts.length > 0 ? ' badge-red' : '');
  }
  if (!alerts || alerts.length === 0) {
    el.innerHTML = '<div class="home-empty">No active alerts — all clear ✓</div>';
    return;
  }
  el.innerHTML = alerts.map(a => `
    <div class="alert-row alert-${a.severity}" data-alert-id="${a.id}">
      <span class="alert-icon">${a.severity === 'red' ? '🔴' : a.severity === 'amber' ? '🟡' : 'ℹ️'}</span>
      <span class="alert-message">${escapeHtml(a.message)}</span>
      <button class="alert-dismiss" onclick="dismissHomeAlert(${a.id})" title="Dismiss">×</button>
    </div>
  `).join('');
}

async function dismissHomeAlert(id) {
  await fetchJSON(`/api/alerts/${id}/dismiss`, { method: 'POST' });
  const row = document.querySelector(`[data-alert-id="${id}"]`);
  if (row) row.remove();
  // Update count
  const remaining = document.querySelectorAll('.alert-row').length;
  const count = document.getElementById('home-alerts-count');
  if (count) {
    count.textContent = remaining;
    count.className = 'home-section-badge' + (remaining > 0 ? ' badge-red' : '');
  }
  const alertStat = document.getElementById('home-stat-alerts');
  if (alertStat) {
    alertStat.textContent = `${remaining} alert${remaining !== 1 ? 's' : ''}`;
    alertStat.className = 'home-stat-pill' + (remaining > 0 ? ' red' : '');
  }
  if (remaining === 0) {
    const el = document.getElementById('home-alerts-list');
    if (el) el.innerHTML = '<div class="home-empty">No active alerts — all clear ✓</div>';
  }
}

function renderHomeSchedule(schedule) {
  const el = document.getElementById('home-schedule-list');
  if (!el) return;
  if (!schedule || schedule.length === 0) {
    el.innerHTML = '<div class="home-empty">Nothing scheduled for today.</div>';
    return;
  }
  el.innerHTML = `<div class="home-timeline">${schedule.map(s => `
    <div class="timeline-item" style="--item-color:${escapeHtml(s.color || '#7c6bf0')}">
      <div class="timeline-time">${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)}</div>
      <div class="timeline-content">
        <span class="timeline-title">${escapeHtml(s.title)}</span>
        ${s.description ? `<span class="timeline-desc">${escapeHtml(s.description)}</span>` : ''}
      </div>
    </div>
  `).join('')}</div>`;
}

function renderHomeTasks(tasks) {
  const el = document.getElementById('home-tasks-list');
  if (!el) return;
  if (!tasks || tasks.length === 0) {
    el.innerHTML = '<div class="home-empty">No active tasks.</div>';
    return;
  }
  el.innerHTML = tasks.slice(0, 8).map(t => `
    <div class="home-task-row">
      <span class="home-task-status-dot ${t.status === 'in_progress' ? 'in-progress' : 'todo'}"></span>
      <span class="home-task-title">${escapeHtml(t.title)}</span>
      ${t.priority && t.priority !== 'normal' ? `<span class="priority-badge ${t.priority}">${t.priority}</span>` : ''}
    </div>
  `).join('');
}

function renderHomeProjects(projects) {
  const el = document.getElementById('home-projects-grid');
  if (!el) return;
  const active = projects.filter(p => p.status === 'active');
  if (active.length === 0) {
    el.innerHTML = '<div class="home-empty">No active projects.</div>';
    return;
  }
  el.className = 'home-projects-grid';
  el.innerHTML = active.map(p => `
    <div class="home-project-card ${p.stale_level ? 'stale-' + p.stale_level : ''}" onclick="navigate('projects')">
      <div class="home-project-icon">${p.icon || '📁'}</div>
      <div class="home-project-info">
        <div class="home-project-name">${escapeHtml(p.name)}${staleBadgeHtml(p.days_since_activity, p.stale_level)}</div>
        <div class="home-project-meta">
          <span class="project-status-tag ${p.status}">${p.status}</span>
          <span class="home-project-activity" title="${p.last_activity_at || 'Never'}">${relativeActivityTime(p.last_activity_at)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ===== GOALS HOME WIDGET =====

function renderHomeGoals(goals) {
  const el = document.getElementById('home-goals-list');
  const badge = document.getElementById('home-goals-badge');
  if (!el) return;

  if (!goals || goals.length === 0) {
    el.className = '';
    el.innerHTML = `
      <div class="goals-empty-cta">
        <span class="goals-empty-icon">🎯</span>
        <span class="goals-empty-text">Set your 3 goals for today</span>
        <button class="btn-ghost" onclick="openGoalsModal()">+ Set Goals</button>
      </div>`;
    if (badge) badge.style.display = 'none';
    return;
  }

  const completed = goals.filter(g => g.status === 'completed').length;
  if (badge) {
    badge.style.display = completed === goals.length ? 'inline' : 'none';
    badge.textContent = `${completed}/${goals.length} done`;
    badge.className = 'home-section-badge' + (completed === goals.length ? ' badge-green' : '');
  }

  el.className = 'home-goals-list';
  el.innerHTML = goals.map(g => {
    const totalSteps = g.steps.length;
    const doneSteps = g.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
    const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : (g.status === 'completed' ? 100 : 0);
    const statusClass = g.status === 'completed' ? 'completed' : g.status === 'active' ? 'active' : '';

    return `
    <div class="home-goal-card ${statusClass}" id="home-goal-${g.id}">
      <div class="home-goal-header" onclick="toggleHomeGoal(${g.id})">
        <div class="home-goal-title-row">
          <span class="home-goal-status-dot ${g.status}"></span>
          <span class="home-goal-title ${g.status === 'completed' ? 'done' : ''}">${escapeHtml(g.title)}</span>
          ${totalSteps > 0 ? `<span class="home-goal-step-count">${doneSteps}/${totalSteps}</span>` : ''}
        </div>
        <div class="home-goal-progress-bar"><div class="home-goal-progress-fill" style="width:${pct}%"></div></div>
      </div>
      ${totalSteps > 0 ? `
        <div class="home-goal-steps" id="home-goal-steps-${g.id}" style="display:none">
          ${g.steps.map(s => `
            <label class="home-step-row ${s.status === 'done' ? 'done' : ''}">
              <input type="checkbox" class="home-step-check" ${s.status === 'done' ? 'checked' : ''}
                onchange="toggleStep(${g.id}, ${s.id}, this.checked)">
              <span class="home-step-title">${escapeHtml(s.title)}</span>
              ${s.estimated_minutes ? `<span class="home-step-mins">${s.estimated_minutes}m</span>` : ''}
            </label>
          `).join('')}
        </div>` : ''}
    </div>`;
  }).join('');
}

function toggleHomeGoal(goalId) {
  const steps = document.getElementById(`home-goal-steps-${goalId}`);
  if (!steps) return;
  steps.style.display = steps.style.display === 'none' ? 'block' : 'none';
}

async function toggleStep(goalId, stepId, checked) {
  const status = checked ? 'done' : 'pending';
  await fetch(`/api/goals/${goalId}/steps/${stepId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  // Refresh goals widget
  const homeData = await fetchJSON('/api/home');
  if (homeData) renderHomeGoals(homeData.goals);
}

// ===== GOALS MODAL =====

let goalsModalDate = null;

function openGoalsModal(date) {
  const modal = document.getElementById('goals-modal');
  const dateInput = document.getElementById('goals-modal-date');
  const today = new Date().toISOString().slice(0, 10);
  goalsModalDate = date || today;
  if (dateInput) dateInput.value = goalsModalDate;
  document.getElementById('goals-modal-title').textContent = goalsModalDate === today ? "Set Today's Goals" : `Set Goals for ${goalsModalDate}`;
  // Reset inputs to 3 blank
  const container = document.getElementById('goals-modal-inputs');
  container.innerHTML = [1,2,3].map((n, i) => `
    <div class="modal-field goal-input-row">
      <label>Goal ${n}</label>
      <input type="text" class="modal-input goal-title-input" placeholder="${['e.g. Ship the auth feature','e.g. Review pull requests','e.g. Write blog post outline'][i] || ''}">
    </div>`).join('');
  modal.classList.add('active');
  modal.querySelector('.goal-title-input').focus();
}

function closeGoalsModal(e) {
  if (e && e.target !== document.getElementById('goals-modal')) return;
  document.getElementById('goals-modal').classList.remove('active');
}

function addGoalInput() {
  const container = document.getElementById('goals-modal-inputs');
  const n = container.querySelectorAll('.goal-input-row').length + 1;
  const div = document.createElement('div');
  div.className = 'modal-field goal-input-row';
  div.innerHTML = `<label>Goal ${n}</label><input type="text" class="modal-input goal-title-input" placeholder="Another goal...">`;
  container.appendChild(div);
  div.querySelector('input').focus();
}

async function submitGoalsModal() {
  const date = document.getElementById('goals-modal-date').value;
  const inputs = document.querySelectorAll('.goal-title-input');
  const titles = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
  if (titles.length === 0) return;

  await fetch('/api/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, goals: titles.map(t => ({ title: t })) })
  });

  document.getElementById('goals-modal').classList.remove('active');

  // Refresh relevant view
  if (currentView === 'home') {
    const homeData = await fetchJSON('/api/home');
    if (homeData) renderHomeGoals(homeData.goals);
  } else if (currentView === 'goals') {
    renderGoals(document.getElementById('main-content'));
  }
}

// ===== STEP MODAL =====

let stepModalGoalId = null;

function openStepModal(goalId, goalTitle) {
  stepModalGoalId = goalId;
  document.getElementById('step-modal-title').textContent = 'Add Steps';
  document.getElementById('step-modal-goal-name').textContent = goalTitle;
  const container = document.getElementById('step-inputs');
  container.innerHTML = `
    <div class="modal-field step-input-row">
      <input type="text" class="modal-input step-title-input" placeholder="Step title..." autofocus>
      <input type="number" class="modal-input step-mins-input" placeholder="mins" style="width:80px;margin-top:0.25rem">
    </div>`;
  document.getElementById('step-modal').classList.add('active');
  container.querySelector('.step-title-input').focus();
}

function closeStepModal(e) {
  if (e && e.target !== document.getElementById('step-modal')) return;
  document.getElementById('step-modal').classList.remove('active');
}

function addStepInput() {
  const container = document.getElementById('step-inputs');
  const div = document.createElement('div');
  div.className = 'modal-field step-input-row';
  div.innerHTML = `<input type="text" class="modal-input step-title-input" placeholder="Step title..."><input type="number" class="modal-input step-mins-input" placeholder="mins" style="width:80px;margin-top:0.25rem">`;
  container.appendChild(div);
  div.querySelector('input').focus();
}

async function submitStepModal() {
  const rows = document.querySelectorAll('#step-inputs .step-input-row');
  const steps = Array.from(rows).map(r => ({
    title: r.querySelector('.step-title-input').value.trim(),
    estimated_minutes: parseInt(r.querySelector('.step-mins-input').value) || null
  })).filter(s => s.title);

  if (steps.length === 0) return;

  await fetch(`/api/goals/${stepModalGoalId}/steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps })
  });

  document.getElementById('step-modal').classList.remove('active');
  if (currentView === 'goals') renderGoals(document.getElementById('main-content'));
}

// ===== GOALS PAGE =====

async function renderGoals(container) {
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="view-container goals-view">
      <div class="view-header">
        <h1 class="view-title">🎯 Goals</h1>
        <div class="view-header-actions">
          <button class="btn-primary" onclick="openGoalsModal()">+ Set Goals</button>
          <button class="btn-ghost" onclick="carryForwardGoals()" title="Move yesterday's incomplete goals to today">↩ Carry Forward</button>
        </div>
      </div>

      <div class="goals-toolbar">
        <div class="goals-date-nav">
          <button class="btn-icon" onclick="goalsNavDate(-1)">◀</button>
          <input type="date" id="goals-date-picker" class="modal-input" value="${today}" style="width:160px" onchange="loadGoalsForDate(this.value)">
          <button class="btn-icon" onclick="goalsNavDate(1)">▶</button>
          <button class="btn-ghost" onclick="loadGoalsForDate('${today}')">Today</button>
        </div>
        <div id="goals-summary-bar"></div>
      </div>

      <div id="goals-page-list" class="goals-page-list">
        <div class="home-loading">Loading…</div>
      </div>

      <div class="goals-history-section">
        <div class="home-section-header" style="margin-bottom:0.75rem">
          <span class="home-section-title">📅 Recent History</span>
        </div>
        <div id="goals-history-list" class="goals-history-list">
          <div class="home-loading">Loading…</div>
        </div>
      </div>
    </div>
  `;

  await loadGoalsForDate(today);
  await loadGoalsHistory();
}

let goalsCurrentDate = new Date().toISOString().slice(0, 10);

function goalsNavDate(delta) {
  const d = new Date(goalsCurrentDate);
  d.setDate(d.getDate() + delta);
  const newDate = d.toISOString().slice(0, 10);
  document.getElementById('goals-date-picker').value = newDate;
  loadGoalsForDate(newDate);
}

async function loadGoalsForDate(date) {
  goalsCurrentDate = date;
  const el = document.getElementById('goals-page-list');
  const summaryEl = document.getElementById('goals-summary-bar');
  if (!el) return;
  el.innerHTML = '<div class="home-loading">Loading…</div>';

  const goals = await fetchJSON(`/api/goals?date=${date}`);
  if (!goals) { el.innerHTML = '<div class="home-empty">Error loading goals.</div>'; return; }

  if (summaryEl) {
    if (goals.length > 0) {
      const done = goals.filter(g => g.status === 'completed').length;
      const pct = Math.round((done / goals.length) * 100);
      summaryEl.innerHTML = `<span class="goals-summary-pill">${done}/${goals.length} complete &mdash; ${pct}%</span>`;
    } else {
      summaryEl.innerHTML = '';
    }
  }

  if (goals.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    el.innerHTML = `
      <div class="goals-empty-cta">
        <span class="goals-empty-icon">🎯</span>
        <span class="goals-empty-text">${date === today ? 'No goals set for today.' : 'No goals on this date.'}</span>
        ${date === today ? `<button class="btn-ghost" onclick="openGoalsModal('${date}')">+ Set Goals</button>` : ''}
      </div>`;
    return;
  }

  el.innerHTML = goals.map(g => renderGoalCard(g)).join('');
}

function renderGoalCard(g) {
  const totalSteps = g.steps.length;
  const doneSteps = g.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : (g.status === 'completed' ? 100 : 0);

  const statusColors = { pending: 'var(--text-muted)', active: 'var(--yellow)', completed: 'var(--green)', carried_forward: 'var(--blue)' };
  const statusColor = statusColors[g.status] || 'var(--text-muted)';

  return `
  <div class="goal-card" id="goal-card-${g.id}">
    <div class="goal-card-header">
      <div class="goal-card-title-row">
        <span class="goal-status-dot" style="background:${statusColor}" title="${g.status}"></span>
        <span class="goal-card-title ${g.status === 'completed' ? 'done' : ''}">${escapeHtml(g.title)}</span>
        <span class="goal-status-badge ${g.status}">${g.status.replace('_', ' ')}</span>
      </div>
      <div class="goal-card-actions">
        <button class="btn-icon" title="Add steps" onclick="openStepModal(${g.id}, '${escapeHtml(g.title).replace(/'/g, "\\'")}')">+ Steps</button>
        <button class="btn-icon" title="Mark complete" onclick="markGoalDone(${g.id})" ${g.status === 'completed' ? 'disabled' : ''}>✓</button>
        <button class="btn-icon danger" title="Delete goal" onclick="deleteGoal(${g.id})">🗑</button>
      </div>
    </div>

    <div class="goal-progress-row">
      <div class="goal-progress-bar-track"><div class="goal-progress-bar-fill" style="width:${pct}%"></div></div>
      <span class="goal-progress-pct">${pct}%</span>
    </div>

    ${g.steps.length > 0 ? `
    <div class="goal-steps-list" id="goal-steps-${g.id}">
      ${g.steps.map(s => `
        <div class="goal-step-row ${s.status === 'done' ? 'done' : ''}" id="goal-step-row-${s.id}">
          <label class="goal-step-label">
            <input type="checkbox" class="goal-step-check" ${s.status === 'done' ? 'checked' : ''}
              onchange="toggleGoalStep(${g.id}, ${s.id}, this.checked, '${goalsCurrentDate}')">
            <span class="goal-step-title">${escapeHtml(s.title)}</span>
            ${s.estimated_minutes ? `<span class="goal-step-mins">${s.estimated_minutes}m</span>` : ''}
          </label>
          <button class="btn-icon danger small" onclick="deleteStep(${g.id}, ${s.id}, '${goalsCurrentDate}')">×</button>
        </div>`).join('')}
    </div>` : `<div class="goal-no-steps"><button class="btn-ghost small" onclick="openStepModal(${g.id}, '${escapeHtml(g.title).replace(/'/g, "\\'")}')">+ Add steps</button></div>`}
  </div>`;
}

async function markGoalDone(goalId) {
  await fetch(`/api/goals/${goalId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' })
  });
  await loadGoalsForDate(goalsCurrentDate);
}

async function deleteGoal(goalId) {
  if (!confirm('Delete this goal and all its steps?')) return;
  await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
  await loadGoalsForDate(goalsCurrentDate);
}

async function toggleGoalStep(goalId, stepId, checked, date) {
  const status = checked ? 'done' : 'pending';
  await fetch(`/api/goals/${goalId}/steps/${stepId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  await loadGoalsForDate(date || goalsCurrentDate);
}

async function deleteStep(goalId, stepId, date) {
  await fetch(`/api/goals/${goalId}/steps/${stepId}`, { method: 'DELETE' });
  await loadGoalsForDate(date || goalsCurrentDate);
}

async function carryForwardGoals() {
  const res = await fetch('/api/goals/carry-forward', { method: 'POST' });
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('goals-date-picker').value = today;
  await loadGoalsForDate(today);
  if (data.carried > 0) {
    showToast(`Carried forward ${data.carried} goal${data.carried !== 1 ? 's' : ''} to today`);
  } else {
    showToast('No incomplete goals to carry forward');
  }
}

async function loadGoalsHistory() {
  const el = document.getElementById('goals-history-list');
  if (!el) return;

  // Load last 7 days
  const dates = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }

  const results = await Promise.all(dates.map(d => fetchJSON(`/api/goals?date=${d}`)));

  const rows = dates.map((d, i) => {
    const goals = results[i] || [];
    if (goals.length === 0) return null;
    const done = goals.filter(g => g.status === 'completed').length;
    const pct = Math.round((done / goals.length) * 100);
    const barColor = pct === 100 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    return `
      <div class="goals-history-row" onclick="loadGoalsForDate('${d}');document.getElementById('goals-date-picker').value='${d}'">
        <span class="goals-history-date">${d}</span>
        <div class="goals-history-bar-track"><div class="goals-history-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <span class="goals-history-pct">${done}/${goals.length}</span>
      </div>`;
  }).filter(Boolean);

  el.innerHTML = rows.length > 0 ? rows.join('') : '<div class="home-empty">No goal history yet.</div>';
}

// ===== TOAST HELPER =====

function showToast(msg, duration = 3000) {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'global-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
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
        <span class="session-active-dot"></span>
        ${escapeHtml(s.project || 'Unknown project')}
      </div>
      <div class="session-summary">${escapeHtml(s.last_summary || 'Working...')}</div>
      <div class="session-meta">
        <span class="session-time">Last activity: ${timeAgo(s.last_activity)}</span>
        <span class="session-events">${s.event_count} event${s.event_count !== 1 ? 's' : ''} in last 30m</span>
      </div>
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

  const now = new Date();

  el.innerHTML = events.map(e => {
    const startDate = e.start?.dateTime || e.start?.date || e.start;
    const endDate = e.end?.dateTime || e.end?.date || e.end;
    const isAllDay = e.allDay || (e.start?.date && !e.start?.dateTime);

    // Determine event status
    let statusClass = '';
    let badgeHtml = '';
    let titlePrefix = '';

    const startTime = new Date(startDate);
    const endTime = endDate ? new Date(endDate) : null;

    if (isAllDay) {
      // All-day events: compare by date only
      const todayStr = now.toISOString().slice(0, 10);
      const eventDateStr = typeof startDate === 'string' ? startDate.slice(0, 10) : startTime.toISOString().slice(0, 10);
      if (eventDateStr < todayStr) {
        statusClass = 'cal-event-done';
        titlePrefix = '<span class="cal-check">✓</span> ';
      } else if (eventDateStr === todayStr) {
        statusClass = 'cal-event-active';
        badgeHtml = ' <span class="cal-now-badge">NOW</span>';
      }
    } else if (endTime && endTime <= now) {
      // Past event — ended already
      statusClass = 'cal-event-done';
      titlePrefix = '<span class="cal-check">✓</span> ';
    } else if (startTime <= now && (!endTime || endTime > now)) {
      // Currently happening
      statusClass = 'cal-event-active';
      badgeHtml = ' <span class="cal-now-badge">NOW</span>';
    }
    // else: upcoming — no extra class

    return `
      <div class="cal-event ${statusClass}">
        <div class="cal-time">${isAllDay ? 'All day' : formatTime(startDate)}${badgeHtml}</div>
        <div>
          <div class="cal-title">${titlePrefix}${formatDate(startDate)} — ${e.summary}</div>
          ${e.location ? `<div class="cal-location">📍 ${e.location}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ===== SCHEDULED DELIVERABLES =====

function getNextDeliverableRun(deliverable) {
  // Parse schedule time like "8:00 AM" or "4:00 PM"
  const match = deliverable.schedule.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const mins = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  const detail = (deliverable.scheduleDetail || '').toLowerCase();
  const isWeekdaysOnly = detail.includes('weekday');
  const isSundayOnly = detail.includes('sunday');

  // Use London time
  const now = new Date();
  const londonNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const londonToday = new Date(londonNow.getFullYear(), londonNow.getMonth(), londonNow.getDate(), hours, mins, 0);

  let next = new Date(londonToday);

  // If already past today's run time, move to next day
  if (londonNow >= londonToday) {
    next.setDate(next.getDate() + 1);
  }

  // Skip to correct day based on schedule type
  if (isSundayOnly) {
    while (next.getDay() !== 0) {
      next.setDate(next.getDate() + 1);
    }
  } else if (isWeekdaysOnly) {
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
  }

  // Format relative
  const todayDate = new Date(londonNow.getFullYear(), londonNow.getMonth(), londonNow.getDate());
  const nextDate = new Date(next.getFullYear(), next.getMonth(), next.getDate());
  const diffDays = Math.round((nextDate - todayDate) / 86400000);

  let dayLabel;
  if (diffDays === 0) dayLabel = 'today';
  else if (diffDays === 1) dayLabel = 'tomorrow';
  else dayLabel = next.toLocaleDateString('en-GB', { weekday: 'long' });

  return `${dayLabel} ${deliverable.schedule}`;
}

function getAgentBadge(agent) {
  const a = (agent || '').toLowerCase();
  if (a === 'emily') return '<span class="deliv-agent-badge emily">📧 Emily</span>';
  if (a === 'jarvis') return '<span class="deliv-agent-badge jarvis">🐶 Jarvis</span>';
  if (a === 'klaus') return '<span class="deliv-agent-badge klaus">⚡ Klaus</span>';
  return `<span class="deliv-agent-badge">${escapeHtml(agent)}</span>`;
}

function renderDeliverables(deliverables) {
  const el = document.getElementById('deliverables-content');
  if (!el) return;

  if (!deliverables || deliverables.length === 0) {
    el.innerHTML = '<div class="empty-state">No scheduled deliverables</div>';
    return;
  }

  el.innerHTML = deliverables.map(d => {
    const nextRun = getNextDeliverableRun(d);
    const dLow = (d.scheduleDetail || '').toLowerCase();
    const freq = dLow.includes('sunday') ? 'sundays' : dLow.includes('weekday') ? 'weekdays' : dLow.includes('hourly') ? 'hourly' : 'daily';

    return `
      <div class="deliv-row ${d.enabled ? '' : 'disabled'}">
        <div class="deliv-status-dot ${d.enabled ? 'enabled' : 'disabled'}"></div>
        <div class="deliv-emoji">${d.emoji}</div>
        <div class="deliv-info">
          <div class="deliv-name">${escapeHtml(d.name.replace(/^[\p{Emoji}\s]+/u, ''))}</div>
          <div class="deliv-desc">${escapeHtml(d.description)}</div>
        </div>
        <div class="deliv-meta">
          <div class="deliv-schedule">${d.schedule} ${freq}</div>
          ${nextRun ? `<div class="deliv-next">Next: ${nextRun}</div>` : ''}
        </div>
        <div class="deliv-agent">${getAgentBadge(d.agent)}</div>
      </div>
    `;
  }).join('');
}

// ===== HEARTBEAT CARD =====

function renderHeartbeat(hb) {
  const el = document.getElementById('heartbeat-content');
  const badge = document.getElementById('heartbeat-badge');
  if (!el || !hb) return;

  const isDormant = hb.dormant;
  const status = !hb.enabled ? 'Disabled' : isDormant ? 'Dormant' : 'Active';
  const statusColor = !hb.enabled ? 'var(--red)' : isDormant ? 'var(--text-muted)' : 'var(--green)';
  const statusBg = !hb.enabled ? 'var(--red-dim)' : isDormant ? 'rgba(255,255,255,0.08)' : 'var(--green-dim)';

  if (badge) {
    badge.style.background = statusBg;
    badge.style.color = statusColor;
    badge.textContent = status;
  }

  // Config line
  const model = (hb.model || 'unknown').split('/').pop();
  const configLine = `Every ${hb.interval} · ${model} · ${hb.lightContext ? 'light context' : 'full context'}`;

  // Active hours
  let hoursLine = '';
  if (hb.activeHours) {
    const tz = (hb.activeHours.timezone || 'UTC').replace(/^.*\//, '');
    hoursLine = `${hb.activeHours.start}–${hb.activeHours.end} ${tz}`;
  }

  // Timing line
  let timingHtml = '';
  if (hb.lastHeartbeat || hb.nextHeartbeat) {
    const fmtTime = (iso) => {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } catch { return '—'; }
    };
    const last = fmtTime(hb.lastHeartbeat);
    const next = isDormant ? 'dormant' : fmtTime(hb.nextHeartbeat);
    timingHtml = `<div class="hb-timing">Last: <strong>${last}</strong> · Next: <strong>${next}</strong></div>`;
  } else if (isDormant) {
    timingHtml = `<div class="hb-timing">No heartbeats — HEARTBEAT.md is empty</div>`;
  }

  // Check items
  let checksHtml = '';
  if (hb.checkItems && hb.checkItems.length > 0) {
    checksHtml = `<ul class="hb-checks">${hb.checkItems.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`;
  } else if (isDormant) {
    checksHtml = `<div class="hb-dormant-hint">Add tasks to HEARTBEAT.md to activate</div>`;
  }

  el.innerHTML = `
    <div class="hb-config">${escapeHtml(configLine)}</div>
    ${hoursLine ? `<div class="hb-hours">🕐 ${escapeHtml(hoursLine)}</div>` : ''}
    ${timingHtml}
    ${checksHtml}
  `;
}

// ===== VIEW: SCHEDULE (Calendar/Schedule) =====

// Calendar date helpers
function calDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calWeekStart(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function calWeekEnd(d) {
  const start = calWeekStart(d);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}

function calMonthStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function calMonthEnd(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function calFormatHeader(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function calFormatWeekHeader(d) {
  const start = calWeekStart(d);
  const end = calWeekEnd(d);
  const fmt = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('en-GB', fmt)} — ${end.toLocaleDateString('en-GB', fmt)}, ${end.getFullYear()}`;
}

function calFormatMonthHeader(d) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToPx(mins, hourHeight) {
  return (mins / 60) * hourHeight;
}

const CAL_START_HOUR = 6;
const CAL_END_HOUR = 23;
const CAL_HOUR_HEIGHT = 80;

async function renderSchedule(container) {
  // Clear previous time indicator interval
  if (calCurrentTimeInterval) { clearInterval(calCurrentTimeInterval); calCurrentTimeInterval = null; }

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header">
        <h2 class="view-title">🗓️ Schedule</h2>
      </div>

      <!-- Calendar Controls -->
      <div class="cal-controls">
        <div class="cal-nav">
          <button class="cal-nav-btn" onclick="calNavigate(-1)" title="Previous">◀</button>
          <button class="cal-today-btn" onclick="calGoToday()">Today</button>
          <button class="cal-nav-btn" onclick="calNavigate(1)" title="Next">▶</button>
          <span class="cal-header-text" id="cal-header-text"></span>
        </div>
        <div class="cal-view-toggle">
          <button class="cal-view-btn ${calViewMode === 'day' ? 'active' : ''}" onclick="calSwitchView('day')">Day</button>
          <button class="cal-view-btn ${calViewMode === 'week' ? 'active' : ''}" onclick="calSwitchView('week')">Week</button>
          <button class="cal-view-btn ${calViewMode === 'month' ? 'active' : ''}" onclick="calSwitchView('month')">Month</button>
        </div>
      </div>

      <!-- Calendar Container -->
      <div class="cal-container" id="cal-container">
        <div class="loading"><div class="spinner"></div> Loading schedule...</div>
      </div>

      <!-- Scheduled Deliverables -->
      <div class="card deliv-schedule-card" style="margin-top:1.25rem">
        <div class="card-header">
          <span class="card-title">🚀 Scheduled Deliverables</span>
          <span class="card-badge" style="background:rgba(167,139,250,0.15);color:#a78bfa">recurring</span>
        </div>
        <div id="schedule-deliverables-content">
          <div class="loading"><div class="spinner"></div> Loading...</div>
        </div>
      </div>

      <!-- Today's Agenda -->
      <div class="card" style="margin-top:1.25rem">
        <div class="card-header">
          <span class="card-title">📋 Today's Agenda</span>
        </div>
        <div id="agenda-content">
          <div class="loading"><div class="spinner"></div> Loading...</div>
        </div>
      </div>
    </div>
  `;
  refreshScheduleData();
}

async function refreshScheduleData() {
  if (currentView !== 'schedule') return;

  // Determine date range for current view
  let from, to;
  if (calViewMode === 'day') {
    from = to = calDateStr(calSelectedDate);
  } else if (calViewMode === 'week') {
    from = calDateStr(calWeekStart(calSelectedDate));
    to = calDateStr(calWeekEnd(calSelectedDate));
  } else {
    // Month: include padding days
    const ms = calMonthStart(calSelectedDate);
    const me = calMonthEnd(calSelectedDate);
    const startDay = ms.getDay();
    const padBefore = startDay === 0 ? 6 : startDay - 1;
    from = calDateStr(new Date(ms.getFullYear(), ms.getMonth(), ms.getDate() - padBefore));
    to = calDateStr(new Date(me.getFullYear(), me.getMonth(), me.getDate() + (42 - padBefore - me.getDate())));
  }

  const todayStr = calDateStr(new Date());

  // Calculate calendar days needed from today
  const calDays = calViewMode === 'month' ? 45 : calViewMode === 'week' ? 14 : 7;
  const [schedule, todaySchedule, calendar, deliverables] = await Promise.all([
    fetchJSON(`/api/schedule?from=${from}&to=${to}`),
    fetchJSON(`/api/schedule?date=${todayStr}`),
    fetchJSON(`/api/calendar?days=${calDays}`),
    fetchJSON('/api/scheduled-deliverables')
  ]);

  if (currentView !== 'schedule') return;

  // Convert Google Calendar events to schedule-like blocks
  const calendarBlocks = (calendar || []).map(e => {
    const startRaw = e.start?.dateTime || e.start?.date || e.start;
    const endRaw = e.end?.dateTime || e.end?.date || e.end;
    if (!startRaw) return null;
    const isAllDay = e.allDay || (e.start?.date && !e.start?.dateTime);
    const startDt = new Date(startRaw);
    const endDt = endRaw ? new Date(endRaw) : new Date(startDt.getTime() + 3600000);
    // Convert to London time
    const startLondon = new Date(startDt.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const endLondon = new Date(endDt.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const dateStr = startRaw.slice(0, 10);
    const startTime = isAllDay ? '06:00' : String(startLondon.getHours()).padStart(2, '0') + ':' + String(startLondon.getMinutes()).padStart(2, '0');
    const endTime = isAllDay ? '23:00' : String(endLondon.getHours()).padStart(2, '0') + ':' + String(endLondon.getMinutes()).padStart(2, '0');
    return {
      date: dateStr,
      start_time: startTime,
      end_time: endTime,
      title: e.summary || 'Calendar Event',
      color: '#22d3ee',
      description: e.location ? '📍 ' + e.location : '',
      isGoogleCal: true,
      isAllDay
    };
  }).filter(Boolean);

  // Header text
  const headerEl = document.getElementById('cal-header-text');
  if (headerEl) {
    if (calViewMode === 'day') headerEl.textContent = calFormatHeader(calSelectedDate);
    else if (calViewMode === 'week') headerEl.textContent = calFormatWeekHeader(calSelectedDate);
    else headerEl.textContent = calFormatMonthHeader(calSelectedDate);
  }

  // Render the appropriate view
  const calContainer = document.getElementById('cal-container');
  if (!calContainer) return;

  // Build deliverable blocks for the time grid
  const deliverableBlocks = buildDeliverableBlocks(deliverables || [], from, to);

  if (calViewMode === 'day') renderDayView(calContainer, schedule || [], calendarBlocks, deliverableBlocks);
  else if (calViewMode === 'week') renderWeekView(calContainer, schedule || [], calendarBlocks, deliverableBlocks);
  else renderMonthView(calContainer, schedule || [], calendarBlocks, deliverableBlocks);

  // Render schedule deliverables section
  renderScheduleDeliverables(deliverables || []);

  // Agenda
  renderAgenda(todaySchedule, calendar);
}

// ===== DELIVERABLE BLOCKS FOR SCHEDULE =====

function buildDeliverableBlocks(deliverables, fromStr, toStr) {
  if (!deliverables || deliverables.length === 0) return [];

  const blocks = [];
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T23:59:59');

  // Iterate each day in range
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
    const dateStr = calDateStr(d);

    deliverables.forEach(del => {
      if (!del.enabled) return;

      const detailLower = (del.scheduleDetail || '').toLowerCase();
      const isWeekday = detailLower.includes('weekday');
      const isSunday = detailLower.includes('sunday');
      if (isWeekday && (dayOfWeek === 0 || dayOfWeek === 6)) return;
      if (isSunday && dayOfWeek !== 0) return;

      // Parse time
      const match = del.schedule.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return;
      let hours = parseInt(match[1]);
      const mins = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const startTime = String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
      const endHour = hours;
      const endMin = mins + 30; // 30-min block
      const endTime = String(endMin >= 60 ? endHour + 1 : endHour).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');

      blocks.push({
        date: dateStr,
        start_time: startTime,
        end_time: endTime,
        title: del.name,
        emoji: del.emoji,
        agent: del.agent,
        description: del.description,
        isDeliverable: true
      });
    });
  }

  return blocks;
}

function renderDeliverableBlocks(blocks, compact) {
  return (blocks || []).map(e => {
    const startMins = timeToMinutes(e.start_time) - CAL_START_HOUR * 60;
    const endMins = timeToMinutes(e.end_time) - CAL_START_HOUR * 60;
    const top = minutesToPx(Math.max(startMins, 0), CAL_HOUR_HEIGHT);
    const height = Math.max(minutesToPx(endMins - Math.max(startMins, 0), CAL_HOUR_HEIGHT), 20);
    const agentIcon = (e.agent || '').toLowerCase() === 'emily' ? '📧' : '🐶';

    return `<div class="cal-block cal-block-deliverable" style="top:${top}px;height:${height}px"
      title="${escapeHtml(e.title)}\n${e.start_time}\n${e.description || ''}">
      <div class="cal-block-title">${escapeHtml(e.title)}</div>
      ${!compact ? `<div class="cal-block-time">${e.start_time} · ${agentIcon} ${escapeHtml(e.agent)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderScheduleDeliverables(deliverables) {
  const el = document.getElementById('schedule-deliverables-content');
  if (!el) return;

  if (!deliverables || deliverables.length === 0) {
    el.innerHTML = '<div class="empty-state">No scheduled deliverables</div>';
    return;
  }

  el.innerHTML = `
    <div class="sched-deliv-grid">
      ${deliverables.map(d => {
        const nextRun = getNextDeliverableRun(d);
        const detailLow = (d.scheduleDetail || '').toLowerCase();
        const isWeekday = detailLow.includes('weekday');
        const isSunday = detailLow.includes('sunday');
        const isHourly = detailLow.includes('hourly');
        const freq = isSunday ? 'Sundays' : isWeekday ? 'Weekdays' : isHourly ? 'Hourly' : 'Daily';
        const agentIcon = (d.agent || '').toLowerCase() === 'emily' ? '📧' : (d.agent || '').toLowerCase() === 'klaus' ? '⚡' : '🐶';

        return `
          <div class="sched-deliv-item ${d.enabled ? '' : 'disabled'}">
            <div class="sched-deliv-time-col">
              <div class="sched-deliv-time">${d.schedule}</div>
              <div class="sched-deliv-freq">${freq}</div>
            </div>
            <div class="sched-deliv-dot ${d.enabled ? 'enabled' : 'disabled'}"></div>
            <div class="sched-deliv-content">
              <div class="sched-deliv-name">${escapeHtml(d.name)}</div>
              <div class="sched-deliv-desc">${escapeHtml(d.description)}</div>
              <div class="sched-deliv-meta">
                <span class="sched-deliv-agent">${agentIcon} ${escapeHtml(d.agent)}</span>
                ${nextRun ? `<span class="sched-deliv-next">Next: ${nextRun}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ===== DAY VIEW =====

function renderDayView(container, entries, calendarBlocks, deliverableBlocks) {
  const totalHours = CAL_END_HOUR - CAL_START_HOUR;
  const gridHeight = totalHours * CAL_HOUR_HEIGHT;

  let hoursHtml = '';
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    const top = (h - CAL_START_HOUR) * CAL_HOUR_HEIGHT;
    const label = String(h).padStart(2, '0') + ':00';
    hoursHtml += `<div class="cal-hour-label" style="top:${top}px">${label}</div>`;
    hoursHtml += `<div class="cal-hour-line" style="top:${top}px"></div>`;
  }

  // Render time blocks
  const dateStr = calDateStr(calSelectedDate);
  const todayEntries = entries.filter(e => e.date === dateStr);
  const todayCalBlocks = (calendarBlocks || []).filter(e => e.date === dateStr);
  const todayDelivBlocks = (deliverableBlocks || []).filter(e => e.date === dateStr);
  const blocksHtml = renderTimeBlocks(todayEntries, false) + renderGoogleCalBlocks(todayCalBlocks, false) + renderDeliverableBlocks(todayDelivBlocks, false);

  container.innerHTML = `
    <div class="cal-day-view">
      <div class="cal-time-grid" style="height:${gridHeight}px" onclick="calGridClick(event, '${dateStr}')">
        ${hoursHtml}
        <div class="cal-blocks-area">
          ${blocksHtml}
        </div>
        <div class="cal-now-line" id="cal-now-line"></div>
      </div>
    </div>
  `;
  updateNowLine();
  startNowLineUpdater();
  scrollToCurrentTime();
}

// ===== WEEK VIEW =====

function renderWeekView(container, entries, calendarBlocks, deliverableBlocks) {
  const start = calWeekStart(calSelectedDate);
  const totalHours = CAL_END_HOUR - CAL_START_HOUR;
  const gridHeight = totalHours * CAL_HOUR_HEIGHT;
  const todayStr = calDateStr(new Date());

  // Day headers
  let headersHtml = '<div class="cal-week-time-col"></div>';
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = calDateStr(d);
    days.push(ds);
    const dayName = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const dayNum = d.getDate();
    const isToday = ds === todayStr;
    headersHtml += `<div class="cal-week-day-header ${isToday ? 'today' : ''}">
      <span class="cal-week-day-name">${dayName}</span>
      <span class="cal-week-day-num ${isToday ? 'today' : ''}">${dayNum}</span>
    </div>`;
  }

  // Hour labels
  let hoursHtml = '';
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    const top = (h - CAL_START_HOUR) * CAL_HOUR_HEIGHT;
    const label = String(h).padStart(2, '0') + ':00';
    hoursHtml += `<div class="cal-hour-label" style="top:${top}px">${label}</div>`;
  }

  // Columns
  let columnsHtml = '';
  for (let i = 0; i < 7; i++) {
    const ds = days[i];
    const isToday = ds === todayStr;
    const dayEntries = entries.filter(e => e.date === ds);
    const dayCalBlocks = (calendarBlocks || []).filter(e => e.date === ds);
    const dayDelivBlocks = (deliverableBlocks || []).filter(e => e.date === ds);
    const blocks = renderTimeBlocks(dayEntries, true) + renderGoogleCalBlocks(dayCalBlocks, true) + renderDeliverableBlocks(dayDelivBlocks, true);

    let gridLines = '';
    for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
      const top = (h - CAL_START_HOUR) * CAL_HOUR_HEIGHT;
      gridLines += `<div class="cal-hour-line" style="top:${top}px"></div>`;
    }

    columnsHtml += `<div class="cal-week-col ${isToday ? 'today' : ''}" onclick="calGridClick(event, '${ds}')" style="height:${gridHeight}px">
      ${gridLines}
      <div class="cal-blocks-area">${blocks}</div>
      ${isToday ? '<div class="cal-now-line" id="cal-now-line"></div>' : ''}
    </div>`;
  }

  container.innerHTML = `
    <div class="cal-week-view">
      <div class="cal-week-header">${headersHtml}</div>
      <div class="cal-week-body">
        <div class="cal-week-time-col" style="height:${gridHeight}px">${hoursHtml}</div>
        <div class="cal-week-columns">${columnsHtml}</div>
      </div>
    </div>
  `;
  updateNowLine();
  startNowLineUpdater();
  scrollToCurrentTime();
}

// ===== MONTH VIEW =====

function renderMonthView(container, entries, calendarBlocks, deliverableBlocks) {
  const todayStr = calDateStr(new Date());
  const ms = calMonthStart(calSelectedDate);
  const me = calMonthEnd(calSelectedDate);
  const startDay = ms.getDay();
  const padBefore = startDay === 0 ? 6 : startDay - 1;
  const firstCell = new Date(ms.getFullYear(), ms.getMonth(), ms.getDate() - padBefore);

  // Group entries by date
  const byDate = {};
  (entries || []).forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  // Add Google Calendar events to month view grouping
  (calendarBlocks || []).forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  // Add deliverable blocks
  (deliverableBlocks || []).forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push({ ...e, color: '#a78bfa' });
  });

  let headerHtml = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map(d => `<div class="cal-month-header-cell">${d}</div>`).join('');

  let cellsHtml = '';
  const totalCells = 42;
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + i);
    const ds = calDateStr(cellDate);
    const isToday = ds === todayStr;
    const isCurrentMonth = cellDate.getMonth() === calSelectedDate.getMonth();
    const dayEntries = byDate[ds] || [];

    const dots = dayEntries.slice(0, 3).map(e =>
      `<div class="cal-month-dot" style="background:${e.color}" title="${escapeHtml(e.title)}"></div>`
    ).join('');
    const more = dayEntries.length > 3 ? `<span class="cal-month-more">+${dayEntries.length - 3}</span>` : '';

    cellsHtml += `<div class="cal-month-cell ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'other-month' : ''}" onclick="calMonthDayClick('${ds}')">
      <span class="cal-month-day-num ${isToday ? 'today' : ''}">${cellDate.getDate()}</span>
      <div class="cal-month-dots">${dots}${more}</div>
    </div>`;
  }

  container.innerHTML = `
    <div class="cal-month-view">
      <div class="cal-month-header-row">${headerHtml}</div>
      <div class="cal-month-grid">${cellsHtml}</div>
    </div>
  `;
}

// ===== TIME BLOCKS RENDERING =====

function renderTimeBlocks(entries, compact) {
  return entries.map(e => {
    const startMins = timeToMinutes(e.start_time) - CAL_START_HOUR * 60;
    const endMins = timeToMinutes(e.end_time) - CAL_START_HOUR * 60;
    const top = minutesToPx(Math.max(startMins, 0), CAL_HOUR_HEIGHT);
    const height = Math.max(minutesToPx(endMins - Math.max(startMins, 0), CAL_HOUR_HEIGHT), 20);

    return `<div class="cal-block" style="top:${top}px;height:${height}px;background:${e.color}33;border-left:3px solid ${e.color}"
      onclick="event.stopPropagation();openScheduleEdit(${e.id})"
      title="${escapeHtml(e.title)}\n${e.start_time} – ${e.end_time}${e.description ? '\n' + e.description : ''}">
      <div class="cal-block-title">${escapeHtml(e.title)}</div>
      <div class="cal-block-time">${e.start_time} – ${e.end_time}</div>
      ${!compact && e.description ? `<div class="cal-block-desc">${escapeHtml(e.description)}</div>` : ''}
    </div>`;
  }).join('');
}

// ===== GOOGLE CALENDAR BLOCKS =====

function renderGoogleCalBlocks(events, compact) {
  return (events || []).map(e => {
    const startMins = timeToMinutes(e.start_time) - CAL_START_HOUR * 60;
    const endMins = timeToMinutes(e.end_time) - CAL_START_HOUR * 60;
    const top = minutesToPx(Math.max(startMins, 0), CAL_HOUR_HEIGHT);
    const height = Math.max(minutesToPx(endMins - Math.max(startMins, 0), CAL_HOUR_HEIGHT), 20);
    const color = '#22d3ee';

    return `<div class="cal-block cal-block-gcal" style="top:${top}px;height:${height}px;background:${color}22;border-left:3px solid ${color}"
      title="${escapeHtml(e.title)}\n${e.start_time} – ${e.end_time}${e.description ? '\n' + e.description : ''}">
      <div class="cal-block-title">${escapeHtml(e.title)}</div>
      <div class="cal-block-time">${e.start_time} – ${e.end_time}</div>
      ${!compact && e.description ? `<div class="cal-block-desc">${escapeHtml(e.description)}</div>` : ''}
    </div>`;
  }).join('');
}

// ===== NOW LINE =====

function updateNowLine() {
  const line = document.getElementById('cal-now-line');
  if (!line) return;

  const now = new Date();
  // Use London time
  const londonTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const h = londonTime.getHours();
  const m = londonTime.getMinutes();

  if (h < CAL_START_HOUR || h >= CAL_END_HOUR) {
    line.style.display = 'none';
    return;
  }

  const top = ((h - CAL_START_HOUR) * 60 + m) / 60 * CAL_HOUR_HEIGHT;
  line.style.display = '';
  line.style.top = top + 'px';
}

function startNowLineUpdater() {
  if (calCurrentTimeInterval) clearInterval(calCurrentTimeInterval);
  calCurrentTimeInterval = setInterval(updateNowLine, 60000);
}

function scrollToCurrentTime() {
  setTimeout(() => {
    const line = document.getElementById('cal-now-line');
    if (line && line.style.display !== 'none') {
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

// ===== CALENDAR NAVIGATION =====

function calNavigate(dir) {
  if (calViewMode === 'day') {
    calSelectedDate = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate() + dir);
  } else if (calViewMode === 'week') {
    calSelectedDate = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate() + (7 * dir));
  } else {
    calSelectedDate = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth() + dir, 1);
  }
  refreshScheduleData();
}

function calGoToday() {
  calSelectedDate = new Date();
  refreshScheduleData();
}

function calSwitchView(mode) {
  calViewMode = mode;
  // Update toggle buttons
  document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.cal-view-btn[onclick*="'${mode}'"]`)?.classList.add('active');
  refreshScheduleData();
}

function calMonthDayClick(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  calSelectedDate = new Date(y, m - 1, d);
  calViewMode = 'day';
  renderSchedule(document.getElementById('main-content'));
}

function calGridClick(event, dateStr) {
  // Calculate time from click position
  const rect = event.currentTarget.getBoundingClientRect();
  const y = event.clientY - rect.top + event.currentTarget.scrollTop;
  const totalMinutes = (y / CAL_HOUR_HEIGHT) * 60 + CAL_START_HOUR * 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round((totalMinutes % 60) / 15) * 15;
  const startTime = String(hours).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const endHour = minutes + 60 >= 60 ? hours + 1 : hours;
  const endMin = (minutes + 60) % 60;
  const endTime = String(Math.min(endHour, CAL_END_HOUR)).padStart(2, '0') + ':' + String(endMin).padStart(2, '0');

  openScheduleNew(dateStr, startTime, endTime);
}

// ===== AGENDA =====

function renderAgenda(todaySchedule, calendarEvents) {
  const el = document.getElementById('agenda-content');
  if (!el) return;

  const items = [];

  // Schedule entries
  if (todaySchedule) {
    todaySchedule.forEach(e => {
      items.push({
        time: e.start_time,
        endTime: e.end_time,
        title: e.title,
        color: e.color,
        source: 'schedule',
        description: e.description
      });
    });
  }

  // Google Calendar events (today only)
  if (calendarEvents) {
    const todayStr = calDateStr(new Date());
    calendarEvents.forEach(e => {
      const startDate = e.start?.dateTime || e.start?.date || e.start;
      if (!startDate) return;
      const eventDate = startDate.slice(0, 10);
      if (eventDate !== todayStr && !e.allDay) return;
      const isAllDay = e.allDay || (e.start?.date && !e.start?.dateTime);
      items.push({
        time: isAllDay ? '00:00' : new Date(startDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }),
        title: e.summary,
        color: '#60a5fa',
        source: 'google',
        location: e.location,
        isAllDay
      });
    });
  }

  items.sort((a, b) => a.time.localeCompare(b.time));

  if (items.length === 0) {
    el.innerHTML = '<div class="empty-state">No events scheduled for today</div>';
    return;
  }

  el.innerHTML = items.map(item => `
    <div class="agenda-item">
      <div class="agenda-color-dot" style="background:${item.color}"></div>
      <div class="agenda-time">${item.isAllDay ? 'All day' : item.time}${item.endTime ? ' – ' + item.endTime : ''}</div>
      <div class="agenda-info">
        <div class="agenda-title">${escapeHtml(item.title)}</div>
        ${item.description ? `<div class="agenda-desc">${escapeHtml(item.description)}</div>` : ''}
        ${item.location ? `<div class="agenda-desc">📍 ${escapeHtml(item.location)}</div>` : ''}
      </div>
      <span class="agenda-source ${item.source}">${item.source === 'google' ? '📅 Google' : '🗓 Local'}</span>
    </div>
  `).join('');
}

// ===== SCHEDULE MODAL =====

async function openScheduleNew(dateStr, startTime, endTime) {
  editingScheduleId = null;
  document.getElementById('schedule-modal-title').textContent = 'New Schedule Entry';
  document.getElementById('schedule-title').value = '';
  document.getElementById('schedule-date').value = dateStr || calDateStr(calSelectedDate);
  document.getElementById('schedule-start').value = startTime || '09:00';
  document.getElementById('schedule-end').value = endTime || '10:00';
  document.getElementById('schedule-desc').value = '';
  document.getElementById('schedule-delete-btn').style.display = 'none';
  selectedScheduleColor = '#7c6bf0';
  renderScheduleColorPicker();
  await loadTaskOptions();
  document.getElementById('schedule-task-link').value = '';
  document.getElementById('schedule-modal').classList.add('visible');
  setTimeout(() => document.getElementById('schedule-title').focus(), 100);
}

async function openScheduleEdit(id) {
  const entries = await fetchJSON(`/api/schedule?from=2000-01-01&to=2099-12-31`);
  const entry = entries?.find(e => e.id === id);
  if (!entry) return;

  editingScheduleId = id;
  document.getElementById('schedule-modal-title').textContent = 'Edit Schedule Entry';
  document.getElementById('schedule-title').value = entry.title;
  document.getElementById('schedule-date').value = entry.date;
  document.getElementById('schedule-start').value = entry.start_time;
  document.getElementById('schedule-end').value = entry.end_time;
  document.getElementById('schedule-desc').value = entry.description || '';
  document.getElementById('schedule-delete-btn').style.display = '';
  selectedScheduleColor = entry.color || '#7c6bf0';
  renderScheduleColorPicker();
  await loadTaskOptions();
  document.getElementById('schedule-task-link').value = entry.task_id || '';
  document.getElementById('schedule-modal').classList.add('visible');
}

function renderScheduleColorPicker() {
  const picker = document.getElementById('schedule-color-picker');
  if (!picker) return;
  picker.innerHTML = SCHEDULE_COLORS.map(c =>
    `<div class="sched-color-swatch ${selectedScheduleColor === c.value ? 'active' : ''}"
          style="background:${c.value}" title="${c.name}"
          onclick="selectScheduleColor('${c.value}')"></div>`
  ).join('');
}

function selectScheduleColor(color) {
  selectedScheduleColor = color;
  renderScheduleColorPicker();
}

async function loadTaskOptions() {
  const tasks = await fetchJSON('/api/tasks?kanban=1');
  const select = document.getElementById('schedule-task-link');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">— No task —</option>' +
    (tasks || []).filter(t => t.status !== 'archived').map(t =>
      `<option value="${t.id}">${escapeHtml(t.title)}</option>`
    ).join('');
  select.value = current;
}

async function saveScheduleEntry() {
  const data = {
    title: document.getElementById('schedule-title').value.trim(),
    date: document.getElementById('schedule-date').value,
    start_time: document.getElementById('schedule-start').value,
    end_time: document.getElementById('schedule-end').value,
    description: document.getElementById('schedule-desc').value.trim() || null,
    color: selectedScheduleColor,
    task_id: document.getElementById('schedule-task-link').value || null
  };

  if (!data.title || !data.date || !data.start_time || !data.end_time) return;

  if (editingScheduleId) {
    await fetchJSON(`/api/schedule/${editingScheduleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    await fetchJSON('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  closeScheduleModal();
  refreshScheduleData();
}

async function deleteScheduleEntry() {
  if (!editingScheduleId) return;
  if (!confirm('Delete this schedule entry?')) return;
  await fetchJSON(`/api/schedule/${editingScheduleId}`, { method: 'DELETE' });
  closeScheduleModal();
  refreshScheduleData();
}

function closeScheduleModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('schedule-modal').classList.remove('visible');
  editingScheduleId = null;
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

// Kanban state
let kanbanArchiveExpanded = false;

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
      <div class="kanban-archive-section" id="kanban-archive-section"></div>
    </div>
  `;
  refreshKanbanData();
}

async function refreshKanbanData() {
  if (currentView !== 'kanban') return;
  const tasks = await fetchJSON('/api/tasks?kanban=1');
  const el = document.getElementById('kanban-board');
  const archiveEl = document.getElementById('kanban-archive-section');
  if (!el || currentView !== 'kanban') return;

  const mainColumns = [
    { key: 'todo', name: 'To Do', tasks: [] },
    { key: 'in_progress', name: 'In Progress', tasks: [] },
    { key: 'done', name: 'Done', tasks: [] }
  ];

  const archiveTasks = [];
  const today = new Date().toISOString().slice(0, 10);

  if (tasks) {
    tasks.forEach(t => {
      if (t.status === 'archived') {
        if (t.archived_at && t.archived_at.slice(0, 10) >= today) {
          archiveTasks.push(t);
        }
      } else {
        const col = mainColumns.find(c => c.key === t.status);
        if (col) col.tasks.push(t);
      }
    });
  }

  const statusFlow = ['todo', 'in_progress', 'done', 'archived'];
  const allColumns = [...mainColumns, { key: 'archived', name: 'Archive', tasks: archiveTasks }];

  el.innerHTML = mainColumns.map(col => `
    <div class="kanban-column" data-status="${col.key}"
         ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event, '${col.key}')">
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
            return `
              <div class="kanban-card" draggable="true" data-task-id="${t.id}" data-task-status="${t.status}"
                   ondragstart="kanbanDragStart(event, ${t.id})" ondragend="kanbanDragEnd(event)"
                   onclick="openKanbanTaskEdit(${t.id})">
                <div class="kanban-card-top">
                  <div class="kanban-card-title">${escapeHtml(t.title)}</div>
                  <button class="kanban-card-menu-btn" onclick="event.stopPropagation(); kanbanContextMenu(event, ${t.id}, '${t.status}')" title="Move card">⋮</button>
                </div>
                <div class="kanban-card-meta">
                  ${priorityBadgeHtml(t.priority)}
                  ${categoryTagHtml(t.category)}
                  <span class="kanban-card-time">${timeAgo(t.updated_at)}</span>
                </div>
              </div>
            `;
          }).join('')}
      </div>
    </div>
  `).join('');

  // Render collapsible archive section
  if (archiveEl) {
    archiveEl.innerHTML = `
      <div class="kanban-archive-header ${kanbanArchiveExpanded ? 'expanded' : ''}" onclick="toggleKanbanArchive()">
        <span class="kanban-archive-toggle">${kanbanArchiveExpanded ? '▼' : '▶'}</span>
        <span class="kanban-archive-title">Archive</span>
        <span class="kanban-column-count">${archiveTasks.length}</span>
      </div>
      ${kanbanArchiveExpanded ? `
        <div class="kanban-archive-body" data-status="archived"
             ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event, 'archived')">
          ${archiveTasks.length === 0 ? '<div class="empty-state" style="text-align:center;padding:1rem">No archived tasks today</div>' :
            archiveTasks.map(t => `
              <div class="kanban-card archived" draggable="true" data-task-id="${t.id}" data-task-status="archived"
                   ondragstart="kanbanDragStart(event, ${t.id})" ondragend="kanbanDragEnd(event)"
                   onclick="openKanbanTaskEdit(${t.id})">
                <div class="kanban-card-top">
                  <div class="kanban-card-title">${escapeHtml(t.title)}</div>
                  <button class="kanban-card-menu-btn" onclick="event.stopPropagation(); kanbanContextMenu(event, ${t.id}, 'archived')" title="Move card">⋮</button>
                </div>
                <div class="kanban-card-meta">
                  ${priorityBadgeHtml(t.priority)}
                  ${categoryTagHtml(t.category)}
                  <span class="kanban-card-time">${timeAgo(t.updated_at)}</span>
                </div>
              </div>
            `).join('')}
        </div>
      ` : ''}
    `;
  }
}

function toggleKanbanArchive() {
  kanbanArchiveExpanded = !kanbanArchiveExpanded;
  refreshKanbanData();
}

// ===== KANBAN DRAG & DROP =====

function kanbanDragStart(event, taskId) {
  event.dataTransfer.setData('text/plain', taskId);
  event.dataTransfer.effectAllowed = 'move';
  event.target.classList.add('kanban-card-dragging');
  // Highlight all drop targets
  setTimeout(() => {
    document.querySelectorAll('.kanban-column, .kanban-archive-body').forEach(col => col.classList.add('kanban-drop-target'));
  }, 0);
}

function kanbanDragEnd(event) {
  event.target.classList.remove('kanban-card-dragging');
  document.querySelectorAll('.kanban-column, .kanban-archive-body').forEach(col => {
    col.classList.remove('kanban-drop-target', 'kanban-drag-over');
  });
}

function kanbanDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const dropTarget = event.currentTarget;
  dropTarget.classList.add('kanban-drag-over');
}

function kanbanDragLeave(event) {
  // Only remove if actually leaving the column (not entering a child)
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove('kanban-drag-over');
  }
}

async function kanbanDrop(event, newStatus) {
  event.preventDefault();
  event.currentTarget.classList.remove('kanban-drag-over');
  const taskId = event.dataTransfer.getData('text/plain');
  if (!taskId) return;
  // Find current status from the card
  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  const currentStatus = card ? card.dataset.taskStatus : null;
  if (currentStatus === newStatus) return;
  await moveKanbanTask(parseInt(taskId), newStatus);
}

// ===== KANBAN CONTEXT MENU =====

function kanbanContextMenu(event, taskId, currentStatus) {
  event.preventDefault();
  event.stopPropagation();

  // Remove existing menu
  const existing = document.getElementById('kanban-ctx-menu');
  if (existing) existing.remove();

  const allStatuses = [
    { key: 'todo', name: 'To Do' },
    { key: 'in_progress', name: 'In Progress' },
    { key: 'done', name: 'Done' },
    { key: 'archived', name: 'Archive' }
  ];

  const moveOptions = allStatuses.filter(s => s.key !== currentStatus);

  const menu = document.createElement('div');
  menu.id = 'kanban-ctx-menu';
  menu.className = 'kanban-ctx-menu';
  menu.innerHTML = `
    <div class="kanban-ctx-header">Move to</div>
    ${moveOptions.map(s => `
      <div class="kanban-ctx-item" onclick="kanbanCtxMove(${taskId}, '${s.key}')">
        ${s.name}
      </div>
    `).join('')}
    ${currentStatus !== 'archived' ? `
      <div class="kanban-ctx-divider"></div>
      <div class="kanban-ctx-item kanban-ctx-archive" onclick="kanbanCtxMove(${taskId}, 'archived')">
        📦 Archive
      </div>
    ` : ''}
  `;

  // Position at cursor
  menu.style.left = event.clientX + 'px';
  menu.style.top = event.clientY + 'px';
  document.body.appendChild(menu);

  // Adjust if overflowing viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  // Dismiss on click outside
  setTimeout(() => {
    document.addEventListener('click', dismissKanbanCtxMenu);
    document.addEventListener('contextmenu', dismissKanbanCtxMenu);
  }, 0);
}

function dismissKanbanCtxMenu() {
  const menu = document.getElementById('kanban-ctx-menu');
  if (menu) menu.remove();
  document.removeEventListener('click', dismissKanbanCtxMenu);
  document.removeEventListener('contextmenu', dismissKanbanCtxMenu);
}

async function kanbanCtxMove(taskId, newStatus) {
  dismissKanbanCtxMenu();
  await moveKanbanTask(taskId, newStatus);
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

// ===== VIEW: PROJECTS (Project Hub) =====

let projectHubState = {
  projects: [],
  selectedId: null,
  projectData: null,
  featureFilter: 'all',
  featureGroupBy: 'status',
  collapsedSections: {},
  editingSection: null,
  editingFeature: null,
  openTabs: [],       // [{id, name, icon}]
  activeTab: null,    // project id or null (null = overview)
  showOverview: true  // show grid overview
};

const FEATURE_STATUSES = [
  { key: 'idea', label: '💡 Ideas', color: '#f59e0b' },
  { key: 'defined', label: '📋 Defined', color: '#3b82f6' },
  { key: 'building', label: '🏗️ Building', color: '#8b5cf6' },
  { key: 'shipped', label: '✅ Shipped', color: '#10b981' }
];

const SECTION_ICONS = {
  concept: '💭', tech: '⚙️', marketing: '📣', feedback_intro: '💬',
  flows: '🔀', kanban: '📋'
};

const PROJECT_STATUS_COLORS = {
  active: '#10b981', paused: '#f59e0b', archived: '#6b7280'
};

async function renderProjects(container) {
  container.innerHTML = `
    <div class="view-container project-hub">
      <div class="project-hub-topbar" id="project-hub-topbar"></div>
      <div class="project-hub-content" id="project-hub-content">
        <div class="loading"><div class="spinner"></div> Loading projects...</div>
      </div>
    </div>
  `;
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('project-tab-dropdown');
    const btn = document.getElementById('project-tab-add-btn');
    if (dd && !dd.contains(e.target) && !btn?.contains(e.target)) {
      dd.classList.remove('open');
    }
  });
  await loadProjectsList();
}

async function loadProjectsList() {
  const projects = await fetchJSON('/api/projects');
  projectHubState.projects = projects || [];
  // If we have an active tab, go to it; otherwise show overview
  if (projectHubState.activeTab) {
    renderProjectTabBar();
    selectProject(projectHubState.activeTab);
  } else {
    projectHubState.showOverview = true;
    renderProjectTabBar();
    renderProjectOverview();
  }
}

function getVersionProgress(project, features) {
  if (!features || !features.length) return { done: 0, total: 0, pct: 0, label: '' };
  const nextVer = project.next_version;
  const hasCurrentVersion = !!project.current_version;

  let targetFeatures;
  if (hasCurrentVersion && nextVer) {
    // Progress toward next version
    targetFeatures = features.filter(f => f.version_target === `v${nextVer}` || f.version_target === nextVer);
    if (!targetFeatures.length) targetFeatures = features; // fallback to all
  } else {
    // Not built yet — progress toward v1.0 (all features)
    targetFeatures = features;
  }

  const done = targetFeatures.filter(f => f.status === 'shipped').length;
  const building = targetFeatures.filter(f => f.status === 'building').length;
  const total = targetFeatures.length;
  const pct = total > 0 ? Math.round(((done + building * 0.5) / total) * 100) : 0;
  const vLabel = hasCurrentVersion && nextVer ? `v${nextVer}` : 'v1.0';

  return { done, building, total, pct, vLabel };
}

function renderProjectOverview() {
  const content = document.getElementById('project-hub-content');
  if (!content) return;

  const active = projectHubState.projects.filter(p => p.status !== 'archived');
  const archived = projectHubState.projects.filter(p => p.status === 'archived');

  if (!active.length && !archived.length) {
    content.innerHTML = `<div class="docs-empty-state" style="padding:3rem;text-align:center">
      <div class="placeholder-icon">📁</div>
      <div class="placeholder-text">No projects yet</div>
    </div>`;
    return;
  }

  content.innerHTML = `
    <div class="project-overview-grid">
      ${active.map(p => {
        const features = p.features || [];
        const vp = getVersionProgress(p, features);
        const techPills = parseTechStack(p.tech_stack);
        const statusColor = PROJECT_STATUS_COLORS[p.status] || '#6b7280';
        return `
          <div class="project-overview-card" onclick="openProjectTab('${p.id}')">
            <div class="po-card-header">
              <span class="po-card-icon">${p.icon || '📁'}</span>
              <div class="po-card-title-area">
                <div class="po-card-name">${escapeHtml(p.name)}${(() => { const d = p.last_activity_at ? Math.floor((Date.now() - new Date(p.last_activity_at).getTime()) / 86400000) : 999; return d >= 5 ? `<span class="stale-badge stale-red" title="No activity for ${d} days">⚠ ${d}d</span>` : d >= 3 ? `<span class="stale-badge stale-amber" title="No activity for ${d} days">⚠ ${d}d</span>` : ''; })()}</div>
                ${p.tagline ? `<div class="po-card-tagline">${escapeHtml(p.tagline)}</div>` : ''}
              </div>
              <span class="project-status-badge" style="background:${statusColor}">${p.status}</span>
            </div>
            <div class="po-card-meta">
              ${p.current_version ? `<span class="po-meta-pill">v${escapeHtml(p.current_version)}</span>` : ''}
              ${p.next_version ? `<span class="po-meta-pill po-meta-next">→ v${escapeHtml(p.next_version)}</span>` : ''}
              ${p.platform ? `<span class="po-meta-pill">${escapeHtml(p.platform)}</span>` : ''}
              <span class="po-meta-pill">${p.project_type === 'personal' ? '🔧 Personal' : '🚀 Product'}</span>
            </div>
            ${vp.total > 0 ? `
              <div class="po-version-progress">
                <div class="po-vp-header">
                  <span class="po-vp-label">Progress to ${vp.vLabel}</span>
                  <span class="po-vp-pct">${vp.done}/${vp.total} features · ${vp.pct}%</span>
                </div>
                <div class="po-vp-bar">
                  <div class="po-vp-fill" style="width:${vp.pct}%"></div>
                </div>
              </div>
            ` : `<div class="po-version-progress"><span class="po-vp-label" style="color:var(--text-muted)">No features yet</span></div>`}
            ${techPills.length ? `<div class="po-card-tech">${techPills.slice(0, 5).map(t => `<span class="tech-pill">${escapeHtml(t)}</span>`).join('')}${techPills.length > 5 ? `<span class="tech-pill">+${techPills.length - 5}</span>` : ''}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    ${archived.length ? `
      <div class="po-archived-section">
        <div class="po-archived-header" onclick="this.parentElement.classList.toggle('expanded')">📦 Archived (${archived.length})</div>
        <div class="po-archived-grid">
          ${archived.map(p => `
            <div class="project-overview-card po-card-archived" onclick="openProjectTab('${p.id}')">
              <div class="po-card-header">
                <span class="po-card-icon">${p.icon || '📁'}</span>
                <div class="po-card-name">${escapeHtml(p.name)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function openProjectTab(id) {
  const p = projectHubState.projects.find(p => p.id === id);
  if (!p) return;
  // Add to tabs if not already there
  if (!projectHubState.openTabs.find(t => t.id === id)) {
    projectHubState.openTabs.push({ id: p.id, name: p.name, icon: p.icon || '📁' });
  }
  projectHubState.activeTab = id;
  projectHubState.showOverview = false;
  renderProjectTabBar();
  selectProject(id);
}

function closeProjectTab(id, event) {
  if (event) event.stopPropagation();
  projectHubState.openTabs = projectHubState.openTabs.filter(t => t.id !== id);
  if (projectHubState.activeTab === id) {
    // Switch to another tab or overview
    if (projectHubState.openTabs.length > 0) {
      const next = projectHubState.openTabs[projectHubState.openTabs.length - 1];
      projectHubState.activeTab = next.id;
      projectHubState.showOverview = false;
      renderProjectTabBar();
      selectProject(next.id);
    } else {
      projectHubState.activeTab = null;
      projectHubState.showOverview = true;
      renderProjectTabBar();
      renderProjectOverview();
    }
  } else {
    renderProjectTabBar();
  }
}

function switchToOverview() {
  projectHubState.activeTab = null;
  projectHubState.showOverview = true;
  projectHubState.selectedId = null;
  renderProjectTabBar();
  renderProjectOverview();
}

function renderProjectTabBar() {
  const topbar = document.getElementById('project-hub-topbar');
  if (!topbar) return;
  const tabs = projectHubState.openTabs;
  const unopened = projectHubState.projects.filter(p => p.status !== 'archived' && !tabs.find(t => t.id === p.id));

  topbar.innerHTML = `
    <div class="project-tab-bar">
      <div class="project-tab ${projectHubState.showOverview ? 'active' : ''}" onclick="switchToOverview()">
        <span>📁 Overview</span>
      </div>
      ${tabs.map(t => `
        <div class="project-tab ${projectHubState.activeTab === t.id ? 'active' : ''}" onclick="openProjectTab('${t.id}')">
          <span>${t.icon} ${escapeHtml(t.name)}</span>
          <button class="project-tab-close" onclick="closeProjectTab('${t.id}', event)">&times;</button>
        </div>
      `).join('')}
      <div class="project-tab-add-wrapper">
        <button class="project-tab-add-btn" id="project-tab-add-btn" onclick="toggleTabDropdown()">+</button>
        <div class="project-tab-dropdown" id="project-tab-dropdown">
          ${unopened.length ? unopened.map(p => `
            <div class="project-dropdown-item" onclick="openProjectTab('${p.id}'); closeTabDropdown()">
              <span class="project-dropdown-icon">${p.icon || '📁'}</span>
              <span class="project-dropdown-name">${escapeHtml(p.name)}</span>
            </div>
          `).join('') : '<div class="project-dropdown-item" style="color:var(--text-muted)">All projects open</div>'}
        </div>
      </div>
    </div>
  `;
}

function toggleTabDropdown() {
  document.getElementById('project-tab-dropdown')?.classList.toggle('open');
}
function closeTabDropdown() {
  document.getElementById('project-tab-dropdown')?.classList.remove('open');
}

async function selectProject(id) {
  projectHubState.selectedId = id;
  projectHubState.showOverview = false;
  const content = document.getElementById('project-hub-content');
  if (content) content.innerHTML = '<div class="loading"><div class="spinner"></div> Loading project...</div>';
  const data = await fetchJSON(`/api/projects/${id}`);
  if (!data || data.error) {
    if (content) content.innerHTML = `<div class="empty-state">Failed to load project</div>`;
    return;
  }
  projectHubState.projectData = data;
  renderProjectHub();
}

async function toggleProjectType(projectId, type) {
  await fetchJSON(`/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_type: type })
  });
  await selectProject(projectId);
}

function renderProjectHub() {
  const content = document.getElementById('project-hub-content');
  if (!content) return;
  const p = projectHubState.projectData;
  if (!p) return;

  const isProduct = p.project_type !== 'personal';
  const sections = p.sections || [];
  const getSection = (type) => sections.find(s => s.section_type === type);

  content.innerHTML = `
    ${renderProjectHeader(p)}
    ${renderProjectSection('concept', 'Concept & Definition', getSection('concept'), p.id)}
    ${renderFeatureMap(p)}
    ${renderProjectKanban(p)}
    ${isProduct ? renderProjectSection('feedback_intro', 'User Feedback', getSection('feedback_intro'), p.id) : ''}
    ${isProduct ? renderFeedbackList(p) : ''}
    ${isProduct ? renderProjectSection('marketing', 'Marketing', getSection('marketing'), p.id) : ''}
    ${renderProjectSection('flows', 'App Flows', getSection('flows'), p.id)}
    ${renderProjectSection('tech', 'Tech Stack', getSection('tech'), p.id)}
  `;

  // Load kanban if board linked
  if (p.trello_board_id) {
    loadProjectKanban(p.trello_board_id);
  }
}

function getProjectCompleteness(p) {
  const isProduct = p.project_type !== 'personal';
  const checks = [
    { label: 'Tagline', done: !!p.tagline },
    { label: 'Concept defined', done: !!(p.sections || []).find(s => s.section_type === 'concept' && s.content && s.content.trim().length > 20) },
    { label: 'Tech stack', done: !!(p.sections || []).find(s => s.section_type === 'tech' && s.content && s.content.trim().length > 20) },
    ...(isProduct ? [{ label: 'Marketing plan', done: !!(p.sections || []).find(s => s.section_type === 'marketing' && s.content && s.content.trim().length > 20) }] : []),
    { label: 'App flows', done: !!(p.sections || []).find(s => s.section_type === 'flows' && s.content && s.content.trim().length > 20) },
    { label: 'Features defined', done: (p.features || []).length >= 3 },
    ...(isProduct ? [{ label: 'User feedback', done: (p.feedback || []).length >= 1 }] : []),
    { label: 'App Store / GitHub link', done: !!(p.app_store_url || p.github_url) },
    { label: 'Version set', done: !!p.current_version || !!p.next_version },
    { label: 'Platform & category', done: !!(p.platform && p.category) },
  ];
  const done = checks.filter(c => c.done).length;
  const total = checks.length;
  const pct = Math.round((done / total) * 100);
  return { checks, done, total, pct };
}

function renderProjectHeader(p) {
  const statusColor = PROJECT_STATUS_COLORS[p.status] || '#6b7280';
  const versionInfo = [];
  if (p.current_version) {
    let v = `v${p.current_version}`;
    if (p.release_date) v += ` (${p.release_date})`;
    versionInfo.push(v);
  }
  if (p.next_version) versionInfo.push(`→ v${p.next_version} next`);

  const links = [];
  if (p.app_store_url) links.push(`<a href="${p.app_store_url}" target="_blank" class="project-link-btn">🏪 App Store</a>`);
  if (p.github_url) links.push(`<a href="${p.github_url}" target="_blank" class="project-link-btn">🐙 GitHub</a>`);
  if (p.landing_url) links.push(`<a href="${p.landing_url}" target="_blank" class="project-link-btn">🌐 Website</a>`);

  const comp = getProjectCompleteness(p);
  let barClass = '';
  if (comp.pct >= 80) barClass = 'complete';
  else if (comp.pct >= 50) barClass = 'partial';
  else barClass = 'low';

  const missingItems = comp.checks.filter(c => !c.done);

  return `
    <div class="project-header-card">
      <div class="project-header-top">
        <div class="project-header-identity">
          ${p.icon ? `<span class="project-header-icon">${p.icon}</span>` : ''}
          <div>
            <h1 class="project-header-name">${escapeHtml(p.name)}</h1>
            ${p.tagline ? `<div class="project-header-tagline">${escapeHtml(p.tagline)}</div>` : ''}
          </div>
        </div>
        <div class="project-header-actions">
          <div class="project-type-toggle" title="${p.project_type === 'personal' ? 'Personal project — no marketing/feedback sections' : 'Product — includes marketing & feedback sections'}">
            <button class="type-toggle-btn ${p.project_type !== 'personal' ? 'active' : ''}" onclick="toggleProjectType('${p.id}', 'product')">🚀 Product</button>
            <button class="type-toggle-btn ${p.project_type === 'personal' ? 'active' : ''}" onclick="toggleProjectType('${p.id}', 'personal')">🔧 Personal</button>
          </div>
          <span class="project-status-badge" style="background:${statusColor}">${p.status}</span>
          <button class="btn-doc-action" onclick="openProjectEditModal('${p.id}')">✏️ Edit</button>
          ${p.status !== 'archived' ? `<button class="btn-archive" onclick="archiveProject('${p.id}')">📦 Archive</button>` : `<button class="btn-move" onclick="restoreProject('${p.id}')">♻️ Restore</button><button class="btn-archive" style="color:#ef4444" onclick="permanentDeleteProject('${p.id}')">🗑 Delete</button>`}
        </div>
      </div>
      <div class="project-header-meta">
        ${versionInfo.length ? `<span class="project-meta-item">📦 ${versionInfo.join(' ')}</span>` : ''}
        ${p.platform ? `<span class="project-meta-item">📱 ${escapeHtml(p.platform)}</span>` : ''}
        ${p.category ? `<span class="project-meta-item">🏷️ ${escapeHtml(p.category)}</span>` : ''}
        ${p.tech_stack ? `<span class="project-meta-item">⚙️ ${parseTechStack(p.tech_stack).map(t => `<span class="tech-pill">${escapeHtml(t)}</span>`).join('')}</span>` : ''}
      </div>
      ${links.length ? `<div class="project-header-links">${links.join('')}</div>` : ''}
      ${(() => {
        const features = p.features || [];
        const vp = getVersionProgress(p, features);
        if (vp.total > 0) {
          return `<div class="po-version-progress po-vp-detail">
            <div class="po-vp-header">
              <span class="po-vp-label">📦 Progress to ${vp.vLabel}</span>
              <span class="po-vp-pct">${vp.done} shipped${vp.building ? `, ${vp.building} building` : ''} of ${vp.total} features · ${vp.pct}%</span>
            </div>
            <div class="po-vp-bar"><div class="po-vp-fill" style="width:${vp.pct}%"></div></div>
          </div>`;
        }
        return '';
      })()}
      <div class="project-completeness">
        <div class="project-completeness-header">
          <span class="project-completeness-label">Project completeness</span>
          <span class="project-completeness-pct">${comp.done}/${comp.total} (${comp.pct}%)</span>
        </div>
        <div class="project-completeness-bar">
          <div class="project-completeness-fill ${barClass}" style="width:${comp.pct}%"></div>
        </div>
        ${missingItems.length > 0 ? `
          <div class="project-completeness-missing">
            ${missingItems.map(m => `<span class="project-missing-item">⚠️ ${m.label}</span>`).join('')}
          </div>
        ` : `<div class="project-completeness-done">✅ All sections complete!</div>`}
      </div>
    </div>
  `;
}

function renderProjectSection(type, title, section, projectId) {
  const icon = SECTION_ICONS[type] || '📄';
  const content = section ? section.content : '';
  const isEmpty = !content || !content.trim();
  // Auto-collapse empty sections unless user has explicitly toggled them
  const isCollapsed = projectHubState.collapsedSections[type] !== undefined
    ? projectHubState.collapsedSections[type]
    : isEmpty;
  const isEditing = projectHubState.editingSection === (section ? section.id : `new-${type}`);

  return `
    <div class="project-section-card">
      <div class="project-section-header" onclick="toggleProjectSection('${type}')">
        <span class="project-section-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="project-section-icon">${icon}</span>
        <span class="project-section-title">${title}</span>
        <button class="btn-doc-action" onclick="event.stopPropagation(); editProjectSection('${type}', ${section ? section.id : 'null'}, '${projectId}')" style="margin-left:auto">✏️</button>
      </div>
      ${!isCollapsed ? `
        <div class="project-section-body">
          ${isEditing ? `
            <textarea class="project-section-textarea" id="section-edit-${type}">${escapeHtml(content || '')}</textarea>
            <div class="project-section-edit-actions">
              <button class="btn-move" onclick="saveProjectSection('${type}', ${section ? section.id : 'null'}, '${projectId}')">Save</button>
              <button class="btn-archive" onclick="cancelSectionEdit()">Cancel</button>
            </div>
          ` : content ? `<div class="markdown-body">${renderMarkdown(content)}</div>` : `<div class="project-section-empty">No content yet. Click ✏️ to add.</div>`}
        </div>
      ` : ''}
    </div>
  `;
}

function toggleProjectSection(type) {
  projectHubState.collapsedSections[type] = !projectHubState.collapsedSections[type];
  renderProjectHub();
}

function editProjectSection(type, sectionId, projectId) {
  projectHubState.editingSection = sectionId || `new-${type}`;
  renderProjectHub();
  const ta = document.getElementById(`section-edit-${type}`);
  if (ta) ta.focus();
}

function cancelSectionEdit() {
  projectHubState.editingSection = null;
  renderProjectHub();
}

async function saveProjectSection(type, sectionId, projectId) {
  const ta = document.getElementById(`section-edit-${type}`);
  if (!ta) return;
  const content = ta.value;

  if (sectionId && sectionId !== 'null') {
    await fetchJSON(`/api/projects/${projectId}/sections/${sectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } else {
    await fetchJSON(`/api/projects/${projectId}/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_type: type, title: type, content })
    });
  }
  projectHubState.editingSection = null;
  await selectProjectPreserveScroll(projectId);
}

// --- Feature Map ---

function renderFeatureMap(p) {
  const features = p.features || [];
  const tags = p.tags || [];
  const isCollapsed = projectHubState.collapsedSections['featuremap'];

  // Get distinct versions
  const versions = [...new Set(features.map(f => f.version_target).filter(Boolean))].sort();

  // Filter
  let filtered = features;
  if (projectHubState.featureFilter !== 'all') {
    if (projectHubState.featureFilter === 'unassigned') {
      filtered = features.filter(f => !f.version_target);
    } else {
      filtered = features.filter(f => f.version_target === projectHubState.featureFilter);
    }
  }

  // Group
  const groups = {};
  const groupBy = projectHubState.featureGroupBy;
  if (groupBy === 'status') {
    for (const s of FEATURE_STATUSES) groups[s.key] = { label: s.label, color: s.color, items: [] };
    for (const f of filtered) {
      const key = f.status || 'idea';
      if (!groups[key]) groups[key] = { label: key, color: '#6b7280', items: [] };
      groups[key].items.push(f);
    }
  } else if (groupBy === 'version') {
    groups['unassigned'] = { label: '📌 Unassigned', color: '#6b7280', items: [] };
    for (const v of versions) groups[v] = { label: `📦 ${v}`, color: '#3b82f6', items: [] };
    for (const f of filtered) {
      const key = f.version_target || 'unassigned';
      if (!groups[key]) groups[key] = { label: key, color: '#6b7280', items: [] };
      groups[key].items.push(f);
    }
  } else if (groupBy === 'tags') {
    groups['untagged'] = { label: '🏷️ Untagged', color: '#6b7280', items: [] };
    for (const t of tags) groups[t.name] = { label: `🏷️ ${t.name}`, color: t.color || '#6b7280', items: [] };
    for (const f of filtered) {
      const fTags = parseFeatureTags(f.tags);
      if (!fTags.length) { groups['untagged'].items.push(f); continue; }
      for (const t of fTags) {
        if (!groups[t]) groups[t] = { label: `🏷️ ${t}`, color: '#6b7280', items: [] };
        groups[t].items.push(f);
      }
    }
  }

  // Build tag color map
  const tagColorMap = {};
  for (const t of tags) tagColorMap[t.name] = t.color || '#6b7280';

  return `
    <div class="project-section-card">
      <div class="project-section-header" onclick="toggleProjectSection('featuremap')">
        <span class="project-section-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="project-section-icon">🗺️</span>
        <span class="project-section-title">Feature Map</span>
        <span class="tab-count" style="margin-left:0.5rem">${features.length}</span>
        <button class="btn-doc-action" onclick="event.stopPropagation(); openNewFeatureModal('${p.id}')" style="margin-left:auto">+ New Feature</button>
      </div>
      ${!isCollapsed ? `
        <div class="project-section-body">
          <div class="feature-filter-bar">
            <div class="feature-filter-versions">
              <button class="feature-filter-btn ${projectHubState.featureFilter === 'all' ? 'active' : ''}" onclick="setFeatureFilter('all')">All</button>
              ${versions.map(v => `<button class="feature-filter-btn ${projectHubState.featureFilter === v ? 'active' : ''}" onclick="setFeatureFilter('${v}')">${v}</button>`).join('')}
              <button class="feature-filter-btn ${projectHubState.featureFilter === 'unassigned' ? 'active' : ''}" onclick="setFeatureFilter('unassigned')">Unassigned</button>
            </div>
            <select class="feature-group-select" onchange="setFeatureGroupBy(this.value)">
              <option value="status" ${groupBy === 'status' ? 'selected' : ''}>Group by Status</option>
              <option value="version" ${groupBy === 'version' ? 'selected' : ''}>Group by Version</option>
              <option value="tags" ${groupBy === 'tags' ? 'selected' : ''}>Group by Tags</option>
            </select>
          </div>
          <div class="feature-groups">
            ${Object.entries(groups).map(([key, group]) => `
              <div class="feature-group">
                <div class="feature-group-header" style="border-left:3px solid ${group.color}">
                  <span class="feature-group-label">${group.label}</span>
                  <span class="feature-group-count">${group.items.length}</span>
                </div>
                <div class="feature-group-cards" data-feature-group="${escapeHtml(key)}" data-project-id="${p.id}"
                     ondragover="featureDragOver(event)" ondragleave="featureDragLeave(event)" ondrop="featureDrop(event)">
                  ${group.items.length ? group.items.map(f => renderFeatureCard(f, tagColorMap, p.id)).join('') : '<div class="feature-empty">No features</div>'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function parseFeatureTags(raw) {
  if (!raw) return [];
  try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map(t => t.trim()).filter(Boolean); } catch {}
  return raw.replace(/[\[\]"]/g, '').split(',').map(t => t.trim()).filter(Boolean);
}

function parseTechStack(raw) {
  if (!raw) return [];
  try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map(t => t.trim()).filter(Boolean); } catch {}
  return raw.replace(/[\[\]"]/g, '').split(',').map(t => t.trim()).filter(Boolean);
}

function renderFeatureCard(f, tagColorMap, projectId) {
  const fTags = parseFeatureTags(f.tags);
  const primaryColor = fTags.length && tagColorMap[fTags[0]] ? tagColorMap[fTags[0]] : '#4b5563';
  const statusInfo = FEATURE_STATUSES.find(s => s.key === f.status) || { label: f.status, color: '#6b7280' };
  const priorityBadge = f.priority === 'high' ? '🟠' : f.priority === 'urgent' ? '🔴' : f.priority === 'low' ? '⚪' : '';

  return `
    <div class="feature-card" style="border-left:3px solid ${primaryColor}" draggable="true"
         data-feature-id="${f.id}" data-feature-status="${f.status}"
         ondragstart="featureDragStart(event, ${f.id}, '${projectId}')" ondragend="featureDragEnd(event)"
         onclick="openFeatureEditModal(${f.id}, '${projectId}')">

      <div class="feature-card-top">
        <span class="feature-card-name">${escapeHtml(f.name)}</span>
        ${priorityBadge ? `<span class="feature-priority">${priorityBadge}</span>` : ''}
      </div>
      ${f.description ? `<div class="feature-card-desc">${escapeHtml(f.description.length > 100 ? f.description.slice(0, 100) + '...' : f.description)}</div>` : ''}
      <div class="feature-card-meta">
        <span class="feature-status-badge" style="background:${statusInfo.color}20;color:${statusInfo.color}">${statusInfo.label}</span>
        ${f.version_target ? `<span class="feature-version-badge">📦 ${f.version_target}</span>` : ''}
        ${fTags.map(t => `<span class="feature-tag-pill" style="background:${tagColorMap[t] || '#6b7280'}30;color:${tagColorMap[t] || '#6b7280'}">${t}</span>`).join('')}
        ${f.source ? `<span class="feature-source-label">via ${escapeHtml(f.source)}</span>` : ''}
        ${f.prompt ? `<span class="feature-prompt-badge" title="Has Claude Code prompt">🤖</span>` : ''}
        ${f.testing ? `<span class="feature-prompt-badge" title="Has testing checklist">🧪</span>` : ''}
      </div>
      ${f.status === 'defined' && !f.trello_card_id ? `<button class="feature-promote-btn" onclick="event.stopPropagation(); promoteFeature(${f.id}, '${projectId}')">→ Promote to Kanban</button>` : ''}
    </div>
  `;
}

function setFeatureFilter(val) {
  projectHubState.featureFilter = val;
  renderProjectHub();
}

function setFeatureGroupBy(val) {
  projectHubState.featureGroupBy = val;
  renderProjectHub();
}

async function promoteFeature(featureId, projectId) {
  if (!confirm('Promote this feature to a Trello card?')) return;
  const result = await fetchJSON(`/api/projects/${projectId}/features/${featureId}/promote`, { method: 'POST' });
  if (result && !result.error) {
    selectProject(projectId);
  } else {
    alert('Failed to promote: ' + (result?.error || 'Unknown error'));
  }
}

// --- Kanban Section ---

function renderProjectKanban(p) {
  if (!p.trello_board_id) return '';
  const isCollapsed = projectHubState.collapsedSections['kanban'];

  return `
    <div class="project-section-card">
      <div class="project-section-header" onclick="toggleProjectSection('kanban')">
        <span class="project-section-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="project-section-icon">📋</span>
        <span class="project-section-title">Kanban</span>
      </div>
      ${!isCollapsed ? `
        <div class="project-section-body project-kanban-body">
          <div id="project-board-container" class="board-container">
            <div class="loading"><div class="spinner"></div> Loading board...</div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function loadProjectKanban(boardId) {
  const data = await fetchJSON('/api/trello');
  if (!data || !data.boards) return;
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;

  // Re-use existing boardsData and renderBoard
  boardsData = data;
  const idx = data.boards.findIndex(b => b.id === boardId);
  activeTab = idx >= 0 ? idx : 0;

  const container = document.getElementById('project-board-container');
  if (!container) return;

  // Render directly into the project container
  const oldContainer = document.getElementById('board-container');
  // Temporarily set board-container to our project container
  container.id = 'board-container';
  renderBoard(board);
  container.id = 'project-board-container';
}

// --- Feedback List ---

function renderFeedbackList(p) {
  const feedback = p.feedback || [];
  if (!feedback.length && !projectHubState.collapsedSections['feedback_list']) {
    // Just show add button within the feedback_intro section
  }

  const isCollapsed = projectHubState.collapsedSections['feedback_list'];
  const sentimentColors = { positive: '#10b981', neutral: '#6b7280', negative: '#ef4444' };

  return feedback.length || !isCollapsed ? `
    <div class="project-section-card" style="margin-top:-0.5rem">
      <div class="project-section-header" onclick="toggleProjectSection('feedback_list')">
        <span class="project-section-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="project-section-icon">📬</span>
        <span class="project-section-title">Feedback Items</span>
        <span class="tab-count" style="margin-left:0.5rem">${feedback.length}</span>
        <button class="btn-doc-action" onclick="event.stopPropagation(); openNewFeedbackModal('${p.id}')" style="margin-left:auto">+ Add Feedback</button>
      </div>
      ${!isCollapsed ? `
        <div class="project-section-body">
          ${feedback.length ? feedback.map(fb => `
            <div class="feedback-card" onclick="openFeedbackEditModal(${fb.id}, '${p.id}')">
              <div class="feedback-card-top">
                ${fb.source ? `<span class="feedback-source">${escapeHtml(fb.source)}</span>` : ''}
                ${fb.sentiment ? `<span class="feedback-sentiment" style="color:${sentimentColors[fb.sentiment] || '#6b7280'}">${fb.sentiment === 'positive' ? '👍' : fb.sentiment === 'negative' ? '👎' : '😐'} ${fb.sentiment}</span>` : ''}
                <span class="feedback-date">${timeAgo(fb.created_at)}</span>
              </div>
              <div class="feedback-content">${escapeHtml(fb.content)}</div>
            </div>
          `).join('') : '<div class="feature-empty">No feedback yet</div>'}
        </div>
      ` : ''}
    </div>
  ` : '';
}

// --- Modal: Edit Project ---

function openProjectEditModal(projectId) {
  const p = projectHubState.projectData;
  if (!p) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'project-edit-modal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Edit Project</h3>
        <button class="modal-close" onclick="document.getElementById('project-edit-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field"><label>Name</label><input type="text" class="modal-input" id="pe-name" value="${escapeHtml(p.name)}"></div>
        <div class="modal-field"><label>Tagline</label><input type="text" class="modal-input" id="pe-tagline" value="${escapeHtml(p.tagline || '')}"></div>
        <div class="modal-field"><label>Icon (emoji)</label><input type="text" class="modal-input" id="pe-icon" value="${escapeHtml(p.icon || '')}" style="width:60px"></div>
        <div class="modal-field"><label>Status</label>
          <select class="modal-select" id="pe-status">
            <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="paused" ${p.status === 'paused' ? 'selected' : ''}>Paused</option>
            <option value="archived" ${p.status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
        </div>
        <div class="modal-field"><label>Platform</label><input type="text" class="modal-input" id="pe-platform" value="${escapeHtml(p.platform || '')}"></div>
        <div class="modal-field"><label>Tech Stack</label><input type="text" class="modal-input" id="pe-techstack" value="${escapeHtml(p.tech_stack || '')}"></div>
        <div class="modal-field"><label>Category</label><input type="text" class="modal-input" id="pe-category" value="${escapeHtml(p.category || '')}"></div>
        <div class="modal-field" style="display:flex;gap:0.75rem">
          <div style="flex:1"><label>Current Version</label><input type="text" class="modal-input" id="pe-curver" value="${escapeHtml(p.current_version || '')}"></div>
          <div style="flex:1"><label>Next Version</label><input type="text" class="modal-input" id="pe-nextver" value="${escapeHtml(p.next_version || '')}"></div>
        </div>
        <div class="modal-field"><label>Release Date</label><input type="text" class="modal-input" id="pe-reldate" value="${escapeHtml(p.release_date || '')}"></div>
        <div class="modal-field"><label>App Store URL</label><input type="text" class="modal-input" id="pe-appstore" value="${escapeHtml(p.app_store_url || '')}"></div>
        <div class="modal-field"><label>GitHub URL</label><input type="text" class="modal-input" id="pe-github" value="${escapeHtml(p.github_url || '')}"></div>
        <div class="modal-field"><label>Landing URL</label><input type="text" class="modal-input" id="pe-landing" value="${escapeHtml(p.landing_url || '')}"></div>
        <div class="modal-field"><label>Trello Board ID</label><input type="text" class="modal-input" id="pe-trello" value="${escapeHtml(p.trello_board_id || '')}"></div>
      </div>
      <div class="modal-actions">
        <button class="btn-move" onclick="saveProjectEdit('${projectId}')">Save</button>
        <button class="btn-archive" onclick="document.getElementById('project-edit-modal').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
}

async function saveProjectEdit(projectId) {
  const body = {
    name: document.getElementById('pe-name').value,
    tagline: document.getElementById('pe-tagline').value || null,
    icon: document.getElementById('pe-icon').value || null,
    status: document.getElementById('pe-status').value,
    platform: document.getElementById('pe-platform').value || null,
    tech_stack: document.getElementById('pe-techstack').value || null,
    category: document.getElementById('pe-category').value || null,
    current_version: document.getElementById('pe-curver').value || null,
    next_version: document.getElementById('pe-nextver').value || null,
    release_date: document.getElementById('pe-reldate').value || null,
    app_store_url: document.getElementById('pe-appstore').value || null,
    github_url: document.getElementById('pe-github').value || null,
    landing_url: document.getElementById('pe-landing').value || null,
    trello_board_id: document.getElementById('pe-trello').value || null
  };
  await fetchJSON(`/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('project-edit-modal')?.remove();
  selectProject(projectId);
}

async function archiveProject(projectId) {
  if (!confirm('Archive this project? You can restore it later.')) return;
  await fetchJSON(`/api/projects/${projectId}`, { method: 'DELETE' });
  projectHubState.selectedId = null;
  loadProjectsList();
}

async function restoreProject(projectId) {
  await fetchJSON(`/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  });
  loadProjectsList();
}

async function permanentDeleteProject(projectId) {
  if (!confirm('⚠️ PERMANENTLY delete this project and ALL its data (features, sections, tags, feedback)? This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure? This is irreversible.')) return;
  await fetchJSON(`/api/projects/${projectId}/permanent`, { method: 'DELETE' });
  projectHubState.selectedId = null;
  loadProjectsList();
}

// --- Modal: Feature Edit/New ---

function openNewFeatureModal(projectId) {
  openFeatureModal(null, projectId);
}

async function openFeatureEditModal(featureId, projectId) {
  const f = (projectHubState.projectData?.features || []).find(f => f.id === featureId);
  if (!f) return;
  openFeatureModal(f, projectId);
}

function renderMarkdownLite(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 class="md-h3">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="md-h2">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="md-h1">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/^(\d+)\. ✅ (.+)$/gm, '<div class="md-check"><span class="md-step-num">$1.</span> <span class="md-check-icon">✅</span> $2</div>')
    .replace(/^(\d+)\. (.+)$/gm, '<div class="md-step"><span class="md-step-num">$1.</span> $2</div>')
    .replace(/^- ✅ (.+)$/gm, '<div class="md-check"><span class="md-check-icon">✅</span> $1</div>')
    .replace(/^- (.+)$/gm, '<div class="md-bullet">$1</div>')
    .replace(/\n{2,}/g, '<div class="md-break"></div>')
    .replace(/\n/g, '\n');
}

function openFeatureModal(feature, projectId) {
  const f = feature || {};
  const isNew = !feature;
  const tags = projectHubState.projectData?.tags || [];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'feature-modal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal feature-modal-large" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>${isNew ? 'New Feature' : 'Edit Feature'}</h3>
        <button class="modal-close" onclick="document.getElementById('feature-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field"><label>Name</label><input type="text" class="modal-input" id="fe-name" value="${escapeHtml(f.name || '')}"></div>
        <div class="modal-field"><label>Description</label><textarea class="modal-textarea" id="fe-desc" rows="3">${escapeHtml(f.description || '')}</textarea></div>
        <div class="feature-modal-row">
          <div class="modal-field" style="flex:1"><label>Status</label>
            <select class="modal-select" id="fe-status">
              ${FEATURE_STATUSES.map(s => `<option value="${s.key}" ${f.status === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
          <div class="modal-field" style="flex:1"><label>Priority</label>
            <select class="modal-select" id="fe-priority">
              <option value="low" ${f.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="normal" ${f.priority === 'normal' || !f.priority ? 'selected' : ''}>Normal</option>
              <option value="high" ${f.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="urgent" ${f.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
            </select>
          </div>
        </div>
        <div class="feature-modal-row">
          <div class="modal-field" style="flex:1"><label>Version Target</label><input type="text" class="modal-input" id="fe-vertarget" value="${escapeHtml(f.version_target || '')}"></div>
          <div class="modal-field" style="flex:1"><label>Version Shipped</label><input type="text" class="modal-input" id="fe-vershipped" value="${escapeHtml(f.version_shipped || '')}"></div>
        </div>
        <div class="feature-modal-row">
          <div class="modal-field" style="flex:1"><label>Tags (comma-separated)</label><input type="text" class="modal-input" id="fe-tags" value="${escapeHtml(parseFeatureTags(f.tags).join(', '))}"></div>
          <div class="modal-field" style="flex:1"><label>Source</label><input type="text" class="modal-input" id="fe-source" value="${escapeHtml(f.source || '')}" placeholder="e.g. user request, brainstorm, competitor"></div>
        </div>
        <div class="modal-field">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem">
            <label style="margin:0">🤖 Claude Code Prompt</label>
            <div style="display:flex;gap:0.4rem">
              ${f.prompt ? '<button class="prompt-copy-btn" onclick="copyFeaturePrompt(this)">📋 Copy</button>' : ''}
              <button class="prompt-copy-btn" id="fe-prompt-toggle" onclick="togglePromptEdit(\'prompt\')">✏️ Edit</button>
            </div>
          </div>
          <div class="feature-rendered-box" id="fe-prompt-rendered" style="${f.prompt ? '' : 'display:none'}">${renderMarkdownLite(f.prompt || '')}</div>
          <textarea class="modal-textarea prompt-textarea" id="fe-prompt" rows="8" style="${f.prompt ? 'display:none' : ''}" placeholder="Paste a detailed prompt for Claude Code to implement this feature...">${escapeHtml(f.prompt || '')}</textarea>
        </div>
        <div class="modal-field">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem">
            <label style="margin:0">🧪 Testing Checklist</label>
            <button class="prompt-copy-btn" id="fe-testing-toggle" onclick="togglePromptEdit(\'testing\')">✏️ Edit</button>
          </div>
          <div class="feature-rendered-box testing-rendered" id="fe-testing-rendered" style="${f.testing ? '' : 'display:none'}">${renderMarkdownLite(f.testing || '')}</div>
          <textarea class="modal-textarea" id="fe-testing" rows="6" style="${f.testing ? 'display:none' : ''}" placeholder="What to test after implementation...">${escapeHtml(f.testing || '')}</textarea>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-move" onclick="saveFeatureModal(${f.id || 'null'}, '${projectId}')">${isNew ? 'Create' : 'Save'}</button>
        ${!isNew ? `<button class="btn-archive" onclick="deleteFeatureModal(${f.id}, '${projectId}')">🗑 Delete</button>` : ''}
        <button class="btn-archive" onclick="document.getElementById('feature-modal').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
}

function togglePromptEdit(field) {
  const rendered = document.getElementById(`fe-${field}-rendered`);
  const textarea = document.getElementById(`fe-${field}`);
  const btn = document.getElementById(`fe-${field}-toggle`);
  if (textarea.style.display === 'none') {
    textarea.style.display = '';
    rendered.style.display = 'none';
    btn.textContent = '👁 View';
  } else {
    rendered.innerHTML = renderMarkdownLite(textarea.value);
    rendered.style.display = '';
    textarea.style.display = 'none';
    btn.textContent = '✏️ Edit';
  }
}

async function saveFeatureModal(featureId, projectId) {
  const body = {
    name: document.getElementById('fe-name').value,
    description: document.getElementById('fe-desc').value || null,
    status: document.getElementById('fe-status').value,
    version_target: document.getElementById('fe-vertarget').value || null,
    version_shipped: document.getElementById('fe-vershipped').value || null,
    priority: document.getElementById('fe-priority').value,
    tags: document.getElementById('fe-tags').value || null,
    source: document.getElementById('fe-source').value || null,
    prompt: document.getElementById('fe-prompt').value || null,
    testing: document.getElementById('fe-testing').value || null
  };
  if (!body.name) return alert('Name is required');

  if (featureId) {
    await fetchJSON(`/api/projects/${projectId}/features/${featureId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } else {
    await fetchJSON(`/api/projects/${projectId}/features`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  document.getElementById('feature-modal')?.remove();
  await selectProjectPreserveScroll(projectId);
}

// --- Feature drag-and-drop ---
function featureDragStart(event, featureId, projectId) {
  event.dataTransfer.setData('text/plain', JSON.stringify({ featureId, projectId }));
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.style.opacity = '0.4';
  // Highlight all drop targets
  setTimeout(() => {
    document.querySelectorAll('.feature-group-cards').forEach(g => g.classList.add('feature-drop-target'));
  }, 0);
}

function featureDragEnd(event) {
  event.currentTarget.style.opacity = '1';
  document.querySelectorAll('.feature-group-cards').forEach(g => {
    g.classList.remove('feature-drop-target', 'feature-drag-over');
  });
}

function featureDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('feature-drag-over');
}

function featureDragLeave(event) {
  event.currentTarget.classList.remove('feature-drag-over');
}

async function featureDrop(event) {
  event.preventDefault();
  const target = event.currentTarget;
  target.classList.remove('feature-drag-over');

  const groupBy = projectHubState.featureGroupBy || 'status';
  const groupKey = target.dataset.featureGroup;
  const projectId = target.dataset.projectId;

  let data;
  try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch(e) { return; }
  const { featureId } = data;

  // Determine what field to update based on groupBy
  let updateBody = {};
  if (groupBy === 'status') {
    updateBody.status = groupKey;
  } else if (groupBy === 'version') {
    updateBody.version_target = groupKey === 'Unassigned' ? '' : groupKey;
  } else if (groupBy === 'tags') {
    updateBody.tags = groupKey === 'Untagged' ? '' : groupKey;
  }

  try {
    await fetchJSON(`/api/projects/${projectId}/features/${featureId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody)
    });
    await selectProjectPreserveScroll(projectId);
  } catch (err) {
    console.error('Feature drop error:', err);
  }
}

async function selectProjectPreserveScroll(id) {
  const content = document.getElementById('project-hub-content');
  const scrollTop = content ? content.scrollTop : 0;
  const mainEl = document.querySelector('.main-content');
  const mainScroll = mainEl ? mainEl.scrollTop : window.scrollY;

  projectHubState.selectedId = id;
  projectHubState.showOverview = false;
  const data = await fetchJSON(`/api/projects/${id}`);
  if (!data || data.error) return;
  projectHubState.projectData = data;
  renderProjectHub();

  // Restore scroll
  requestAnimationFrame(() => {
    if (content) content.scrollTop = scrollTop;
    if (mainEl) mainEl.scrollTop = mainScroll;
    else window.scrollTo(0, mainScroll);
  });
}

function copyFeaturePrompt(btn) {
  const text = document.getElementById('fe-prompt')?.value;
  if (!text) return;
  // Use execCommand fallback for non-HTTPS contexts
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  }
}

async function deleteFeatureModal(featureId, projectId) {
  if (!confirm('Delete this feature?')) return;
  await fetchJSON(`/api/projects/${projectId}/features/${featureId}`, { method: 'DELETE' });
  document.getElementById('feature-modal')?.remove();
  await selectProjectPreserveScroll(projectId);
}

// --- Modal: Feedback ---

function openNewFeedbackModal(projectId) {
  openFeedbackModal(null, projectId);
}

function openFeedbackEditModal(fbId, projectId) {
  const fb = (projectHubState.projectData?.feedback || []).find(f => f.id === fbId);
  if (!fb) return;
  openFeedbackModal(fb, projectId);
}

function openFeedbackModal(fb, projectId) {
  const f = fb || {};
  const isNew = !fb;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'feedback-modal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>${isNew ? 'Add Feedback' : 'Edit Feedback'}</h3>
        <button class="modal-close" onclick="document.getElementById('feedback-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field"><label>Source</label><input type="text" class="modal-input" id="fb-source" value="${escapeHtml(f.source || '')}" placeholder="e.g. App Store, Reddit, Email"></div>
        <div class="modal-field"><label>Content</label><textarea class="modal-textarea" id="fb-content" rows="4">${escapeHtml(f.content || '')}</textarea></div>
        <div class="modal-field"><label>Sentiment</label>
          <select class="modal-select" id="fb-sentiment">
            <option value="">Unknown</option>
            <option value="positive" ${f.sentiment === 'positive' ? 'selected' : ''}>👍 Positive</option>
            <option value="neutral" ${f.sentiment === 'neutral' ? 'selected' : ''}>😐 Neutral</option>
            <option value="negative" ${f.sentiment === 'negative' ? 'selected' : ''}>👎 Negative</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-move" onclick="saveFeedbackModal(${f.id || 'null'}, '${projectId}')">${isNew ? 'Add' : 'Save'}</button>
        ${!isNew ? `<button class="btn-archive" onclick="deleteFeedbackModal(${f.id}, '${projectId}')">🗑 Delete</button>` : ''}
        <button class="btn-archive" onclick="document.getElementById('feedback-modal').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
}

async function saveFeedbackModal(fbId, projectId) {
  const body = {
    source: document.getElementById('fb-source').value || null,
    content: document.getElementById('fb-content').value,
    sentiment: document.getElementById('fb-sentiment').value || null
  };
  if (!body.content) return alert('Content is required');

  if (fbId) {
    await fetchJSON(`/api/projects/${projectId}/feedback/${fbId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } else {
    await fetchJSON(`/api/projects/${projectId}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  document.getElementById('feedback-modal')?.remove();
  selectProject(projectId);
}

async function deleteFeedbackModal(fbId, projectId) {
  if (!confirm('Delete this feedback?')) return;
  await fetchJSON(`/api/projects/${projectId}/feedback/${fbId}`, { method: 'DELETE' });
  document.getElementById('feedback-modal')?.remove();
  selectProject(projectId);
}

// Legacy refreshProjects for Trello-only board view (used by kanban section)
async function refreshProjects() {
  boardsData = await fetchJSON('/api/trello');
  if (boardsData && boardsData.boards && document.getElementById('board-container')) {
    renderTabs(boardsData.boards);
    renderBoard(boardsData.boards[activeTab]);
  }
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

// ==================== IDEAS ====================

let ideasState = { ideas: [], selectedId: null };

async function renderIdeas(container) {
  container.innerHTML = `
    <div class="view-container ideas-page">
      <div class="ideas-list-panel" id="ideas-list-panel">
        <div class="ideas-list-header">
          <h2>💡 Ideas</h2>
          <button class="btn-move" onclick="openNewIdeaModal()">+ New</button>
        </div>
        <div class="ideas-list" id="ideas-list">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="ideas-detail-panel" id="ideas-detail-panel">
        <div class="docs-empty-state" style="padding:3rem;text-align:center">
          <div class="placeholder-icon">💡</div>
          <div class="placeholder-text">Select an idea</div>
          <div class="placeholder-sub">Click one to see the full breakdown</div>
        </div>
      </div>
    </div>
  `;
  await loadIdeas();
}

async function loadIdeas() {
  ideasState.ideas = await fetchJSON('/api/ideas') || [];
  renderIdeaList();
  if (ideasState.selectedId) openIdeaDetail(ideasState.selectedId);
}

function renderIdeaList() {
  const list = document.getElementById('ideas-list');
  if (!list) return;

  const active = ideasState.ideas.filter(i => i.status === 'active');
  const archived = ideasState.ideas.filter(i => i.status === 'archived');
  const promoted = ideasState.ideas.filter(i => i.status === 'promoted');

  if (!active.length && !archived.length && !promoted.length) {
    list.innerHTML = `<div class="ideas-list-empty">No ideas yet</div>`;
    return;
  }

  let html = active.map(i => renderIdeaListItem(i)).join('');

  if (promoted.length) {
    html += `<div class="ideas-divider" onclick="this.nextElementSibling.classList.toggle('collapsed')">
      <span>🚀 Promoted (${promoted.length})</span><span class="chevron">▸</span>
    </div><div class="ideas-section collapsed">${promoted.map(i => renderIdeaListItem(i)).join('')}</div>`;
  }
  if (archived.length) {
    html += `<div class="ideas-divider" onclick="this.nextElementSibling.classList.toggle('collapsed')">
      <span>📦 Archived (${archived.length})</span><span class="chevron">▸</span>
    </div><div class="ideas-section collapsed">${archived.map(i => renderIdeaListItem(i)).join('')}</div>`;
  }
  list.innerHTML = html;
}

function renderIdeaListItem(idea) {
  const tags = idea.tags ? idea.tags.split(',').map(t => t.trim()) : [];
  const effort = idea.effort ? `<span class="idea-effort-badge">${escapeHtml(idea.effort)}</span>` : '';
  const isSelected = ideasState.selectedId === idea.id;

  return `
    <div class="idea-list-item ${idea.status === 'archived' ? 'archived' : ''} ${idea.status === 'promoted' ? 'promoted' : ''} ${isSelected ? 'active' : ''}" onclick="openIdeaDetail(${idea.id})">
      <div class="idea-list-title">${escapeHtml(idea.title)}</div>
      <div class="idea-list-meta">
        ${tags.slice(0, 2).map(t => `<span class="idea-tag">${escapeHtml(t)}</span>`).join('')}
        ${effort}
      </div>
    </div>
  `;
}

async function openIdeaDetail(id) {
  ideasState.selectedId = id;
  renderIdeaList(); // update active highlight

  const panel = document.getElementById('ideas-detail-panel');
  if (!panel) return;

  const idea = ideasState.ideas.find(i => i.id === id);
  if (!idea) { panel.innerHTML = '<div class="docs-empty-state">Idea not found</div>'; return; }

  const tags = idea.tags ? idea.tags.split(',').map(t => t.trim()) : [];

  panel.innerHTML = `
    <div class="idea-detail">
      <div class="idea-detail-header">
        <h1 class="idea-detail-title">${escapeHtml(idea.title)}</h1>
        <div class="idea-detail-actions">
          <button class="btn-doc-action" onclick="openEditIdeaModal(${idea.id})">✏️ Edit</button>
          ${idea.status === 'active' ? `
            <button class="btn-move" onclick="promoteIdea(${idea.id})">🚀 Promote</button>
            <button class="btn-archive" onclick="archiveIdea(${idea.id})">📦 Archive</button>
          ` : idea.status === 'archived' ? `
            <button class="btn-move" onclick="restoreIdea(${idea.id})">♻️ Restore</button>
            <button class="btn-archive" style="color:#ef4444" onclick="deleteIdea(${idea.id})">🗑 Delete</button>
          ` : ''}
        </div>
      </div>
      <div class="idea-detail-meta">
        ${tags.map(t => `<span class="idea-tag">${escapeHtml(t)}</span>`).join('')}
        ${idea.effort ? `<span class="idea-effort-pill">${escapeHtml(idea.effort)}</span>` : ''}
        ${idea.feasibility ? `<span class="idea-feasibility-pill">${escapeHtml(idea.feasibility)}</span>` : ''}
        ${idea.source ? `<span class="idea-source">via ${escapeHtml(idea.source)}</span>` : ''}
      </div>
      ${idea.description ? `<div class="idea-detail-section"><p class="idea-detail-desc">${escapeHtml(idea.description)}</p></div>` : ''}
      ${idea.pain_point ? `
        <div class="idea-detail-section">
          <h3>🎯 The Problem</h3>
          <p>${escapeHtml(idea.pain_point)}</p>
        </div>
      ` : ''}
      ${idea.how_it_works ? `
        <div class="idea-detail-section">
          <h3>⚙️ How It Works</h3>
          <p>${escapeHtml(idea.how_it_works)}</p>
        </div>
      ` : ''}
      ${idea.why_it_works ? `
        <div class="idea-detail-section">
          <h3>📈 Why It Could Work</h3>
          <p>${escapeHtml(idea.why_it_works)}</p>
        </div>
      ` : ''}
      ${idea.revenue_model ? `
        <div class="idea-detail-section">
          <h3>💰 Revenue Model</h3>
          <p>${escapeHtml(idea.revenue_model)}</p>
        </div>
      ` : ''}
      ${idea.competition ? `
        <div class="idea-detail-section">
          <h3>🏟️ Competition</h3>
          <p>${escapeHtml(idea.competition)}</p>
        </div>
      ` : ''}
      ${idea.synergy ? `
        <div class="idea-detail-section">
          <h3>🔗 Synergy</h3>
          <p>${escapeHtml(idea.synergy)}</p>
        </div>
      ` : ''}
      ${!idea.pain_point && !idea.how_it_works && !idea.why_it_works && !idea.revenue_model && !idea.competition ? `
        <div class="idea-detail-empty">
          <p>This idea hasn't been fleshed out yet. Click ✏️ Edit to add details.</p>
        </div>
      ` : ''}
    </div>
  `;
}

function getTimeAgo(dateStr) {
  const now = new Date();
  const d = new Date(dateStr + 'Z');
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
  return d.toLocaleDateString();
}

function openNewIdeaModal() { showIdeaEditModal(null); }
function openEditIdeaModal(id) {
  const idea = ideasState.ideas.find(i => i.id === id);
  showIdeaEditModal(idea);
}

function showIdeaEditModal(idea) {
  const f = idea || {};
  const isNew = !idea;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'idea-modal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal modal-wide" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>${isNew ? '💡 New Idea' : '✏️ Edit Idea'}</h3>
        <button class="modal-close" onclick="document.getElementById('idea-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field"><label>Title</label><input type="text" class="modal-input" id="idea-title" value="${escapeHtml(f.title || '')}" placeholder="What's the idea?"></div>
        <div class="modal-field"><label>One-liner</label><input type="text" class="modal-input" id="idea-desc" value="${escapeHtml(f.description || '')}" placeholder="Quick concept summary"></div>
        <div class="modal-two-col">
          <div class="modal-field"><label>Tags</label><input type="text" class="modal-input" id="idea-tags" value="${escapeHtml(f.tags || '')}" placeholder="iOS, productivity, AI"></div>
          <div class="modal-field"><label>Source</label><input type="text" class="modal-input" id="idea-source" value="${escapeHtml(f.source || '')}" placeholder="Reddit, brainstorm"></div>
        </div>
        <div class="modal-two-col">
          <div class="modal-field"><label>Effort</label>
            <select class="modal-select" id="idea-effort">
              <option value="" ${!f.effort ? 'selected' : ''}>—</option>
              <option value="🟢 Weekend" ${f.effort === '🟢 Weekend' ? 'selected' : ''}>🟢 Weekend</option>
              <option value="🟡 1-2 weeks" ${f.effort === '🟡 1-2 weeks' ? 'selected' : ''}>🟡 1-2 weeks</option>
              <option value="🟠 2-4 weeks" ${f.effort === '🟠 2-4 weeks' ? 'selected' : ''}>🟠 2-4 weeks</option>
              <option value="🔴 Month+" ${f.effort === '🔴 Month+' ? 'selected' : ''}>🔴 Month+</option>
            </select>
          </div>
          <div class="modal-field"><label>Feasibility</label><input type="text" class="modal-input" id="idea-feasibility" value="${escapeHtml(f.feasibility || '')}" placeholder="Easy / Medium / Hard"></div>
        </div>
        <div class="modal-field"><label>🎯 The Problem</label><textarea class="modal-textarea" id="idea-pain" rows="3" placeholder="What pain point does this solve? Include evidence (Reddit posts, complaints, etc.)">${escapeHtml(f.pain_point || '')}</textarea></div>
        <div class="modal-field"><label>⚙️ How It Works</label><textarea class="modal-textarea" id="idea-how" rows="3" placeholder="Core features — what does the app actually do?">${escapeHtml(f.how_it_works || '')}</textarea></div>
        <div class="modal-field"><label>📈 Why It Could Work</label><textarea class="modal-textarea" id="idea-why" rows="3" placeholder="Market gap, no good existing solution, growing demand...">${escapeHtml(f.why_it_works || '')}</textarea></div>
        <div class="modal-field"><label>💰 Revenue Model</label><input type="text" class="modal-input" id="idea-revenue" value="${escapeHtml(f.revenue_model || '')}" placeholder="Freemium, subscription, one-time, ads"></div>
        <div class="modal-field"><label>🏟️ Competition</label><textarea class="modal-textarea" id="idea-comp" rows="2" placeholder="What exists and why it's not good enough">${escapeHtml(f.competition || '')}</textarea></div>
        <div class="modal-field"><label>🔗 Synergy</label><input type="text" class="modal-input" id="idea-synergy" value="${escapeHtml(f.synergy || '')}" placeholder="Connection to Sown, Adventune, Limelee..."></div>
      </div>
      <div class="modal-actions">
        <button class="btn-move" onclick="saveIdea(${f.id || 'null'})">${isNew ? 'Create' : 'Save'}</button>
        <button class="btn-archive" onclick="document.getElementById('idea-modal').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
  document.getElementById('idea-title')?.focus();
}

async function saveIdea(ideaId) {
  const body = {
    title: document.getElementById('idea-title').value,
    description: document.getElementById('idea-desc').value || null,
    tags: document.getElementById('idea-tags').value || null,
    source: document.getElementById('idea-source').value || null,
    pain_point: document.getElementById('idea-pain').value || null,
    how_it_works: document.getElementById('idea-how').value || null,
    why_it_works: document.getElementById('idea-why').value || null,
    feasibility: document.getElementById('idea-feasibility').value || null,
    effort: document.getElementById('idea-effort').value || null,
    revenue_model: document.getElementById('idea-revenue').value || null,
    competition: document.getElementById('idea-comp').value || null,
    synergy: document.getElementById('idea-synergy').value || null
  };
  if (!body.title) return alert('Title is required');

  if (ideaId) {
    await fetchJSON(`/api/ideas/${ideaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    await fetchJSON('/api/ideas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  document.getElementById('idea-modal')?.remove();
  await loadIdeas();
  if (ideaId) openIdeaDetail(ideaId);
}

async function archiveIdea(id) {
  await fetchJSON(`/api/ideas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
  ideasState.selectedId = null;
  await loadIdeas();
  document.getElementById('ideas-detail-panel').innerHTML = '<div class="docs-empty-state" style="padding:3rem;text-align:center"><div class="placeholder-icon">💡</div><div class="placeholder-text">Select an idea</div></div>';
}

async function restoreIdea(id) {
  await fetchJSON(`/api/ideas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
  await loadIdeas();
  openIdeaDetail(id);
}

async function deleteIdea(id) {
  if (!confirm('Permanently delete this idea?')) return;
  await fetchJSON(`/api/ideas/${id}`, { method: 'DELETE' });
  ideasState.selectedId = null;
  await loadIdeas();
  document.getElementById('ideas-detail-panel').innerHTML = '<div class="docs-empty-state" style="padding:3rem;text-align:center"><div class="placeholder-icon">💡</div><div class="placeholder-text">Select an idea</div></div>';
}

async function promoteIdea(id) {
  const idea = ideasState.ideas.find(i => i.id === id);
  if (!idea) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'promote-modal';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>🚀 Promote to Project</h3>
        <button class="modal-close" onclick="document.getElementById('promote-modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-muted);margin-bottom:1rem">Create a new project from "<strong>${escapeHtml(idea.title)}</strong>"</p>
        <div class="modal-field"><label>Project ID (slug)</label><input type="text" class="modal-input" id="promote-id" value="${idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/-+$/, '')}" placeholder="my-project"></div>
        <div class="modal-field"><label>Icon (emoji)</label><input type="text" class="modal-input" id="promote-icon" value="💡" style="width:60px"></div>
        <div class="modal-field"><label>Platform</label><input type="text" class="modal-input" id="promote-platform" placeholder="e.g. iOS / Web / Both"></div>
        <div class="modal-field"><label>Category</label><input type="text" class="modal-input" id="promote-category" placeholder="e.g. Productivity, Social, Music"></div>
      </div>
      <div class="modal-actions">
        <button class="btn-move" onclick="executePromote(${id})">🚀 Create Project</button>
        <button class="btn-archive" onclick="document.getElementById('promote-modal').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';
}

async function executePromote(ideaId) {
  const body = {
    project_id: document.getElementById('promote-id').value,
    icon: document.getElementById('promote-icon').value || '💡',
    platform: document.getElementById('promote-platform').value || null,
    category: document.getElementById('promote-category').value || null
  };
  if (!body.project_id) return alert('Project ID is required');

  const result = await fetchJSON(`/api/ideas/${ideaId}/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('promote-modal')?.remove();
  if (result?.project_id) {
    await loadIdeas();
    if (confirm('Project created! View it now?')) {
      loadView('projects');
      setTimeout(() => selectProject(result.project_id), 500);
    }
  }
}

// ==================== WORKSPACE ====================

let wsSelectedFile = null;
let wsContent = '';
let wsSavedContent = '';
let wsPreview = false;
let wsExpandedDirs = new Set();

async function renderWorkspace(container) {
  container.innerHTML = `
    <div class="view-container workspace-view">
      <div class="ws-layout">
        <div class="ws-tree-panel">
          <div class="ws-tree-header">
            <span class="ws-tree-title">Workspace</span>
            <button class="ws-new-btn" onclick="wsNewFile()" title="New file">+</button>
          </div>
          <div class="ws-tree" id="ws-tree">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="ws-editor-panel" id="ws-editor-panel">
          <div class="ws-empty-state">
            <div class="placeholder-icon">🗂️</div>
            <div class="placeholder-text">Select a file to edit</div>
            <div class="placeholder-sub">Click any file in the tree</div>
          </div>
        </div>
      </div>
    </div>
  `;
  await loadWsTree();
}

async function loadWsTree() {
  const el = document.getElementById('ws-tree');
  if (!el) return;
  const tree = await fetchJSON('/api/workspace/tree');
  if (!tree) { el.innerHTML = '<div class="ws-error">Failed to load</div>'; return; }
  el.innerHTML = renderWsTree(tree.children || [], 0);
}

function wsFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'md') return '📄';
  if (ext === 'json') return '📋';
  if (ext === 'js' || ext === 'ts') return '📜';
  if (ext === 'sh') return '⚙️';
  if (ext === 'txt') return '📃';
  if (ext === 'csv') return '📊';
  if (ext === 'yaml' || ext === 'yml') return '⚙️';
  return '📄';
}

function renderWsTree(nodes, depth) {
  if (!nodes || nodes.length === 0) return '';
  return nodes.map(node => {
    const indent = depth * 14;
    if (node.type === 'dir') {
      const expanded = wsExpandedDirs.has(node.path);
      return `
        <div class="ws-tree-dir ${expanded ? 'expanded' : ''}" style="padding-left:${indent}px" onclick="wsToggleDir('${escapeHtml(node.path)}', event)">
          <span class="ws-dir-arrow">${expanded ? '▾' : '▸'}</span>
          <span class="ws-dir-icon">📁</span>
          <span class="ws-name">${escapeHtml(node.name)}</span>
        </div>
        <div class="ws-tree-children" id="wsdir-${CSS.escape(node.path)}" style="display:${expanded ? 'block' : 'none'}">
          ${renderWsTree(node.children || [], depth + 1)}
        </div>
      `;
    } else {
      const isActive = wsSelectedFile === node.path;
      return `
        <div class="ws-tree-file ${isActive ? 'active' : ''}" style="padding-left:${indent + 14}px" onclick="wsOpenFile('${escapeHtml(node.path)}')" title="${escapeHtml(node.path)}">
          <span class="ws-file-icon">${wsFileIcon(node.name)}</span>
          <span class="ws-name">${escapeHtml(node.name)}</span>
        </div>
      `;
    }
  }).join('');
}

function wsToggleDir(dirPath, e) {
  e.stopPropagation();
  if (wsExpandedDirs.has(dirPath)) {
    wsExpandedDirs.delete(dirPath);
  } else {
    wsExpandedDirs.add(dirPath);
  }
  loadWsTree();
}

async function wsOpenFile(filePath) {
  if (wsSelectedFile && wsContent !== wsSavedContent) {
    if (!confirm('You have unsaved changes. Discard?')) return;
  }
  wsSelectedFile = filePath;
  wsPreview = false;
  const panel = document.getElementById('ws-editor-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="loading" style="padding:2rem"><div class="spinner"></div> Loading...</div>';
  await loadWsTree();

  const data = await fetchJSON(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
  if (!data) { panel.innerHTML = '<div class="ws-error" style="padding:1rem">Failed to load file</div>'; return; }

  wsContent = data.content || '';
  wsSavedContent = wsContent;
  renderWsEditorPanel(panel, filePath);
}

function renderWsEditorPanel(panel, filePath) {
  const name = filePath.split('/').pop();
  const isMarkdown = name.endsWith('.md');
  const dirty = wsContent !== wsSavedContent;

  panel.innerHTML = `
    <div class="ws-editor-header">
      <div class="ws-editor-file">
        <span class="ws-editor-filename">${escapeHtml(name)}</span>
        <span class="ws-unsaved-dot ${dirty ? 'visible' : ''}" id="ws-unsaved-dot" title="Unsaved changes"></span>
      </div>
      <div class="ws-editor-actions">
        ${isMarkdown ? `<button class="ws-btn ${wsPreview ? 'active' : ''}" onclick="wsTogglePreview()" id="ws-preview-btn">Preview</button>` : ''}
        <button class="ws-btn ws-save-btn" onclick="wsSave()" id="ws-save-btn">Save</button>
      </div>
    </div>
    <div class="ws-editor-body" id="ws-editor-body">
      <div class="ws-editor-wrap ${wsPreview ? 'hidden' : ''}\" id="ws-editor-wrap">
        <div class="ws-line-numbers" id="ws-line-numbers"></div>
        <textarea class="ws-textarea" id="ws-textarea" spellcheck="false">${escapeHtml(wsContent)}</textarea>
      </div>
      ${isMarkdown ? `<div class="ws-preview markdown-body ${wsPreview ? '' : 'hidden'}" id="ws-preview">${renderMarkdown(wsContent)}</div>` : ''}
    </div>
  `;

  const ta = document.getElementById('ws-textarea');
  if (ta) {
    // Unescape for actual editing
    ta.value = wsContent;
    wsUpdateLineNumbers();
    ta.addEventListener('input', wsOnInput);
    ta.addEventListener('scroll', wsOnScroll);
    ta.addEventListener('keydown', wsOnKeydown);
  }
}

function wsOnInput() {
  const ta = document.getElementById('ws-textarea');
  if (!ta) return;
  wsContent = ta.value;
  const dot = document.getElementById('ws-unsaved-dot');
  if (dot) dot.classList.toggle('visible', wsContent !== wsSavedContent);
  wsUpdateLineNumbers();
}

function wsOnScroll() {
  const ta = document.getElementById('ws-textarea');
  const ln = document.getElementById('ws-line-numbers');
  if (ta && ln) ln.scrollTop = ta.scrollTop;
}

function wsUpdateLineNumbers() {
  const ta = document.getElementById('ws-textarea');
  const ln = document.getElementById('ws-line-numbers');
  if (!ta || !ln) return;
  const lines = ta.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) html += `<div>${i}</div>`;
  ln.innerHTML = html;
}

function wsOnKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    wsSave();
  }
  // Tab inserts spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + 2;
    wsOnInput();
  }
}

async function wsSave() {
  if (!wsSelectedFile) return;
  const ta = document.getElementById('ws-textarea');
  const content = ta ? ta.value : wsContent;
  const btn = document.getElementById('ws-save-btn');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(wsSelectedFile)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
  if (res.ok) {
    wsContent = content;
    wsSavedContent = content;
    const dot = document.getElementById('ws-unsaved-dot');
    if (dot) dot.classList.remove('visible');
    // Flash save confirmation
    if (btn) { btn.textContent = 'Saved!'; setTimeout(() => { if (btn) btn.textContent = 'Save'; }, 1500); }
  }
}

function wsTogglePreview() {
  const ta = document.getElementById('ws-textarea');
  if (ta) wsContent = ta.value;
  wsPreview = !wsPreview;
  const panel = document.getElementById('ws-editor-panel');
  if (!panel) return;
  const editorWrap = document.getElementById('ws-editor-wrap');
  const previewDiv = document.getElementById('ws-preview');
  const btn = document.getElementById('ws-preview-btn');

  if (wsPreview) {
    if (editorWrap) editorWrap.classList.add('hidden');
    if (previewDiv) { previewDiv.innerHTML = renderMarkdown(wsContent); previewDiv.classList.remove('hidden'); }
    if (btn) btn.classList.add('active');
  } else {
    if (editorWrap) editorWrap.classList.remove('hidden');
    if (previewDiv) previewDiv.classList.add('hidden');
    if (btn) btn.classList.remove('active');
    setTimeout(() => { const t = document.getElementById('ws-textarea'); if (t) { t.value = wsContent; wsUpdateLineNumbers(); } }, 0);
  }
}

async function wsNewFile() {
  const name = prompt('New file name (e.g. notes.md):');
  if (!name || !name.trim()) return;
  const filePath = name.trim();
  if (filePath.includes('..') || filePath.startsWith('/')) { alert('Invalid filename'); return; }
  const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '' })
  });
  if (res.ok) {
    await loadWsTree();
    wsOpenFile(filePath);
  }
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
          <option value="emily">📧 Emily</option>
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

// ===== VIEW: AGENT PROFILE =====

let agentProfileState = {
  name: null,
  selectedFile: null,
  files: [],
  status: null,
  activity: []
};

const AGENT_META = {
  jarvis: { emoji: '🐶', defaultFile: 'MEMORY.md' },
  klaus: { emoji: '⚡', defaultFile: 'AGENTS.md' },
  emily: { emoji: '📧', defaultFile: 'AGENTS.md' }
};

async function renderAgentProfile(container, agentName) {
  const name = agentName.toLowerCase();
  const meta = AGENT_META[name] || { emoji: '🤖', defaultFile: null };
  agentProfileState.name = name;
  agentProfileState.selectedFile = null;

  // Highlight sidebar agent
  document.querySelectorAll('.sidebar-agent').forEach(el => el.classList.remove('sidebar-agent-active'));
  document.getElementById(`sidebar-agent-${name}`)?.classList.add('sidebar-agent-active');
  // Clear nav active states since this isn't a nav link page
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  container.innerHTML = `
    <div class="view-container agent-profile-view">
      <div class="agent-profile-header">
        <div class="agent-profile-identity">
          <span class="agent-profile-emoji">${meta.emoji}</span>
          <div>
            <h1 class="agent-profile-name">${name.charAt(0).toUpperCase() + name.slice(1)}</h1>
            <div class="agent-profile-model" id="ap-model">—</div>
          </div>
        </div>
        <div class="agent-profile-badge" id="ap-badge">Loading...</div>
      </div>

      <div class="agent-profile-context" id="ap-context">
        <div class="loading"><div class="spinner"></div> Loading status...</div>
      </div>

      <div class="agent-profile-stats" id="ap-stats"></div>

      <div class="agent-profile-section">
        <div class="agent-profile-section-title">Files</div>
        <div class="agent-profile-file-tabs" id="ap-file-tabs">
          <div class="loading"><div class="spinner"></div></div>
        </div>
        <div class="agent-profile-file-content" id="ap-file-content">
          <div class="empty-state">Select a file to view its contents</div>
        </div>
      </div>

      <div class="agent-profile-section" id="ap-capabilities-section">
        <div class="loading"><div class="spinner"></div> Loading capabilities...</div>
      </div>

      <div class="agent-profile-section">
        <div class="agent-profile-section-title">Recent Activity</div>
        <div class="agent-profile-activity" id="ap-activity">
          <div class="loading"><div class="spinner"></div> Loading activity...</div>
        </div>
      </div>
    </div>
  `;

  // Fetch all data in parallel
  const [status, files, activity, capabilities] = await Promise.all([
    fetchJSON(`/api/agent/${name}/status`),
    fetchJSON(`/api/agent/${name}/files`),
    fetchJSON(`/api/agent/${name}/activity`),
    fetchJSON(`/api/agent/${name}/capabilities`)
  ]);

  if (!currentView.startsWith('agent/')) return;

  agentProfileState.status = status;
  agentProfileState.files = files || [];
  agentProfileState.activity = activity || [];

  renderAgentProfileStatus(status);
  renderAgentProfileFiles(files || [], meta.defaultFile);
  renderAgentProfileCapabilities(capabilities);
  renderAgentProfileActivity(activity || []);
}

function renderAgentProfileStatus(status) {
  const badge = document.getElementById('ap-badge');
  const modelEl = document.getElementById('ap-model');
  const contextEl = document.getElementById('ap-context');
  const statsEl = document.getElementById('ap-stats');

  if (!badge || !status) return;

  if (status.error) {
    badge.textContent = 'Offline';
    badge.className = 'agent-profile-badge offline';
    modelEl.textContent = 'No status available';
    contextEl.innerHTML = '';
    statsEl.innerHTML = '';
    return;
  }

  const updatedAgo = status.updated_at ? (Date.now() - new Date(status.updated_at).getTime()) / 60000 : 999;
  if (updatedAgo > 5) {
    badge.textContent = 'Idle';
    badge.className = 'agent-profile-badge idle';
  } else {
    badge.textContent = 'Online';
    badge.className = 'agent-profile-badge online';
  }

  modelEl.textContent = status.model || '—';

  // Context window
  const contextUsed = status.context_used || 0;
  const contextMax = status.context_max || 200000;
  const contextPct = Math.round((contextUsed / contextMax) * 100);
  const contextK = Math.round(contextUsed / 1000);
  const contextMaxK = Math.round(contextMax / 1000);

  let barClass = '';
  if (contextPct >= 80) barClass = 'danger';
  else if (contextPct >= 60) barClass = 'warning';

  contextEl.innerHTML = `
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
  `;

  // Stats cards
  const stats = [];
  if (status.model) stats.push({ label: 'Model', value: status.model, cls: 'accent' });
  if (status.tokens_in || status.tokens_out) stats.push({ label: 'Tokens In / Out', value: `${status.tokens_in || '—'} / ${status.tokens_out || '—'}`, cls: 'blue' });
  if (status.compactions !== undefined) stats.push({ label: 'Compactions', value: status.compactions, cls: status.compactions > 0 ? 'orange' : 'green' });
  if (status.thinking) stats.push({ label: 'Thinking', value: status.thinking, cls: '' });
  if (status.status_text) stats.push({ label: 'Status', value: status.status_text, cls: '' });
  if (status.project) stats.push({ label: 'Project', value: status.project, cls: 'orange' });

  statsEl.innerHTML = stats.map(s => `
    <div class="ap-stat-card">
      <div class="ap-stat-label">${s.label}</div>
      <div class="ap-stat-value ${s.cls}">${escapeHtml(String(s.value))}</div>
    </div>
  `).join('');
}

function renderAgentProfileFiles(files, defaultFile) {
  const tabsEl = document.getElementById('ap-file-tabs');
  if (!tabsEl) return;

  if (files.length === 0) {
    tabsEl.innerHTML = '<div class="empty-state">No files available</div>';
    return;
  }

  tabsEl.innerHTML = files.map(f => `
    <button class="ap-file-tab ${!f.exists ? 'missing' : ''}" data-path="${escapeHtml(f.path)}" onclick="selectAgentFile('${escapeHtml(f.path)}')">
      ${escapeHtml(f.name)}
      ${!f.exists ? '<span class="ap-file-missing-dot"></span>' : ''}
    </button>
  `).join('');

  // Auto-select default file
  const firstExisting = files.find(f => f.name === defaultFile && f.exists) || files.find(f => f.exists);
  if (firstExisting) {
    selectAgentFile(firstExisting.path);
  }
}

async function selectAgentFile(filePath) {
  agentProfileState.selectedFile = filePath;

  // Update tab active states
  document.querySelectorAll('.ap-file-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.path === filePath);
  });

  const contentEl = document.getElementById('ap-file-content');
  if (!contentEl) return;
  contentEl.innerHTML = '<div class="loading"><div class="spinner"></div> Loading file...</div>';

  const data = await fetchJSON(`/api/agent/${agentProfileState.name}/file?path=${encodeURIComponent(filePath)}`);

  if (!currentView.startsWith('agent/')) return;

  if (!data || !data.exists || data.content === null) {
    contentEl.innerHTML = `<div class="ap-file-empty"><span class="ap-file-empty-icon">📄</span><span>File not found or empty</span></div>`;
    return;
  }

  contentEl.innerHTML = `
    <div class="ap-file-viewer">
      <div class="ap-file-viewer-header">
        <span class="ap-file-viewer-name">${escapeHtml(data.name)}</span>
        ${data.updated_at ? `<span class="ap-file-viewer-updated">Updated ${timeAgo(data.updated_at)}</span>` : ''}
      </div>
      <div class="ap-file-viewer-body markdown-body">${renderMarkdown(data.content)}</div>
    </div>
  `;
}

function renderAgentProfileCapabilities(cap) {
  const el = document.getElementById('ap-capabilities-section');
  if (!el || !cap || cap.error) {
    if (el) el.innerHTML = '';
    return;
  }

  // Permissions grid
  const permLabels = {
    canSpawnSubagents: { label: 'Spawn Subagents', icon: '🔀' },
    canAccessFiles: { label: 'File Access', icon: '📁' },
    canExecuteCommands: { label: 'Execute Commands', icon: '⚙️' },
    canManageCron: { label: 'Manage Cron', icon: '⏰' },
    canSendMessages: { label: 'Send Messages', icon: '💬' }
  };

  const permHtml = Object.entries(cap.permissions || {}).map(([key, allowed]) => {
    const meta = permLabels[key] || { label: key, icon: '•' };
    return `<div class="cap-perm-badge ${allowed ? 'allowed' : 'denied'}">
      <span class="cap-perm-icon">${allowed ? '✅' : '❌'}</span>
      <span class="cap-perm-label">${meta.icon} ${meta.label}</span>
    </div>`;
  }).join('');

  // Skills pills
  const skillCount = cap.allSkillCount || cap.skills?.length || 0;
  const skillsHtml = (cap.skills || []).map(s => {
    const locBadge = s.location === 'workspace' ? 'skill-loc-workspace' : 'skill-loc-builtin';
    const locLabel = s.location === 'workspace' ? 'user' : 'built-in';
    return `<div class="cap-skill-pill" title="${escapeHtml(s.description)}">
      <span class="cap-skill-name">${escapeHtml(s.name)}</span>
      <span class="cap-skill-loc ${locBadge}">${locLabel}</span>
    </div>`;
  }).join('');

  // API Keys table
  const keysHtml = (cap.apiKeys || []).map(k => `
    <div class="cap-key-row">
      <span class="cap-key-status">●</span>
      <span class="cap-key-service">${escapeHtml(k.service)}</span>
      <span class="cap-key-name">${escapeHtml(k.name)}</span>
      <span class="cap-key-masked">${escapeHtml(k.masked)}</span>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="agent-profile-section-title">Permissions</div>
    <div class="cap-perm-grid">${permHtml}</div>

    <div class="agent-profile-section-title" style="margin-top:1.5rem">
      Skills
      <span class="cap-skill-count">${cap.skills?.length || 0}${skillCount > (cap.skills?.length || 0) ? ' / ' + skillCount + ' total' : ''}</span>
    </div>
    <div class="cap-skills-list">${skillsHtml || '<div class="empty-state">No skills configured</div>'}</div>

    <div class="agent-profile-section-title" style="margin-top:1.5rem">API Keys</div>
    <div class="cap-keys-table">${keysHtml || '<div class="empty-state">No API keys configured</div>'}</div>
  `;
}

function renderAgentProfileActivity(entries) {
  const el = document.getElementById('ap-activity');
  if (!el) return;

  if (!entries || entries.length === 0) {
    el.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }

  el.innerHTML = entries.map(e => `
    <div class="ap-activity-item">
      <div class="ap-activity-dot"></div>
      <div class="ap-activity-content">
        <span class="ap-activity-action">${escapeHtml(e.action)}</span>
        ${e.description ? `<span class="ap-activity-desc"> — ${escapeHtml(e.description)}</span>` : ''}
      </div>
      <div class="ap-activity-meta">
        <span class="ap-activity-time">${formatTime(e.started_at)}</span>
        ${e.duration_ms ? `<span class="ap-activity-duration"> · ${formatDuration(e.duration_ms)}</span>` : ''}
      </div>
    </div>
  `).join('');
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

function getListColor(listName) {
  const name = (listName || '').toLowerCase();
  if (name.includes('v2 features')) return '#22c55e';
  if (name.includes('bugs')) return '#ef4444';
  if (name.includes('doing')) return '#f59e0b';
  if (name.includes('done')) return '#6b7280';
  if (name.includes('user testing')) return '#22d3ee';
  if (name.includes('v3+ features') || name.includes('v3+')) return '#a78bfa';
  return '#8b8b8b';
}

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
      ${board.lists.map(list => {
        const listColor = getListColor(list.name);
        return `
        <div class="board-list" data-list-id="${list.id}"
             ondragover="boardDragOver(event)" ondragleave="boardDragLeave(event)" ondrop="boardDrop(event, '${list.id}')">
          <div class="board-list-header" style="border-bottom: 3px solid ${listColor}">
            <span class="board-list-name" style="color: ${listColor}">${list.name}</span>
            <span class="board-list-count" style="background: ${listColor}26">${list.cards.length}</span>
          </div>
          <div class="board-list-cards">
            ${list.cards.map(card => {
              const due = formatDue(card.due);
              const hasLabels = card.labels && card.labels.length > 0;
              const hasDesc = card.desc && card.desc.trim().length > 0;
              return `
                <div class="board-card" draggable="true" data-card-id="${card.id}" style="border-left: 3px solid ${listColor}"
                     ondragstart="boardCardDragStart(event, '${card.id}')" ondragend="boardCardDragEnd(event)"
                     onclick='openCard(${JSON.stringify(card).replace(/'/g, "&#39;")})'>
                  ${hasLabels ? `
                    <div class="board-card-labels">
                      ${card.labels.map(l => `<div class="board-card-label ${labelColorClass(l.color)}" title="${l.name || ''}"></div>`).join('')}
                    </div>
                  ` : ''}
                  <div class="board-card-top-row">
                    <div class="board-card-name">${card.name}</div>
                    <button class="board-card-menu-btn" onclick="event.stopPropagation(); boardCardContextMenu(event, '${card.id}', '${list.id}')" title="Move card">⋮</button>
                  </div>
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
      `; }).join('')}
    </div>
    ${board.archivedCards && board.archivedCards.length > 0 ? `
      <div class="board-archive-section">
        <div class="kanban-archive-header ${boardArchiveExpanded ? 'expanded' : ''}" onclick="toggleBoardArchive()">
          <span class="kanban-archive-toggle">${boardArchiveExpanded ? '▼' : '▶'}</span>
          <span class="kanban-archive-title">Archive</span>
          <span class="kanban-column-count">${board.archivedCards.length}</span>
        </div>
        ${boardArchiveExpanded ? `
          <div class="kanban-archive-body">
            ${board.archivedCards.map(card => `
              <div class="board-card archived" style="border-left: 3px solid #6b7280">
                <div class="board-card-top-row">
                  <div class="board-card-name">${escapeHtml(card.name)}</div>
                  <button class="board-card-menu-btn" onclick="event.stopPropagation(); unarchiveBoardCard('${card.id}')" title="Restore card">↩</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    ` : ''}
  `;
}

let boardArchiveExpanded = false;

function toggleBoardArchive() {
  boardArchiveExpanded = !boardArchiveExpanded;
  if (boardsData && boardsData.boards) {
    renderBoard(boardsData.boards[activeTab]);
  }
}

async function unarchiveBoardCard(cardId) {
  await fetchJSON('/api/trello/cards/' + cardId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closed: false })
  });
  refreshProjects();
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

// ===== BOARD CARD DRAG & DROP =====

function boardCardDragStart(event, cardId) {
  event.dataTransfer.setData('text/plain', cardId);
  event.dataTransfer.effectAllowed = 'move';
  event.target.classList.add('board-card-dragging');
  setTimeout(() => {
    document.querySelectorAll('.board-list').forEach(col => col.classList.add('board-drop-target'));
  }, 0);
}

function boardCardDragEnd(event) {
  event.target.classList.remove('board-card-dragging');
  document.querySelectorAll('.board-list').forEach(col => {
    col.classList.remove('board-drop-target', 'board-drag-over');
  });
}

function boardDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('board-drag-over');
}

function boardDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove('board-drag-over');
  }
}

async function boardDrop(event, listId) {
  event.preventDefault();
  event.currentTarget.classList.remove('board-drag-over');
  const cardId = event.dataTransfer.getData('text/plain');
  if (!cardId) return;
  // Don't move if dropped on same list
  const card = document.querySelector(`[data-card-id="${cardId}"]`);
  if (card && card.closest('.board-list')?.dataset.listId === listId) return;
  await fetchJSON(`/api/trello/cards/${cardId}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId })
  });
  refreshProjects();
}

// ===== BOARD CARD CONTEXT MENU =====

function boardCardContextMenu(event, cardId, currentListId) {
  event.preventDefault();
  event.stopPropagation();

  // Remove existing menu
  const existing = document.getElementById('board-ctx-menu');
  if (existing) existing.remove();

  if (!boardsData || !boardsData.boards || !boardsData.boards[activeTab]) return;
  const lists = boardsData.boards[activeTab].lists;

  const moveOptions = lists.filter(l => l.id !== currentListId);

  const menu = document.createElement('div');
  menu.id = 'board-ctx-menu';
  menu.className = 'kanban-ctx-menu';
  menu.innerHTML = `
    <div class="kanban-ctx-header">Move to</div>
    ${moveOptions.map(l => {
      const color = getListColor(l.name);
      return `<div class="kanban-ctx-item" onclick="boardCtxMove('${cardId}', '${l.id}')" style="border-left: 3px solid ${color}; padding-left: 0.6rem">
        ${escapeHtml(l.name)}
      </div>`;
    }).join('')}
    <div class="kanban-ctx-divider"></div>
    <div class="kanban-ctx-item kanban-ctx-archive" onclick="boardCtxArchive('${cardId}')">
      📦 Archive
    </div>
  `;

  menu.style.left = event.clientX + 'px';
  menu.style.top = event.clientY + 'px';
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

  setTimeout(() => {
    document.addEventListener('click', dismissBoardCtxMenu);
  }, 0);
}

function dismissBoardCtxMenu() {
  const menu = document.getElementById('board-ctx-menu');
  if (menu) menu.remove();
  document.removeEventListener('click', dismissBoardCtxMenu);
}

async function boardCtxMove(cardId, listId) {
  dismissBoardCtxMenu();
  await fetchJSON(`/api/trello/cards/${cardId}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId })
  });
  refreshProjects();
}

async function boardCtxArchive(cardId) {
  dismissBoardCtxMenu();
  await fetchJSON(`/api/trello/cards/${cardId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closed: true })
  });
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
    closeScheduleModal();
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
  if (currentView === 'home') {
    refreshHomeData();
  } else if (currentView === 'schedule') {
    refreshScheduleData();
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
fetchNavBadges();
setInterval(fetchNavBadges, 30000);

// ===== FINANCE TAB =====

const SPENDING_CATEGORIES = [
  { value: 'food', label: '🍔 Food' },
  { value: 'transport', label: '🚌 Transport' },
  { value: 'entertainment', label: '🎮 Entertainment' },
  { value: 'shopping', label: '🛒 Shopping' },
  { value: 'health', label: '💊 Health' },
  { value: 'eating_out', label: '☕ Eating Out' },
  { value: 'home', label: '🏠 Home' },
  { value: 'subscriptions', label: '📱 Subscriptions' },
  { value: 'other', label: '🎯 Other' }
];

const EXPENSE_CATEGORIES = ['Travel', 'Meals', 'Software', 'Equipment', 'Other'];

let financeState = {
  budget: null,
  settings: null,
  recurring: [],
  todaySpending: [],
  monthSpending: [],
  expenses: [],
  expenseFilter: 'all',
  editingRecurringId: null,
  openRecurringMenu: null
};

function getCategoryEmoji(cat) {
  const found = SPENDING_CATEGORIES.find(c => c.value === cat);
  return found ? found.label : cat || '🎯 Other';
}

function getCategoryBadge(cat) {
  const colors = {
    food: '#f97316', transport: '#3b82f6', entertainment: '#a855f7',
    shopping: '#22c55e', health: '#ef4444', eating_out: '#f59e0b',
    home: '#6366f1', subscriptions: '#ec4899', other: '#6b7280'
  };
  const color = colors[cat] || '#6b7280';
  return `<span class="finance-cat-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${getCategoryEmoji(cat)}</span>`;
}

async function renderFinance(container) {
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading finance...</div>';

  // Load all data in parallel
  const [settings, recurring, todaySpending, budget, expenses] = await Promise.all([
    fetchJSON('/api/finance/settings'),
    fetchJSON('/api/finance/recurring'),
    fetchJSON('/api/finance/spending/today'),
    fetchJSON('/api/finance/budget/latest'),
    fetchJSON('/api/finance/expenses')
  ]);

  financeState.settings = settings;
  financeState.recurring = recurring || [];
  financeState.todaySpending = todaySpending || [];
  financeState.budget = budget;
  financeState.expenses = expenses || [];

  // Get current month spending
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthSpending = await fetchJSON(`/api/finance/spending?month=${monthStr}`);
  financeState.monthSpending = monthSpending || [];

  renderFinanceContent(container);
}

function renderFinanceContent(container) {
  const b = financeState.budget;
  const s = financeState.settings || {};
  const dailyStr = b ? `£${b.daily_allowance.toFixed(2)}` : '£--.--';
  const calcTime = b ? new Date(b.calculated_at).toLocaleString('en-GB') : 'Never';

  // Progress bar calc
  const totalBudget = (s.monthly_income || 0) - (b?.total_fixed || 0) - (s.savings_target || 0);
  const spentPct = totalBudget > 0 ? Math.min(100, ((b?.total_spent || 0) / totalBudget) * 100) : 0;
  const progressColor = spentPct > 90 ? 'var(--red)' : spentPct > 70 ? 'var(--orange)' : 'var(--green)';

  const todayTotal = financeState.todaySpending.reduce((s, e) => s + e.amount, 0);

  container.innerHTML = `
    <div class="finance-view">
      <!-- Budget Overview -->
      <div class="finance-budget-card">
        <div class="finance-budget-hero">
          <div class="finance-daily-amount ${(b?.daily_allowance || 0) < 0 ? 'negative' : ''}">${dailyStr}</div>
          <div class="finance-daily-label">per day</div>
          <div class="finance-cycle-info">${b?.cycle_start && b?.cycle_end ? `Pay cycle: ${new Date(b.cycle_start+'T00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})} → ${new Date(b.cycle_end+'T00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}` : `Pay day: ${s.pay_day || 25}th`}</div>
          <div class="finance-calc-row">
            <span class="finance-calc-time">Last calculated: ${calcTime}</span>
            <button class="btn-doc-action" onclick="recalcBudget()">🔄 Recalculate</button>
          </div>
        </div>
        <div class="finance-progress-bar">
          <div class="finance-progress-fill" style="width:${spentPct}%;background:${progressColor}"></div>
        </div>
        <div class="finance-progress-label">£${(b?.total_spent || 0).toFixed(2)} spent of £${totalBudget.toFixed(2)} available</div>
        <div class="finance-stats-row">
          <div class="finance-stat">
            <span class="finance-stat-value">£${(s.monthly_income || 0).toFixed(0)}</span>
            <span class="finance-stat-label">Income</span>
          </div>
          <div class="finance-stat">
            <span class="finance-stat-value">£${(b?.total_fixed || 0).toFixed(0)}</span>
            <span class="finance-stat-label">Fixed Costs</span>
          </div>
          <div class="finance-stat">
            <span class="finance-stat-value">£${(s.savings_target || 0).toFixed(0)}</span>
            <span class="finance-stat-label">Savings</span>
          </div>
          <div class="finance-stat">
            <span class="finance-stat-value">£${(b?.total_spent || 0).toFixed(2)}</span>
            <span class="finance-stat-label">Spent</span>
          </div>
          <div class="finance-stat">
            <span class="finance-stat-value">${b?.days_remaining || '--'}</span>
            <span class="finance-stat-label">Days Left</span>
          </div>
        </div>
        <div class="finance-settings-row">
          <button class="btn-doc-action" onclick="openFinanceSettings()">⚙️ Settings</button>
        </div>
      </div>

      <!-- Settings (hidden by default) -->
      <div class="finance-settings-panel" id="finance-settings-panel" style="display:none">
        <div class="finance-card">
          <h3>Finance Settings</h3>
          <div class="finance-form-row">
            <label>Monthly Income (£)</label>
            <input type="number" id="fin-income" class="modal-input" value="${s.monthly_income || 0}" step="0.01">
          </div>
          <div class="finance-form-row">
            <label>Savings Target (£)</label>
            <input type="number" id="fin-savings" class="modal-input" value="${s.savings_target || 0}" step="0.01">
          </div>
          <div class="finance-form-row">
            <label>Pay Day (day of month)</label>
            <input type="number" id="fin-payday" class="modal-input" value="${s.pay_day || 25}" min="1" max="31" step="1">
          </div>
          <div class="finance-form-actions">
            <button class="btn-move" onclick="saveFinanceSettings()">Save</button>
            <button class="btn-archive" onclick="document.getElementById('finance-settings-panel').style.display='none'">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Two Column -->
      <div class="finance-columns">
        <!-- Left: Spending -->
        <div class="finance-card">
          <h3>💳 Spending Log</h3>
          <div class="finance-quick-add">
            <input type="number" id="spend-amount" class="modal-input" placeholder="£ Amount" step="0.01" style="width:100px">
            <input type="text" id="spend-desc" class="modal-input" placeholder="Description" style="flex:1">
            <select id="spend-cat" class="modal-select" style="width:140px">
              ${SPENDING_CATEGORIES.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
            </select>
            <button class="btn-move" onclick="addSpending()">Add</button>
          </div>

          <div class="finance-today-header">
            <span>Today</span>
            <span class="finance-today-total">£${todayTotal.toFixed(2)}</span>
          </div>
          <div class="finance-spending-list" id="finance-today-list">
            ${renderSpendingItems(financeState.todaySpending)}
          </div>

          ${renderPreviousDaysSpending()}
        </div>

        <!-- Right: Recurring -->
        <div class="finance-card">
          <h3>🔄 Recurring Payments</h3>
          <div class="finance-recurring-add">
            <button class="btn-doc-action" onclick="showRecurringForm()">+ Add Payment</button>
          </div>
          <div id="recurring-form-area"></div>
          <div class="finance-recurring-list" id="finance-recurring-list">
            ${renderRecurringItems()}
          </div>
          <div class="finance-recurring-total">
            Monthly Total: £${financeState.recurring.reduce((s, r) => s + r.amount, 0).toFixed(2)}
          </div>
        </div>
      </div>

      <!-- Work Expenses -->
      <div class="finance-card finance-full-width">
        <div class="finance-expenses-header">
          <h3>💼 Work Expenses</h3>
          <div class="finance-expenses-actions">
            <button class="btn-doc-action" onclick="showExpenseForm()">+ Add Expense</button>
            <button class="btn-doc-action" onclick="exportExpenses()">📥 Export CSV</button>
          </div>
        </div>
        <div class="finance-expense-filters">
          <button class="finance-filter-tab ${financeState.expenseFilter === 'all' ? 'active' : ''}" onclick="filterExpenses('all')">All</button>
          <button class="finance-filter-tab ${financeState.expenseFilter === 'pending' ? 'active' : ''}" onclick="filterExpenses('pending')">Pending</button>
          <button class="finance-filter-tab ${financeState.expenseFilter === 'submitted' ? 'active' : ''}" onclick="filterExpenses('submitted')">Submitted</button>
          <button class="finance-filter-tab ${financeState.expenseFilter === 'reimbursed' ? 'active' : ''}" onclick="filterExpenses('reimbursed')">Reimbursed</button>
        </div>
        <div id="expense-form-area"></div>
        <div class="finance-expenses-table" id="finance-expenses-table">
          ${renderExpensesTable()}
        </div>
      </div>
    </div>
  `;
}

function renderSpendingItems(items) {
  if (!items.length) return '<div class="finance-empty">No spending recorded</div>';
  return items.map(item => `
    <div class="finance-spending-item">
      <div class="finance-spending-info">
        ${getCategoryBadge(item.category)}
        <span class="finance-spending-desc">${escapeHtml(item.description) || 'No description'}</span>
      </div>
      <div class="finance-spending-right">
        <span class="finance-spending-amount">£${item.amount.toFixed(2)}</span>
        <button class="finance-delete-btn" onclick="deleteSpending(${item.id})" title="Delete">×</button>
      </div>
    </div>
  `).join('');
}

function renderPreviousDaysSpending() {
  // Group month spending by date, excluding today
  const today = new Date().toISOString().slice(0, 10);
  const byDate = {};
  for (const item of financeState.monthSpending) {
    if (item.date === today) continue;
    if (!byDate[item.date]) byDate[item.date] = [];
    byDate[item.date].push(item);
  }
  const dates = Object.keys(byDate).sort().reverse();
  if (!dates.length) return '';

  return dates.map(date => {
    const items = byDate[date];
    const total = items.reduce((s, i) => s + i.amount, 0);
    const d = new Date(date + 'T12:00:00');
    const label = d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
    return `
      <details class="finance-day-group">
        <summary class="finance-day-summary">
          <span>${label}</span>
          <span>£${total.toFixed(2)}</span>
        </summary>
        <div class="finance-spending-list">
          ${renderSpendingItems(items)}
        </div>
      </details>
    `;
  }).join('');
}

function renderRecurringItems() {
  if (!financeState.recurring.length) return '<div class="finance-empty">No recurring payments</div>';
  const today = new Date().getDate();
  return financeState.recurring.map(r => {
    const isPast = r.day_of_month && r.day_of_month <= today;
    return `
      <div class="finance-recurring-item ${isPast ? 'paid' : 'upcoming'}">
        <div class="finance-recurring-info">
          <span class="finance-recurring-name">${escapeHtml(r.name)}</span>
          <span class="finance-recurring-day">${r.day_of_month ? `Day ${r.day_of_month}` : '—'}</span>
          ${r.category ? getCategoryBadge(r.category) : ''}
        </div>
        <div class="finance-recurring-right">
          <span class="finance-recurring-amount">£${r.amount.toFixed(2)}</span>
          <span class="finance-recurring-status">${isPast ? '✅' : '⏳'}</span>
          <div class="finance-recurring-menu-wrap">
            <button class="finance-menu-btn" onclick="toggleRecurringMenu(event, ${r.id})">⋮</button>
            <div class="finance-menu-dropdown" id="recurring-menu-${r.id}" style="display:none">
              <button onclick="editRecurring(${r.id})">✏️ Edit</button>
              <button onclick="deleteRecurring(${r.id})">🗑 Delete</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderExpensesTable() {
  let items = financeState.expenses;
  if (financeState.expenseFilter !== 'all') {
    items = items.filter(e => e.status === financeState.expenseFilter);
  }
  if (!items.length) return '<div class="finance-empty">No expenses</div>';

  const statusColors = { pending: 'var(--orange)', submitted: 'var(--blue)', reimbursed: 'var(--green)' };
  const nextStatus = { pending: 'submitted', submitted: 'reimbursed', reimbursed: 'pending' };

  return `<table class="finance-table">
    <thead><tr><th>Date</th><th>Amount</th><th>Description</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>
      ${items.map(e => `<tr>
        <td>${e.date}</td>
        <td>£${e.amount.toFixed(2)}</td>
        <td>${escapeHtml(e.description) || '—'}</td>
        <td>${escapeHtml(e.category) || '—'}</td>
        <td><span class="finance-status-badge" style="background:${statusColors[e.status] || statusColors.pending}20;color:${statusColors[e.status] || statusColors.pending};cursor:pointer" onclick="cycleExpenseStatus(${e.id},'${nextStatus[e.status] || 'pending'}')">${e.status}</span></td>
        <td><button class="finance-delete-btn" onclick="deleteExpense(${e.id})">🗑</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// Finance Actions

async function recalcBudget() {
  const b = await fetchJSON('/api/finance/budget');
  financeState.budget = b;
  // Also reload settings
  financeState.settings = await fetchJSON('/api/finance/settings');
  renderFinanceContent(document.getElementById('main-content'));
}

function openFinanceSettings() {
  const panel = document.getElementById('finance-settings-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function saveFinanceSettings() {
  const income = parseFloat(document.getElementById('fin-income').value) || 0;
  const savings = parseFloat(document.getElementById('fin-savings').value) || 0;
  const payDay = parseInt(document.getElementById('fin-payday').value) || 25;
  await fetch('/api/finance/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthly_income: income, savings_target: savings, pay_day: payDay })
  });
  document.getElementById('finance-settings-panel').style.display = 'none';
  await recalcBudget();
}

async function addSpending() {
  const amount = parseFloat(document.getElementById('spend-amount').value);
  const desc = document.getElementById('spend-desc').value.trim();
  const cat = document.getElementById('spend-cat').value;
  if (!amount || amount <= 0) return;

  await fetch('/api/finance/spending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), amount, description: desc, category: cat })
  });

  document.getElementById('spend-amount').value = '';
  document.getElementById('spend-desc').value = '';
  await refreshFinanceSpending();
}

async function deleteSpending(id) {
  await fetch(`/api/finance/spending/${id}`, { method: 'DELETE' });
  await refreshFinanceSpending();
}

async function refreshFinanceSpending() {
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [todaySpending, monthSpending] = await Promise.all([
    fetchJSON('/api/finance/spending/today'),
    fetchJSON(`/api/finance/spending?month=${monthStr}`)
  ]);
  financeState.todaySpending = todaySpending || [];
  financeState.monthSpending = monthSpending || [];
  renderFinanceContent(document.getElementById('main-content'));
}

function showRecurringForm(existing) {
  const area = document.getElementById('recurring-form-area');
  if (!area) return;
  const r = existing || {};
  area.innerHTML = `
    <div class="finance-inline-form">
      <input type="text" id="rec-name" class="modal-input" placeholder="Name" value="${escapeHtml(r.name || '')}" style="flex:1">
      <input type="number" id="rec-amount" class="modal-input" placeholder="£" step="0.01" value="${r.amount || ''}" style="width:90px">
      <input type="number" id="rec-day" class="modal-input" placeholder="Day" min="1" max="31" value="${r.day_of_month || ''}" style="width:70px">
      <select id="rec-cat" class="modal-select" style="width:130px">
        <option value="">Category</option>
        ${SPENDING_CATEGORIES.map(c => `<option value="${c.value}" ${r.category === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
      <button class="btn-move" onclick="saveRecurring(${r.id || 'null'})">${r.id ? 'Update' : 'Add'}</button>
      <button class="btn-archive" onclick="document.getElementById('recurring-form-area').innerHTML=''">Cancel</button>
    </div>
  `;
}

async function saveRecurring(id) {
  const name = document.getElementById('rec-name').value.trim();
  const amount = parseFloat(document.getElementById('rec-amount').value);
  const day = parseInt(document.getElementById('rec-day').value) || null;
  const cat = document.getElementById('rec-cat').value || null;
  if (!name || !amount) return;

  if (id) {
    await fetch(`/api/finance/recurring/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, amount, day_of_month: day, category: cat })
    });
  } else {
    await fetch('/api/finance/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, amount, day_of_month: day, category: cat })
    });
  }
  financeState.recurring = await fetchJSON('/api/finance/recurring') || [];
  renderFinanceContent(document.getElementById('main-content'));
}

function toggleRecurringMenu(e, id) {
  e.stopPropagation();
  // Close all other menus
  document.querySelectorAll('.finance-menu-dropdown').forEach(el => {
    if (el.id !== `recurring-menu-${id}`) el.style.display = 'none';
  });
  const menu = document.getElementById(`recurring-menu-${id}`);
  menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function editRecurring(id) {
  const r = financeState.recurring.find(x => x.id === id);
  if (r) showRecurringForm(r);
}

async function deleteRecurring(id) {
  await fetch(`/api/finance/recurring/${id}`, { method: 'DELETE' });
  financeState.recurring = await fetchJSON('/api/finance/recurring') || [];
  renderFinanceContent(document.getElementById('main-content'));
}

function showExpenseForm() {
  const area = document.getElementById('expense-form-area');
  if (!area) return;
  area.innerHTML = `
    <div class="finance-inline-form" style="margin-bottom:1rem">
      <input type="date" id="exp-date" class="modal-input" value="${new Date().toISOString().slice(0, 10)}" style="width:140px">
      <input type="number" id="exp-amount" class="modal-input" placeholder="£" step="0.01" style="width:90px">
      <input type="text" id="exp-desc" class="modal-input" placeholder="Description" style="flex:1">
      <select id="exp-cat" class="modal-select" style="width:120px">
        ${EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
      <button class="btn-move" onclick="addExpense()">Add</button>
      <button class="btn-archive" onclick="document.getElementById('expense-form-area').innerHTML=''">Cancel</button>
    </div>
  `;
}

async function addExpense() {
  const date = document.getElementById('exp-date').value;
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const desc = document.getElementById('exp-desc').value.trim();
  const cat = document.getElementById('exp-cat').value;
  if (!amount) return;

  await fetch('/api/finance/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, amount, description: desc, category: cat })
  });
  financeState.expenses = await fetchJSON('/api/finance/expenses') || [];
  renderFinanceContent(document.getElementById('main-content'));
}

async function cycleExpenseStatus(id, newStatus) {
  await fetch(`/api/finance/expenses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  });
  financeState.expenses = await fetchJSON('/api/finance/expenses') || [];
  document.getElementById('finance-expenses-table').innerHTML = renderExpensesTable();
}

async function deleteExpense(id) {
  await fetch(`/api/finance/expenses/${id}`, { method: 'DELETE' });
  financeState.expenses = await fetchJSON('/api/finance/expenses') || [];
  document.getElementById('finance-expenses-table').innerHTML = renderExpensesTable();
}

function filterExpenses(filter) {
  financeState.expenseFilter = filter;
  renderFinanceContent(document.getElementById('main-content'));
}

function exportExpenses() {
  let items = financeState.expenses;
  if (financeState.expenseFilter !== 'all') {
    items = items.filter(e => e.status === financeState.expenseFilter);
  }
  const headers = ['Date', 'Amount', 'Description', 'Category', 'Status'];
  const rows = items.map(e => [e.date, e.amount.toFixed(2), `"${(e.description || '').replace(/"/g, '""')}"`, e.category || '', e.status]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `work-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Close recurring menus on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('.finance-menu-dropdown').forEach(el => el.style.display = 'none');
});
