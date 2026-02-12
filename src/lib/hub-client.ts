/**
 * CodePilot Hub Client
 * Connects to a CodePilot Hub server for shared configuration and usage reporting.
 */

interface HubConfig {
  url: string;
  userId: string;
  syncInterval: number; // seconds
}

interface HubProvider {
  id: number;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  extra_env: string;
  notes: string;
  is_active: number;
}

interface HubMcpServer {
  id: number;
  name: string;
  config: string; // JSON
}

interface HubSystemPrompt {
  id: number;
  name: string;
  content: string;
  description?: string;
  publisher?: string;
  tags?: string;
}

interface HubSkill {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  version: number;
}

interface HubTemplate {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  template_type: string;
}

interface HubSharedPrompt {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  tags: string;
}

interface HubConversation {
  id: number;
  title: string;
  content: string; // Summary content
  user_id: string;
  description: string;
  tags: string;
  raw_messages?: string | null; // ✅ JSON string of original messages
  created_at: string;
  updated_at: string;
}

interface HubSyncResponse {
  providers: HubProvider[];
  mcpServers: HubMcpServer[];
  systemPrompts: HubSystemPrompt[];
  sharedSkills?: HubSkill[];
  templates?: HubTemplate[];
  sharedPrompts?: HubSharedPrompt[];
}

interface UsageReport {
  userId: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface HealthResponse {
  status: string;
  version: string;
}

class HubClient {
  private config: HubConfig | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncData: HubSyncResponse | null = null;
  private connected = false;

  /**
   * Configure the Hub client with connection details.
   */
  configure(config: HubConfig): void {
    this.config = config;
    this.connected = false;
    this.lastSyncData = null;

    // Stop existing sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): HubConfig | null {
    return this.config;
  }

  /**
   * Get the configured user ID.
   */
  getUserId(): string {
    return this.config?.userId || 'anonymous';
  }

  /**
   * Check if the Hub is configured and connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get last synced data.
   */
  getLastSyncData(): HubSyncResponse | null {
    return this.lastSyncData;
  }

  /**
   * Check Hub health/connectivity.
   */
  async checkHealth(): Promise<HealthResponse | null> {
    if (!this.config?.url) return null;

    try {
      const res = await fetch(`${this.config.url}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        this.connected = true;
        return data as HealthResponse;
      }
    } catch {
      this.connected = false;
    }
    return null;
  }

  /**
   * Pull shared configuration from the Hub and cache it locally.
   */
  async syncConfig(): Promise<HubSyncResponse | null> {
    if (!this.config?.url) return null;

    try {
      const res = await fetch(`${this.config.url}/api/sync/config`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json() as HubSyncResponse;
        this.lastSyncData = data;
        this.connected = true;

        // Cache data locally for offline support
        await this.cacheHubData(data);

        return data;
      }
    } catch {
      this.connected = false;
    }
    return null;
  }

  /**
   * Cache Hub data to local database for offline access.
   */
  private async cacheHubData(data: HubSyncResponse): Promise<void> {
    // Skip caching in browser environment (client-side)
    if (typeof window !== 'undefined') {
      return;
    }

    // Dynamic import to avoid circular dependency
    const db = await import('./db');

    // Cache Skills
    if (data.sharedSkills) {
      db.clearSkillsCache();
      for (const skill of data.sharedSkills) {
        db.upsertSkillCache(skill);
      }
      db.updateSyncTime('skills');
    }

    // Cache Templates
    if (data.templates) {
      db.clearTemplatesCache();
      for (const template of data.templates) {
        db.upsertTemplateCache(template);
      }
      db.updateSyncTime('templates');
    }

    // Cache Prompts (from systemPrompts for backwards compatibility)
    if (data.systemPrompts) {
      db.clearPromptsCache();
      for (const prompt of data.systemPrompts) {
        db.upsertPromptCache({
          id: prompt.id,
          name: prompt.name,
          content: prompt.content,
          description: prompt.description || '',
          publisher: prompt.publisher || '',
          tags: prompt.tags || '',
        });
      }
      db.updateSyncTime('prompts');
    }

    // Cache Shared Prompts (from sharedPrompts - new API)
    if (data.sharedPrompts) {
      db.clearPromptsCache();
      for (const prompt of data.sharedPrompts) {
        db.upsertPromptCache({
          id: prompt.id,
          name: prompt.name,
          content: prompt.content,
          description: prompt.description || '',
          publisher: prompt.publisher || '',
          tags: prompt.tags || '',
        });
      }
      db.updateSyncTime('prompts');
    }
  }

  /**
   * Report usage data to the Hub (non-blocking, fire-and-forget).
   */
  async reportUsage(report: UsageReport): Promise<void> {
    if (!this.config?.url) return;

    try {
      await fetch(`${this.config.url}/api/usage/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Silent — usage reporting should never block the main flow
    }
  }

  /**
   * Start periodic configuration sync.
   */
  startSync(onSync?: (data: HubSyncResponse) => void): void {
    if (!this.config) return;

    // Initial sync
    this.syncConfig().then(data => {
      if (data && onSync) onSync(data);
    });

    // Periodic sync
    const intervalMs = (this.config.syncInterval || 300) * 1000;
    this.syncTimer = setInterval(async () => {
      const data = await this.syncConfig();
      if (data && onSync) onSync(data);
    }, intervalMs);
  }

  /**
   * Stop periodic sync.
   */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    this.stopSync();
    this.connected = false;
    this.lastSyncData = null;
  }

