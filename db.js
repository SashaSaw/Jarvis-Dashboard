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
    (SELECT COUNT(DISTINCT project) FROM events
      WHERE project IS NOT NULL
        AND created_at >= datetime('now', '-30 minutes')
        AND (SELECT event_type FROM events e3 WHERE e3.project = events.project ORDER BY e3.created_at DESC LIMIT 1) != 'SessionEnd'
    ) as active_sessions,
    (SELECT COUNT(*) FROM events WHERE created_at >= date('now')) as events_today
`);

const getActiveSessions = db.prepare(`
  SELECT
    project,
    MAX(created_at) as last_activity,
    (SELECT summary FROM events e2 WHERE e2.project = events.project ORDER BY e2.created_at DESC LIMIT 1) as last_summary,
    COUNT(*) as event_count
  FROM events
  WHERE project IS NOT NULL
    AND created_at >= datetime('now', '-30 minutes')
  GROUP BY project
  HAVING
    (SELECT event_type FROM events e3 WHERE e3.project = events.project ORDER BY e3.created_at DESC LIMIT 1) != 'SessionEnd'
  ORDER BY last_activity DESC
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

// --- Schedule ---

db.exec(`
  CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    date TEXT NOT NULL,
    color TEXT DEFAULT '#7c6bf0',
    task_id INTEGER,
    recurring TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
  CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date);
`);

const insertSchedule = db.prepare(`
  INSERT INTO schedule (title, description, start_time, end_time, date, color, task_id, recurring)
  VALUES (@title, @description, @start_time, @end_time, @date, @color, @task_id, @recurring)
`);

const getScheduleByDate = db.prepare(`
  SELECT s.*, t.title as task_title FROM schedule s
  LEFT JOIN tasks t ON s.task_id = t.id
  WHERE s.date = @date
  ORDER BY s.start_time ASC
`);

const getScheduleByRange = db.prepare(`
  SELECT s.*, t.title as task_title FROM schedule s
  LEFT JOIN tasks t ON s.task_id = t.id
  WHERE s.date >= @from AND s.date <= @to
  ORDER BY s.date ASC, s.start_time ASC
`);

const getScheduleById = db.prepare(`SELECT * FROM schedule WHERE id = @id`);

const updateSchedule = db.prepare(`
  UPDATE schedule SET
    title = COALESCE(@title, title),
    description = COALESCE(@description, description),
    start_time = COALESCE(@start_time, start_time),
    end_time = COALESCE(@end_time, end_time),
    date = COALESCE(@date, date),
    color = COALESCE(@color, color),
    task_id = @task_id,
    recurring = @recurring,
    updated_at = datetime('now')
  WHERE id = @id
`);

const deleteSchedule = db.prepare(`DELETE FROM schedule WHERE id = @id`);

// --- Documents ---

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);
`);

const insertDocument = db.prepare(`
  INSERT INTO documents (title, content, category)
  VALUES (@title, @content, @category)
`);

const getDocuments = db.prepare(`
  SELECT id, title, category, updated_at FROM documents ORDER BY updated_at DESC
`);

const getDocumentById = db.prepare(`
  SELECT * FROM documents WHERE id = @id
`);

const updateDocument = db.prepare(`
  UPDATE documents SET
    title = COALESCE(@title, title),
    content = COALESCE(@content, content),
    category = COALESCE(@category, category),
    updated_at = datetime('now')
  WHERE id = @id
`);

const deleteDocument = db.prepare(`DELETE FROM documents WHERE id = @id`);

// --- Action Log ---

db.exec(`
  CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    reason TEXT,
    status TEXT DEFAULT 'completed',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    duration_ms INTEGER,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_action_log_started ON action_log(started_at);
  CREATE INDEX IF NOT EXISTS idx_action_log_agent ON action_log(agent);
`);

const insertLogEntry = db.prepare(`
  INSERT INTO action_log (agent, action, description, reason, status, started_at, completed_at, duration_ms, metadata)
  VALUES (@agent, @action, @description, @reason, @status, @started_at, @completed_at, @duration_ms, @metadata)
`);

const getLogEntries = db.prepare(`
  SELECT * FROM action_log
  WHERE (@agent IS NULL OR agent = @agent)
    AND (@since IS NULL OR started_at >= @since)
  ORDER BY started_at DESC
  LIMIT @limit
`);

const getLogStats = db.prepare(`
  SELECT
    agent,
    COUNT(*) as total,
    SUM(CASE WHEN started_at >= date('now') THEN 1 ELSE 0 END) as today,
    ROUND(AVG(duration_ms)) as avg_duration_ms
  FROM action_log
  GROUP BY agent
`);

const getLogTopActions = db.prepare(`
  SELECT action, COUNT(*) as count
  FROM action_log
  WHERE started_at >= date('now', '-7 days')
  GROUP BY action
  ORDER BY count DESC
  LIMIT 10
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
  moveTask,
  insertSchedule,
  getScheduleByDate,
  getScheduleByRange,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  insertDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  insertLogEntry,
  getLogEntries,
  getLogStats,
  getLogTopActions
};
