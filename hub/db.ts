import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "hub.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS providers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    provider_type TEXT    NOT NULL DEFAULT 'anthropic',
    base_url      TEXT    NOT NULL DEFAULT '',
    api_key       TEXT    NOT NULL DEFAULT '',
    extra_env     TEXT    NOT NULL DEFAULT '{}',
    notes         TEXT    NOT NULL DEFAULT '',
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mcp_servers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    config      TEXT    NOT NULL DEFAULT '{}',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL DEFAULT '',
    session_id    TEXT    NOT NULL DEFAULT '',
    model         TEXT    NOT NULL DEFAULT '',
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL    NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS system_prompts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    content     TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shared_skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    content     TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    publisher   TEXT    NOT NULL DEFAULT '',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shared_templates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL UNIQUE,
    content       TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    publisher     TEXT    NOT NULL DEFAULT '',
    template_type TEXT    NOT NULL DEFAULT 'claude_md',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shared_prompts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    content     TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    publisher   TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shared_conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    user_id     TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Schema migration: Add missing fields to existing tables
// ---------------------------------------------------------------------------

// Migration for mcp_servers: add description and publisher
const mcpColumns = db.prepare("PRAGMA table_info(mcp_servers)").all() as Array<{ name: string }>;
const mcpColNames = mcpColumns.map(c => c.name);

