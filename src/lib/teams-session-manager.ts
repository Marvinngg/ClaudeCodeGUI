/**
 * Teams Session Manager
 *
 * 管理 agent teams 的 CLI 进程。
 * 使用 `claude --print --output-format stream-json --verbose` 获取实时流式输出。
 * 支持 --resume 保持同一对话的上下文连续性。
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { getActiveProvider } from './db';
import { findGitBash, getExpandedPath } from './platform';

export interface TeamsSessionOptions {
  sessionId: string;
  workingDirectory: string;
  model?: string;
  sdkSessionId?: string; // 用于 --resume 保持对话连续性
}

/** stream-json 输出的消息类型 */
export interface CLIStreamMessage {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
      is_error?: boolean;
    }>;
  };
  // result 类型的字段
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: Record<string, unknown>;
  // system init 字段
  tools?: string[];
  model?: string;
  // tool_use_result (user message 上的额外字段)
  tool_use_result?: Record<string, unknown>;
}

/**
 * Teams 会话类
 * 每个会话对应一个 claude --print --output-format stream-json --verbose CLI 进程
 */
export class TeamsSession extends EventEmitter {
  private cliProcess: ChildProcess | null = null;
  private sessionId: string;
  private workingDirectory: string;
  private model?: string;
  private sdkSessionId?: string;
  private _isRunning = false;
  private stdoutBuffer = ''; // 用于缓冲不完整的 JSON 行

  constructor(options: TeamsSessionOptions) {
    super();
    this.sessionId = options.sessionId;
    this.workingDirectory = options.workingDirectory;
    this.model = options.model;
    this.sdkSessionId = options.sdkSessionId;
  }

  /**
   * 启动 CLI 进程并发送消息
   * 使用 --print --output-format stream-json --verbose 获取实时流式 JSON 输出
   */
  async startAndSend(message: string): Promise<void> {
    if (this.cliProcess) {
      throw new Error('Session already started');
    }

    // 构建环境变量
    const env = { ...process.env };

    if (!env.HOME) env.HOME = os.homedir();
    if (!env.USERPROFILE) env.USERPROFILE = os.homedir();
    env.PATH = getExpandedPath();

    // Windows Git Bash
    if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
      const gitBashPath = findGitBash();
      if (gitBashPath) {
        env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
      }
    }

    // 启用 Agent Teams
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';

    // API 配置：优先使用 active provider，否则让 CLI 用自己的认证
    const activeProvider = getActiveProvider();
    if (activeProvider?.api_key) {
      env.ANTHROPIC_API_KEY = activeProvider.api_key;
      if (activeProvider.base_url) {
        env.ANTHROPIC_BASE_URL = activeProvider.base_url;
      }
    } else {
      console.log(`[teams] No active provider — CLI will use its own auth (claude login)`);
    }

    // 查找 claude CLI
    const cliPath = this.findClaudeCLI();

    // 验证工作目录存在
    if (!fs.existsSync(this.workingDirectory)) {
      console.error(`[teams] Working directory does not exist: ${this.workingDirectory}`);
      throw new Error(`Working directory does not exist: ${this.workingDirectory}`);
    }