  // ==========================================
  // Read from Local Cache (Offline Support)
  // ==========================================

  /**
   * Get cached skills from local database.
   */
  async getCachedSkills(): Promise<HubSkill[]> {
    if (typeof window !== 'undefined') {
      return [];
    }
    const db = await import('./db');
    return db.getCachedSkills() as HubSkill[];
  }

  /**
   * Get cached templates from local database.
   */
  async getCachedTemplates(): Promise<HubTemplate[]> {
    if (typeof window !== 'undefined') {
      return [];
    }
    const db = await import('./db');
    return db.getCachedTemplates() as HubTemplate[];
  }

  /**
   * Get cached prompts from local database.
   */
  async getCachedPrompts(): Promise<HubSystemPrompt[]> {
    if (typeof window !== 'undefined') {
      return [];
    }
    const db = await import('./db');
    const prompts = db.getCachedPrompts();
    return prompts.map(p => ({
      id: p.id,
      name: p.name,
      content: p.content,
      description: p.description,
      publisher: p.publisher,
      tags: p.tags,
    }));
  }

  // ==========================================
  // Push to Hub (Publishing)
  // ==========================================

  /**
   * Publish a skill to the Hub.
   */
  async publishSkill(data: {
    name: string;
    content: string;
    description: string;
    publisher: string;
  }): Promise<HubSkill | null> {
    if (!this.config?.url) {
      throw new Error('Hub not configured');
    }

    try {
      const res = await fetch(`${this.config.url}/api/shared/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const skill = await res.json() as HubSkill;

        // Update local cache (server-side only)
        if (typeof window === 'undefined') {
          const db = await import('./db');
          db.upsertSkillCache(skill);
        }

        return skill;
      } else {
        const error = await res.text();
        throw new Error(`Failed to publish skill: ${error}`);
      }
    } catch (err) {
      console.error('[hub-client] publishSkill error:', err);
      throw err;
    }
  }

  /**
   * Publish a template to the Hub.
   */
  async publishTemplate(data: {
    name: string;
    content: string;
    description: string;
    publisher: string;
    template_type?: string;
  }): Promise<HubTemplate | null> {
    if (!this.config?.url) {
      throw new Error('Hub not configured');
    }

    try {
      const res = await fetch(`${this.config.url}/api/shared/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          template_type: data.template_type || 'claude_md',
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const template = await res.json() as HubTemplate;

        // Update local cache (server-side only)
        if (typeof window === 'undefined') {
          const db = await import('./db');
          db.upsertTemplateCache(template);
        }

        return template;
      } else {
        const error = await res.text();
        throw new Error(`Failed to publish template: ${error}`);
      }
    } catch (err) {
      console.error('[hub-client] publishTemplate error:', err);
      throw err;
    }
  }