if (!mcpColNames.includes('description')) {
  db.exec("ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}
if (!mcpColNames.includes('publisher')) {
  db.exec("ALTER TABLE mcp_servers ADD COLUMN publisher TEXT NOT NULL DEFAULT ''");
}

// Migration for system_prompts: add description, publisher, and tags
const promptColumns = db.prepare("PRAGMA table_info(system_prompts)").all() as Array<{ name: string }>;
const promptColNames = promptColumns.map(c => c.name);

if (!promptColNames.includes('description')) {
  db.exec("ALTER TABLE system_prompts ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}
if (!promptColNames.includes('publisher')) {
  db.exec("ALTER TABLE system_prompts ADD COLUMN publisher TEXT NOT NULL DEFAULT ''");
}
if (!promptColNames.includes('tags')) {
  db.exec("ALTER TABLE system_prompts ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
}

// Migration for shared_conversations: add raw_messages
const convColumns = db.prepare("PRAGMA table_info(shared_conversations)").all() as Array<{ name: string }>;
const convColNames = convColumns.map(c => c.name);

if (!convColNames.includes('raw_messages')) {
  db.exec("ALTER TABLE shared_conversations ADD COLUMN raw_messages TEXT");
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface Provider {
  id: number;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  extra_env: string;
  notes: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface McpServer {
  id: number;
  name: string;
  config: string;
  description: string;
  publisher: string;
  created_at: string;
  updated_at: string;
}

export interface UsageRecord {
  id: number;
  user_id: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface SystemPrompt {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface SharedPrompt {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface SharedConversation {
  id: number;
  title: string;
  content: string;
  user_id: string;
  description: string;
  tags: string;
  raw_messages?: string | null; // ✅ 原始对话 JSON
  created_at: string;
  updated_at: string;
}

export interface SharedSkill {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SharedTemplate {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  template_type: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Providers CRUD
// ---------------------------------------------------------------------------

const stmtInsertProvider = db.prepare(`
  INSERT INTO providers (name, provider_type, base_url, api_key, extra_env, notes, is_active)
  VALUES (@name, @provider_type, @base_url, @api_key, @extra_env, @notes, @is_active)
`);

const stmtUpdateProvider = db.prepare(`
  UPDATE providers
  SET name = @name,
      provider_type = @provider_type,
      base_url = @base_url,
      api_key = @api_key,
      extra_env = @extra_env,
      notes = @notes,
      is_active = @is_active,
      updated_at = datetime('now')
  WHERE id = @id
`);

const stmtDeleteProvider = db.prepare(`DELETE FROM providers WHERE id = ?`);
const stmtGetProviders = db.prepare(`SELECT * FROM providers ORDER BY id`);
const stmtGetActiveProviders = db.prepare(`SELECT * FROM providers WHERE is_active = 1 ORDER BY id`);
const stmtGetProviderById = db.prepare(`SELECT * FROM providers WHERE id = ?`);

export function getAllProviders(): Provider[] {
  return stmtGetProviders.all() as Provider[];
}

export function getActiveProviders(): Provider[] {
  return stmtGetActiveProviders.all() as Provider[];
}

export function getProviderById(id: number): Provider | undefined {
  return stmtGetProviderById.get(id) as Provider | undefined;
}

export function createProvider(data: Omit<Provider, "id" | "created_at" | "updated_at">): Provider {
  const info = stmtInsertProvider.run(data);
  return getProviderById(info.lastInsertRowid as number)!;
}

export function updateProvider(id: number, data: Partial<Omit<Provider, "id" | "created_at" | "updated_at">>): Provider | undefined {
  const existing = getProviderById(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...data, id };
  stmtUpdateProvider.run(merged);
  return getProviderById(id);
}

export function deleteProvider(id: number): boolean {
  const info = stmtDeleteProvider.run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// MCP Servers CRUD
// ---------------------------------------------------------------------------

const stmtInsertMcp = db.prepare(`
  INSERT INTO mcp_servers (name, config, description, publisher)
  VALUES (@name, @config, @description, @publisher)
`);

const stmtUpdateMcp = db.prepare(`
  UPDATE mcp_servers
  SET name = @name, config = @config, description = @description, publisher = @publisher, updated_at = datetime('now')
  WHERE id = @id
`);

const stmtDeleteMcp = db.prepare(`DELETE FROM mcp_servers WHERE id = ?`);
const stmtGetMcpServers = db.prepare(`SELECT * FROM mcp_servers ORDER BY id`);
const stmtGetMcpById = db.prepare(`SELECT * FROM mcp_servers WHERE id = ?`);

export function getAllMcpServers(): McpServer[] {
  return stmtGetMcpServers.all() as McpServer[];
}

export function getMcpServerById(id: number): McpServer | undefined {
  return stmtGetMcpById.get(id) as McpServer | undefined;
}

export function createMcpServer(data: { name: string; config: string; description?: string; publisher?: string }): McpServer {
  const info = stmtInsertMcp.run({
    name: data.name,
    config: data.config,
    description: data.description || '',
    publisher: data.publisher || '',
  });
  return getMcpServerById(info.lastInsertRowid as number)!;
}

export function updateMcpServer(id: number, data: { name?: string; config?: string; description?: string; publisher?: string }): McpServer | undefined {
  const existing = getMcpServerById(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...data, id };
  stmtUpdateMcp.run(merged);
  return getMcpServerById(id);
}

export function deleteMcpServer(id: number): boolean {
  const info = stmtDeleteMcp.run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// System Prompts CRUD
// ---------------------------------------------------------------------------

const stmtInsertPrompt = db.prepare(`
  INSERT INTO system_prompts (name, content, description, publisher, tags)
  VALUES (@name, @content, @description, @publisher, @tags)
`);

const stmtUpdatePrompt = db.prepare(`
  UPDATE system_prompts
  SET name = @name, content = @content, description = @description, publisher = @publisher, tags = @tags, updated_at = datetime('now')
  WHERE id = @id
`);

const stmtDeletePrompt = db.prepare(`DELETE FROM system_prompts WHERE id = ?`);
const stmtGetPrompts = db.prepare(`SELECT * FROM system_prompts ORDER BY id`);
const stmtGetPromptById = db.prepare(`SELECT * FROM system_prompts WHERE id = ?`);

export function getAllSystemPrompts(): SystemPrompt[] {
  return stmtGetPrompts.all() as SystemPrompt[];
}

export function getSystemPromptById(id: number): SystemPrompt | undefined {
  return stmtGetPromptById.get(id) as SystemPrompt | undefined;
}

export function createSystemPrompt(data: { name: string; content: string; description?: string; publisher?: string; tags?: string }): SystemPrompt {
  const info = stmtInsertPrompt.run({
    name: data.name,
    content: data.content,
    description: data.description || '',
    publisher: data.publisher || '',
    tags: data.tags || '',
  });
  return getSystemPromptById(info.lastInsertRowid as number)!;
}

export function updateSystemPrompt(id: number, data: { name?: string; content?: string; description?: string; publisher?: string; tags?: string }): SystemPrompt | undefined {
  const existing = getSystemPromptById(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...data, id };
  stmtUpdatePrompt.run(merged);
  return getSystemPromptById(id);
}

export function deleteSystemPrompt(id: number): boolean {
  const info = stmtDeletePrompt.run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Shared Skills CRUD
// ---------------------------------------------------------------------------

const stmtInsertSkill = db.prepare(`
  INSERT INTO shared_skills (name, content, description, publisher, version)
  VALUES (@name, @content, @description, @publisher, @version)
  ON CONFLICT(name) DO UPDATE SET
    content = excluded.content,
    description = excluded.description,
    publisher = excluded.publisher,
    version = version + 1,
    updated_at = datetime('now')
`);

const stmtDeleteSkill = db.prepare(`DELETE FROM shared_skills WHERE id = ?`);
const stmtGetSkills = db.prepare(`SELECT * FROM shared_skills ORDER BY name ASC`);
const stmtGetSkillById = db.prepare(`SELECT * FROM shared_skills WHERE id = ?`);

export function getAllSharedSkills(): SharedSkill[] {
  return stmtGetSkills.all() as SharedSkill[];
}

export function getSharedSkillById(id: number): SharedSkill | undefined {
  return stmtGetSkillById.get(id) as SharedSkill | undefined;
}

export function createOrUpdateSharedSkill(data: {
  name: string;
  content: string;
  description?: string;
  publisher?: string;
}): SharedSkill {
  const info = stmtInsertSkill.run({
    name: data.name,
    content: data.content,
    description: data.description || '',
    publisher: data.publisher || '',
    version: 1,
  });
  // If INSERT, lastInsertRowid will be the new ID; if UPDATE (conflict), it will be 0
  if (info.lastInsertRowid) {
    return getSharedSkillById(info.lastInsertRowid as number)!;
  } else {
    // Find by name after update
    const skill = (db.prepare(`SELECT * FROM shared_skills WHERE name = ?`).get(data.name)) as SharedSkill;
    return skill;
  }
}

export function deleteSharedSkill(id: number): boolean {
  const info = stmtDeleteSkill.run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Shared Templates CRUD
// ---------------------------------------------------------------------------

const stmtInsertTemplate = db.prepare(`
  INSERT INTO shared_templates (name, content, description, publisher, template_type)
  VALUES (@name, @content, @description, @publisher, @template_type)
  ON CONFLICT(name) DO UPDATE SET
    content = excluded.content,
    description = excluded.description,
    publisher = excluded.publisher,
    template_type = excluded.template_type,
    updated_at = datetime('now')
`);

const stmtDeleteTemplate = db.prepare(`DELETE FROM shared_templates WHERE id = ?`);
const stmtGetTemplates = db.prepare(`SELECT * FROM shared_templates ORDER BY name ASC`);
const stmtGetTemplateById = db.prepare(`SELECT * FROM shared_templates WHERE id = ?`);

// ---------------------------------------------------------------------------
// Shared Prompts CRUD
// ---------------------------------------------------------------------------

const stmtInsertSharedPrompt = db.prepare(`
  INSERT INTO shared_prompts (name, content, description, publisher, tags)
  VALUES (@name, @content, @description, @publisher, @tags)
  ON CONFLICT(name) DO UPDATE SET
    content = excluded.content,
    description = excluded.description,
    publisher = excluded.publisher,
    tags = excluded.tags,
    updated_at = datetime('now')
`);

const stmtDeleteSharedPrompt = db.prepare(`DELETE FROM shared_prompts WHERE id = ?`);
const stmtGetSharedPrompts = db.prepare(`SELECT * FROM shared_prompts ORDER BY created_at DESC`);
const stmtGetSharedPromptById = db.prepare(`SELECT * FROM shared_prompts WHERE id = ?`);

export function getAllSharedTemplates(): SharedTemplate[] {
  return stmtGetTemplates.all() as SharedTemplate[];
}

export function getSharedTemplateById(id: number): SharedTemplate | undefined {
  return stmtGetTemplateById.get(id) as SharedTemplate | undefined;
}

export function createOrUpdateSharedTemplate(data: {
  name: string;
  content: string;
  description?: string;
  publisher?: string;
  template_type?: string;
}): SharedTemplate {
  const info = stmtInsertTemplate.run({
    name: data.name,
    content: data.content,
    description: data.description || '',
    publisher: data.publisher || '',
    template_type: data.template_type || 'claude_md',
  });
  if (info.lastInsertRowid) {
    return getSharedTemplateById(info.lastInsertRowid as number)!;
  } else {
    const template = (db.prepare(`SELECT * FROM shared_templates WHERE name = ?`).get(data.name)) as SharedTemplate;
    return template;
  }
}

export function deleteSharedTemplate(id: number): boolean {
  const info = stmtDeleteTemplate.run(id);
  return info.changes > 0;
}

export function getAllSharedPrompts(): SharedPrompt[] {
  return stmtGetSharedPrompts.all() as SharedPrompt[];
}

export function getSharedPromptById(id: number): SharedPrompt | undefined {
  return stmtGetSharedPromptById.get(id) as SharedPrompt | undefined;
}

export function createOrUpdateSharedPrompt(data: {
  name: string;
  content: string;
  description?: string;
  publisher?: string;
  tags?: string;
}): SharedPrompt {
  const info = stmtInsertSharedPrompt.run({
    name: data.name,
    content: data.content,
    description: data.description || '',
    publisher: data.publisher || '',
    tags: data.tags || '',
  });
  if (info.lastInsertRowid) {
    return getSharedPromptById(info.lastInsertRowid as number)!;
  } else {
    const prompt = (db.prepare(`SELECT * FROM shared_prompts WHERE name = ?`).get(data.name)) as SharedPrompt;
    return prompt;
  }
}

export function deleteSharedPrompt(id: number): boolean {
  const info = stmtDeleteSharedPrompt.run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Shared Conversations CRUD
// ---------------------------------------------------------------------------

const stmtInsertSharedConversation = db.prepare(`
  INSERT INTO shared_conversations (title, content, user_id, description, tags, raw_messages)
  VALUES (@title, @content, @user_id, @description, @tags, @raw_messages)
`);

const stmtDeleteSharedConversation = db.prepare(`DELETE FROM shared_conversations WHERE id = ?`);
const stmtGetSharedConversations = db.prepare(`SELECT * FROM shared_conversations ORDER BY created_at DESC`);
const stmtGetSharedConversationById = db.prepare(`SELECT * FROM shared_conversations WHERE id = ?`);

export function getAllSharedConversations(): SharedConversation[] {
  return stmtGetSharedConversations.all() as SharedConversation[];
}

export function getSharedConversationById(id: number): SharedConversation | undefined {
  return stmtGetSharedConversationById.get(id) as SharedConversation | undefined;
}

export function createSharedConversation(data: {
  title: string;
  content: string;
  user_id?: string;
  description?: string;
  tags?: string;
  raw_messages?: string | null; // ✅ 添加原始对话支持
}): SharedConversation {
  const info = stmtInsertSharedConversation.run({
    title: data.title,
    content: data.content,
    user_id: data.user_id || '',
    description: data.description || '',
    tags: data.tags || '',
    raw_messages: data.raw_messages || null, // ✅ 传递原始对话
  });
  return getSharedConversationById(info.lastInsertRowid as number)!;
}

export function deleteSharedConversation(id: number): boolean {
  const info = stmtDeleteSharedConversation.run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Usage Records
// ---------------------------------------------------------------------------

const stmtInsertUsage = db.prepare(`
  INSERT INTO usage_records (user_id, session_id, model, input_tokens, output_tokens, cost_usd)
  VALUES (@user_id, @session_id, @model, @input_tokens, @output_tokens, @cost_usd)
`);

const stmtGetUsageAll = db.prepare(`
  SELECT * FROM usage_records ORDER BY created_at DESC
`);

const stmtGetUsageByUser = db.prepare(`
  SELECT * FROM usage_records WHERE user_id = ? ORDER BY created_at DESC
`);

const stmtUsageByUserSummary = db.prepare(`
  SELECT user_id,
         COUNT(*)            AS record_count,
         SUM(input_tokens)   AS total_input_tokens,
         SUM(output_tokens)  AS total_output_tokens,
         SUM(cost_usd)       AS total_cost_usd
  FROM usage_records
  GROUP BY user_id
  ORDER BY total_cost_usd DESC
`);

const stmtUsageByUserFiltered = db.prepare(`
  SELECT user_id,
         COUNT(*)            AS record_count,
         SUM(input_tokens)   AS total_input_tokens,
         SUM(output_tokens)  AS total_output_tokens,
         SUM(cost_usd)       AS total_cost_usd
  FROM usage_records
  WHERE user_id = ?
  GROUP BY user_id
`);

const stmtUsageByModel = db.prepare(`
  SELECT model,
         COUNT(*)            AS record_count,
         SUM(input_tokens)   AS total_input_tokens,
         SUM(output_tokens)  AS total_output_tokens,
         SUM(cost_usd)       AS total_cost_usd
  FROM usage_records
  GROUP BY model
  ORDER BY total_cost_usd DESC
`);

const stmtUsageTotals = db.prepare(`
  SELECT COUNT(*)            AS record_count,
         SUM(input_tokens)   AS total_input_tokens,
         SUM(output_tokens)  AS total_output_tokens,
         SUM(cost_usd)       AS total_cost_usd
  FROM usage_records
`);

const stmtUsageTotalsFiltered = db.prepare(`
  SELECT COUNT(*)            AS record_count,
         SUM(input_tokens)   AS total_input_tokens,
         SUM(output_tokens)  AS total_output_tokens,
         SUM(cost_usd)       AS total_cost_usd
  FROM usage_records
  WHERE user_id = ?
`);

export interface UsageReportInput {
  user_id: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export function recordUsage(data: UsageReportInput): UsageRecord {
  const info = stmtInsertUsage.run(data);
  return {
    id: info.lastInsertRowid as number,
    ...data,
    created_at: new Date().toISOString(),
  };
}

export function getUsageRecords(userId?: string): UsageRecord[] {
  if (userId) {
    return stmtGetUsageByUser.all(userId) as UsageRecord[];
  }
  return stmtGetUsageAll.all() as UsageRecord[];
}

export interface UsageSummary {
  by_user: unknown[];
  by_model: unknown[];
  totals: unknown;
  records: UsageRecord[];
}

export function getUsageStats(userId?: string): UsageSummary {
  const byUser = userId
    ? stmtUsageByUserFiltered.all(userId)
    : stmtUsageByUserSummary.all();
  const byModel = stmtUsageByModel.all();
  const totals = userId
    ? stmtUsageTotalsFiltered.get(userId)
    : stmtUsageTotals.get();
  const records = getUsageRecords(userId);

  return { by_user: byUser, by_model: byModel, totals, records };
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

const stmtGetSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const stmtSetSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);
const stmtGetAllSettings = db.prepare(`SELECT key, value FROM settings`);

export function getSetting(key: string): string | null {
  const row = stmtGetSetting.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  stmtSetSetting.run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = stmtGetAllSettings.all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export function closeDatabase(): void {
  db.close();
}

export default db;
