const express = require('express');
const path = require('path');
const { insertEvent, getEvents, getStats, getActiveSessions } = require('./db');
const { getAllBoards, createCard, moveCard, archiveCard, updateCard } = require('./integrations/trello');
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

app.delete('/api/trello/cards/:cardId', async (req, res) => {
  try {
    const card = await archiveCard(req.params.cardId);
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Jarvis Status ---

let jarvisStatus = null;

app.post('/api/jarvis/status', (req, res) => {
  try {
    jarvisStatus = { ...req.body, updated_at: new Date().toISOString() };
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jarvis/status', (req, res) => {
  res.json(jarvisStatus || { error: 'No status yet' });
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
