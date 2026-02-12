/**
 * API Route for Agent Teams
 *
 * 使用 `claude --print --output-format stream-json --verbose` CLI 进程处理 teams 模式。
 * GET: 启动 CLI 进程并通过 SSE 流式返回实时输出（thinking、text、tool_use、tool_result 等）
 *      CLI 退出后自动检查队友是否还在工作，如果是则 --resume 继续（resume loop）
 * POST: 发送控制命令（interrupt/close）
 */

import { NextRequest } from 'next/server';
import { teamsSessionManager, hasActiveTeamWork } from '@/lib/teams-session-manager';
import type { CLIStreamMessage } from '@/lib/teams-session-manager';
import { getSession, addMessage, updateSessionTitle, updateSdkSessionId } from '@/lib/db';
import type { MessageContentBlock } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RESUME_CYCLES = 30;
const POLL_INTERVAL_MS = 5000;
const IDLE_TIMEOUT_MS = 60_000;        // 60 秒无输出 → 强制中断 CLI
const POST_RESULT_TIMEOUT_MS = 5_000;  // 收到 result 事件后 5 秒仍未退出 → 强制中断

// 启动 teams 会话并流式返回输出
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const message = searchParams.get('message');
  const workingDir = searchParams.get('working_directory');

  console.log(`[teams/ws] GET request — session_id=${sessionId}, message_length=${message?.length}, working_directory=${workingDir || '(not set)'}`);

  if (!sessionId || !message) {
    return new Response(JSON.stringify({ error: 'session_id and message are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dbSession = getSession(sessionId);
  if (!dbSession) {
    console.error(`[teams/ws] Session not found in DB: ${sessionId}`);
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 保存用户消息
  addMessage(sessionId, 'user', message);

  // 自动生成标题
  if (dbSession.title === 'New Chat' || dbSession.title === message.slice(0, 50)) {
    const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
    updateSessionTitle(sessionId, title);
  }

  // 确定工作目录：请求参数 > 数据库记录 > 服务端 cwd
  const effectiveWorkingDir = (workingDir && workingDir !== '/')
    ? workingDir
    : dbSession.working_directory || process.cwd();

  console.log(`[teams/ws] Effective working directory: ${effectiveWorkingDir}`);

  try {
    console.log(`[teams/ws] Session starting, resume=${dbSession.sdk_session_id || '(new)'}`);

    // 使用 SSE 流式返回 CLI 输出
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let aborted = false;

        // 收集内容块用于保存到 DB
        const contentBlocks: MessageContentBlock[] = [];
        let currentText = '';
        let capturedSdkSessionId = dbSession.sdk_session_id || '';
        let capturedTeamName = ''; // 从 TeamCreate tool_result 中捕获

        const sendSSE = (type: string, data: string) => {
          if (aborted) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
          } catch {
            // controller 可能已关闭
          }
        };

        // 用户断开连接时设置 abort 标记
        request.signal.addEventListener('abort', () => {
          console.log(`[teams/ws] Client disconnected`);
          aborted = true;
          // 中断当前正在运行的 CLI 进程
          const currentSession = teamsSessionManager.getSession(sessionId);
          if (currentSession) {
            currentSession.interrupt();
          }
          try {
            controller.close();
          } catch {
            // 可能已关闭
          }
        });

        /**
         * 运行一次 CLI 进程并等待退出
         * 返回 Promise<number>（退出码）
         */
        const runOnce = (msg: string, sdkSid?: string): Promise<number> => {
          return new Promise(async (resolve, reject) => {
            try {
              const teamsSession = await teamsSessionManager.createSession({
                sessionId,
                workingDirectory: effectiveWorkingDir,
                model: dbSession.model,
                sdkSessionId: sdkSid,
              });

              // ── 空闲超时机制 ──
              // 跟踪最后一次有意义输出的时间，超时则强制中断 CLI
              let lastActivityTime = Date.now();
              let gotResultEvent = false;
              let resolved = false;
              let idleTimer: ReturnType<typeof setInterval> | null = null;

              const resetActivity = () => {
                lastActivityTime = Date.now();
              };

              const cleanup = () => {
                if (idleTimer) {
                  clearInterval(idleTimer);
                  idleTimer = null;
                }
                teamsSession.off('message', onMessage);
                teamsSession.off('stderr', onStderr);
                teamsSession.off('exit', onExit);
                teamsSession.off('error', onErrorHandler);
              };

              const forceInterrupt = (reason: string) => {
                if (resolved) return;
                console.log(`[teams/ws] Force interrupting CLI: ${reason}`);
                sendSSE('tool_output', `[自动中断] ${reason}`);
                teamsSession.interrupt();
              };

              // 每 5 秒检查一次是否超时
              idleTimer = setInterval(() => {
                if (resolved) {
                  if (idleTimer) clearInterval(idleTimer);
                  return;
                }
                const elapsed = Date.now() - lastActivityTime;

                // 收到 result 后，CLI 应该很快退出；如果超过 POST_RESULT_TIMEOUT_MS 仍未退出，强制中断
                if (gotResultEvent && elapsed >= POST_RESULT_TIMEOUT_MS) {
                  forceInterrupt(`收到 result 事件后 ${Math.round(elapsed / 1000)}s 仍未退出`);
                  return;
                }

                // 常规空闲超时
                if (!gotResultEvent && elapsed >= IDLE_TIMEOUT_MS) {
                  forceInterrupt(`空闲超时 ${Math.round(elapsed / 1000)}s 无新输出`);
                  return;
                }
              }, 5000);

              // 处理 stream-json 消息
              const onMessage = (cliMsg: CLIStreamMessage) => {
                resetActivity(); // 收到任何消息都重置空闲计时器

                switch (cliMsg.type) {
                  case 'system': {
                    if (cliMsg.subtype === 'init' && cliMsg.session_id) {
                      capturedSdkSessionId = cliMsg.session_id;
                      updateSdkSessionId(sessionId, cliMsg.session_id);
                      sendSSE('status', JSON.stringify({
                        session_id: cliMsg.session_id,
                        model: cliMsg.model,
                        tools: cliMsg.tools,
                      }));
                    }
                    break;
                  }

                  case 'assistant': {
                    const content = cliMsg.message?.content;
                    if (!content) break;

                    for (const block of content) {
                      if (block.type === 'thinking' && block.thinking) {
                        sendSSE('thinking', block.thinking);
                      } else if (block.type === 'text' && block.text) {
                        currentText += block.text;
                        sendSSE('text', block.text);
                      } else if (block.type === 'tool_use') {
                        if (currentText.trim()) {
                          contentBlocks.push({ type: 'text', text: currentText });
                          currentText = '';
                        }
                        contentBlocks.push({
                          type: 'tool_use',
                          id: block.id || '',
                          name: block.name || '',
                          input: block.input,
                        });
                        sendSSE('tool_use', JSON.stringify({
                          id: block.id,
                          name: block.name,
                          input: block.input,
                        }));
                      }
                    }
                    break;
                  }

                  case 'user': {
                    const content = cliMsg.message?.content;
                    if (!content) break;

                    // 从 tool_use_result 中捕获团队名（TeamCreate 返回时有 team_name）
                    if (cliMsg.tool_use_result && typeof cliMsg.tool_use_result === 'object') {
                      const tn = (cliMsg.tool_use_result as Record<string, unknown>).team_name;
                      if (typeof tn === 'string' && tn && !capturedTeamName) {
                        capturedTeamName = tn;
                        console.log(`[teams/ws] Captured team name: ${capturedTeamName}`);
                      }
                    }

                    for (const block of content) {
                      if (block.type === 'tool_result') {
                        const resultContent = typeof block.content === 'string'
                          ? block.content
                          : Array.isArray(block.content)
                            ? block.content
                                .filter(c => c.type === 'text')
                                .map(c => c.text || '')
                                .join('\n')
                            : '';
                        contentBlocks.push({
                          type: 'tool_result',
                          tool_use_id: block.tool_use_id || '',
                          content: resultContent,
                          is_error: block.is_error || false,
                        });
                        sendSSE('tool_result', JSON.stringify({
                          tool_use_id: block.tool_use_id,
                          content: resultContent,
                          is_error: block.is_error || false,
                        }));
                      }
                    }
                    break;
                  }

                  case 'result': {
                    gotResultEvent = true;
                    lastActivityTime = Date.now(); // 重置计时，给 CLI 一点退出时间
                    if (cliMsg.session_id) {
                      capturedSdkSessionId = cliMsg.session_id;
                      updateSdkSessionId(sessionId, cliMsg.session_id);
                    }
                    sendSSE('result', JSON.stringify({
                      subtype: cliMsg.is_error ? 'error' : 'success',
                      is_error: cliMsg.is_error || false,
                      num_turns: cliMsg.num_turns,
                      duration_ms: cliMsg.duration_ms,
                      session_id: cliMsg.session_id,
                      usage: cliMsg.total_cost_usd ? {
                        cost_usd: cliMsg.total_cost_usd,
                      } : undefined,
                    }));
                    break;
                  }
                }

                // raw_text fallback
                if ((cliMsg as unknown as Record<string, unknown>).type === 'raw_text') {
                  const text = (cliMsg as unknown as Record<string, unknown>).text as string;
                  if (text) {
                    currentText += text;
                    sendSSE('text', text);
                  }
                }
              };

              const onStderr = (data: string) => {
                resetActivity(); // stderr 输出也算活跃
                sendSSE('tool_output', data);
              };

              const onExit = (code: number) => {
                resolved = true;
                cleanup();
                const sdkSid = teamsSession.getSdkSessionId();
                console.log(`[teams/ws] CLI exited with code ${code}, sdk_session_id=${sdkSid || '(none)'}`);
                if (sdkSid) {
                  capturedSdkSessionId = sdkSid;
                  updateSdkSessionId(sessionId, sdkSid);
                }
                resolve(code);
              };

              const onErrorHandler = (data: string) => {
                resolved = true;
                cleanup();
                console.error(`[teams/ws] CLI error: ${data}`);
                sendSSE('error', data);
                reject(new Error(data));
              };

              teamsSession.on('message', onMessage);
              teamsSession.on('stderr', onStderr);
              teamsSession.on('exit', onExit);
              teamsSession.on('error', onErrorHandler);

              // 当用户断开连接时清理当前进程
              const abortHandler = () => {
                resolved = true;
                cleanup();
                teamsSession.interrupt();
                resolve(-1); // signal abort
              };
              request.signal.addEventListener('abort', abortHandler, { once: true });

              await teamsSession.startAndSend(msg);
            } catch (err) {
              reject(err);
            }
          });
        };

        // ── 主执行逻辑（async IIFE） ──
        (async () => {
          try {
            // 第一轮：发送用户消息
            await runOnce(message, dbSession.sdk_session_id || undefined);

            // ── Resume Loop ──
            // CLI 退出后队友可能还在后台运行。
            // 等待一段时间后检查是否有活跃的 team work，如果有就 --resume 继续。
            if (capturedSdkSessionId) {
              for (let cycle = 0; cycle < MAX_RESUME_CYCLES; cycle++) {
                if (aborted) break;

                // 等待队友完成一些工作
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
                if (aborted) break;

                const hasWork = hasActiveTeamWork(capturedTeamName || undefined);
                console.log(`[teams/ws] Resume cycle ${cycle + 1}: hasActiveTeamWork(${capturedTeamName || 'ALL'})=${hasWork}`);

                if (!hasWork) {
                  console.log(`[teams/ws] No more active work, stopping resume loop`);
                  break;
                }

                sendSSE('status', JSON.stringify({
                  notification: true,
                  title: 'Teams',
                  message: `检测到队友活动，正在处理 (cycle ${cycle + 1})...`,
                }));

                try {
                  const code = await runOnce(
                    '检查你的 inbox 中的队友消息。处理所有更新并继续管理团队，直到所有任务完成。',
                    capturedSdkSessionId
                  );
                  if (code === -1) break; // aborted
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  console.error(`[teams/ws] Resume failed: ${errMsg}`);
                  sendSSE('tool_output', `Resume error: ${errMsg}`);
                  break;
                }
              }
            }

            // Flush 剩余文本并保存到 DB
            if (currentText.trim()) {
              contentBlocks.push({ type: 'text', text: currentText });
            }
            if (contentBlocks.length > 0) {
              const hasToolBlocks = contentBlocks.some(
                b => b.type === 'tool_use' || b.type === 'tool_result'
              );
              const dbContent = hasToolBlocks
                ? JSON.stringify(contentBlocks)
                : contentBlocks
                    .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
                    .map(b => b.text)
                    .join('')
                    .trim();
              if (dbContent) {
                addMessage(sessionId, 'assistant', dbContent);
              }
            }

            sendSSE('done', '');
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[teams/ws] Fatal error:`, errorMsg);
            sendSSE('error', errorMsg);
            sendSSE('done', '');
          } finally {
            try {
              controller.close();
            } catch {
              // 可能已关闭
            }
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    console.error(`[teams/ws] Error:`, errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// 向已存在的 teams 会话发送操作
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, action } = body;

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const teamsSession = teamsSessionManager.getSession(session_id);

    switch (action) {
      case 'interrupt':
        teamsSession?.interrupt();
        break;

      case 'close':
        await teamsSessionManager.closeSession(session_id);
        break;

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
