const express = require('express');
const path = require('path');
const fs = require('fs');
const { insertEvent, getEvents, getStats, getActiveSessions, upsertAgentStatus, getAgentStatus, insertTask, getTasks, getTasksByStatuses, getTaskById, updateTask, deleteTask, moveTask, insertSchedule, getScheduleByDate, getScheduleByRange, getScheduleById, updateSchedule, deleteSchedule, insertDocument, getDocuments, getDocumentById, updateDocument, deleteDocument, insertLogEntry, getLogEntries, getLogStats, getLogTopActions, getLogTotalCount, getLogTodayCount, getLogDailyActivity, getLogTopActionsAll, logDb, insertProject, getProjects, getProjectById, updateProject, archiveProject, deleteProjectPermanent, deleteProjectSections, deleteProjectFeatures, deleteProjectTags, deleteProjectFeedback, insertSection, getSectionsByProject, getSectionById, updateSection, deleteSection, insertFeature, getFeaturesByProject, getFeatureById, updateFeature, deleteFeature, insertProjectTag, getTagsByProject, getProjectTagById, updateProjectTag, deleteProjectTag, insertFeedback, getFeedbackByProject, getFeedbackById, updateFeedback, deleteFeedback, getChatMessages, getChatMessagesAfter, insertChatMessage, getChatPending, markChatAnswered, touchProjectActivity, getActiveAlerts, getAlertById, dismissAlert, upsertAlert, deleteAlertByTypeEntity, getProjectsForStaleness, insertGoal, getGoalsByDate, getGoalById, updateGoal, deleteGoal, insertGoalStep, getStepsByGoal, updateGoalStep, deleteGoalStep, deleteStepsByGoal, getGoalsAfter, insertTaskStep, getStepsByTask, getTaskStepById, updateTaskStep, deleteTaskStep, deleteStepsByTask, getTaskStepCounts, insertApiUsage, getApiUsage, upsertEvaluation, getEvaluationByProject, updateProjectPipelineStage, getPipelineProjects, insertConcept, getConceptsByProject, getConceptById, updateConcept, deleteConcept, getLearningStats } = require('./db');
const { getAllBoards, createCard, moveCard, archiveCard, updateCard, getBoardLabels } = require('./integrations/trello');
const { getTodayEvents, getUpcomingEvents } = require('./integrations/calendar');

const app = express();
const PORT = process.env.PORT || 3147;