  /**
   * Publish a prompt to the Hub.
   */
  async publishPrompt(data: {
    name: string;
    content: string;
    description: string;
    publisher: string;
    tags?: string;
  }): Promise<HubSharedPrompt | null> {
    if (!this.config?.url) {
      throw new Error('Hub not configured');
    }

    try {
      const res = await fetch(`${this.config.url}/api/shared/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          content: data.content,
          description: data.description,
          publisher: data.publisher,
          tags: data.tags || '',
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const prompt = await res.json() as HubSharedPrompt;

        // Update local cache (server-side only)
        if (typeof window === 'undefined') {
          const db = await import('./db');
          db.upsertPromptCache({
            id: prompt.id,
            name: prompt.name,
            content: prompt.content,
            description: prompt.description || '',
            publisher: prompt.publisher || '',
            tags: prompt.tags || '',
          });
        }

        return prompt;
      } else {
        const error = await res.text();
        throw new Error(`Failed to publish prompt: ${error}`);
      }
    } catch (err) {
      console.error('[hub-client] publishPrompt error:', err);
      throw err;
    }
  }

  /**
   * Fetch skills from Hub (with incremental sync support).
   */
  async fetchSkills(): Promise<HubSkill[]> {
    if (!this.config?.url) return [];

    try {
      const res = await fetch(`${this.config.url}/api/shared/skills`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return await res.json() as HubSkill[];
      }
    } catch (err) {
      console.error('[hub-client] fetchSkills error:', err);
    }
    return [];
  }

  /**
   * Fetch templates from Hub.
   */
  async fetchTemplates(): Promise<HubTemplate[]> {
    if (!this.config?.url) return [];

    try {
      const res = await fetch(`${this.config.url}/api/shared/templates`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return await res.json() as HubTemplate[];
      }
    } catch (err) {
      console.error('[hub-client] fetchTemplates error:', err);
    }
    return [];
  }

  /**
   * Fetch prompts from Hub.
   */
  async fetchPrompts(): Promise<HubSharedPrompt[]> {
    if (!this.config?.url) return [];

    try {
      const res = await fetch(`${this.config.url}/api/shared/prompts`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return await res.json() as HubSharedPrompt[];
      }
    } catch (err) {
      console.error('[hub-client] fetchPrompts error:', err);
    }
    return [];
  }

  /**
   * Delete a skill from Hub.
   */
  async deleteSkill(id: number): Promise<boolean> {
    if (!this.config?.url) throw new Error('Hub not configured');

    try {
      const res = await fetch(`${this.config.url}/api/shared/skills/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const db = await import('./db');
        db.deleteSkillCache(id);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[hub-client] deleteSkill error:', err);
      return false;
    }
  }

  /**
   * Delete a template from Hub.
   */
  async deleteTemplate(id: number): Promise<boolean> {
    if (!this.config?.url) throw new Error('Hub not configured');

    try {
      const res = await fetch(`${this.config.url}/api/shared/templates/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const db = await import('./db');
        db.deleteTemplateCache(id);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[hub-client] deleteTemplate error:', err);
      return false;
    }
  }

  /**
   * Delete a prompt from Hub.
   */
  async deletePrompt(id: number): Promise<boolean> {
    if (!this.config?.url) throw new Error('Hub not configured');

    try {
      const res = await fetch(`${this.config.url}/api/shared/prompts/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const db = await import('./db');
        db.deletePromptCache(id);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * Fetch shared conversations from Hub.
   */
  async fetchConversations(): Promise<HubConversation[]> {
    if (!this.config?.url) return [];

    try {
      const res = await fetch(`${this.config.url}/api/shared/conversations`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return await res.json() as HubConversation[];
      }
    } catch (err) {
      console.error('[hub-client] fetchConversations error:', err);
    }
    return [];
  }

  /**
   * Publish a conversation to the Hub.
   */
  async publishConversation(data: {
    title: string;
    content: string;
    description?: string;
    tags?: string;
    raw_messages?: string | null; // ✅ 添加原始对话支持
  }): Promise<HubConversation | null> {
    if (!this.config?.url) {
      throw new Error('Hub not configured');
    }

    try {
      const res = await fetch(`${this.config.url}/api/shared/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          content: data.content,
          user_id: this.config.userId,
          description: data.description || '',
          tags: data.tags || '',
          raw_messages: data.raw_messages || null, // ✅ 传递原始对话
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        return await res.json() as HubConversation;
      } else {
        const error = await res.text();
        throw new Error(`Failed to publish conversation: ${error}`);
      }
    } catch (err) {
      console.error('[hub-client] publishConversation error:', err);
      throw err;
    }
  }

  /**
   * Delete a conversation from Hub.
   */
  async deleteConversation(id: number): Promise<boolean> {
    if (!this.config?.url) throw new Error('Hub not configured');

    try {
      const res = await fetch(`${this.config.url}/api/shared/conversations/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10000),
      });

      return res.ok;
    } catch (err) {
      console.error('[hub-client] deleteConversation error:', err);
      return false;
    }
  }
}

// Singleton instance
export const hubClient = new HubClient();
export type {
  HubConfig,
  HubProvider,
  HubMcpServer,
  HubSystemPrompt,
  HubSkill,
  HubTemplate,
  HubSharedPrompt,
  HubConversation,
  HubSyncResponse,
  UsageReport
};
