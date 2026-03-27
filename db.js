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
  -- Project Hub tables
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT,
    icon TEXT,
    status TEXT DEFAULT 'active',
    platform TEXT,
    tech_stack TEXT,
    current_version TEXT,
    next_version TEXT,
    release_date TEXT,
    category TEXT,
    app_store_url TEXT,
    github_url TEXT,
    landing_url TEXT,
    trello_board_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    section_type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_psections_project ON project_sections(project_id);

  CREATE TABLE IF NOT EXISTS features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'idea',
    version_target TEXT,
    version_shipped TEXT,
    tags TEXT,
    priority TEXT DEFAULT 'normal',
    source TEXT,
    trello_card_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_id);

  -- Migration: add prompt and testing columns if missing
  `);
  try { db.exec(`ALTER TABLE features ADD COLUMN prompt TEXT`); } catch(e) { /* already exists */ }
  try { db.exec(`ALTER TABLE features ADD COLUMN testing TEXT`); } catch(e) { /* already exists */ }

  // Migration: last_activity_at + warning_dismissed_at on projects
  try { db.exec(`ALTER TABLE projects ADD COLUMN last_activity_at TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE projects ADD COLUMN warning_dismissed_at TEXT`); } catch(e) {}
  db.exec(`UPDATE projects SET last_activity_at = updated_at WHERE last_activity_at IS NULL`);

  db.exec(`

  CREATE TABLE IF NOT EXISTS project_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    description TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_ptags_project ON project_tags(project_id);

  CREATE TABLE IF NOT EXISTS project_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT,
    content TEXT NOT NULL,
    sentiment TEXT,
    linked_feature_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_pfeedback_project ON project_feedback(project_id);

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

// --- Projects ---

const insertProject = db.prepare(`
  INSERT INTO projects (id, name, tagline, icon, status, platform, tech_stack, current_version, next_version, release_date, category, app_store_url, github_url, landing_url, trello_board_id, project_type)
  VALUES (@id, @name, @tagline, @icon, @status, @platform, @tech_stack, @current_version, @next_version, @release_date, @category, @app_store_url, @github_url, @landing_url, @trello_board_id, @project_type)
`);

const getProjects = db.prepare(`SELECT * FROM projects ORDER BY name ASC`);

const getProjectById = db.prepare(`SELECT * FROM projects WHERE id = @id`);

// Add project_type column if missing
try { db.exec(`ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT 'product'`); } catch(e) {}

const updateProject = db.prepare(`
  UPDATE projects SET
    name = COALESCE(@name, name),
    tagline = COALESCE(@tagline, tagline),
    icon = COALESCE(@icon, icon),
    status = COALESCE(@status, status),
    platform = COALESCE(@platform, platform),
    tech_stack = COALESCE(@tech_stack, tech_stack),
    current_version = COALESCE(@current_version, current_version),
    next_version = COALESCE(@next_version, next_version),
    release_date = COALESCE(@release_date, release_date),
    category = COALESCE(@category, category),
    app_store_url = COALESCE(@app_store_url, app_store_url),
    github_url = COALESCE(@github_url, github_url),
    landing_url = COALESCE(@landing_url, landing_url),
    trello_board_id = COALESCE(@trello_board_id, trello_board_id),
    project_type = COALESCE(@project_type, project_type),
    updated_at = datetime('now')
  WHERE id = @id
`);

const archiveProject = db.prepare(`UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = @id`);
const deleteProjectPermanent = db.prepare(`DELETE FROM projects WHERE id = @id AND status = 'archived'`);
const deleteProjectSections = db.prepare(`DELETE FROM project_sections WHERE project_id = @project_id`);
const deleteProjectFeatures = db.prepare(`DELETE FROM features WHERE project_id = @project_id`);
const deleteProjectTags = db.prepare(`DELETE FROM project_tags WHERE project_id = @project_id`);
const deleteProjectFeedback = db.prepare(`DELETE FROM project_feedback WHERE project_id = @project_id`);

// --- Project Sections ---

const insertSection = db.prepare(`
  INSERT INTO project_sections (project_id, section_type, title, content, sort_order)
  VALUES (@project_id, @section_type, @title, @content, @sort_order)
`);

const getSectionsByProject = db.prepare(`
  SELECT * FROM project_sections WHERE project_id = @project_id ORDER BY sort_order ASC
`);

const getSectionById = db.prepare(`SELECT * FROM project_sections WHERE id = @id`);

const updateSection = db.prepare(`
  UPDATE project_sections SET
    title = COALESCE(@title, title),
    content = COALESCE(@content, content),
    sort_order = COALESCE(@sort_order, sort_order),
    updated_at = datetime('now')
  WHERE id = @id
`);

const deleteSection = db.prepare(`DELETE FROM project_sections WHERE id = @id`);

// --- Features ---

