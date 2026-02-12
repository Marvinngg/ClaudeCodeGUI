'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Message, SSEEvent, TokenUsage, PermissionRequestEvent, FileAttachment } from '@/types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { TeamDashboard } from './TeamDashboard';
import { SummarizeButton } from './SummarizeButton';
import { usePanel } from '@/hooks/usePanel';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
}

interface ChatViewProps {
  sessionId: string;
  initialMessages?: Message[];
  modelName?: string;
  initialMode?: string;
  initialWorkingDirectory?: string; // 🔧 新增：从 session 数据初始化工作目录
}

export function ChatView({ sessionId, initialMessages = [], modelName, initialMode, initialWorkingDirectory = '' }: ChatViewProps) {
  const { setStreamingSessionId, setPanelOpen, setPendingApprovalSessionId, setWorkingDirectory: setGlobalWorkingDirectory } = usePanel();
  // 🔧 使用本地 state 管理工作目录，同步到全局供 RightPanel 显示
  const [workingDirectory, setWorkingDirectoryLocal] = useState(initialWorkingDirectory);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [mode, setMode] = useState(initialMode || 'code');
  const [currentModel, setCurrentModel] = useState(modelName || '');

  // 🔧 模型变更时保存到 localStorage，保持偏好一致

  const handleModelChange = useCallback((newModel: string) => {
    setCurrentModel(newModel);
    try {
      localStorage.setItem('last_model', newModel);
    } catch (e) {
      // ignore
    }
    // Persist to session DB
    if (sessionId) {
      fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      }).catch(() => { /* silent */ });
    }
  }, [sessionId]);

  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [teamNotifications, setTeamNotifications] = useState<Array<{ task_id: string; status: string; summary: string }>>([]);
  const [sdkSlashCommands, setSdkSlashCommands] = useState<string[]>([]);
  const [sdkSkills, setSdkSkills] = useState<Array<{ name: string; description: string }>>([]);

  // 🔧 使用 ref 来跟踪工具调用的实时值，避免闭包问题
  const toolUsesRef = useRef<ToolUseInfo[]>([]);
  const toolResultsRef = useRef<ToolResultInfo[]>([]);

  const handleModeChange = useCallback((newMode: string) => {
    setMode(newMode);
    // Persist mode to database and notify chat list
    if (sessionId) {
      fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      }).then(() => {
        window.dispatchEvent(new CustomEvent('session-updated'));
      }).catch(() => { /* silent */ });
    }
  }, [sessionId]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleWorkingDirectoryChange = useCallback((dir: string) => {
    // 🔧 只更新本地状态和数据库，不影响全局状态
    setWorkingDirectoryLocal(dir);
    setPanelOpen(true);
    // Persist to database
    if (sessionId) {
      fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_directory: dir }),
      }).catch(() => { /* silent */ });
    }
  }, [sessionId, setPanelOpen]);

  // Ref to keep accumulated streaming content in sync regardless of React batching
  const accumulatedRef = useRef('');

  // Re-sync streaming content when the window regains visibility (Electron/browser tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && accumulatedRef.current) {
        setStreamingContent(accumulatedRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Also handle Electron-specific focus events
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (initialMessages.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  // Sync mode when session data loads
  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
    }
  }, [initialMode]);

  // 🔧 同步本地工作目录到全局 context，让 RightPanel 的 FileTree 跟随
  useEffect(() => {
    setGlobalWorkingDirectory(workingDirectory);
  }, [workingDirectory, setGlobalWorkingDirectory]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny') => {
    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedPermissions?: unknown[] } | { behavior: 'deny'; message?: string } } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: 'User denied permission' }
        : {
            behavior: 'allow',
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
          },
    };

    setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
    setPendingApprovalSessionId('');

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort - the stream will handle timeout
    }

    // Clear permission state after a short delay so user sees the feedback
    setTimeout(() => {
      setPendingPermission(null);
      setPermissionResolved(null);
    }, 1000);
  }, [pendingPermission, setPendingApprovalSessionId]);

  const sendMessage = useCallback(
    async (content: string, files?: FileAttachment[]) => {
      if (isStreaming) return;

      // Build display content: embed file metadata as HTML comment for MessageItem to parse
      let displayContent = content;
      if (files && files.length > 0) {
        const fileMeta = files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }));
        displayContent = `<!--files:${JSON.stringify(fileMeta)}-->${content}`;
      }

      // Optimistic: add user message to UI immediately
      const userMessage: Message = {
        id: 'temp-' + Date.now(),
        session_id: sessionId,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
        token_usage: null,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingSessionId(sessionId);
      setStreamingContent('');
      accumulatedRef.current = '';
      setToolUses([]);
      setToolResults([]);
      // 🔧 清空 ref
      toolUsesRef.current = [];
      toolResultsRef.current = [];
      setStatusText(undefined);
      setTeamNotifications([]);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulated = '';

      try {
        // 🔧 Teams 模式：使用持久 CLI 进程 API
        let response: Response;
        console.log(`[ChatView] sendMessage mode=${mode}, sessionId=${sessionId}`);
        if (mode === 'teams') {
          // Teams 模式：启动 CLI 进程
          const params = new URLSearchParams({
            session_id: sessionId,
            message: content,
          });
          // 只有用户实际设置了工作目录才传递，否则让服务端决定默认值
          if (workingDirectory) {
            params.set('working_directory', workingDirectory);
          }
          console.log(`[ChatView] Using teams API: /api/teams/ws`);
          response = await fetch(`/api/teams/ws?${params.toString()}`, {
            method: 'GET',
            signal: controller.signal,
          });
        } else {
          // Code/Ask/Plan 模式：使用原有 API
          response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              content,
              mode,
              model: currentModel,
              working_directory: workingDirectory, // 🔧 直接传递工作目录，不依赖数据库
              ...(files && files.length > 0 ? { files } : {}),
            }),
            signal: controller.signal,
          });
        }

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let tokenUsage: TokenUsage | null = null;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const event: SSEEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'text': {
                  accumulated += event.data;
                  accumulatedRef.current = accumulated;
                  setStreamingContent(accumulated);
                  break;
                }

                case 'tool_use': {
                  try {
                    const toolData = JSON.parse(event.data);
                    // Clear streaming output for new tool
                    setStreamingToolOutput('');
                    setToolUses((prev) => {
                      // Avoid duplicates
                      if (prev.some((t) => t.id === toolData.id)) return prev;
                      const newToolUses = [...prev, {
                        id: toolData.id,
                        name: toolData.name,
                        input: toolData.input,
                      }];
                      // 🔧 同步更新 ref
                      toolUsesRef.current = newToolUses;
                      return newToolUses;
                    });
                  } catch {
                    // skip malformed tool_use data
                  }
                  break;
                }

                case 'tool_result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolResults((prev) => {
                      const newToolResults = [...prev, {
                        tool_use_id: resultData.tool_use_id,
                        content: resultData.content,
                      }];
                      // 🔧 同步更新 ref
                      toolResultsRef.current = newToolResults;
                      return newToolResults;
                    });
                  } catch {
                    // skip malformed tool_result data
                  }
                  break;
                }

                case 'tool_output': {
                  // Check if this is a progress heartbeat or real stderr output
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed._progress) {
                      // SDK tool_progress event — update status with elapsed time
                      setStatusText(`Running ${parsed.tool_name}... (${Math.round(parsed.elapsed_time_seconds)}s)`);
                      break;
                    }
                  } catch {
                    // Not JSON — it's raw stderr output, fall through
                  }
                  // Real-time stderr output from tool execution
                  setStreamingToolOutput((prev) => {
                    const next = prev + (prev ? '\n' : '') + event.data;
                    return next.length > 5000 ? next.slice(-5000) : next;
                  });
                  break;
                }

                case 'status': {
                  try {
                    const statusData = JSON.parse(event.data);
                    if (statusData.session_id) {
                      // Init event — show briefly then clear so tool status can take over
                      setStatusText(`Connected (${statusData.model || 'claude'})`);
                      setTimeout(() => setStatusText(undefined), 2000);
                      // Capture slash_commands and skills from SDK init for the input popover
                      if (Array.isArray(statusData.slash_commands)) {
                        setSdkSlashCommands(statusData.slash_commands);
                      }
                      // ✅ 捕获 SDK 返回的 skills 元数据（包含 name 和 description）
                      if (Array.isArray(statusData.skills)) {
                        setSdkSkills(statusData.skills);
                      }
                    } else if (statusData.notification) {
                      // Notification from SDK hooks — show as progress
                      setStatusText(statusData.message || statusData.title || undefined);
                    } else {
                      setStatusText(typeof event.data === 'string' ? event.data : undefined);
                    }
                  } catch {
                    setStatusText(event.data || undefined);
                  }
                  break;
                }

                case 'result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    if (resultData.usage) {
                      tokenUsage = resultData.usage;
                    }
                  } catch {
                    // skip
                  }
                  setStatusText(undefined);
                  break;
                }

                case 'permission_request': {
                  try {
                    const permData: PermissionRequestEvent = JSON.parse(event.data);
                    setPendingPermission(permData);
                    setPermissionResolved(null);
                    setPendingApprovalSessionId(sessionId);
                  } catch {
                    // skip malformed permission_request data
                  }
                  break;
                }

                case 'task_notification': {
                  try {
                    const notifData = JSON.parse(event.data);
                    setTeamNotifications((prev) => [...prev, {
                      task_id: notifData.task_id,
                      status: notifData.status,
                      summary: notifData.summary,
                    }]);
                  } catch {
                    // skip malformed task_notification data
                  }
                  break;
                }

                case 'tool_use_summary': {
                  try {
                    const summaryData = JSON.parse(event.data);
                    setStatusText(summaryData.summary || undefined);
                  } catch {
                    // skip malformed tool_use_summary data
                  }
                  break;
                }

                case 'error': {
                  accumulated += '\n\n**Error:** ' + event.data;
                  accumulatedRef.current = accumulated;
                  setStreamingContent(accumulated);
                  break;
                }

                case 'done': {
                  // Stream complete
                  break;
                }
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        // Add the assistant message to the list with complete tool calls
        // 🔧 使用 ref 中的最新值，避免闭包问题
        const finalToolUses = toolUsesRef.current;
        const finalToolResults = toolResultsRef.current;

        if (accumulated.trim() || finalToolUses.length > 0) {
          // Build complete content blocks (same format as database)
          const contentBlocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string; is_error?: boolean }> = [];

          // Add all tool_use and tool_result blocks
          for (const tool of finalToolUses) {
            contentBlocks.push({
              type: 'tool_use',
              id: tool.id,
              name: tool.name,
              input: tool.input,
            });
            const result = finalToolResults.find(r => r.tool_use_id === tool.id);
            if (result) {
              contentBlocks.push({
                type: 'tool_result',
                tool_use_id: result.tool_use_id,
                content: result.content,
                is_error: false,
              });
            }
          }

          // Add text content at the end
          if (accumulated.trim()) {
            contentBlocks.push({
              type: 'text',
              text: accumulated.trim(),
            });
          }

          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: JSON.stringify(contentBlocks), // 🔧 保存完整的 contentBlocks
            created_at: new Date().toISOString(),
            token_usage: tokenUsage ? JSON.stringify(tokenUsage) : null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // User stopped generation - still add partial content
          if (accumulated.trim()) {
            const partialMessage: Message = {
              id: 'temp-assistant-' + Date.now(),
              session_id: sessionId,
              role: 'assistant',
              content: accumulated.trim() + '\n\n*(generation stopped)*',
              created_at: new Date().toISOString(),
              token_usage: null,
            };
            setMessages((prev) => [...prev, partialMessage]);
          }
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const errorMessage: Message = {
            id: 'temp-error-' + Date.now(),
            session_id: sessionId,
            role: 'assistant',
            content: `**Error:** ${errMsg}`,
            created_at: new Date().toISOString(),
            token_usage: null,
          };
          setMessages((prev) => [...prev, errorMessage]);
        }
      } finally {
        setIsStreaming(false);
        setStreamingSessionId('');
        setStreamingContent('');
        accumulatedRef.current = '';
        setToolUses([]);
        setToolResults([]);
        // 🔧 清空 ref
        toolUsesRef.current = [];
        toolResultsRef.current = [];
        setStreamingToolOutput('');
        setStatusText(undefined);
        // 🔧 Teams 模式下延迟清理通知，避免与 SDK hooks 竞态
        if (mode !== 'teams') {
          setTeamNotifications([]);
        } else {
          // Teams 模式下延迟 2 秒清理，给 SDK hooks 足够时间
          setTimeout(() => setTeamNotifications([]), 2000);
        }
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
      }
    },
    [sessionId, isStreaming, setStreamingSessionId, setPendingApprovalSessionId, mode, currentModel, workingDirectory]
  );

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        // 动态生成帮助信息：优先使用 SDK 返回的 skills（包含 description）
        let cmdList: string;
        if (sdkSkills.length > 0) {
          // ✅ 使用 SDK 返回的 skills（包含 description）
          cmdList = sdkSkills
            .map(s => `- **/${s.name}** — ${s.description}`)
            .join('\n');
        } else if (sdkSlashCommands.length > 0) {
          // Fallback：只有命令名，无 description
          cmdList = sdkSlashCommands.map(c => `- **/${c}**`).join('\n');
        } else {
          cmdList = '_(send a message first to load available commands)_';
        }
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: sessionId,
          role: 'assistant',
          content: `## Available Commands\n\n### App Commands\n- **/help** — Show this help\n- **/clear** — Clear conversation history\n\n### SDK Commands\n${cmdList}\n\n**Tips:**\n- Type \`/\` to browse all commands and skills\n- Type \`@\` to mention files\n- Commands from \`~/.claude/skills/\`, \`~/.claude/commands/\` and project \`.claude/\` are auto-loaded\n- Select a project folder to see project-level commands`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        // Also clear database messages and reset SDK session
        if (sessionId) {
          fetch(`/api/chat/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear_messages: true }),
          }).catch(() => { /* silent */ });
        }
        break;
      case '/cost': {
        // Aggregate token usage from all messages in this session
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheCreation = 0;
        let totalCost = 0;
        let turnCount = 0;

        for (const msg of messages) {
          if (msg.token_usage) {
            try {
              const usage = typeof msg.token_usage === 'string' ? JSON.parse(msg.token_usage) : msg.token_usage;
              totalInput += usage.input_tokens || 0;
              totalOutput += usage.output_tokens || 0;
              totalCacheRead += usage.cache_read_input_tokens || 0;
              totalCacheCreation += usage.cache_creation_input_tokens || 0;
              if (usage.cost_usd) totalCost += usage.cost_usd;
              turnCount++;
            } catch { /* skip */ }
          }
        }

        const totalTokens = totalInput + totalOutput;
        let content: string;

        if (turnCount === 0) {
          content = `## Token Usage\n\nNo token usage data yet. Send a message first.`;
        } else {
          content = `## Token Usage\n\n| Metric | Count |\n|--------|-------|\n| Input tokens | ${totalInput.toLocaleString()} |\n| Output tokens | ${totalOutput.toLocaleString()} |\n| Cache read | ${totalCacheRead.toLocaleString()} |\n| Cache creation | ${totalCacheCreation.toLocaleString()} |\n| **Total tokens** | **${totalTokens.toLocaleString()}** |\n| Turns | ${turnCount} |${totalCost > 0 ? `\n| **Estimated cost** | **$${totalCost.toFixed(4)}** |` : ''}`;
        }

        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: sessionId,
          role: 'assistant',
          content,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        // This shouldn't be reached since non-immediate commands are handled via badge
        sendMessage(command);
    }
  }, [sessionId, sendMessage, sdkSkills, sdkSlashCommands, messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TeamDashboard
        isTeamsMode={mode === 'teams'}
      />
      {messages.length > 0 && (
        <div className="flex items-center justify-end px-4 py-1 border-b border-zinc-200 dark:border-zinc-800">
          <SummarizeButton
            sessionId={sessionId}
            messages={messages}
            workingDirectory={workingDirectory}
          />
        </div>
      )}
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        toolUses={toolUses}
        toolResults={toolResults}
        streamingToolOutput={streamingToolOutput}
        statusText={statusText}
        pendingPermission={pendingPermission}
        onPermissionResponse={handlePermissionResponse}
        permissionResolved={permissionResolved}
        teamNotifications={teamNotifications}
      />
      <MessageInput
        onSend={sendMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={false}
        isStreaming={isStreaming}
        sessionId={sessionId}
        modelName={currentModel}
        onModelChange={handleModelChange}
        workingDirectory={workingDirectory}
        onWorkingDirectoryChange={handleWorkingDirectoryChange}
        mode={mode}
        onModeChange={handleModeChange}
        sdkSlashCommands={sdkSlashCommands}
        sdkSkills={sdkSkills}
      />
    </div>
  );
}
