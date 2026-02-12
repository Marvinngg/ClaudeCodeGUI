import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import type { ChatSession, Message, SettingsMap, TaskItem, TaskStatus, ApiProvider, CreateProviderRequest, UpdateProviderRequest } from '@/types';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(require('os').homedir(), '.codepilot');
const DB_PATH = path.join(dataDir, 'codepilot.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const fs = require('fs');
    const os = require('os');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Migrate from old locations if the new DB doesn't exist yet
    if (!fs.existsSync(DB_PATH)) {
      const home = os.homedir();
      const oldPaths = [
        // Old Electron userData paths (app.getPath('userData'))
        path.join(home, 'Library', 'Application Support', 'CodePilot', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'codepilot', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'Claude GUI', 'codepilot.db'),
        // Old dev-mode fallback
        path.join(process.cwd(), 'data', 'codepilot.db'),
        // Legacy name
        path.join(home, 'Library', 'Application Support', 'CodePilot', 'claude-gui.db'),
        path.join(home, 'Library', 'Application Support', 'codepilot', 'claude-gui.db'),
      ];
      for (const oldPath of oldPaths) {
        if (fs.existsSync(oldPath)) {
          try {
            fs.copyFileSync(oldPath, DB_PATH);
            // Also copy WAL/SHM if they exist
            if (fs.existsSync(oldPath + '-wal')) fs.copyFileSync(oldPath + '-wal', DB_PATH + '-wal');
            if (fs.existsSync(oldPath + '-shm')) fs.copyFileSync(oldPath + '-shm', DB_PATH + '-shm');
            console.log(`[db] Migrated database from ${oldPath}`);
            break;
          } catch (err) {
            console.warn(`[db] Failed to migrate from ${oldPath}:`, err);
          }
        }
      }
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      sdk_session_id TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      token_usage TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      extra_env TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON chat_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
  `);

  // Run migrations for existing databases
  migrateDb(db);
}

function migrateDb(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
  const colNames = columns.map(c => c.name);

  if (!colNames.includes('model')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('system_prompt')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('sdk_session_id')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN sdk_session_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('project_name')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN project_name TEXT NOT NULL DEFAULT ''");
    // Backfill project_name from working_directory for existing rows
    db.exec(`
      UPDATE chat_sessions
      SET project_name = CASE
        WHEN working_directory != '' THEN REPLACE(REPLACE(working_directory, RTRIM(working_directory, REPLACE(working_directory, '/', '')), ''), '/', '')
        ELSE ''
      END
      WHERE project_name = ''
    `);
  }
  if (!colNames.includes('status')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!colNames.includes('mode')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'code'");
  }

  const msgColumns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const msgColNames = msgColumns.map(c => c.name);

  if (!msgColNames.includes('token_usage')) {
    db.exec("ALTER TABLE messages ADD COLUMN token_usage TEXT");
  }

  // Ensure tasks table exists for databases created before this migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
  `);

  // Migrate conversations table to add raw_messages and source
  const convColumns = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
  const convColNames = convColumns.map(c => c.name);

  if (!convColNames.includes('raw_messages')) {
    db.exec("ALTER TABLE conversations ADD COLUMN raw_messages TEXT");
  }
  if (!convColNames.includes('source')) {
    db.exec("ALTER TABLE conversations ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");
  }

  // Ensure api_providers table exists for databases created before this migration
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      extra_env TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add source column to api_providers if missing (Hub integration)
  const providerColumns = db.prepare("PRAGMA table_info(api_providers)").all() as { name: string }[];
  const providerColNames = providerColumns.map(c => c.name);
  if (!providerColNames.includes('source')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");
  }
  if (!providerColNames.includes('default_model')) {
    db.exec("ALTER TABLE api_providers ADD COLUMN default_model TEXT");
  }

  // Migrate existing settings to a default provider if api_providers is empty
  const providerCount = db.prepare('SELECT COUNT(*) as count FROM api_providers').get() as { count: number };
  if (providerCount.count === 0) {
    const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_auth_token'").get() as { value: string } | undefined;
    const baseUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_base_url'").get() as { value: string } | undefined;
    if (tokenRow || baseUrlRow) {
      const id = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString().replace('T', ' ').split('.')[0];
      db.prepare(
        'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'Default', 'anthropic', baseUrlRow?.value || '', tokenRow?.value || '', 1, 0, '{}', 'Migrated from settings', now, now);
    }
  }

  // Hub cache tables for offline support
  db.exec(`
    CREATE TABLE IF NOT EXISTS hub_skills_cache (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hub_templates_cache (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT '',
      template_type TEXT NOT NULL DEFAULT 'claude_md',
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hub_prompts_cache (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hub_sync_metadata (
      resource_type TEXT PRIMARY KEY,
      last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: Optimize Hub cache tables with UNIQUE constraints and indexes
  migrateHubCacheTables(db);
}

/**
 * Migrate Hub cache tables to add UNIQUE constraints and indexes for better performance.
 * This function is idempotent and can be safely called multiple times.
 */
function migrateHubCacheTables(db: Database.Database): void {
  try {
    // Check if indexes already exist to avoid redundant operations
    const skillsIndexExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND name='idx_hub_skills_cache_name'
    `).get();

    if (!skillsIndexExists) {
      // Add indexes for better query performance
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_hub_skills_cache_name ON hub_skills_cache(name);
        CREATE INDEX IF NOT EXISTS idx_hub_templates_cache_name ON hub_templates_cache(name);
        CREATE INDEX IF NOT EXISTS idx_hub_prompts_cache_name ON hub_prompts_cache(name);
      `);
      console.log('[db] Hub cache table indexes created successfully');
    }
  } catch (err) {
    console.warn('[db] Warning: Hub cache table migration encountered an issue:', err);
    // Non-fatal: don't throw, allow the app to continue
  }
}

// ==========================================
// Session Operations
// ==========================================

export function getAllSessions(): ChatSession[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as ChatSession[];
}

export function getSession(id: string): ChatSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSession | undefined;
}

export function createSession(
  title?: string,
  model?: string,
  systemPrompt?: string,
  workingDirectory?: string,
  mode?: string,
): ChatSession {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const wd = workingDirectory || '';
  const projectName = wd ? path.basename(wd) : '';

  db.prepare(
    'INSERT INTO chat_sessions (id, title, created_at, updated_at, model, system_prompt, working_directory, sdk_session_id, project_name, status, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title || 'New Chat', now, now, model || '', systemPrompt || '', wd, '', projectName, 'active', mode || 'code');

  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateSessionTimestamp(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, id);
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id);
}

export function updateSdkSessionId(id: string, sdkSessionId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET sdk_session_id = ? WHERE id = ?').run(sdkSessionId, id);
}

export function updateSessionWorkingDirectory(id: string, workingDirectory: string): void {
  const db = getDb();
  const projectName = path.basename(workingDirectory);
  db.prepare('UPDATE chat_sessions SET working_directory = ?, project_name = ? WHERE id = ?').run(workingDirectory, projectName, id);
}

export function updateSessionMode(id: string, mode: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET mode = ? WHERE id = ?').run(mode, id);
}

// ==========================================
// Message Operations
// ==========================================

export function getMessages(sessionId: string): Message[] {
  const db = getDb();
  return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Message[];
}

export function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  tokenUsage?: string | null,
): Message {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO messages (id, session_id, role, content, created_at, token_usage) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, now, tokenUsage || null);

  updateSessionTimestamp(sessionId);

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message;
}

export function clearSessionMessages(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  // Reset SDK session ID so next message starts fresh
  db.prepare('UPDATE chat_sessions SET sdk_session_id = ? WHERE id = ?').run('', sessionId);
}

// ==========================================
// Settings Operations
// ==========================================

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function getAllSettings(): SettingsMap {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: SettingsMap = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ==========================================
// Session Status Operations
// ==========================================

export function updateSessionStatus(id: string, status: 'active' | 'archived'): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET status = ? WHERE id = ?').run(status, id);
}

// ==========================================
// Task Operations
// ==========================================

export function getTasksBySession(sessionId: string): TaskItem[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as TaskItem[];
}

export function getTask(id: string): TaskItem | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskItem | undefined;
}

export function createTask(sessionId: string, title: string, description?: string): TaskItem {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO tasks (id, session_id, title, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, title, 'pending', description || null, now, now);

  return getTask(id)!;
}

export function updateTask(id: string, updates: { title?: string; status?: TaskStatus; description?: string }): TaskItem | undefined {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const existing = getTask(id);
  if (!existing) return undefined;

  const title = updates.title ?? existing.title;
  const status = updates.status ?? existing.status;
  const description = updates.description !== undefined ? updates.description : existing.description;

  db.prepare(
    'UPDATE tasks SET title = ?, status = ?, description = ?, updated_at = ? WHERE id = ?'
  ).run(title, status, description, now, id);

  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

// ==========================================
// API Provider Operations
// ==========================================

export function getAllProviders(): ApiProvider[] {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers ORDER BY sort_order ASC, created_at ASC').all() as ApiProvider[];
}

export function getProvider(id: string): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider | undefined;
}

export function getActiveProvider(): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE is_active = 1 LIMIT 1').get() as ApiProvider | undefined;
}

export function createProvider(data: CreateProviderRequest): ApiProvider {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Get max sort_order to append at end
  const maxRow = db.prepare('SELECT MAX(sort_order) as max_order FROM api_providers').get() as { max_order: number | null };
  const sortOrder = (maxRow.max_order ?? -1) + 1;

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, default_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.provider_type || 'anthropic',
    data.base_url || '',
    data.api_key || '',
    0,
    sortOrder,
    data.extra_env || '{}',
    data.notes || '',
    data.default_model || null,
    now,
    now,
  );

  return getProvider(id)!;
}

export function updateProvider(id: string, data: UpdateProviderRequest): ApiProvider | undefined {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const name = data.name ?? existing.name;
  const providerType = data.provider_type ?? existing.provider_type;
  const baseUrl = data.base_url ?? existing.base_url;
  const apiKey = data.api_key ?? existing.api_key;
  const extraEnv = data.extra_env ?? existing.extra_env;
  const notes = data.notes ?? existing.notes;
  const sortOrder = data.sort_order ?? existing.sort_order;
  const defaultModel = data.default_model ?? existing.default_model;

  db.prepare(
    'UPDATE api_providers SET name = ?, provider_type = ?, base_url = ?, api_key = ?, extra_env = ?, notes = ?, sort_order = ?, default_model = ?, updated_at = ? WHERE id = ?'
  ).run(name, providerType, baseUrl, apiKey, extraEnv, notes, sortOrder, defaultModel, now, id);

  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_providers WHERE id = ?').run(id);
  return result.changes > 0;
}

export function activateProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE api_providers SET is_active = 0').run();
    db.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id);
  });
  transaction();
  return true;
}

export function deactivateAllProviders(): void {
  const db = getDb();
  db.prepare('UPDATE api_providers SET is_active = 0').run();
}

// ==========================================
// Hub Cache Operations
// ==========================================

export interface HubSkill {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  version: number;
  synced_at: string;
}

export interface HubTemplate {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  template_type: string;
  synced_at: string;
}

export interface HubPrompt {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  tags: string;
  synced_at: string;
}

// Skills Cache
export function getCachedSkills(): HubSkill[] {
  const db = getDb();
  return db.prepare('SELECT * FROM hub_skills_cache ORDER BY name ASC').all() as HubSkill[];
}

export function upsertSkillCache(skill: Omit<HubSkill, 'synced_at'>): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    INSERT INTO hub_skills_cache (id, name, content, description, publisher, version, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      content = excluded.content,
      description = excluded.description,
      publisher = excluded.publisher,
      version = excluded.version,
      synced_at = excluded.synced_at
  `).run(skill.id, skill.name, skill.content, skill.description, skill.publisher, skill.version, now);
}

export function clearSkillsCache(): void {
  const db = getDb();
  db.prepare('DELETE FROM hub_skills_cache').run();
}

export function deleteSkillCache(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM hub_skills_cache WHERE id = ?').run(id);
}

// Templates Cache
export function getCachedTemplates(): HubTemplate[] {
  const db = getDb();
  return db.prepare('SELECT * FROM hub_templates_cache ORDER BY name ASC').all() as HubTemplate[];
}

export function upsertTemplateCache(template: Omit<HubTemplate, 'synced_at'>): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    INSERT INTO hub_templates_cache (id, name, content, description, publisher, template_type, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      content = excluded.content,
      description = excluded.description,
      publisher = excluded.publisher,
      template_type = excluded.template_type,
      synced_at = excluded.synced_at
  `).run(template.id, template.name, template.content, template.description, template.publisher, template.template_type, now);
}

export function clearTemplatesCache(): void {
  const db = getDb();
  db.prepare('DELETE FROM hub_templates_cache').run();
}

export function deleteTemplateCache(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM hub_templates_cache WHERE id = ?').run(id);
}

// Prompts Cache
export function getCachedPrompts(): HubPrompt[] {
  const db = getDb();
  return db.prepare('SELECT * FROM hub_prompts_cache ORDER BY name ASC').all() as HubPrompt[];
}

export function upsertPromptCache(prompt: Omit<HubPrompt, 'synced_at'>): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    INSERT INTO hub_prompts_cache (id, name, content, description, publisher, tags, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      content = excluded.content,
      description = excluded.description,
      publisher = excluded.publisher,
      tags = excluded.tags,
      synced_at = excluded.synced_at
  `).run(prompt.id, prompt.name, prompt.content, prompt.description, prompt.publisher, prompt.tags, now);
}