// --- Sensitive Data Redaction ---
const REDACT_PATTERNS = [
  // API keys and tokens (long hex/alphanumeric strings)
  { pattern: /ATTA[0-9a-f]{60,}/gi, replacement: '[REDACTED_TOKEN]' },
  // Trello API key
  { pattern: /\b[0-9a-f]{32}\b/g, replacement: '[REDACTED_KEY]' },
  // Telegram bot tokens
  { pattern: /\b\d{9,10}:AA[A-Za-z0-9_-]{30,}\b/g, replacement: '[REDACTED_BOT_TOKEN]' },
  // Email passwords / GOG keyring
  { pattern: /GOG_KEYRING_PASSWORD[=:]\s*\S+/gi, replacement: 'GOG_KEYRING_PASSWORD=[REDACTED]' },
  { pattern: /Brandy\d{4}/gi, replacement: '[REDACTED_PASSWORD]' },
  // Generic password patterns
  { pattern: /password[=:"'\s]+[^\s"',}{]{4,}/gi, replacement: 'password=[REDACTED]' },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/gi, replacement: 'Bearer [REDACTED]' },
  // SSH private key content
  { pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
];

function redactSensitive(str) {
  if (!str || typeof str !== 'string') return str;
  let result = str;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function redactObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      result[key] = redactSensitive(val);
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactObject(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Auto-logging middleware for all mutations ---
const AUTO_LOG_SKIP = ['/api/log', '/api/agent/', '/api/events'];
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (AUTO_LOG_SKIP.some(p => req.path.startsWith(p))) return next();

  const startTime = Date.now();

  res.on('finish', () => {
    try {
      const duration = Date.now() - startTime;
      const action = req.method === 'POST' ? 'create' : req.method === 'PUT' ? 'update' : 'delete';
      const resource = req.path.replace(/^\/api\//, '').replace(/\/\d+/g, '/:id');
      const label = req.body?.title || req.body?.name || '';
      const description = `${req.method} ${req.path}${label ? ` — "${label}"` : ''}`;

      insertLogEntry.run({
        agent: req.headers['x-agent'] || 'system',
        action: `${action}_${resource.split('/')[0]}`,
        description: description,
        reason: null,
        status: res.statusCode < 400 ? 'completed' : 'failed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        metadata: null
      });
    } catch(e) { /* don't break the response if logging fails */ }
  });
  next();
});

// --- Webhook Receiver ---

app.post('/api/hooks', (req, res) => {
  try {
    const body = redactObject(req.body);
    const event = {
      event_type: body.event || 'unknown',
      session_id: body.session_id || null,
      project: body.project || null,
      summary: redactSensitive(body.summary) || null,
      files_changed: body.files_changed ? redactSensitive(JSON.stringify(body.files_changed)) : null,
      metadata: body.metadata ? redactSensitive(JSON.stringify(body.metadata)) : null,
      created_at: body.timestamp || new Date().toISOString()
    };

    insertEvent.run(event);
    console.log(`[HOOK] ${event.event_type}: ${event.summary || 'no summary'}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[HOOK ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Events API ---

app.get('/api/events', (req, res) => {
  try {
    const { type, since, limit } = req.query;
    const events = getEvents.all({
      type: type || null,
      since: since || null,
      limit: parseInt(limit) || 50
    });
    for (const e of events) {
      if (e.files_changed) try { e.files_changed = JSON.parse(e.files_changed); } catch {}
      if (e.metadata) try { e.metadata = JSON.parse(e.metadata); } catch {}
    }
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events/stats', (req, res) => {
  try {
    const stats = getStats.get();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/active', (req, res) => {
  try {
    const sessions = getActiveSessions.all();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Trello API ---

app.get('/api/trello', async (req, res) => {
  try {
    const data = await getAllBoards();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trello/cards', async (req, res) => {
  try {
    const { listId, name, desc } = req.body;
    if (!listId || !name) return res.status(400).json({ error: 'listId and name required' });
    const card = await createCard(listId, name, desc);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trello/cards/:cardId/move', async (req, res) => {
  try {
    const { listId } = req.body;
    if (!listId) return res.status(400).json({ error: 'listId required' });
    const card = await moveCard(req.params.cardId, listId);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trello/cards/:cardId', async (req, res) => {
  try {
    const card = await updateCard(req.params.cardId, req.body);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trello/boards/:boardId/labels', async (req, res) => {
  try {
    const labels = await getBoardLabels(req.params.boardId);
    res.json(labels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/trello/cards/:cardId', async (req, res) => {
  try {
    const card = await archiveCard(req.params.cardId);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Agent Status (SQLite-persisted) ---

function saveAgentStatus(name, body) {
  const updatedAt = new Date().toISOString();
  const statusData = { ...body, updated_at: updatedAt };
  upsertAgentStatus.run({
    agent_name: name,
    data: JSON.stringify(statusData),
    updated_at: updatedAt
  });
  return statusData;
}

function loadAgentStatus(name) {
  const row = getAgentStatus.get({ agent_name: name });
  if (!row) return { error: 'No status yet' };
  try { return JSON.parse(row.data); } catch { return { error: 'Corrupt status data' }; }
}

app.post('/api/agent/:name/status', (req, res) => {
  try {
    saveAgentStatus(req.params.name, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agent/:name/status', (req, res) => {
  try {
    res.json(loadAgentStatus(req.params.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backwards compat
app.post('/api/jarvis/status', (req, res) => {
  try {
    saveAgentStatus('jarvis', req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jarvis/status', (req, res) => {
  try {
    res.json(loadAgentStatus('jarvis'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Tasks API ---

app.post('/api/tasks', (req, res) => {
  try {
    const { title, description, status, priority, category } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = insertTask.run({
      title,
      description: description || null,
      status: status || 'inbox',
      priority: priority || 'normal',
      category: category || null
    });
    const task = getTaskById.get({ id: result.lastInsertRowid });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', (req, res) => {
  try {
    const { status, category, kanban } = req.query;
    let tasks;
    if (kanban === '1') {
      tasks = getTasksByStatuses.all();
    } else {
      tasks = getTasks.all({
        status: status || null,
        category: category || null
      });
    }
    // Attach step counts
    const stepCounts = getTaskStepCounts.all();
    const stepMap = {};
    stepCounts.forEach(r => { stepMap[r.task_id] = r; });
    tasks = tasks.map(t => ({
      ...t,
      total_steps: stepMap[t.id]?.total_steps || 0,
      completed_steps: stepMap[t.id]?.completed_steps || 0
    }));
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id', (req, res) => {
  try {
    const task = getTaskById.get({ id: parseInt(req.params.id) });
    if (!task) return res.status(404).json({ error: 'not found' });
    // Attach step counts
    const steps = getStepsByTask.all({ task_id: task.id });
    task.total_steps = steps.length;
    task.completed_steps = steps.filter(s => s.status === 'done').length;
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', (req, res) => {
  try {
    const { title, description, status, priority, category } = req.body;
    updateTask.run({
      id: parseInt(req.params.id),
      title: title !== undefined ? title : null,
      description: description !== undefined ? description : null,
      status: status !== undefined ? status : null,
      priority: priority !== undefined ? priority : null,
      category: category !== undefined ? category : null
    });
    const task = getTaskById.get({ id: parseInt(req.params.id) });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  try {
    deleteTask.run({ id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id/move', (req, res) => {
  try {
    const { status, completion_summary } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    moveTask.run({ id: parseInt(req.params.id), status, completion_summary: completion_summary || null });
    const task = getTaskById.get({ id: parseInt(req.params.id) });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Task Steps API ---

app.post('/api/tasks/:id/steps', (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { steps } = req.body;
    if (!steps || !Array.isArray(steps)) return res.status(400).json({ error: 'steps array required' });
    const inserted = steps.map((s, i) => {
      const result = insertTaskStep.run({ task_id: taskId, title: s.title, description: s.description || null, sort_order: s.sort_order ?? i });
      return getTaskStepById.get({ id: result.lastInsertRowid });
    });
    res.json(inserted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id/steps', (req, res) => {
  try {
    const steps = getStepsByTask.all({ task_id: parseInt(req.params.id) });
    res.json(steps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id/steps/:stepId', (req, res) => {
  try {
    const { title, status, description, sort_order } = req.body;
    updateTaskStep.run({
      id: parseInt(req.params.stepId),
      title: title !== undefined ? title : null,
      description: description !== undefined ? description : null,
      status: status !== undefined ? status : null,
      sort_order: sort_order !== undefined ? sort_order : null
    });
    const step = getTaskStepById.get({ id: parseInt(req.params.stepId) });
    res.json(step);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id/steps/:stepId', (req, res) => {
  try {
    deleteTaskStep.run({ id: parseInt(req.params.stepId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Schedule API ---

app.post('/api/schedule', (req, res) => {
  try {
    const { title, description, start_time, end_time, date, color, task_id, recurring } = req.body;
    if (!title || !start_time || !end_time || !date) {
      return res.status(400).json({ error: 'title, start_time, end_time, and date required' });
    }
    const result = insertSchedule.run({
      title,
      description: description || null,
      start_time,
      end_time,
      date,
      color: color || '#7c6bf0',
      task_id: task_id || null,
      recurring: recurring || null
    });
    const entry = getScheduleById.get({ id: result.lastInsertRowid });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule', (req, res) => {
  try {
    const { date, from, to } = req.query;
    let entries;
    if (date) {
      entries = getScheduleByDate.all({ date });
    } else if (from && to) {
      entries = getScheduleByRange.all({ from, to });
    } else {
      // Default: today
      const today = new Date().toISOString().slice(0, 10);
      entries = getScheduleByDate.all({ date: today });
    }
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/schedule/:id', (req, res) => {
  try {
    const { title, description, start_time, end_time, date, color, task_id, recurring } = req.body;
    updateSchedule.run({
      id: parseInt(req.params.id),
      title: title !== undefined ? title : null,
      description: description !== undefined ? description : null,
      start_time: start_time !== undefined ? start_time : null,
      end_time: end_time !== undefined ? end_time : null,
      date: date !== undefined ? date : null,
      color: color !== undefined ? color : null,
      task_id: task_id !== undefined ? task_id : null,
      recurring: recurring !== undefined ? recurring : null
    });
    const entry = getScheduleById.get({ id: parseInt(req.params.id) });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/schedule/:id', (req, res) => {
  try {
    deleteSchedule.run({ id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Schedule Smart Scheduling ---

function timeToMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minsToTime(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function buildScheduleProposals(goals, existingItems, calEvents, date) {
  const WORK_START = 9 * 60;
  const WORK_END = 18 * 60;
  const BUFFER = 15;

  const occupied = [];

  for (const item of existingItems) {
    occupied.push([timeToMins(item.start_time), timeToMins(item.end_time)]);
  }

  for (const e of calEvents) {
    if (e.allDay) continue;
    const startRaw = e.start?.dateTime || e.start?.date || e.start;
    const endRaw = e.end?.dateTime || e.end?.date || e.end;
    if (!startRaw) continue;
    try {
      const startDt = new Date(startRaw);
      const endDt = endRaw ? new Date(endRaw) : new Date(startDt.getTime() + 3600000);
      const startL = new Date(startDt.toLocaleString('en-US', { timeZone: 'Europe/London' }));
      const endL = new Date(endDt.toLocaleString('en-US', { timeZone: 'Europe/London' }));
      occupied.push([startL.getHours() * 60 + startL.getMinutes(), endL.getHours() * 60 + endL.getMinutes()]);
    } catch (_) {}
  }

  occupied.sort((a, b) => a[0] - b[0]);

  const proposals = [];
  let cursor = WORK_START;

  for (const goal of goals) {
    const steps = (goal.steps || []).filter(s => s.status !== 'done' && s.status !== 'skipped');
    for (const step of steps) {
      const duration = step.estimated_minutes || 30;
      let start = cursor;
      let found = false;
      while (start + duration <= WORK_END) {
        const end = start + duration;
        const conflict = occupied.find(([os, oe]) => start < oe && end > os);
        if (!conflict) { found = true; break; }
        start = conflict[1] + BUFFER;
      }
      if (!found) continue;
      const endMins = start + duration;
      proposals.push({
        title: step.title,
        description: goal.title,
        date,
        start_time: minsToTime(start),
        end_time: minsToTime(endMins),
        category: 'goal-step',
        goal_id: goal.id,
        step_id: step.id,
        goal_title: goal.title,
        step_title: step.title,
        duration,
        color: '#10b981'
      });
      occupied.push([start, endMins + BUFFER]);
      occupied.sort((a, b) => a[0] - b[0]);
      cursor = endMins + BUFFER;
    }
  }

  return proposals;
}

app.post('/api/schedule/auto-generate', async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().slice(0, 10);
    const rawGoals = getGoalsByDate.all({ date });
    const goals = rawGoals.map(g => ({ ...g, steps: getStepsByGoal.all({ goal_id: g.id }) }));
    const existingItems = getScheduleByDate.all({ date });
    let calEvents = [];
    try { calEvents = getTodayEvents(); } catch (_) {}
    const proposals = buildScheduleProposals(goals, existingItems, calEvents, date);
    res.json({ date, proposals, goals_count: rawGoals.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schedule/confirm', (req, res) => {
  try {
    const { date, items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
    const saved = [];
    for (const item of items) {
      const result = insertSchedule.run({
        title: item.title,
        description: item.description || null,
        start_time: item.start_time,
        end_time: item.end_time,
        date: item.date || date,
        color: item.color || '#10b981',
        task_id: null,
        recurring: null
      });
      saved.push(getScheduleById.get({ id: result.lastInsertRowid }));
    }
    res.json({ saved, count: saved.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule/suggestions', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const rawGoals = getGoalsByDate.all({ date });
    const goals = rawGoals.map(g => ({ ...g, steps: getStepsByGoal.all({ goal_id: g.id }) }));
    const existingItems = getScheduleByDate.all({ date });
    let calEvents = [];
    try { calEvents = getTodayEvents(); } catch (_) {}
    const proposals = buildScheduleProposals(goals, existingItems, calEvents, date);
    res.json({ date, proposals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Documents API ---

app.post('/api/docs', (req, res) => {
  try {
    const { title, content, category } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = insertDocument.run({
      title: redactSensitive(title),
      content: redactSensitive(content) || '',
      category: category || null
    });
    const doc = getDocumentById.get({ id: result.lastInsertRowid });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/docs', (req, res) => {
  try {
    const docs = getDocuments.all();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/docs/:id', (req, res) => {
  try {
    const doc = getDocumentById.get({ id: parseInt(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/docs/:id', (req, res) => {
  try {
    const { title, content, category } = req.body;
    updateDocument.run({
      id: parseInt(req.params.id),
      title: title !== undefined ? title : null,
      content: content !== undefined ? content : null,
      category: category !== undefined ? category : null
    });
    const doc = getDocumentById.get({ id: parseInt(req.params.id) });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/docs/:id', (req, res) => {
  try {
    deleteDocument.run({ id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Action Log API ---

app.post('/api/log', (req, res) => {
  try {
    const { agent, action, description, reason, status, started_at, completed_at, duration_ms, metadata } = redactObject(req.body);
    if (!agent || !action) return res.status(400).json({ error: 'agent and action required' });
    const result = insertLogEntry.run({
      agent,
      action,
      description: redactSensitive(description) || null,
      reason: redactSensitive(reason) || null,
      status: status || 'completed',
      started_at: started_at || new Date().toISOString(),
      completed_at: completed_at || null,
      duration_ms: duration_ms || null,
      metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null
    });
    res.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/log', (req, res) => {
  try {
    const { agent, action, project, search, date_from, date_to, limit, offset } = req.query;
    const maxLimit = Math.min(parseInt(limit) || 100, 500);
    const off = parseInt(offset) || 0;

    const conditions = [];
    const params = [];

    if (agent) { conditions.push('agent = ?'); params.push(agent); }
    if (action) { conditions.push('action LIKE ?'); params.push(`%${action}%`); }
    if (project) { conditions.push('description LIKE ?'); params.push(`%${project}%`); }
    if (search) { conditions.push('(description LIKE ? OR action LIKE ? OR reason LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (date_from) { conditions.push('date(started_at) >= ?'); params.push(date_from); }
    if (date_to) { conditions.push('date(started_at) <= ?'); params.push(date_to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM action_log ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`;
    params.push(maxLimit, off);

    const entries = logDb.prepare(sql).all(...params);
    for (const e of entries) {
      if (e.metadata) try { e.metadata = JSON.parse(e.metadata); } catch {}
    }

    const countSql = `SELECT COUNT(*) as total FROM action_log ${where}`;
    const { total } = logDb.prepare(countSql).get(...params.slice(0, params.length - 2));

    res.json({ entries, total, offset: off, limit: maxLimit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/log/stats', (req, res) => {
  try {
    const agentStats = getLogStats.all();
    const topActions = getLogTopActionsAll.all();
    const dailyActivity = getLogDailyActivity.all();
    const { count: totalCount } = getLogTotalCount.get();
    const { count: todayCount } = getLogTodayCount.get();

    // Build per_agent map
    const per_agent = {};
    for (const a of agentStats) per_agent[a.agent] = { total: a.total, today: a.today, avg_duration_ms: a.avg_duration_ms };

    res.json({
      agents: agentStats,
      per_agent,
      per_action: topActions,
      daily_activity: dailyActivity,
      total_count: totalCount,
      today_count: todayCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Project Hub API ---

// Touch last_activity_at on any project mutation (sections, features, tags, feedback)
app.use('/api/projects/:id', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.params.id) {
    try { touchProjectActivity.run({ id: req.params.id }); } catch(e) {}
  }
  next();
});

// --- Alert Generation ---

function generateAlerts() {
  const projects = getProjectsForStaleness.all();
  const now = Date.now();
  for (const p of projects) {
    const lastActivity = p.last_activity_at ? new Date(p.last_activity_at).getTime() : 0;
    const daysSince = (now - lastActivity) / 86400000;

    if (daysSince >= 3) {
      const severity = daysSince >= 5 ? 'red' : 'amber';
      const days = Math.floor(daysSince);
      upsertAlert.run({
        type: 'stale_project',
        entity_id: p.id,
        entity_type: 'project',
        severity,
        message: `${p.icon || '📁'} ${p.name} has had no activity for ${days} day${days !== 1 ? 's' : ''}`
      });
    } else {
      // Project is active again — remove any stale alert
      try { deleteAlertByTypeEntity.run({ type: 'stale_project', entity_id: p.id }); } catch(e) {}
    }
  }
}

// Projects
app.get('/api/projects', (req, res) => {
  try {
    const projects = getProjects.all();
    // Attach feature summary for overview
    const enriched = projects.map(p => {
      const features = getFeaturesByProject.all({ project_id: p.id }).map(f => ({
        id: f.id, status: f.status, version_target: f.version_target
      }));
      return { ...p, features };
    });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const project = getProjectById.get({ id: req.params.id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const sections = getSectionsByProject.all({ project_id: req.params.id });
    const tags = getTagsByProject.all({ project_id: req.params.id });
    const features = getFeaturesByProject.all({ project_id: req.params.id });
    const feedback = getFeedbackByProject.all({ project_id: req.params.id });
    const concepts = getConceptsByProject.all({ project_id: req.params.id });
    res.json({ ...project, sections, tags, features, feedback, concepts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const { id, name, tagline, icon, status, platform, tech_stack, current_version, next_version, release_date, category, app_store_url, github_url, landing_url, trello_board_id, project_type } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    insertProject.run({
      id, name,
      tagline: tagline || null,
      icon: icon || null,
      status: status || 'active',
      platform: platform || null,
      tech_stack: tech_stack || null,
      current_version: current_version || null,
      next_version: next_version || null,
      release_date: release_date || null,
      category: category || null,
      app_store_url: app_store_url || null,
      github_url: github_url || null,
      landing_url: landing_url || null,
      trello_board_id: trello_board_id || null,
      project_type: project_type || 'product'
    });
    const project = getProjectById.get({ id });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const fields = ['name','tagline','icon','status','platform','tech_stack','current_version','next_version','release_date','category','app_store_url','github_url','landing_url','trello_board_id','project_type'];
    const params = { id: req.params.id };
    for (const f of fields) params[f] = req.body[f] !== undefined ? req.body[f] : null;
    updateProject.run(params);
    const project = getProjectById.get({ id: req.params.id });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archive a project (soft delete)
app.delete('/api/projects/:id', (req, res) => {
  try {
    archiveProject.run({ id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Permanently delete an archived project and all its data
app.delete('/api/projects/:id/permanent', (req, res) => {
  try {
    const project = getProjectById.get({ id: req.params.id });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.status !== 'archived') return res.status(400).json({ error: 'Only archived projects can be permanently deleted' });
    deleteProjectFeedback.run({ project_id: req.params.id });
    deleteProjectTags.run({ project_id: req.params.id });
    deleteProjectFeatures.run({ project_id: req.params.id });
    deleteProjectSections.run({ project_id: req.params.id });
    deleteProjectPermanent.run({ id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Project Sections
app.get('/api/projects/:id/sections', (req, res) => {
  try {
    const sections = getSectionsByProject.all({ project_id: req.params.id });
    res.json(sections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/sections', (req, res) => {
  try {
    const { section_type, title, content, sort_order } = req.body;
    if (!section_type) return res.status(400).json({ error: 'section_type required' });
    const result = insertSection.run({
      project_id: req.params.id,
      section_type,
      title: title || null,
      content: content || null,
      sort_order: sort_order || 0
    });
    const section = getSectionById.get({ id: result.lastInsertRowid });
    res.json(section);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/sections/:sectionId', (req, res) => {
  try {
    const { title, content, sort_order } = req.body;
    updateSection.run({
      id: parseInt(req.params.sectionId),
      title: title !== undefined ? title : null,
      content: content !== undefined ? content : null,
      sort_order: sort_order !== undefined ? sort_order : null
    });
    const section = getSectionById.get({ id: parseInt(req.params.sectionId) });
    res.json(section);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/sections/:sectionId', (req, res) => {
  try {
    deleteSection.run({ id: parseInt(req.params.sectionId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Learning Concepts
app.get('/api/projects/:id/concepts', (req, res) => {
  try {
    const concepts = getConceptsByProject.all({ project_id: req.params.id });
    res.json(concepts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/concepts', (req, res) => {
  try {
    const { tech_name, concept_title, explanation, question, answer_hint, difficulty, sort_order } = req.body;
    if (!tech_name || !concept_title || !explanation || !question) {
      return res.status(400).json({ error: 'tech_name, concept_title, explanation, question required' });
    }
    const result = insertConcept.run({
      project_id: req.params.id,
      tech_name,
      concept_title,
      explanation,
      question,
      answer_hint: answer_hint || null,
      difficulty: difficulty || 'beginner',
      sort_order: sort_order || 0
    });
    const concept = getConceptById.get({ id: result.lastInsertRowid });
    res.json(concept);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/concepts/:conceptId', (req, res) => {
  try {
    const { tech_name, concept_title, explanation, question, answer_hint, difficulty, status, sort_order } = req.body;
    updateConcept.run({
      id: parseInt(req.params.conceptId),
      tech_name: tech_name !== undefined ? tech_name : null,
      concept_title: concept_title !== undefined ? concept_title : null,
      explanation: explanation !== undefined ? explanation : null,
      question: question !== undefined ? question : null,
      answer_hint: answer_hint !== undefined ? answer_hint : null,
      difficulty: difficulty !== undefined ? difficulty : null,
      status: status !== undefined ? status : null,
      sort_order: sort_order !== undefined ? sort_order : null
    });
    const concept = getConceptById.get({ id: parseInt(req.params.conceptId) });
    res.json(concept);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/concepts/:conceptId', (req, res) => {
  try {
    deleteConcept.run({ id: parseInt(req.params.conceptId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/learning/stats', (req, res) => {
  try {
    const stats = getLearningStats.get();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Features
app.get('/api/projects/:id/features', (req, res) => {
  try {
    let features = getFeaturesByProject.all({ project_id: req.params.id });
    const { status, version, tag } = req.query;
    if (status) features = features.filter(f => f.status === status);
    if (version) features = features.filter(f => f.version_target === version);
    if (tag) features = features.filter(f => f.tags && f.tags.split(',').map(t=>t.trim()).includes(tag));
    res.json(features);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/features', (req, res) => {
  try {
    const { name, description, status, version_target, version_shipped, tags, priority, source, trello_card_id, prompt, testing } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    // Auto-promote: if both prompt and testing are provided, move from idea to defined
    let effectiveStatus = status || 'idea';
    if (effectiveStatus === 'idea' && prompt && testing) effectiveStatus = 'defined';
    const result = insertFeature.run({
      project_id: req.params.id,
      name,
      description: description || null,
      status: effectiveStatus,
      version_target: version_target || null,
      version_shipped: version_shipped || null,
      tags: tags || null,
      priority: priority || 'normal',
      source: source || null,
      trello_card_id: trello_card_id || null,
      prompt: prompt || null,
      testing: testing || null
    });
    const feature = getFeatureById.get({ id: result.lastInsertRowid });
    res.json(feature);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/features/:featureId', (req, res) => {
  try {
    const fields = ['name','description','status','version_target','version_shipped','tags','priority','source','trello_card_id','prompt','testing'];
    const existing = getFeatureById.get({ id: parseInt(req.params.featureId) });
    const params = { id: parseInt(req.params.featureId) };
    for (const f of fields) params[f] = req.body[f] !== undefined ? req.body[f] : (existing ? existing[f] : null);
    // Auto-promote: if both prompt and testing now exist and status is still idea, move to defined
    if (params.status === 'idea' && params.prompt && params.testing) params.status = 'defined';
    updateFeature.run(params);
    const feature = getFeatureById.get({ id: parseInt(req.params.featureId) });
    res.json(feature);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/features/:featureId', (req, res) => {
  try {
    deleteFeature.run({ id: parseInt(req.params.featureId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/features/:featureId/promote', async (req, res) => {
  try {
    const project = getProjectById.get({ id: req.params.id });
    if (!project || !project.trello_board_id) return res.status(400).json({ error: 'Project has no linked Trello board' });
    const feature = getFeatureById.get({ id: parseInt(req.params.featureId) });
    if (!feature) return res.status(404).json({ error: 'Feature not found' });

    // Find the "Doing" list on the board
    const boards = await getAllBoards();
    const board = boards.boards.find(b => b.id === project.trello_board_id);
    if (!board) return res.status(404).json({ error: 'Trello board not found' });
    const doingList = board.lists.find(l => l.name.toLowerCase().includes('doing') || l.name.toLowerCase().includes('in progress'));
    if (!doingList) return res.status(404).json({ error: 'No "Doing" list found on board' });

    const card = await createCard(doingList.id, feature.name, feature.description || '');
    updateFeature.run({
      id: feature.id,
      name: null, description: null, status: 'building', version_target: null,
      version_shipped: null, tags: null, priority: null, source: null,
      trello_card_id: card.id
    });
    const updated = getFeatureById.get({ id: feature.id });
    res.json({ feature: updated, card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Project Tags
app.get('/api/projects/:id/tags', (req, res) => {
  try {
    const tags = getTagsByProject.all({ project_id: req.params.id });
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/tags', (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = insertProjectTag.run({
      project_id: req.params.id,
      name,
      color: color || null,
      description: description || null
    });
    const tag = getProjectTagById.get({ id: result.lastInsertRowid });
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/tags/:tagId', (req, res) => {
  try {
    const { name, color, description } = req.body;
    updateProjectTag.run({
      id: parseInt(req.params.tagId),
      name: name !== undefined ? name : null,
      color: color !== undefined ? color : null,
      description: description !== undefined ? description : null
    });
    const tag = getProjectTagById.get({ id: parseInt(req.params.tagId) });
    res.json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/tags/:tagId', (req, res) => {
  try {
    deleteProjectTag.run({ id: parseInt(req.params.tagId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Feedback
app.get('/api/projects/:id/feedback', (req, res) => {
  try {
    const feedback = getFeedbackByProject.all({ project_id: req.params.id });
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/feedback', (req, res) => {
  try {
    const { source, content, sentiment, linked_feature_id } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const result = insertFeedback.run({
      project_id: req.params.id,
      source: source || null,
      content,
      sentiment: sentiment || null,
      linked_feature_id: linked_feature_id || null
    });
    const fb = getFeedbackById.get({ id: result.lastInsertRowid });
    res.json(fb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/feedback/:feedbackId', (req, res) => {
  try {
    const { source, content, sentiment, linked_feature_id } = req.body;
    updateFeedback.run({
      id: parseInt(req.params.feedbackId),
      source: source !== undefined ? source : null,
      content: content !== undefined ? content : null,
      sentiment: sentiment !== undefined ? sentiment : null,
      linked_feature_id: linked_feature_id !== undefined ? linked_feature_id : null
    });
    const fb = getFeedbackById.get({ id: parseInt(req.params.feedbackId) });
    res.json(fb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id/feedback/:feedbackId', (req, res) => {
  try {
    deleteFeedback.run({ id: parseInt(req.params.feedbackId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Alerts API ---

app.get('/api/alerts', (req, res) => {
  try {
    generateAlerts();
    const alerts = getActiveAlerts.all();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/:id/dismiss', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    dismissAlert.run({ id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Goals API ---

app.post('/api/goals', (req, res) => {
  try {
    const { date, title, goals } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });

    const created = [];
    if (Array.isArray(goals)) {
      goals.forEach((g, i) => {
        const r = insertGoal.run({ date, title: g.title, status: 'pending', sort_order: i });
        created.push(getGoalById.get({ id: r.lastInsertRowid }));
      });
    } else if (title) {
      const existing = getGoalsByDate.all({ date });
      const r = insertGoal.run({ date, title, status: 'pending', sort_order: existing.length });
      created.push(getGoalById.get({ id: r.lastInsertRowid }));
    } else {
      return res.status(400).json({ error: 'title or goals array required' });
    }
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/goals', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required' });
    const rawGoals = getGoalsByDate.all({ date });
    const goals = rawGoals.map(g => ({ ...g, steps: getStepsByGoal.all({ goal_id: g.id }) }));
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/goals/:id', (req, res) => {
  try {
    const goal = getGoalById.get({ id: req.params.id });
    if (!goal) return res.status(404).json({ error: 'not found' });
    const steps = getStepsByGoal.all({ goal_id: goal.id });
    res.json({ ...goal, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/goals/:id', (req, res) => {
  try {
    const goal = getGoalById.get({ id: req.params.id });
    if (!goal) return res.status(404).json({ error: 'not found' });
    const { title, status, sort_order } = req.body;
    updateGoal.run({ id: req.params.id, title: title || null, status: status || null, sort_order: sort_order != null ? sort_order : null });
    const updated = getGoalById.get({ id: req.params.id });
    const steps = getStepsByGoal.all({ goal_id: updated.id });
    res.json({ ...updated, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/goals/:id', (req, res) => {
  try {
    const goal = getGoalById.get({ id: req.params.id });
    if (!goal) return res.status(404).json({ error: 'not found' });
    deleteStepsByGoal.run({ goal_id: goal.id });
    deleteGoal.run({ id: goal.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/goals/:id/steps', (req, res) => {
  try {
    const goal = getGoalById.get({ id: req.params.id });
    if (!goal) return res.status(404).json({ error: 'goal not found' });
    const { steps } = req.body;
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps array required' });
    const existing = getStepsByGoal.all({ goal_id: goal.id });
    const created = [];
    steps.forEach((s, i) => {
      const r = insertGoalStep.run({
        goal_id: goal.id,
        title: s.title,
        description: s.description || null,
        status: 'pending',
        sort_order: existing.length + i,
        estimated_minutes: s.estimated_minutes || null
      });
      created.push({ id: r.lastInsertRowid, ...s, goal_id: goal.id, status: 'pending' });
    });
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/goals/:id/steps/:stepId', (req, res) => {
  try {
    const { title, description, status, sort_order, estimated_minutes } = req.body;
    updateGoalStep.run({
      id: req.params.stepId,
      title: title || null,
      description: description !== undefined ? description : null,
      status: status || null,
      sort_order: sort_order != null ? sort_order : null,
      estimated_minutes: estimated_minutes || null
    });
    // Auto-update goal status based on steps
    const allSteps = getStepsByGoal.all({ goal_id: req.params.id });
    if (allSteps.length > 0) {
      const allDone = allSteps.every(s => s.status === 'done' || s.status === 'skipped');
      const anyActive = allSteps.some(s => s.status === 'in_progress');
      const anyDone = allSteps.some(s => s.status === 'done');
      const newStatus = allDone ? 'completed' : anyActive ? 'active' : anyDone ? 'active' : 'pending';
      updateGoal.run({ id: req.params.id, title: null, status: newStatus, sort_order: null });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/goals/:id/steps/:stepId', (req, res) => {
  try {
    deleteGoalStep.run({ id: req.params.stepId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/goals/carry-forward', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayGoals = getGoalsByDate.all({ date: yesterday });
    const todayGoals = getGoalsByDate.all({ date: today });
    const carried = [];

    for (const g of yesterdayGoals) {
      if (g.status === 'completed') continue;
      const steps = getStepsByGoal.all({ goal_id: g.id });
      const r = insertGoal.run({ date: today, title: g.title, status: 'pending', sort_order: todayGoals.length + carried.length });
      const newGoalId = r.lastInsertRowid;
      const pendingSteps = steps.filter(s => s.status !== 'done' && s.status !== 'skipped');
      pendingSteps.forEach((s, i) => {
        insertGoalStep.run({ goal_id: newGoalId, title: s.title, description: s.description, status: 'pending', sort_order: i, estimated_minutes: s.estimated_minutes });
      });
      updateGoal.run({ id: g.id, title: null, status: 'carried_forward', sort_order: null });
      carried.push({ ...getGoalById.get({ id: newGoalId }), steps: getStepsByGoal.all({ goal_id: newGoalId }) });
    }

    res.json({ carried: carried.length, goals: carried });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Home API ---

app.get('/api/home', async (req, res) => {
  try {
    generateAlerts();

    const today = new Date().toISOString().slice(0, 10);

    // Schedule for today
    const schedule = getScheduleByDate.all({ date: today });

    // Agent statuses
    const agentNames = ['jarvis', 'klaus', 'emily'];
    const agents = agentNames.map(name => {
      const s = loadAgentStatus(name);
      return { name, ...s };
    });

    // Active alerts
    const alerts = getActiveAlerts.all();

    // Projects with staleness
    const allProjects = getProjects.all();
    const now = Date.now();
    const projects = allProjects.map(p => {
      const lastActivity = p.last_activity_at ? new Date(p.last_activity_at).getTime() : 0;
      const daysSince = (now - lastActivity) / 86400000;
      return {
        ...p,
        days_since_activity: Math.floor(daysSince),
        stale_level: daysSince >= 5 ? 'red' : daysSince >= 3 ? 'amber' : null
      };
    });

    // In-progress and todo tasks
    const tasks = getTasks.all({ status: null, category: null })
      .filter(t => ['todo', 'in_progress'].includes(t.status))
      .slice(0, 20);

    // Stats
    const allTasks = getTasks.all({ status: null, category: null });
    const stats = {
      projects_active: allProjects.filter(p => p.status === 'active').length,
      projects_paused: allProjects.filter(p => p.status === 'paused').length,
      projects_archived: allProjects.filter(p => p.status === 'archived').length,
      tasks_todo: allTasks.filter(t => t.status === 'todo').length,
      tasks_in_progress: allTasks.filter(t => t.status === 'in_progress').length,
      tasks_done: allTasks.filter(t => t.status === 'done').length,
      tasks_inbox: allTasks.filter(t => t.status === 'inbox').length,
      alerts_count: alerts.length
    };

    // Today's goals with steps
    const rawGoals = getGoalsByDate.all({ date: today });
    const goals = rawGoals.map(g => {
      const steps = getStepsByGoal.all({ goal_id: g.id });
      return { ...g, steps };
    });

    res.json({
      goals,
      schedule,
      agents,
      alerts,
      projects,
      tasks,
      stats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Agent Files API ---

const AGENT_WORKSPACES = {
  jarvis: '/home/sasha/.openclaw/workspace',
  klaus: '/home/sasha/.openclaw/agents/klaus/agent',
  emily: '/home/sasha/.openclaw/agents/emily/agent'
};

const AGENT_FILES = {
  jarvis: ['MEMORY.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'HEARTBEAT.md'],
  klaus: ['AGENTS.md'],
  emily: ['AGENTS.md']
};

// Whitelist: only allow these filenames (prevent path traversal)
const ALLOWED_FILES = new Set(['MEMORY.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'AGENTS.md', 'HEARTBEAT.md']);
const DAILY_NOTE_RE = /^memory\/\d{4}-\d{2}-\d{2}\.md$/;

function isAllowedFile(filename) {
  return ALLOWED_FILES.has(filename) || DAILY_NOTE_RE.test(filename);
}

app.get('/api/agent/:name/files', (req, res) => {
  try {
    const name = req.params.name.toLowerCase();
    const workspace = AGENT_WORKSPACES[name];
    if (!workspace) return res.status(404).json({ error: 'Unknown agent' });

    const staticFiles = (AGENT_FILES[name] || []).map(f => {
      const fullPath = path.join(workspace, f);
      let exists = false;
      try { exists = fs.existsSync(fullPath); } catch {}
      return { name: f, path: f, exists };
    });

    // Add daily notes for jarvis (today + yesterday)
    const dailyNotes = [];
    if (name === 'jarvis') {
      const memDir = path.join(workspace, 'memory');
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      for (const d of [today, yesterday]) {
        const dateStr = d.toISOString().slice(0, 10);
        const fileName = `memory/${dateStr}.md`;
        const fullPath = path.join(workspace, fileName);
        let exists = false;
        try { exists = fs.existsSync(fullPath); } catch {}
        dailyNotes.push({ name: `${dateStr}.md`, path: fileName, exists });
      }
    }

    res.json([...staticFiles, ...dailyNotes]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agent/:name/file', (req, res) => {
  try {
    const name = req.params.name.toLowerCase();
    const workspace = AGENT_WORKSPACES[name];
    if (!workspace) return res.status(404).json({ error: 'Unknown agent' });

    const filePath = req.query.path;
    if (!filePath || !isAllowedFile(filePath)) {
      return res.status(400).json({ error: 'File not allowed' });
    }

    // Extra safety: ensure no path traversal
    const resolved = path.resolve(workspace, filePath);
    if (!resolved.startsWith(workspace)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    if (!fs.existsSync(resolved)) {
      return res.json({ name: path.basename(filePath), content: null, exists: false, updated_at: null });
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    const stat = fs.statSync(resolved);
    res.json({
      name: path.basename(filePath),
      content,
      exists: true,
      updated_at: stat.mtime.toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agent/:name/activity', (req, res) => {
  try {
    const name = req.params.name.toLowerCase();
    const entries = getLogEntries.all({
      agent: name,
      since: null,
      limit: 20
    });
    for (const e of entries) {
      if (e.metadata) try { e.metadata = JSON.parse(e.metadata); } catch {}
    }
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Agent Capabilities API ---

const OPENCLAW_CONFIG_PATH = '/home/sasha/.openclaw/openclaw.json';
const WORKSPACE_SKILLS_DIR = '/home/sasha/.openclaw/workspace/skills';
const BUILTIN_SKILLS_DIR = '/home/sasha/.npm-global/lib/node_modules/openclaw/skills';

const KEY_SERVICE_MAP = {
  'TRELLO_API_KEY': 'Trello',
  'TRELLO_TOKEN': 'Trello',
  'GOG_ACCOUNT': 'Google Workspace',
  'GOG_KEYRING_PASSWORD': 'Google Workspace',
  'SCRAPECREATORS_API_KEY': 'ScrapeCreators',
  'ANTHROPIC_API_KEY': 'Anthropic'
};

const PASSWORD_KEYS = new Set(['GOG_KEYRING_PASSWORD', 'ANTHROPIC_API_KEY']);

function maskValue(key, value) {
  if (!value) return '****';
  if (PASSWORD_KEYS.has(key)) return '****';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

function getSkillDescription(skillDir) {
  try {
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) return null;
    const content = fs.readFileSync(skillMd, 'utf-8');
    const lines = content.split('\n').slice(0, 10);
    for (const line of lines) {
      const match = line.match(/^description:\s*['"]?(.+?)['"]?\s*$/);
      if (match) {
        let desc = match[1];
        // Trim trailing quotes
        if ((desc.startsWith("'") && desc.endsWith("'")) || (desc.startsWith('"') && desc.endsWith('"'))) {
          desc = desc.slice(1, -1);
        }
        return desc.length > 100 ? desc.slice(0, 100) + '...' : desc;
      }
    }
    return null;
  } catch { return null; }
}

function scanSkills(dir, location) {
  const skills = [];
  try {
    if (!fs.existsSync(dir)) return skills;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const desc = getSkillDescription(path.join(dir, entry.name));
      if (desc) {
        skills.push({ name: entry.name, description: desc, location });
      } else {
        skills.push({ name: entry.name, description: '', location });
      }
    }
  } catch {}
  return skills;
}

const AGENT_PERMISSIONS = {
  jarvis: {
    canSpawnSubagents: true,
    canAccessFiles: true,
    canExecuteCommands: true,
    canManageCron: true,
    canSendMessages: true
  },
  klaus: {
    canSpawnSubagents: false,
    canAccessFiles: true,
    canExecuteCommands: true,
    canManageCron: false,
    canSendMessages: false
  },
  emily: {
    canSpawnSubagents: false,
    canAccessFiles: true,
    canExecuteCommands: true,
    canManageCron: false,
    canSendMessages: false
  }
};

const AGENT_SKILL_FOCUS = {
  klaus: new Set(['coding-agent', 'github', 'gh-issues']),
  emily: new Set(['gog', 'himalaya'])
};

app.get('/api/agent/:name/capabilities', (req, res) => {
  try {
    const name = req.params.name.toLowerCase();
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));

    // Find agent config
    const agentList = config.agents?.list || [];
    const agentConf = agentList.find(a => a.id === name || a.name?.toLowerCase() === name);
    const defaults = config.agents?.defaults || {};

    const model = agentConf?.model?.primary || defaults.model?.primary || 'unknown';
    const toolsProfile = config.tools?.profile || 'default';
    const agentType = (agentConf?.id === 'main' || agentConf?.default) ? 'main' : 'subagent';
    const workspace = agentConf?.workspace || defaults.workspace || '';

    // Permissions
    const permissions = AGENT_PERMISSIONS[name] || AGENT_PERMISSIONS.jarvis;

    // Skills
    const workspaceSkills = scanSkills(WORKSPACE_SKILLS_DIR, 'workspace');
    const builtinSkills = scanSkills(BUILTIN_SKILLS_DIR, 'builtin');
    // Deduplicate: workspace overrides builtin
    const workspaceNames = new Set(workspaceSkills.map(s => s.name));
    const allSkills = [...workspaceSkills, ...builtinSkills.filter(s => !workspaceNames.has(s.name))];

    // For subagents, filter to their focus skills
    let skills = allSkills;
    const focusSet = AGENT_SKILL_FOCUS[name];
    if (focusSet) {
      skills = allSkills.filter(s => focusSet.has(s.name));
    }

    // API Keys
    const envVars = config.env || {};
    const apiKeys = Object.entries(envVars).map(([key, value]) => ({
      name: key,
      masked: maskValue(key, value),
      service: KEY_SERVICE_MAP[key] || 'Other'
    }));

    res.json({
      model,
      toolsProfile,
      permissions,
      skills,
      allSkillCount: allSkills.length,
      apiKeys,
      agentType,
      workspace
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Scheduled Deliverables ---

app.get('/api/scheduled-deliverables', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'data', 'scheduled-deliverables.json');
    if (!fs.existsSync(filePath)) {
      return res.json([]);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Calendar ---

app.get('/api/calendar', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const events = days <= 1 ? getTodayEvents() : getUpcomingEvents(days);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Heartbeat Status ---

app.get('/api/heartbeat-status', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
    const defaults = config.agents?.defaults || {};
    const hb = defaults.heartbeat || {};

    // Check if HEARTBEAT.md has real content (not just comments/headers/blanks)
    const hbPath = path.join(defaults.workspace || '/home/sasha/.openclaw/workspace', 'HEARTBEAT.md');
    let heartbeatContent = '';
    let isDormant = true;
    let checkItems = [];
    try {
      heartbeatContent = fs.readFileSync(hbPath, 'utf-8');
      const lines = heartbeatContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          isDormant = false;
          // Extract bullet points as check items
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            checkItems.push(trimmed.slice(2).trim());
          }
        }
      }
    } catch {}

    // Try to find last heartbeat from gateway logs
    let lastHeartbeat = null;
    let nextHeartbeat = null;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const logPath = `/tmp/openclaw/openclaw-${today}.log`;
      if (fs.existsSync(logPath)) {
        const { execSync } = require('child_process');
        const result = execSync(`grep -i "heartbeat" "${logPath}" | tail -5`, { encoding: 'utf-8', timeout: 3000 }).trim();
        const lines = result.split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          const match = lines[i].match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
          if (match) {
            lastHeartbeat = match[1];
            break;
          }
        }
      }
    } catch {}

    // Calculate next heartbeat from interval
    const interval = hb.every || '30m';
    const intervalMs = parseInterval(interval);
    if (lastHeartbeat && intervalMs) {
      const last = new Date(lastHeartbeat);
      if (!isNaN(last.getTime())) {
        nextHeartbeat = new Date(last.getTime() + intervalMs).toISOString();
      }
    }

    res.json({
      enabled: !!hb.every && hb.every !== '0m',
      dormant: isDormant,
      interval: hb.every || '30m',
      model: hb.model || defaults.model?.primary || 'unknown',
      lightContext: !!hb.lightContext,
      activeHours: hb.activeHours || null,
      target: hb.target || 'none',
      checkItems,
      lastHeartbeat,
      nextHeartbeat
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseInterval(str) {
  const match = str.match(/^(\d+)(m|h|s)$/);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2];
  if (unit === 's') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 3600 * 1000;
  return null;
}

// --- Dashboard ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Ideas ---
const { insertIdea, getIdeas, getActiveIdeas, getArchivedIdeas, getIdeaById, updateIdea, deleteIdeaPermanent } = require('./db');

app.get('/api/ideas', (req, res) => {
  try {
    const status = req.query.status;
    const ideas = status === 'archived' ? getArchivedIdeas.all() : status === 'active' ? getActiveIdeas.all() : getIdeas.all();
    res.json(ideas);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ideas', (req, res) => {
  try {
    const { title, description, tags, source, pain_point, how_it_works, why_it_works, feasibility, effort, revenue_model, competition, synergy } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = insertIdea.run({ title, description: description || null, tags: tags || null, source: source || null, pain_point: pain_point || null, how_it_works: how_it_works || null, why_it_works: why_it_works || null, feasibility: feasibility || null, effort: effort || null, revenue_model: revenue_model || null, competition: competition || null, synergy: synergy || null });
    res.json(getIdeaById.get({ id: result.lastInsertRowid }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/ideas/:id', (req, res) => {
  try {
    const fields = ['title','description','tags','source','status','project_id','pain_point','how_it_works','why_it_works','feasibility','effort','revenue_model','competition','synergy'];
    const params = { id: parseInt(req.params.id) };
    for (const f of fields) params[f] = req.body[f] !== undefined ? req.body[f] : null;
    updateIdea.run(params);
    res.json(getIdeaById.get({ id: parseInt(req.params.id) }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/ideas/:id', (req, res) => {
  try {
    deleteIdeaPermanent.run({ id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Promote idea to project
app.post('/api/ideas/:id/promote', (req, res) => {
  try {
    const idea = getIdeaById.get({ id: parseInt(req.params.id) });
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    const projectId = (req.body.project_id || idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)).replace(/-+$/, '');
    const result = insertProject.run({
      id: projectId,
      name: idea.title,
      tagline: idea.description || null,
      icon: req.body.icon || '💡',
      status: 'active',
      platform: req.body.platform || null,
      tech_stack: req.body.tech_stack || null,
      current_version: null, next_version: null, release_date: null,
      category: req.body.category || null,
      app_store_url: null, github_url: null, landing_url: null, trello_board_id: null, project_type: 'product'
    });
    updateIdea.run({ id: parseInt(req.params.id), title: null, description: null, tags: null, source: null, status: 'promoted', project_id: projectId });
    res.json({ ok: true, project_id: projectId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Finance API ---
const financeDb = require('./db').financeDb;

// Finance Settings
app.get('/api/finance/settings', (req, res) => {
  try {
    let row = financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get();
    if (!row) {
      financeDb.prepare('INSERT INTO finance_settings (id, monthly_income, savings_target, currency, updated_at) VALUES (1, 0, 0, ?, datetime(?))').run('£', 'now');
      row = financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get();
    }
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/finance/settings', (req, res) => {
  try {
    const { monthly_income, savings_target } = req.body;
    // Ensure row exists
    let row = financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get();
    if (!row) {
      financeDb.prepare('INSERT INTO finance_settings (id, monthly_income, savings_target, currency, updated_at) VALUES (1, 0, 0, ?, datetime(?))').run('£', 'now');
    }
    const { pay_day } = req.body;
    financeDb.prepare('UPDATE finance_settings SET monthly_income = COALESCE(?, monthly_income), savings_target = COALESCE(?, savings_target), pay_day = COALESCE(?, pay_day), updated_at = datetime(?) WHERE id = 1')
      .run(monthly_income !== undefined ? monthly_income : null, savings_target !== undefined ? savings_target : null, pay_day !== undefined ? pay_day : null, 'now');
    res.json(financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Recurring Payments
app.get('/api/finance/recurring', (req, res) => {
  try {
    const rows = financeDb.prepare('SELECT * FROM recurring_payments WHERE active = 1 ORDER BY day_of_month ASC').all();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/finance/recurring', (req, res) => {
  try {
    const { name, amount, day_of_month, category } = req.body;
    if (!name || amount === undefined) return res.status(400).json({ error: 'name and amount required' });
    const result = financeDb.prepare('INSERT INTO recurring_payments (name, amount, day_of_month, category) VALUES (?, ?, ?, ?)').run(name, amount, day_of_month || null, category || null);
    res.json(financeDb.prepare('SELECT * FROM recurring_payments WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/finance/recurring/:id', (req, res) => {
  try {
    const { name, amount, day_of_month, category, active } = req.body;
    financeDb.prepare('UPDATE recurring_payments SET name = COALESCE(?, name), amount = COALESCE(?, amount), day_of_month = COALESCE(?, day_of_month), category = COALESCE(?, category), active = COALESCE(?, active), updated_at = datetime(?) WHERE id = ?')
      .run(name || null, amount !== undefined ? amount : null, day_of_month !== undefined ? day_of_month : null, category !== undefined ? category : null, active !== undefined ? active : null, 'now', parseInt(req.params.id));
    res.json(financeDb.prepare('SELECT * FROM recurring_payments WHERE id = ?').get(parseInt(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/finance/recurring/:id', (req, res) => {
  try {
    financeDb.prepare('DELETE FROM recurring_payments WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Spending Log
app.get('/api/finance/spending/today', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = financeDb.prepare('SELECT * FROM spending_log WHERE date = ? ORDER BY created_at DESC').all(today);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/finance/spending', (req, res) => {
  try {
    const month = req.query.month; // YYYY-MM
    if (month) {
      const rows = financeDb.prepare("SELECT * FROM spending_log WHERE date LIKE ? ORDER BY date DESC, created_at DESC").all(month + '%');
      res.json(rows);
    } else {
      const rows = financeDb.prepare('SELECT * FROM spending_log ORDER BY date DESC, created_at DESC LIMIT 200').all();
      res.json(rows);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/finance/spending', (req, res) => {
  try {
    const { date, amount, description, category } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const d = date || new Date().toISOString().slice(0, 10);
    const result = financeDb.prepare('INSERT INTO spending_log (date, amount, description, category) VALUES (?, ?, ?, ?)').run(d, amount, description || null, category || null);
    res.json(financeDb.prepare('SELECT * FROM spending_log WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/finance/spending/:id', (req, res) => {
  try {
    financeDb.prepare('DELETE FROM spending_log WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Work Expenses
app.get('/api/finance/expenses', (req, res) => {
  try {
    const status = req.query.status;
    let rows;
    if (status) {
      rows = financeDb.prepare('SELECT * FROM work_expenses WHERE status = ? ORDER BY date DESC').all(status);
    } else {
      rows = financeDb.prepare('SELECT * FROM work_expenses ORDER BY date DESC').all();
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/finance/expenses', (req, res) => {
  try {
    const { date, amount, description, category, receipt_note } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const d = date || new Date().toISOString().slice(0, 10);
    const result = financeDb.prepare('INSERT INTO work_expenses (date, amount, description, category, receipt_note) VALUES (?, ?, ?, ?, ?)').run(d, amount, description || null, category || null, receipt_note || null);
    res.json(financeDb.prepare('SELECT * FROM work_expenses WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/finance/expenses/:id', (req, res) => {
  try {
    const { date, amount, description, category, status, receipt_note } = req.body;
    financeDb.prepare('UPDATE work_expenses SET date = COALESCE(?, date), amount = COALESCE(?, amount), description = COALESCE(?, description), category = COALESCE(?, category), status = COALESCE(?, status), receipt_note = COALESCE(?, receipt_note), updated_at = datetime(?) WHERE id = ?')
      .run(date || null, amount !== undefined ? amount : null, description !== undefined ? description : null, category !== undefined ? category : null, status || null, receipt_note !== undefined ? receipt_note : null, 'now', parseInt(req.params.id));
    res.json(financeDb.prepare('SELECT * FROM work_expenses WHERE id = ?').get(parseInt(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/finance/expenses/:id', (req, res) => {
  try {
    financeDb.prepare('DELETE FROM work_expenses WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/finance/expenses/export', (req, res) => {
  try {
    const { from, to } = req.query;
    let rows;
    if (from && to) {
      rows = financeDb.prepare('SELECT * FROM work_expenses WHERE date >= ? AND date <= ? ORDER BY date ASC').all(from, to);
    } else {
      rows = financeDb.prepare('SELECT * FROM work_expenses ORDER BY date ASC').all();
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Budget Calculator
app.get('/api/finance/budget', (req, res) => {
  try {
    let settings = financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get();
    if (!settings) {
      financeDb.prepare('INSERT INTO finance_settings (id, monthly_income, savings_target, currency, updated_at) VALUES (1, 0, 0, ?, datetime(?))').run('£', 'now');
      settings = financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get();
    }

    const now = new Date();
    const payDay = settings.pay_day || 25;
    const currentDay = now.getDate();

    // Calculate pay cycle: from last payday to next payday
    let cycleStart, cycleEnd;
    if (currentDay >= payDay) {
      // We're past this month's payday — cycle is this month's payday to next month's
      cycleStart = new Date(now.getFullYear(), now.getMonth(), payDay);
      cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, payDay);
    } else {
      // Before this month's payday — cycle is last month's payday to this month's
      cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, payDay);
      cycleEnd = new Date(now.getFullYear(), now.getMonth(), payDay);
    }
    const cycleStartStr = cycleStart.toISOString().slice(0, 10);
    const cycleEndStr = cycleEnd.toISOString().slice(0, 10);
    const totalDaysInCycle = Math.round((cycleEnd - cycleStart) / 86400000);
    const daysSoFar = Math.round((now - cycleStart) / 86400000);
    const daysRemaining = Math.max(1, totalDaysInCycle - daysSoFar);

    // Total fixed costs (active recurring)
    const recurring = financeDb.prepare('SELECT * FROM recurring_payments WHERE active = 1').all();
    const totalFixed = recurring.reduce((sum, r) => sum + r.amount, 0);

    // Total spent this pay cycle
    const spentRow = financeDb.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM spending_log WHERE date >= ? AND date < ?").get(cycleStartStr, cycleEndStr);
    const totalSpent = spentRow.total;

    const remaining = settings.monthly_income - totalFixed - settings.savings_target - totalSpent;
    const dailyAllowance = remaining / daysRemaining;
    const calculatedAt = now.toISOString();

    // Save snapshot
    const today = now.toISOString().slice(0, 10);
    financeDb.prepare('INSERT INTO budget_snapshots (date, daily_allowance, total_spent, total_fixed, remaining, days_remaining, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(today, dailyAllowance, totalSpent, totalFixed, remaining, daysRemaining, calculatedAt);

    res.json({
      daily_allowance: dailyAllowance,
      total_spent: totalSpent,
      total_fixed: totalFixed,
      remaining,
      days_remaining: daysRemaining,
      days_in_cycle: totalDaysInCycle,
      cycle_start: cycleStartStr,
      cycle_end: cycleEndStr,
      pay_day: payDay,
      savings_target: settings.savings_target,
      monthly_income: settings.monthly_income,
      calculated_at: calculatedAt
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/finance/budget/latest', (req, res) => {
  try {
    const row = financeDb.prepare('SELECT * FROM budget_snapshots ORDER BY calculated_at DESC LIMIT 1').get();
    if (!row) return res.json(null);
    // Also get settings for full context
    const settings = financeDb.prepare('SELECT * FROM finance_settings WHERE id = 1').get();
    res.json({
      daily_allowance: row.daily_allowance,
      total_spent: row.total_spent,
      total_fixed: row.total_fixed,
      remaining: row.remaining,
      days_remaining: row.days_remaining,
      savings_target: settings?.savings_target || 0,
      monthly_income: settings?.monthly_income || 0,
      calculated_at: row.calculated_at
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Chat SSE ---
const chatSSEClients = new Set();

app.get('/api/chat/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);
  chatSSEClients.add(res);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: {}\n\n`);
  }, 30000);

  req.on('close', () => {
    chatSSEClients.delete(res);
    clearInterval(heartbeat);
  });
});

function broadcastChatMessage(msg) {
  const data = JSON.stringify(msg);
  for (const client of chatSSEClients) {
    try { client.write(`event: message\ndata: ${data}\n\n`); } catch(e) {}
  }
}

// --- Chat Messages ---
app.get('/api/chat/messages', (req, res) => {
  try {
    const after = parseInt(req.query.after);
    if (after) {
      const messages = getChatMessagesAfter.all({ after });
      return res.json(messages);
    }
    const limit = parseInt(req.query.limit) || 50;
    const messages = getChatMessages.all({ limit });
    res.json(messages.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/chat/messages/pending', (req, res) => {
  try {
    const row = getChatPending.get();
    res.json({ pending: row.count > 0, count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/messages', (req, res) => {
  try {
    const { content, role } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const status = role === 'assistant' ? null : null;
    const result = insertChatMessage.run({ content, role: role || 'user', status });
    // If assistant message, mark pending user messages as answered
    if (role === 'assistant') {
      markChatAnswered.run();
    }
    const msg = { id: result.lastInsertRowid, content, role: role || 'user', status, created_at: new Date().toISOString() };
    broadcastChatMessage(msg);
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a message (from iOS app) — saves with pending status and triggers Jarvis
app.post('/api/chat/send', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const result = insertChatMessage.run({ content, role: 'user', status: 'pending' });
    const msg = { id: result.lastInsertRowid, content, role: 'user', created_at: new Date().toISOString(), status: 'pending' };
    broadcastChatMessage(msg);
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Workspace API ---

const WORKSPACE_ROOT = '/home/sasha/.openclaw/workspace';

function validateWorkspacePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  // Reject absolute paths and path traversal
  if (relPath.startsWith('/') || relPath.startsWith('~')) return null;
  if (relPath.split('/').some(seg => seg === '..')) return null;
  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) return null;
  return abs;
}

function buildDirTree(dir, relBase) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const children = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip hidden
    const relPath = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      children.push({ name: e.name, type: 'dir', path: relPath, children: buildDirTree(path.join(dir, e.name), relPath) });
    } else {
      children.push({ name: e.name, type: 'file', path: relPath });
    }
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

app.get('/api/workspace/tree', (req, res) => {
  try {
    if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    const tree = buildDirTree(WORKSPACE_ROOT, '');
    res.json({ name: 'workspace', type: 'dir', path: '', children: tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspace/file', (req, res) => {
  try {
    const abs = validateWorkspacePath(req.query.path);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File not found' });
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ path: req.query.path, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/workspace/file', (req, res) => {
  try {
    const abs = validateWorkspacePath(req.query.path);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    const content = req.body.content;
    if (content === undefined) return res.status(400).json({ error: 'content required' });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, path: req.query.path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Notification Badges ---

const { upsertTabVisit, getTabVisit, db: rawDb } = require('./db');

app.get('/api/notifications/badges', (req, res) => {
  try {
    const tabs = ['inbox', 'ideas', 'projects', 'docs', 'kanban', 'schedule', 'log', 'goals'];
    const result = {};

    for (const tab of tabs) {
      const visit = getTabVisit.get({ tab_name: tab });
      const since = visit ? visit.last_seen_at : '1970-01-01T00:00:00';

      let count = 0;
      if (tab === 'inbox') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'inbox' AND created_at > ?`).get(since).c;
      } else if (tab === 'ideas') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM ideas WHERE status = 'active' AND created_at > ?`).get(since).c;
      } else if (tab === 'projects') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM projects WHERE updated_at > ?`).get(since).c;
      } else if (tab === 'docs') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM documents WHERE created_at > ?`).get(since).c;
      } else if (tab === 'kanban') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND completed_at > ?`).get(since).c;
      } else if (tab === 'schedule') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM schedule WHERE created_at > ?`).get(since).c;
      } else if (tab === 'log') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM action_log WHERE started_at > ?`).get(since).c;
      } else if (tab === 'goals') {
        count = rawDb.prepare(`SELECT COUNT(*) as c FROM goals WHERE created_at > ?`).get(since).c;
      }
      result[tab] = count;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/seen', (req, res) => {
  try {
    const { tab } = req.body;
    const validTabs = ['inbox', 'ideas', 'projects', 'docs', 'kanban', 'schedule', 'log', 'goals'];
    if (!tab || !validTabs.includes(tab)) return res.status(400).json({ error: 'invalid tab' });
    upsertTabVisit.run({ tab_name: tab });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API Usage Tracking ---

const API_COST_THRESHOLD_GBP = 1.0;
const GBP_PER_USD = 0.79; // approximate

app.post('/api/usage', (req, res) => {
  try {
    const { agent, model, provider, input_tokens, output_tokens, cost_usd, endpoint, task, project } = req.body;
    if (!agent || !model) return res.status(400).json({ error: 'agent and model required' });
    const total = (input_tokens || 0) + (output_tokens || 0);
    const result = insertApiUsage.run({
      agent,
      model,
      provider: provider || null,
      input_tokens: input_tokens || 0,
      output_tokens: output_tokens || 0,
      total_tokens: total,
      cost_usd: cost_usd || 0,
      endpoint: endpoint || null,
      task: task || null,
      project: project || null,
      timestamp: new Date().toISOString()
    });

    // Check if today's cost exceeds threshold — fire alert
    const today = new Date().toISOString().slice(0, 10);
    const todayCost = rawDb.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_usage WHERE timestamp >= ?`).get(today + 'T00:00:00').total;
    const todayCostGBP = todayCost * GBP_PER_USD;
    if (todayCostGBP >= API_COST_THRESHOLD_GBP) {
      upsertAlert.run({
        type: 'api_cost_threshold',
        entity_id: 'daily',
        entity_type: 'api_usage',
        severity: 'amber',
        message: `Daily API spend has reached £${todayCostGBP.toFixed(2)} (threshold: £${API_COST_THRESHOLD_GBP.toFixed(2)})`
      });
    } else {
      try { deleteAlertByTypeEntity.run({ type: 'api_cost_threshold', entity_id: 'daily' }); } catch(e) {}
    }

    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage', (req, res) => {
  try {
    const { agent, model, date_from, date_to, limit } = req.query;
    const rows = getApiUsage.all({
      agent: agent || null,
      model: model || null,
      date_from: date_from || null,
      date_to: date_to ? date_to + 'T23:59:59' : null,
      limit: parseInt(limit) || 100
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage/summary', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    const todayRow = rawDb.prepare(`
      SELECT COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(cost_usd),0) as cost_usd
      FROM api_usage WHERE timestamp >= ?
    `).get(today + 'T00:00:00');

    const todayByModel = rawDb.prepare(`
      SELECT model, COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost_usd),0) as cost
      FROM api_usage WHERE timestamp >= ? GROUP BY model
    `).all(today + 'T00:00:00');

    const todayByAgent = rawDb.prepare(`
      SELECT agent, COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost_usd),0) as cost
      FROM api_usage WHERE timestamp >= ? GROUP BY agent
    `).all(today + 'T00:00:00');

    const monthRow = rawDb.prepare(`
      SELECT COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(cost_usd),0) as cost_usd
      FROM api_usage WHERE timestamp >= ?
    `).get(monthStart + 'T00:00:00');

    const monthByModel = rawDb.prepare(`
      SELECT model, COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost_usd),0) as cost
      FROM api_usage WHERE timestamp >= ? GROUP BY model
    `).all(monthStart + 'T00:00:00');

    const monthByAgent = rawDb.prepare(`
      SELECT agent, COALESCE(SUM(total_tokens),0) as tokens, COALESCE(SUM(cost_usd),0) as cost
      FROM api_usage WHERE timestamp >= ? GROUP BY agent
    `).all(monthStart + 'T00:00:00');

    const allTimeRow = rawDb.prepare(`
      SELECT COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(cost_usd),0) as cost_usd FROM api_usage
    `).get();

    // Daily breakdown: last 30 days
    const dailyBreakdown = rawDb.prepare(`
      SELECT substr(timestamp, 1, 10) as date,
        SUM(total_tokens) as tokens,
        SUM(cost_usd) as cost
      FROM api_usage
      WHERE timestamp >= date('now', '-29 days')
      GROUP BY substr(timestamp, 1, 10)
      ORDER BY date ASC
    `).all();

    const topModels = rawDb.prepare(`
      SELECT model, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
      FROM api_usage GROUP BY model ORDER BY tokens DESC LIMIT 5
    `).all();

    const topAgents = rawDb.prepare(`
      SELECT agent, SUM(total_tokens) as tokens, SUM(cost_usd) as cost
      FROM api_usage GROUP BY agent ORDER BY tokens DESC LIMIT 5
    `).all();

    const toMap = (rows, key) => rows.reduce((acc, r) => { acc[r[key]] = { tokens: r.tokens, cost: r.cost }; return acc; }, {});

    res.json({
      today: { total_tokens: todayRow.total_tokens, cost_usd: todayRow.cost_usd, cost_gbp: todayRow.cost_usd * GBP_PER_USD, by_model: toMap(todayByModel, 'model'), by_agent: toMap(todayByAgent, 'agent') },
      this_month: { total_tokens: monthRow.total_tokens, cost_usd: monthRow.cost_usd, cost_gbp: monthRow.cost_usd * GBP_PER_USD, by_model: toMap(monthByModel, 'model'), by_agent: toMap(monthByAgent, 'agent') },
      all_time: { total_tokens: allTimeRow.total_tokens, cost_usd: allTimeRow.cost_usd, cost_gbp: allTimeRow.cost_usd * GBP_PER_USD },
      daily_breakdown: dailyBreakdown,
      top_models: topModels,
      top_agents: topAgents
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Pipeline API ---

const PIPELINE_STAGES = ['idea', 'evaluating', 'defined', 'building', 'shipped'];

app.get('/api/pipeline', (req, res) => {
  try {
    const projects = getPipelineProjects.all();
    const grouped = {};
    for (const stage of PIPELINE_STAGES) grouped[stage] = [];
    for (const p of projects) {
      const stage = PIPELINE_STAGES.includes(p.pipeline_stage) ? p.pipeline_stage : 'idea';
      grouped[stage].push(p);
    }
    res.json({ stages: PIPELINE_STAGES, projects: grouped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/pipeline', (req, res) => {
  try {
    const { pipeline_stage } = req.body;
    if (!PIPELINE_STAGES.includes(pipeline_stage)) {
      return res.status(400).json({ error: `Invalid stage. Must be one of: ${PIPELINE_STAGES.join(', ')}` });
    }
    updateProjectPipelineStage.run({ id: req.params.id, pipeline_stage });
    // Sync status field with pipeline stage
    if (pipeline_stage === 'building') {
      try { updateProject.run({ id: req.params.id, name: null, tagline: null, icon: null, status: 'active', platform: null, tech_stack: null, current_version: null, next_version: null, release_date: null, category: null, app_store_url: null, github_url: null, landing_url: null, trello_board_id: null, project_type: null }); } catch(e) {}
    }
    res.json({ ok: true, pipeline_stage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/evaluate', (req, res) => {
  try {
    const evaluation = getEvaluationByProject.get({ project_id: req.params.id });
    res.json(evaluation || { project_id: req.params.id, market_score: 3, effort_score: 3, excitement_score: 3, synergy_score: 3, notes: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/evaluate', (req, res) => {
  try {
    const { market_score, effort_score, excitement_score, synergy_score, notes } = req.body;
    upsertEvaluation.run({
      project_id: req.params.id,
      market_score: parseInt(market_score) || 3,
      effort_score: parseInt(effort_score) || 3,
      excitement_score: parseInt(excitement_score) || 3,
      synergy_score: parseInt(synergy_score) || 3,
      notes: notes || null
    });
    const evaluation = getEvaluationByProject.get({ project_id: req.params.id });
    res.json(evaluation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🐶 Jarvis Dashboard running at http://localhost:${PORT}\n`);
});
