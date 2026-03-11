const express = require('express');
const path = require('path');
const { insertEvent, getEvents, getStats, getActiveSessions, upsertAgentStatus, getAgentStatus, insertTask, getTasks, getTasksByStatuses, getTaskById, updateTask, deleteTask, moveTask } = require('./db');
const { getAllBoards, createCard, moveCard, archiveCard, updateCard, getBoardLabels } = require('./integrations/trello');
const { getTodayEvents, getUpcomingEvents } = require('./integrations/calendar');

const app = express();
const PORT = process.env.PORT || 3147;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Webhook Receiver ---

app.post('/api/hooks', (req, res) => {
  try {
    const body = req.body;
    const event = {
      event_type: body.event || 'unknown',
      session_id: body.session_id || null,
      project: body.project || null,
      summary: body.summary || null,
      files_changed: body.files_changed ? JSON.stringify(body.files_changed) : null,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
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
    res.json(tasks);
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
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    moveTask.run({ id: parseInt(req.params.id), status });
    const task = getTaskById.get({ id: parseInt(req.params.id) });
    res.json(task);
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

// --- Dashboard ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🐶 Jarvis Dashboard running at http://localhost:${PORT}\n`);
});