const insertFeature = db.prepare(`
  INSERT INTO features (project_id, name, description, status, version_target, version_shipped, tags, priority, source, trello_card_id, prompt, testing)
  VALUES (@project_id, @name, @description, @status, @version_target, @version_shipped, @tags, @priority, @source, @trello_card_id, @prompt, @testing)
`);

const getFeaturesByProject = db.prepare(`
  SELECT * FROM features WHERE project_id = @project_id ORDER BY created_at DESC
`);

const getFeatureById = db.prepare(`SELECT * FROM features WHERE id = @id`);

const updateFeature = db.prepare(`
  UPDATE features SET
    name = COALESCE(@name, name),
    description = COALESCE(@description, description),
    status = COALESCE(@status, status),
    version_target = COALESCE(@version_target, version_target),
    version_shipped = COALESCE(@version_shipped, version_shipped),
    tags = COALESCE(@tags, tags),
    priority = COALESCE(@priority, priority),
    source = COALESCE(@source, source),
    trello_card_id = COALESCE(@trello_card_id, trello_card_id),
    prompt = COALESCE(@prompt, prompt),
    testing = COALESCE(@testing, testing),
    updated_at = datetime('now')
  WHERE id = @id
`);

const deleteFeature = db.prepare(`DELETE FROM features WHERE id = @id`);

// --- Project Tags ---

const insertProjectTag = db.prepare(`
  INSERT INTO project_tags (project_id, name, color, description)
  VALUES (@project_id, @name, @color, @description)
`);

const getTagsByProject = db.prepare(`
  SELECT * FROM project_tags WHERE project_id = @project_id ORDER BY name ASC
`);

const getProjectTagById = db.prepare(`SELECT * FROM project_tags WHERE id = @id`);

const updateProjectTag = db.prepare(`
  UPDATE project_tags SET
    name = COALESCE(@name, name),
    color = COALESCE(@color, color),
    description = COALESCE(@description, description)
  WHERE id = @id
`);

const deleteProjectTag = db.prepare(`DELETE FROM project_tags WHERE id = @id`);

// --- Project Feedback ---

const insertFeedback = db.prepare(`
  INSERT INTO project_feedback (project_id, source, content, sentiment, linked_feature_id)
  VALUES (@project_id, @source, @content, @sentiment, @linked_feature_id)
`);

const getFeedbackByProject = db.prepare(`
  SELECT * FROM project_feedback WHERE project_id = @project_id ORDER BY created_at DESC
`);

const getFeedbackById = db.prepare(`SELECT * FROM project_feedback WHERE id = @id`);

const updateFeedback = db.prepare(`
  UPDATE project_feedback SET
    source = COALESCE(@source, source),
    content = COALESCE(@content, content),
    sentiment = COALESCE(@sentiment, sentiment),
    linked_feature_id = @linked_feature_id
  WHERE id = @id
`);

const deleteFeedback = db.prepare(`DELETE FROM project_feedback WHERE id = @id`);

// --- Alerts ---

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    entity_id TEXT,
    entity_type TEXT,
    severity TEXT DEFAULT 'info',
    message TEXT NOT NULL,
    dismissed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(type, entity_id)
  );
`);

const touchProjectActivity = db.prepare(`
  UPDATE projects SET last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = @id
`);

const getActiveAlerts = db.prepare(`SELECT * FROM alerts WHERE dismissed_at IS NULL ORDER BY created_at DESC`);
const getAlertById = db.prepare(`SELECT * FROM alerts WHERE id = @id`);
const dismissAlert = db.prepare(`UPDATE alerts SET dismissed_at = datetime('now'), updated_at = datetime('now') WHERE id = @id`);

const upsertAlert = db.prepare(`
  INSERT INTO alerts (type, entity_id, entity_type, severity, message, created_at, updated_at)
  VALUES (@type, @entity_id, @entity_type, @severity, @message, datetime('now'), datetime('now'))
  ON CONFLICT(type, entity_id) DO UPDATE SET
    severity = @severity,
    message = @message,
    dismissed_at = CASE WHEN dismissed_at IS NOT NULL AND severity != excluded.severity THEN NULL ELSE dismissed_at END,
    updated_at = datetime('now')
`);

const deleteAlertByTypeEntity = db.prepare(`DELETE FROM alerts WHERE type = @type AND entity_id = @entity_id`);

const getProjectsForStaleness = db.prepare(`
  SELECT id, name, icon, status, last_activity_at, warning_dismissed_at
  FROM projects
  WHERE status = 'active'
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
  getLogTopActions,
  // Project Hub
  insertProject,
  getProjects,
  getProjectById,
  updateProject,
  archiveProject,
  deleteProjectPermanent,
  deleteProjectSections,
  deleteProjectFeatures,
  deleteProjectTags,
  deleteProjectFeedback,
  insertSection,
  getSectionsByProject,
  getSectionById,
  updateSection,
  deleteSection,
  insertFeature,
  getFeaturesByProject,
  getFeatureById,
  updateFeature,
  deleteFeature,
  insertProjectTag,
  getTagsByProject,
  getProjectTagById,
  updateProjectTag,
  deleteProjectTag,
  insertFeedback,
  getFeedbackByProject,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
  // Alerts
  touchProjectActivity,
  getActiveAlerts,
  getAlertById,
  dismissAlert,
  upsertAlert,
  deleteAlertByTypeEntity,
  getProjectsForStaleness
};

