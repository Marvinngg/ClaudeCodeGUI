import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  SDKTaskNotificationMessage,
  SDKToolUseSummaryMessage,
  SDKStatusMessage,
  SDKHookStartedMessage,
  Options,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig,
  NotificationHookInput,
  PostToolUseHookInput,
  TeammateIdleHookInput,
  TaskCompletedHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeStreamOptions, SSEEvent, TokenUsage, MCPServerConfig, PermissionRequestEvent, FileAttachment } from '@/types';
import { isImageFile } from '@/types';
import { registerPendingPermission } from './permission-registry';
import { getSetting, getActiveProvider } from './db';
import { findClaudeBinary, findGitBash, getExpandedPath } from './platform';
import os from 'os';
import fs from 'fs';
import path from 'path';

let cachedClaudePath: string | null | undefined;
let cachedClaudeSettings: Record<string, unknown> | null | undefined;

/**
 * Clear cached Claude Code settings (call after settings are modified)
 */
export function clearClaudeSettingsCache(): void {
  cachedClaudeSettings = undefined;
  console.log('[claude-client] Claude Code settings cache cleared');
}

/**
 * Read Claude Code settings from ~/.claude/settings.json
 * Returns cached result after first read
 */
function getClaudeCodeSettings(): Record<string, unknown> | null {
  if (cachedClaudeSettings !== undefined) return cachedClaudeSettings;

  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(content);
      cachedClaudeSettings = parsed;
      console.log('[claude-client] Loaded Claude Code settings from', settingsPath);
      return parsed;
    }
  } catch (error) {
    console.warn('[claude-client] Failed to read Claude Code settings:', error);
  }

  cachedClaudeSettings = null;
  return null;
}

function findClaudePath(): string | undefined {
  if (cachedClaudePath !== undefined) return cachedClaudePath || undefined;
  const found = findClaudeBinary();
  cachedClaudePath = found ?? null;
  return found;
}

/**
 * Convert our MCPServerConfig to the SDK's McpServerConfig format.
 * Supports stdio, sse, and http transport types.
 */
function toSdkMcpConfig(
  servers: Record<string, MCPServerConfig>
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio';

    switch (transport) {
      case 'sse': {
        if (!config.url) {
          console.warn(`[mcp] SSE server "${name}" is missing url, skipping`);
          continue;
        }
        const sseConfig: McpSSEServerConfig = {
          type: 'sse',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers;
        }
        result[name] = sseConfig;
        break;
      }

      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }
        const httpConfig: McpHttpServerConfig = {
          type: 'http',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers;
        }
        result[name] = httpConfig;
        break;
      }

      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }
        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        };
        result[name] = stdioConfig;
        break;
      }
    }
  }
  return result;
}

/**
 * Format an SSE line from an event object
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Extract text content from an SDK assistant message
 */
