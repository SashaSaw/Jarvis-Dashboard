const express = require('express');
const path = require('path');
const fs = require('fs');
const { insertEvent, getEvents, getStats, getActiveSessions, upsertAgentStatus, getAgentStatus, insertTask, getTasks, getTasksByStatuses, getTaskById, updateTask, deleteTask, moveTask, insertSchedule, getScheduleByDate, getScheduleByRange, getScheduleById, updateSchedule, deleteSchedule, insertDocument, getDocuments, getDocumentById, updateDocument, deleteDocument, insertLogEntry, getLogEntries, getLogStats, getLogTopActions } = require('./db');
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

// --- Documents API ---

app.post('/api/docs', (req, res) => {
  try {
    const { title, content, category } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = insertDocument.run({
      title,
      content: content || '',
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
    const { agent, action, description, reason, status, started_at, completed_at, duration_ms, metadata } = req.body;
    if (!agent || !action) return res.status(400).json({ error: 'agent and action required' });
    const result = insertLogEntry.run({
      agent,
      action,
      description: description || null,
      reason: reason || null,
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
    const { agent, since, limit } = req.query;
    const entries = getLogEntries.all({
      agent: agent || null,
      since: since || null,
      limit: parseInt(limit) || 100
    });
    for (const e of entries) {
      if (e.metadata) try { e.metadata = JSON.parse(e.metadata); } catch {}
    }
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/log/stats', (req, res) => {
  try {
    const agentStats = getLogStats.all();
    const topActions = getLogTopActions.all();
    res.json({ agents: agentStats, topActions });
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
  jarvis: ['MEMORY.md', 'SOUL.md', 'USER.md', 'IDENTITY.md'],
  klaus: ['AGENTS.md'],
  emily: ['AGENTS.md']
};

// Whitelist: only allow these filenames (prevent path traversal)
const ALLOWED_FILES = new Set(['MEMORY.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'AGENTS.md']);
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