// --- Ideas ---

db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    tags TEXT,
    source TEXT,
    project_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    archived_at TEXT
  )
`);

const insertIdea = db.prepare(`
  INSERT INTO ideas (title, description, tags, source, pain_point, how_it_works, why_it_works, feasibility, effort, revenue_model, competition, synergy)
  VALUES (@title, @description, @tags, @source, @pain_point, @how_it_works, @why_it_works, @feasibility, @effort, @revenue_model, @competition, @synergy)
`);
const getIdeas = db.prepare(`SELECT * FROM ideas ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'archived' THEN 1 END, created_at DESC`);
const getActiveIdeas = db.prepare(`SELECT * FROM ideas WHERE status = 'active' ORDER BY created_at DESC`);
const getArchivedIdeas = db.prepare(`SELECT * FROM ideas WHERE status = 'archived' ORDER BY archived_at DESC`);
const getIdeaById = db.prepare(`SELECT * FROM ideas WHERE id = @id`);
const updateIdea = db.prepare(`
  UPDATE ideas SET
    title = COALESCE(@title, title),
    description = COALESCE(@description, description),
    tags = COALESCE(@tags, tags),
    source = COALESCE(@source, source),
    status = COALESCE(@status, status),
    project_id = COALESCE(@project_id, project_id),
    pain_point = COALESCE(@pain_point, pain_point),
    how_it_works = COALESCE(@how_it_works, how_it_works),
    why_it_works = COALESCE(@why_it_works, why_it_works),
    feasibility = COALESCE(@feasibility, feasibility),
    effort = COALESCE(@effort, effort),
    revenue_model = COALESCE(@revenue_model, revenue_model),
    competition = COALESCE(@competition, competition),
    synergy = COALESCE(@synergy, synergy),
    archived_at = CASE WHEN @status = 'archived' THEN datetime('now') ELSE archived_at END,
    updated_at = datetime('now')
  WHERE id = @id
`);
const deleteIdeaPermanent = db.prepare(`DELETE FROM ideas WHERE id = @id`);

module.exports.insertIdea = insertIdea;
module.exports.getIdeas = getIdeas;
module.exports.getActiveIdeas = getActiveIdeas;
module.exports.getArchivedIdeas = getArchivedIdeas;
module.exports.getIdeaById = getIdeaById;
module.exports.updateIdea = updateIdea;
module.exports.deleteIdeaPermanent = deleteIdeaPermanent;

// Migration: add rich fields to ideas
try { db.exec(`ALTER TABLE ideas ADD COLUMN pain_point TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN how_it_works TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN why_it_works TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN feasibility TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN effort TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN revenue_model TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN competition TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE ideas ADD COLUMN synergy TEXT`); } catch(e) {}

// --- Finance ---

db.exec(`
  CREATE TABLE IF NOT EXISTS finance_settings (
    id INTEGER PRIMARY KEY,
    monthly_income REAL DEFAULT 0,
    savings_target REAL DEFAULT 0,
    currency TEXT DEFAULT '£',
    pay_day INTEGER DEFAULT 25,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS recurring_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    day_of_month INTEGER,
    category TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS spending_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_spending_date ON spending_log(date);

  CREATE TABLE IF NOT EXISTS work_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    category TEXT,
    status TEXT DEFAULT 'pending',
    receipt_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_work_expenses_status ON work_expenses(status);

  CREATE TABLE IF NOT EXISTS budget_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    daily_allowance REAL,
    total_spent REAL,
    total_fixed REAL,
    remaining REAL,
    days_remaining INTEGER,
    calculated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrations
try { db.exec(`ALTER TABLE finance_settings ADD COLUMN pay_day INTEGER DEFAULT 25`); } catch(e) {}

module.exports.financeDb = db;

// Chat messages table
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migration
try { db.exec(`ALTER TABLE chat_messages ADD COLUMN status TEXT`); } catch(e) {}

const getChatMessages = db.prepare('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT @limit');
const getChatMessagesAfter = db.prepare('SELECT * FROM chat_messages WHERE id > @after ORDER BY created_at ASC');
const insertChatMessage = db.prepare("INSERT INTO chat_messages (content, role, status, created_at) VALUES (@content, @role, @status, datetime('now'))");
const getChatPending = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE status = 'pending'");
const markChatAnswered = db.prepare("UPDATE chat_messages SET status = 'answered' WHERE status = 'pending'");

module.exports.getChatMessages = getChatMessages;
module.exports.getChatMessagesAfter = getChatMessagesAfter;
module.exports.insertChatMessage = insertChatMessage;
module.exports.getChatPending = getChatPending;
module.exports.markChatAnswered = markChatAnswered;