function extractTextFromMessage(msg: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Extract token usage from an SDK result message
 */
function extractTokenUsage(msg: SDKResultMessage): TokenUsage | null {
  if (!msg.usage) return null;
  return {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cost_usd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
  };
}

/**
 * Stream Claude responses using the Agent SDK.
 * Returns a ReadableStream of SSE-formatted strings.
 */
/**
 * Save non-image file attachments to a temporary upload directory
 * and return the file paths. The files are placed in .codepilot-uploads/
 * under the working directory so Claude's Read tool can access them.
 */
function saveUploadedFiles(files: FileAttachment[], workDir: string): string[] {
  const uploadDir = path.join(workDir, '.codepilot-uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const savedPaths: string[] = [];
  for (const file of files) {
    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const filePath = path.join(uploadDir, `${timestamp}-${safeName}`);
    const buffer = Buffer.from(file.data, 'base64');
    fs.writeFileSync(filePath, buffer);
    savedPaths.push(filePath);
  }
  return savedPaths;
}

/**
 * Check if there are active team tasks (pending or in_progress) or unread inbox messages.
 * Used to determine if we need to resume the conversation in teams mode.
 */
function hasActiveTeamWork(): boolean {
  const homedir = os.homedir();
  let foundActiveTasks = false;
  let foundUnreadMessages = false;

  // Check for pending/in_progress tasks
  const tasksDir = path.join(homedir, '.claude', 'tasks');
  try {
    if (fs.existsSync(tasksDir)) {
      const teamDirs = fs.readdirSync(tasksDir);
      console.log(`[hasActiveTeamWork] Found ${teamDirs.length} team directories in tasks/`);
      for (const dir of teamDirs) {
        const teamPath = path.join(tasksDir, dir);
        try {
          if (!fs.statSync(teamPath).isDirectory()) continue;
        } catch { continue; }
        const files = fs.readdirSync(teamPath).filter(f => f.endsWith('.json'));
        console.log(`[hasActiveTeamWork] Team ${dir}: ${files.length} task files`);
        for (const file of files) {
          try {
            const taskPath = path.join(teamPath, file);
            const task = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
            console.log(`[hasActiveTeamWork] Task ${file}: status=${task.status}`);
            if (task.status === 'pending' || task.status === 'in_progress') {
              console.log(`[hasActiveTeamWork] ✅ Found active task: ${file} (${task.status})`);
              foundActiveTasks = true;
            }
          } catch (err) {
            console.error(`[hasActiveTeamWork] Failed to read task ${file}:`, err);
            continue;
          }
        }
      }
    } else {
      console.log(`[hasActiveTeamWork] Tasks directory does not exist: ${tasksDir}`);
    }
  } catch (err) {
    console.error('[hasActiveTeamWork] Error checking tasks:', err);
  }

  // Check for unread inbox messages
  const teamsDir = path.join(homedir, '.claude', 'teams');
  try {
    if (fs.existsSync(teamsDir)) {
      const teamDirs = fs.readdirSync(teamsDir);
      console.log(`[hasActiveTeamWork] Found ${teamDirs.length} team directories in teams/`);
      for (const dir of teamDirs) {
        const inboxDir = path.join(teamsDir, dir, 'inboxes');
        if (!fs.existsSync(inboxDir)) {
          console.log(`[hasActiveTeamWork] Team ${dir}: no inboxes directory`);
          continue;
        }
        const inboxFiles = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json'));
        console.log(`[hasActiveTeamWork] Team ${dir}: ${inboxFiles.length} inbox files`);
        for (const file of inboxFiles) {
          try {
            const inboxPath = path.join(inboxDir, file);
            const data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
            const messages = Array.isArray(data) ? data : (data.messages || []);
            const unreadCount = messages.filter((msg: Record<string, unknown>) => msg.read === false).length;
            console.log(`[hasActiveTeamWork] Inbox ${file}: ${messages.length} total, ${unreadCount} unread`);
            if (unreadCount > 0) {
              console.log(`[hasActiveTeamWork] ✅ Found ${unreadCount} unread messages in ${file}`);
              foundUnreadMessages = true;
            }
          } catch (err) {
            console.error(`[hasActiveTeamWork] Failed to read inbox ${file}:`, err);
            continue;
          }
        }
      }
    } else {
      console.log(`[hasActiveTeamWork] Teams directory does not exist: ${teamsDir}`);
    }
  } catch (err) {
    console.error('[hasActiveTeamWork] Error checking inboxes:', err);
  }

  const hasWork = foundActiveTasks || foundUnreadMessages;
  console.log(`[hasActiveTeamWork] Result: ${hasWork} (tasks=${foundActiveTasks}, messages=${foundUnreadMessages})`);
  return hasWork;
}

export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  const {
    prompt,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    mcpServers,
    abortController,
    permissionMode,
    files,
    enableAgentTeams,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      // 🔧 Teams 模式下添加心跳机制，防止长时间无数据时 SSE 连接断开
      let heartbeatInterval: NodeJS.Timeout | null = null;
      if (enableAgentTeams) {
        heartbeatInterval = setInterval(() => {
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({ heartbeat: true }),
          }));
        }, 15000); // 每 15 秒发送一次心跳
      }

      try {
        // Build env for the Claude Code subprocess.
        // Start with process.env (includes user shell env from Electron's loadUserShellEnv).
        // Then overlay any API config the user set in CodePilot settings (optional).
        const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> };

        // Ensure HOME/USERPROFILE are set so Claude Code can find ~/.claude/commands/
        if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir();
        if (!sdkEnv.USERPROFILE) sdkEnv.USERPROFILE = os.homedir();
        // Ensure SDK subprocess has expanded PATH (consistent with Electron mode)
        sdkEnv.PATH = getExpandedPath();

        // On Windows, auto-detect Git Bash if not already configured
        if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
          const gitBashPath = findGitBash();
          if (gitBashPath) {
            sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
          }
        }

        // Enable Agent Teams if requested (experimental feature)
        if (enableAgentTeams) {
          sdkEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
        }

        // Try to get config from active provider first
        const activeProvider = getActiveProvider();

        if (activeProvider && activeProvider.api_key) {
          // Clear all existing ANTHROPIC_* variables to prevent conflicts
          for (const key of Object.keys(sdkEnv)) {
            if (key.startsWith('ANTHROPIC_')) {
              delete sdkEnv[key];
            }
          }

          // Inject provider config — set both token variants so extra_env can clear the unwanted one
          sdkEnv.ANTHROPIC_AUTH_TOKEN = activeProvider.api_key;
          sdkEnv.ANTHROPIC_API_KEY = activeProvider.api_key;
          if (activeProvider.base_url) {
            sdkEnv.ANTHROPIC_BASE_URL = activeProvider.base_url;
          }

          // Inject extra environment variables
          // Empty string values mean "delete this variable" (e.g. clear ANTHROPIC_API_KEY for AUTH_TOKEN-only providers)
          try {
            const extraEnv = JSON.parse(activeProvider.extra_env || '{}');
            for (const [key, value] of Object.entries(extraEnv)) {
              if (typeof value === 'string') {
                if (value === '') {
                  delete sdkEnv[key];
                } else {
                  sdkEnv[key] = value;
                }
              }
            }
          } catch {
            // ignore malformed extra_env
          }
        } else {
          // No active provider — try to read from local Claude Code settings.json first
          // This allows CodePilot to use the same configuration as Claude Code CLI
          const claudeSettings = getClaudeCodeSettings();
          const claudeEnv = claudeSettings?.env as Record<string, string> | undefined;

          if (claudeEnv && Object.keys(claudeEnv).length > 0) {
            // Inject all environment variables from Claude Code settings
            for (const [key, value] of Object.entries(claudeEnv)) {
              if (typeof value === 'string') {
                sdkEnv[key] = value;
              }
            }
            console.log('[claude-client] Using Claude Code settings.json env configuration');
          } else {
            // Fallback: check legacy DB settings, then environment variables
            const appToken = getSetting('anthropic_auth_token');
            const appBaseUrl = getSetting('anthropic_base_url');
            if (appToken) {
              sdkEnv.ANTHROPIC_AUTH_TOKEN = appToken;
            }
            if (appBaseUrl) {
              sdkEnv.ANTHROPIC_BASE_URL = appBaseUrl;
            }
            // If neither legacy settings nor env vars provide a key, log a warning
            if (!appToken && !sdkEnv.ANTHROPIC_API_KEY && !sdkEnv.ANTHROPIC_AUTH_TOKEN) {
              console.warn('[claude-client] No API key found: no active provider, no Claude Code settings.json, no legacy settings, and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment');
            }
          }
        }

        const effectivePermMode = (permissionMode as Options['permissionMode']) || 'acceptEdits';
        const queryOptions: Options = {
          // 🔧 GUI 模式下默认使用用户主目录，而不是应用启动目录 (process.cwd())
          cwd: workingDirectory || os.homedir(),
          abortController,
          includePartialMessages: true,
          permissionMode: effectivePermMode,
          env: sdkEnv,
          // 加载文件系统设置：skills、slash commands、CLAUDE.md 等
          settingSources: ['user', 'project'],
          // bypassPermissions requires this safety flag
          ...(effectivePermMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
        };

        // Teams mode: allow many turns so the team lead can coordinate subagents
        if (enableAgentTeams) {
          queryOptions.maxTurns = 200;
        }

        // Find claude binary for packaged app where PATH is limited
        const claudePath = findClaudePath();
        if (claudePath) {
          queryOptions.pathToClaudeCodeExecutable = claudePath;
        }

        if (model) {
          queryOptions.model = model;
        }

        // ✅ 始终使用 claude_code preset（包含 skills 元数据、工作目录感知等）
        // 即使没有额外的 systemPrompt，也必须设置 preset 才能加载 skills
        queryOptions.systemPrompt = {
          type: 'preset',
          preset: 'claude_code',
          ...(systemPrompt ? { append: systemPrompt } : {}),
        };

        if (mcpServers && Object.keys(mcpServers).length > 0) {
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers);
        }

        // Resume session if we have an SDK session ID from a previous conversation turn
        if (sdkSessionId) {
          queryOptions.resume = sdkSessionId;
        }

        // Permission handler: sends SSE event and waits for user response
        // Skip for bypassPermissions mode (e.g. teams) — SDK won't call it anyway,
        // and not setting it avoids potential issues with concurrent permission requests.
        if (effectivePermMode !== 'bypassPermissions') {
        queryOptions.canUseTool = async (toolName, input, opts) => {
          const permissionRequestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const permEvent: PermissionRequestEvent = {
            permissionRequestId,
            toolName,
            toolInput: input,
            suggestions: opts.suggestions as PermissionRequestEvent['suggestions'],
            decisionReason: opts.decisionReason,
            blockedPath: opts.blockedPath,
            toolUseId: opts.toolUseID,
            description: undefined,
          };

          // Send permission_request SSE event to the client
          controller.enqueue(formatSSE({
            type: 'permission_request',
            data: JSON.stringify(permEvent),
          }));

          // Wait for user response (resolved by POST /api/chat/permission)
          // Store original input so registry can inject updatedInput on allow
          return registerPendingPermission(permissionRequestId, input, opts.signal);
        };
        } // end if (effectivePermMode !== 'bypassPermissions')

        // Hooks: capture notifications and tool completion events
        queryOptions.hooks = {
          Notification: [{
            hooks: [async (input) => {
              const notif = input as NotificationHookInput;
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  notification: true,
                  title: notif.title,
                  message: notif.message,
                }),
              }));
              return {};
            }],
          }],
          PostToolUse: [{
            hooks: [async (input) => {
              const toolEvent = input as PostToolUseHookInput;
              controller.enqueue(formatSSE({
                type: 'tool_result',
                data: JSON.stringify({
                  tool_use_id: toolEvent.tool_use_id,
                  content: typeof toolEvent.tool_response === 'string'
                    ? toolEvent.tool_response
                    : JSON.stringify(toolEvent.tool_response),
                  is_error: false,
                }),
              }));
              return {};
            }],
          }],
          ...(enableAgentTeams ? {
            TeammateIdle: [{
              hooks: [async (input) => {
                const idleEvent = input as TeammateIdleHookInput;
                controller.enqueue(formatSSE({
                  type: 'task_notification',
                  data: JSON.stringify({
                    task_id: `idle-${idleEvent.teammate_name}`,
                    status: 'stopped',
                    summary: `Teammate idle: ${idleEvent.teammate_name} (${idleEvent.team_name})`,
                  }),
                }));

                // 🔧 关键修复：返回 injectPrompt 让 SDK 自动提示 team lead 检查 inbox
                controller.enqueue(formatSSE({
                  type: 'tool_output',
                  data: `[DEBUG] Teammate ${idleEvent.teammate_name} went idle. Injecting prompt to check inbox.`,
                }));

                return {
                  injectPrompt: `队友 ${idleEvent.teammate_name} 已完成工作并进入空闲状态。请检查你的 inbox 中是否有来自该队友的消息，阅读并处理这些消息。`,
                } as Record<string, unknown>;
              }],
            }],
            TaskCompleted: [{
              hooks: [async (input) => {
                const taskEvent = input as TaskCompletedHookInput;
                controller.enqueue(formatSSE({
                  type: 'task_notification',
                  data: JSON.stringify({
                    task_id: taskEvent.task_id,
                    status: 'completed',
                    summary: `Task completed: ${taskEvent.task_subject}${taskEvent.teammate_name ? ` (${taskEvent.teammate_name})` : ''}`,
                  }),
                }));
                return {};
              }],
            }],
            SubagentStart: [{
              hooks: [async (input) => {
                const agentEvent = input as SubagentStartHookInput;
                controller.enqueue(formatSSE({
                  type: 'task_notification',
                  data: JSON.stringify({
                    task_id: `agent-${agentEvent.agent_id}`,
                    status: 'started',
                    summary: `Agent started: ${agentEvent.agent_type} (${agentEvent.agent_id})`,
                  }),
                }));
                return {};
              }],
            }],
            SubagentStop: [{
              hooks: [async (input) => {
                const agentEvent = input as SubagentStopHookInput;
                controller.enqueue(formatSSE({
                  type: 'task_notification',
                  data: JSON.stringify({
                    task_id: `agent-${agentEvent.agent_id}`,
                    status: 'stopped',
                    summary: `Agent stopped: ${agentEvent.agent_type} (${agentEvent.agent_id})`,
                  }),
                }));
                return {};
              }],
            }],
          } : {}),
        };

        // Capture real-time stderr output from Claude Code process
        queryOptions.stderr = (data: string) => {
          // Diagnostic: log raw stderr data length to server console
          console.log(`[stderr] received ${data.length} bytes, first 200 chars:`, data.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '?'));
          // Strip ANSI escape codes, OSC sequences, and control characters
          // but preserve tabs (\x09) and carriage returns (\x0D)
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor)
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
            .replace(/\x1B\([A-Z]/g, '')               // Character set selection
            .replace(/\x1B[=>]/g, '')                   // Keypad mode
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control chars (keep \t \n \r)
            .replace(/\r\n/g, '\n')                    // Normalize CRLF
            .replace(/\r/g, '\n')                      // Convert remaining CR to LF
            .replace(/\n{3,}/g, '\n\n')                // Collapse multiple blank lines
            .trim();
          if (cleaned) {
            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: cleaned,
            }));
          }
        };

        // Build the prompt: save all file attachments to disk and reference them in the prompt.
        // Claude Code's built-in Read tool can read images (converts to base64 internally),
        // PDFs, and text files — this is more reliable than constructing SDK multimodal messages.
        let finalPrompt: string = prompt;

        if (files && files.length > 0) {
          const workDir = workingDirectory || process.cwd();
          const savedPaths = saveUploadedFiles(files, workDir);
          const fileReferences = savedPaths
            .map((p, i) => {
              const f = files[i];
              if (isImageFile(f.type)) {
                return `[User attached image: ${p} (${f.name})]`;
              }
              return `[User attached file: ${p} (${f.name})]`;
            })
            .join('\n');
          finalPrompt = `${fileReferences}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${prompt}`;
        }

        // ── Reusable SDK message processor ──
        // Processes all messages from a query conversation and streams SSE events.
        // Returns the captured SDK session ID (for resume) and token usage.
        let capturedSdkSessionId = sdkSessionId || '';

        const processConversation = async (conv: AsyncIterable<SDKMessage>): Promise<TokenUsage | null> => {
          let lastAssistantText = '';
          let tokenUsage: TokenUsage | null = null;

          for await (const message of conv) {
            if (abortController?.signal.aborted) break;

            switch (message.type) {
              case 'assistant': {
                const assistantMsg = message as SDKAssistantMessage;
                const text = extractTextFromMessage(assistantMsg);
                if (text) lastAssistantText = text;
                for (const block of assistantMsg.message.content) {
                  if (block.type === 'tool_use') {
                    controller.enqueue(formatSSE({
                      type: 'tool_use',
                      data: JSON.stringify({ id: block.id, name: block.name, input: block.input }),
                    }));
                  }
                }
                break;
              }

              case 'user': {
                const userMsg = message as SDKUserMessage;
                const content = userMsg.message.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'tool_result') {
                      const resultContent = typeof block.content === 'string'
                        ? block.content
                        : Array.isArray(block.content)
                          ? block.content
                              .filter((c: unknown): c is { type: 'text'; text: string } => {
                                return typeof c === 'object' && c !== null && 'type' in c && (c as { type: string }).type === 'text';
                              })
                              .map((c) => c.text)
                              .join('\n')
                          : String(block.content ?? '');
                      controller.enqueue(formatSSE({
                        type: 'tool_result',
                        data: JSON.stringify({
                          tool_use_id: block.tool_use_id,
                          content: resultContent,
                          is_error: block.is_error || false,
                        }),
                      }));
                    }
                  }
                }
                break;
              }

              case 'stream_event': {
                const streamEvent = message as SDKPartialAssistantMessage;
                const evt = streamEvent.event;
                if (evt.type === 'content_block_delta' && 'delta' in evt) {
                  const delta = evt.delta;
                  if ('text' in delta && delta.text) {
                    controller.enqueue(formatSSE({ type: 'text', data: delta.text }));
                  }
                }
                break;
              }

              case 'system': {
                const sysMsg = message as SDKSystemMessage;
                if ('subtype' in sysMsg) {
                  if (sysMsg.subtype === 'init') {
                    // Capture session ID for potential resume
                    capturedSdkSessionId = sysMsg.session_id;
                    controller.enqueue(formatSSE({
                      type: 'status',
                      data: JSON.stringify({
                        session_id: sysMsg.session_id,
                        model: sysMsg.model,
                        tools: sysMsg.tools,
                        slash_commands: sysMsg.slash_commands,
                        skills: sysMsg.skills,
                      }),
                    }));
                  } else if (sysMsg.subtype === 'task_notification') {
                    const taskMsg = message as SDKTaskNotificationMessage;
                    controller.enqueue(formatSSE({
                      type: 'task_notification',
                      data: JSON.stringify({
                        task_id: taskMsg.task_id,
                        status: taskMsg.status,
                        summary: taskMsg.summary,
                      }),
                    }));
                  } else if (sysMsg.subtype === 'status') {
                    const statusMsg = message as SDKStatusMessage;
                    controller.enqueue(formatSSE({
                      type: 'status',
                      data: JSON.stringify({ compacting: true, status: statusMsg.status }),
                    }));
                  } else if (
                    sysMsg.subtype === 'hook_started' ||
                    sysMsg.subtype === 'hook_progress' ||
                    sysMsg.subtype === 'hook_response'
                  ) {
                    const hookMsg = message as SDKHookStartedMessage;
                    controller.enqueue(formatSSE({
                      type: 'status',
                      data: JSON.stringify({
                        notification: true,
                        title: `Hook: ${hookMsg.hook_name || sysMsg.subtype}`,
                        message: sysMsg.subtype,
                      }),
                    }));
                  }
                }
                break;
              }

              case 'tool_use_summary': {
                const summaryMsg = message as SDKToolUseSummaryMessage;
                controller.enqueue(formatSSE({
                  type: 'tool_use_summary',
                  data: JSON.stringify({
                    summary: summaryMsg.summary,
                    preceding_tool_use_ids: summaryMsg.preceding_tool_use_ids,
                  }),
                }));
                break;
              }

              case 'tool_progress': {
                const progressMsg = message as SDKToolProgressMessage;
                controller.enqueue(formatSSE({
                  type: 'tool_output',
                  data: JSON.stringify({
                    _progress: true,
                    tool_use_id: progressMsg.tool_use_id,
                    tool_name: progressMsg.tool_name,
                    elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                  }),
                }));
                break;
              }

              case 'result': {
                const resultMsg = message as SDKResultMessage;
                tokenUsage = extractTokenUsage(resultMsg);
                // Also capture session_id from result
                if (resultMsg.session_id) capturedSdkSessionId = resultMsg.session_id;
                controller.enqueue(formatSSE({
                  type: 'result',
                  data: JSON.stringify({
                    subtype: resultMsg.subtype,
                    is_error: resultMsg.is_error,
                    num_turns: resultMsg.num_turns,
                    duration_ms: resultMsg.duration_ms,
                    usage: tokenUsage,
                    session_id: resultMsg.session_id,
                  }),
                }));
                break;
              }
            }
          }

          void lastAssistantText; // consumed by SSE streaming
          return tokenUsage;
        };

        // ── Run the initial conversation ──
        const conversation = query({
          prompt: finalPrompt,
          options: queryOptions,
        });

        await processConversation(conversation);

        // ── Teams resume loop ──
        // After the initial query, teammates may still be running in the background.
        // Their messages land in ~/.claude/teams/{name}/inboxes/ but the team lead
        // has already stopped. We resume the conversation so the team lead can
        // process inbox messages and continue coordinating.
        if (enableAgentTeams) {
          controller.enqueue(formatSSE({
            type: 'tool_output',
            data: `[DEBUG] Teams mode enabled, capturedSdkSessionId: ${capturedSdkSessionId || 'NOT CAPTURED'}`,
          }));

          if (!capturedSdkSessionId) {
            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: '[DEBUG] ERROR: No SDK session ID! Resume loop cannot run.',
            }));
          } else {
            const MAX_RESUME_CYCLES = 30;
            const POLL_INTERVAL_MS = 5000;

            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: `[DEBUG] Starting resume loop (max ${MAX_RESUME_CYCLES} cycles, poll every ${POLL_INTERVAL_MS}ms)`,
            }));

            for (let cycle = 0; cycle < MAX_RESUME_CYCLES; cycle++) {
              if (abortController?.signal.aborted) {
                controller.enqueue(formatSSE({
                  type: 'tool_output',
                  data: '[DEBUG] Aborted by user',
                }));
                break;
              }

              await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

              if (abortController?.signal.aborted) break;

              const hasWork = hasActiveTeamWork();
              controller.enqueue(formatSSE({
                type: 'tool_output',
                data: `[DEBUG] Cycle ${cycle + 1}: hasActiveTeamWork() = ${hasWork}`,
              }));

              if (!hasWork) {
                controller.enqueue(formatSSE({
                  type: 'tool_output',
                  data: `[DEBUG] No more active work after ${cycle} cycles, stopping resume loop`,
                }));
                break;
              }

              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  notification: true,
                  title: 'Teams',
                  message: `检测到队友消息，正在处理 (cycle ${cycle + 1})...`,
                }),
              }));

              try {
                const resumeConv = query({
                  prompt: '检查你的 inbox 中的队友消息。处理所有更新并继续管理团队，直到所有任务完成。',
                  options: {
                    ...queryOptions,
                    resume: capturedSdkSessionId,
                  },
                });

                await processConversation(resumeConv);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                controller.enqueue(formatSSE({
                  type: 'tool_output',
                  data: `[DEBUG] Resume failed: ${errMsg}`,
                }));
                break;
              }
            }

            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: '[DEBUG] Resume loop finished',
            }));
          }
        }

        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        controller.enqueue(formatSSE({ type: 'error', data: errorMessage }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } finally {
        // 🔧 清理心跳定时器
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      }
    },

    cancel() {
      abortController?.abort();
    },
  });
}