    // 构建 CLI 参数
    const args = [
      ...cliPath.args,
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    // 如果有之前的 session ID，使用 --resume 保持对话连续性
    if (this.sdkSessionId) {
      args.push('--resume', this.sdkSessionId);
    }

    console.log(`[teams] ========== Starting CLI ==========`);
    console.log(`[teams] Command: ${cliPath.command}`);
    console.log(`[teams] Args: ${JSON.stringify(args)}`);
    console.log(`[teams] CWD: ${this.workingDirectory}`);
    console.log(`[teams] Message length: ${message.length}`);
    console.log(`[teams] Resume session: ${this.sdkSessionId || '(new session)'}`);
    console.log(`[teams] AGENT_TEAMS: ${env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS}`);

    this.cliProcess = spawn(cliPath.command, args, {
      cwd: this.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._isRunning = true;
    const proc = this.cliProcess;
    console.log(`[teams] CLI process spawned, PID: ${proc.pid}`);

    // 通过 stdin 发送消息
    proc.stdin?.write(message);
    proc.stdin?.end();

    // 监听 stdout — stream-json 格式，每行一个 JSON 对象
    proc.stdout?.on('data', (data: Buffer) => {
      this.handleStdoutChunk(data.toString('utf-8'));
    });

    // 监听 stderr — 日志信息
    proc.stderr?.on('data', (data: Buffer) => {
      const error = data.toString('utf-8');
      // 只输出有意义的 stderr（过滤掉空行和 ANSI 控制码）
      const cleaned = error
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim();
      if (cleaned) {
        this.emit('stderr', cleaned);
      }
    });

    // 监听退出
    proc.on('exit', (code, signal) => {
      console.log(`[teams] CLI process exited — code: ${code}, signal: ${signal}`);
      // 处理 buffer 中剩余的数据
      if (this.stdoutBuffer.trim()) {
        this.processJsonLine(this.stdoutBuffer.trim());
        this.stdoutBuffer = '';
      }
      this._isRunning = false;
      this.emit('exit', code || 0);
      this.cliProcess = null;
    });

    // 监听 spawn 错误
    proc.on('error', (err) => {
      console.error(`[teams] CLI process spawn error:`, err.message);
      this._isRunning = false;
      this.emit('error', `Failed to start CLI: ${err.message}`);
      this.cliProcess = null;
    });
  }

  /**
   * 处理 stdout 数据块
   * stream-json 格式每行一个完整 JSON 对象，但 Node 的 data 事件可能在任意位置截断
   */
  private handleStdoutChunk(chunk: string) {
    this.stdoutBuffer += chunk;

    // 按换行符分割，逐行处理完整的 JSON
    const lines = this.stdoutBuffer.split('\n');
    // 最后一个元素可能是不完整的行，保留在 buffer 中
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.processJsonLine(trimmed);
    }
  }

  /**
   * 解析并分发一条 JSON 消息
   */
  private processJsonLine(line: string) {
    let msg: CLIStreamMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      // 不是有效 JSON，作为纯文本输出
      console.warn(`[teams] Non-JSON stdout line: ${line.slice(0, 100)}`);
      this.emit('message', { type: 'raw_text', text: line });
      return;
    }

    // 捕获 session_id
    if (msg.session_id && !this.sdkSessionId) {
      this.sdkSessionId = msg.session_id;
    }
    // result 中也可能有 session_id
    if (msg.type === 'result' && msg.session_id) {
      this.sdkSessionId = msg.session_id;
    }

    // 分发消息
    this.emit('message', msg);
  }

  getSdkSessionId(): string | undefined {
    return this.sdkSessionId;
  }

  interrupt(): void {
    if (!this.cliProcess) return;
    console.log(`[teams] Interrupting CLI process`);
    this.cliProcess.kill('SIGINT');
  }

  async close(): Promise<void> {
    if (!this.cliProcess) return;

    return new Promise((resolve) => {
      if (!this.cliProcess) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        if (this.cliProcess) {
          console.log(`[teams] Force-killing CLI process after timeout`);
          this.cliProcess.kill('SIGKILL');
        }
      }, 5000);

      this.cliProcess.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.cliProcess.kill('SIGINT');
    });
  }

  /**
   * 查找 claude CLI — 按优先级尝试多种路径
   */
  private findClaudeCLI(): { command: string; args: string[] } {
    // 方案 1：全局安装的 claude
    const homeLocalBin = path.join(os.homedir(), '.local', 'bin', 'claude');
    if (fs.existsSync(homeLocalBin)) {
      console.log(`[teams] Found CLI at: ${homeLocalBin}`);
      return { command: homeLocalBin, args: [] };
    }

    // 方案 2：项目 node_modules 中的 SDK CLI
    const sdkCLI = path.resolve(
      process.cwd(),
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
      'cli.js'
    );
    if (fs.existsSync(sdkCLI)) {
      console.log(`[teams] Found SDK CLI at: ${sdkCLI}`);
      return { command: process.execPath, args: [sdkCLI] };
    }

    // 方案 3：通过 which/where 查找 PATH 中的 claude
    try {
      const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
      const found = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
      if (found) {
        console.log(`[teams] Found CLI in PATH: ${found}`);
        return { command: found, args: [] };
      }
    } catch {
      // which/where 失败，继续
    }

    // 方案 4：直接使用 'claude' 命令名
    console.log(`[teams] Falling back to 'claude' command in PATH`);
    return { command: 'claude', args: [] };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this._isRunning;
  }
}