export function clearPromptsCache(): void {
  const db = getDb();
  db.prepare('DELETE FROM hub_prompts_cache').run();
}

export function deletePromptCache(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM hub_prompts_cache WHERE id = ?').run(id);
}

// Sync Metadata
export function getLastSyncTime(resourceType: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT last_synced_at FROM hub_sync_metadata WHERE resource_type = ?').get(resourceType) as { last_synced_at: string } | undefined;
  return row?.last_synced_at || null;
}

export function updateSyncTime(resourceType: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    INSERT INTO hub_sync_metadata (resource_type, last_synced_at)
    VALUES (?, ?)
    ON CONFLICT(resource_type) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `).run(resourceType, now);
}

// ==========================================
// Graceful Shutdown
// ==========================================

/**
 * Close the database connection gracefully.
 * In WAL mode, this ensures the WAL is checkpointed and the
 * -wal/-shm files are cleaned up properly.
 */
export function closeDb(): void {
  if (db) {
    try {
      db.close();
      console.log('[db] Database closed gracefully');
    } catch (err) {
      console.warn('[db] Error closing database:', err);
    }
    db = null;
  }
}

// ========================
// Conversations
// ========================

export interface Conversation {
  id: string;
  session_id: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  raw_messages?: string | null; // JSON string of original messages
  source?: string; // 'local' or 'hub'
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  session_id: string;
  name: string;
  description: string;
  content: string;
  tags: string;
  raw_messages?: string | null;
  source?: string;
  created_at: string;
  updated_at: string;
}

export function getConversations(): Conversation[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as ConversationRow[];
  return rows.map(row => ({
    ...row,
    tags: JSON.parse(row.tags),
  }));
}

export function getConversation(id: string): Conversation | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags),
  };
}

export function getConversationBySessionId(sessionId: string): Conversation | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM conversations WHERE session_id = ?').get(sessionId) as ConversationRow | undefined;
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags),
  };
}

export function createOrUpdateConversation(conv: Omit<Conversation, 'created_at' | 'updated_at'>): Conversation {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const tagsJson = JSON.stringify(conv.tags);
  const rawMessages = conv.raw_messages || null;
  const source = conv.source || 'local';

  // Check if conversation exists for this session
  const existing = getConversationBySessionId(conv.session_id);

  if (existing) {
    // Update existing (覆盖)
    db.prepare(`
      UPDATE conversations
      SET name = ?, description = ?, content = ?, tags = ?, raw_messages = ?, source = ?, updated_at = ?
      WHERE session_id = ?
    `).run(conv.name, conv.description, conv.content, tagsJson, rawMessages, source, now, conv.session_id);

    return getConversation(existing.id)!;
  } else {
    // Create new
    db.prepare(`
      INSERT INTO conversations (id, session_id, name, description, content, tags, raw_messages, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(conv.id, conv.session_id, conv.name, conv.description, conv.content, tagsJson, rawMessages, source, now, now);

    return getConversation(conv.id)!;
  }
}

export function deleteConversation(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

// Register shutdown handlers to close the database when the process exits.
// This prevents WAL file accumulation and potential data loss.
function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[db] Received ${signal}, closing database...`);
    closeDb();
  };

  // 'exit' fires synchronously when the process is about to exit
  process.on('exit', () => shutdown('exit'));

  // Handle termination signals (Docker stop, systemd, Ctrl+C, etc.)
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
    process.exit(0);
  });

  // Handle Windows-specific close events
  if (process.platform === 'win32') {
    process.on('SIGHUP', () => {
      shutdown('SIGHUP');
      process.exit(0);
    });
  }
}

registerShutdownHandlers();
