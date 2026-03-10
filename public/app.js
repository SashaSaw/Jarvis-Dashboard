const REFRESH_INTERVAL = 30000;

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
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
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

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err);
    return null;
  }
}

// --- Render Functions ---

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
          ${e.project ? `<span>${e.project}</span>` : ''}
          ${e.session_id ? `<span>session: ${e.session_id.slice(0, 8)}</span>` : ''}
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
      <div class="session-project">${s.project || 'Unknown project'}</div>
      <div class="session-summary">${s.summary || 'Working...'}</div>
      <div class="session-time">Started ${timeAgo(s.started_at)}</div>
    </div>
  `).join('');
}

function renderProjects(data) {
  const el = document.getElementById('projects-content');

  if (!data || data.error) {
    el.innerHTML = `<div class="empty-state">${data?.error || 'Failed to load Trello boards'}</div>`;
    return;
  }

  el.innerHTML = data.boards.map(board => `
    <div class="project-board">
      <div class="project-name">
        ${board.name}
        <span class="count">${board.totalCards} cards</span>
      </div>
      ${board.error ? `<div class="empty-state">${board.error}</div>` : `
        <div class="trello-lists">
          ${board.lists.filter(l => l.cards.length > 0).map(l => `
            <div class="trello-list">
              <div class="trello-list-name">${l.name}</div>
              <div class="trello-list-count">${l.cards.length}</div>
            </div>
          `).join('')}
        </div>
      `}
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
  const [stats, events, sessions, trello, calendar] = await Promise.all([
    fetchJSON('/api/events/stats'),
    fetchJSON('/api/events?limit=50'),
    fetchJSON('/api/sessions/active'),
    fetchJSON('/api/trello'),
    fetchJSON('/api/calendar?days=7')
  ]);

  renderStats(stats);
  renderFeed(events);
  renderSessions(sessions);
  renderProjects(trello);
  renderCalendar(calendar);

  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('last-update').textContent = now;
  document.getElementById('server-time').textContent = now;
}

// --- Init ---
refreshAll();
setInterval(refreshAll, REFRESH_INTERVAL);