/**
 * 全局会话管理器
 */
class TeamsSessionManager {
  private sessions = new Map<string, TeamsSession>();

  async createSession(options: TeamsSessionOptions): Promise<TeamsSession> {
    // 如果已存在相同 session，先关闭
    const existing = this.sessions.get(options.sessionId);
    if (existing) {
      console.log(`[teams] Closing existing session: ${options.sessionId}`);
      await existing.close();
      this.sessions.delete(options.sessionId);
    }

    const session = new TeamsSession(options);
    this.sessions.set(options.sessionId, session);

    session.once('exit', () => {
      this.sessions.delete(options.sessionId);
    });

    return session;
  }

  getSession(sessionId: string): TeamsSession | undefined {
    return this.sessions.get(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.close();
    this.sessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.sessions.values()).map(s => s.close());
    await Promise.all(closePromises);
    this.sessions.clear();
  }
}

export const teamsSessionManager = new TeamsSessionManager();

/**
 * 检查指定团队是否有活跃的 team work（pending/in_progress tasks 或未读 inbox 消息）
 * CLI 退出后用此判断是否需要 --resume 继续。
 * @param teamName 只检查指定团队，不传则检查所有（不推荐，旧数据会干扰）
 */
export function hasActiveTeamWork(teamName?: string): boolean {
  const homedir = os.homedir();
  let foundActiveTasks = false;
  let foundUnreadMessages = false;

  // 检查 pending/in_progress tasks
  const tasksDir = path.join(homedir, '.claude', 'tasks');
  try {
    if (fs.existsSync(tasksDir)) {
      const dirsToCheck = teamName ? [teamName] : fs.readdirSync(tasksDir);
      for (const dir of dirsToCheck) {
        const teamPath = path.join(tasksDir, dir);
        try {
          if (!fs.statSync(teamPath).isDirectory()) continue;
        } catch { continue; }
        const files = fs.readdirSync(teamPath).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const taskPath = path.join(teamPath, file);
            const task = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
            if (task.status === 'pending' || task.status === 'in_progress') {
              console.log(`[teams] Active task: ${dir}/${file} (${task.status})`);
              foundActiveTasks = true;
            }
          } catch { continue; }
        }
      }
    }
  } catch { /* ignore */ }

  // 检查未读 inbox 消息
  const teamsDir = path.join(homedir, '.claude', 'teams');
  try {
    if (fs.existsSync(teamsDir)) {
      const dirsToCheck = teamName ? [teamName] : fs.readdirSync(teamsDir);
      for (const dir of dirsToCheck) {
        const inboxDir = path.join(teamsDir, dir, 'inboxes');
        if (!fs.existsSync(inboxDir)) continue;
        const inboxFiles = fs.readdirSync(inboxDir).filter(f => f.endsWith('.json'));
        for (const file of inboxFiles) {
          try {
            const inboxPath = path.join(inboxDir, file);
            const data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
            const messages = Array.isArray(data) ? data : (data.messages || []);
            const unreadCount = messages.filter((msg: Record<string, unknown>) => msg.read === false).length;
            if (unreadCount > 0) {
              console.log(`[teams] Unread inbox: ${dir}/${file} (${unreadCount} messages)`);
              foundUnreadMessages = true;
            }
          } catch { continue; }
        }
      }
    }
  } catch { /* ignore */ }

  const hasWork = foundActiveTasks || foundUnreadMessages;
  console.log(`[teams] hasActiveTeamWork(${teamName || 'ALL'}): ${hasWork} (tasks=${foundActiveTasks}, messages=${foundUnreadMessages})`);
  return hasWork;
}
