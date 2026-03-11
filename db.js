const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'jarvis.db'));

// WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    session_id TEXT,
    project TEXT,
    summary TEXT,
    files_changed TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

  CREATE TABLE IF NOT EXISTS agent_status (
    agent_name TEXT PRIMARY KEY,
    data TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'inbox',
    priority TEXT DEFAULT 'normal',
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    archived_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
`);

const insertEvent = db.prepare(`
  INSERT INTO events (event_type, session_id, project, summary, files_changed, metadata, created_at)
  VALUES (@event_type, @session_id, @project, @summary, @files_changed, @metadata, @created_at)
`);

const getEvents = db.prepare(`
  SELECT * FROM events
  WHERE (@type IS NULL OR event_type = @type)
    AND (@since IS NULL OR created_at >= @since)
  ORDER BY created_at DESC
  LIMIT @limit
`);

const getStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM events WHERE event_type = 'TaskCompleted' AND created_at >= date('now')) as tasks_today,
    (SELECT COUNT(*) FROM events WHERE event_type IN ('PostToolUse') AND created_at >= date('now')) as tool_uses_today,
    (SELECT COUNT(DISTINCT session_id) FROM events WHERE event_type = 'SessionStart' AND session_id NOT IN (
      SELECT COALESCE(session_id, '') FROM events WHERE event_type = 'SessionEnd'
    ) AND created_at >= datetime('now', '-24 hours')) as active_sessions,
    (SELECT COUNT(*) FROM events WHERE created_at >= date('now')) as events_today
`);

const getActiveSessions = db.prepare(`
  SELECT e1.session_id, e1.project, e1.summary, e1.created_at as started_at
  FROM events e1
  WHERE e1.event_type = 'SessionStart'
    AND e1.session_id IS NOT NULL
    AND e1.created_at >= datetime('now', '-24 hours')
    AND NOT EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.event_type = 'SessionEnd'
        AND e2.session_id = e1.session_id
        AND e2.created_at > e1.created_at
    )
  ORDER BY e1.created_at DESC
`);

const upsertAgentStatus = db.prepare(`
  INSERT INTO agent_status (agent_name, data, updated_at)
  VALUES (@agent_name, @data, @updated_at)
  ON CONFLICT(agent_name) DO UPDATE SET data = @data, updated_at = @updated_at
`);

const getAgentStatus = db.prepare(`
  SELECT data, updated_at FROM agent_status WHERE agent_name = @agent_name
`);

// --- Tasks ---

const insertTask = db.prepare(`
  INSERT INTO tasks (title, description, status, priority, category)
  VALUES (@title, @description, @status, @priority, @category)
`);

const getTasks = db.prepare(`
  SELECT * FROM tasks
  WHERE (@status IS NULL OR status = @status)
    AND (@category IS NULL OR category = @category)
  ORDER BY created_at DESC
`);

const getTasksByStatuses = db.prepare(`
  SELECT * FROM tasks
  WHERE status IN ('todo', 'in_progress', 'done', 'archived')
  ORDER BY updated_at DESC
`);

const getTaskById = db.prepare(`SELECT * FROM tasks WHERE id = @id`);

const updateTask = db.prepare(`
  UPDATE tasks SET
    title = COALESCE(@title, title),
    description = COALESCE(@description, description),
    status = COALESCE(@status, status),
    priority = COALESCE(@priority, priority),
    category = COALESCE(@category, category),
    updated_at = datetime('now'),
    completed_at = CASE WHEN @status = 'done' THEN datetime('now') ELSE completed_at END,
    archived_at = CASE WHEN @status = 'archived' THEN datetime('now') ELSE archived_at END
  WHERE id = @id
`);

const deleteTask = db.prepare(`DELETE FROM tasks WHERE id = @id`);

const moveTask = db.prepare(`
  UPDATE tasks SET
    status = @status,
    updated_at = datetime('now'),
    completed_at = CASE WHEN @status = 'done' THEN datetime('now') ELSE completed_at END,
    archived_at = CASE WHEN @status = 'archived' THEN datetime('now') ELSE archived_at END
  WHERE id = @id
`);

module.exports = {
  db,
  insertEvent,
  getEvents,
  getStats,
  getActiveSessions,
  upsertAgentStatus,
  getAgentStatus,
  insertTask,
  getTasks,
  getTasksByStatuses,
  getTaskById,
  updateTask,
  deleteTask,
  moveTask
};
