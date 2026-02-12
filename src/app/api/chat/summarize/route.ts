import { NextRequest } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getSetting, getActiveProvider } from '@/lib/db';
import { findClaudeBinary, getExpandedPath } from '@/lib/platform';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SummarizeRequest {
  session_id: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  workingDirectory?: string;
}

interface SummarySuggestion {
  name: string;
  description: string;
  content: string;
  tags: string[];
}

export async function POST(request: NextRequest) {
  let originalMessagesCount = 0;

  try {
    const body: SummarizeRequest = await request.json();
    const { session_id, messages, workingDirectory } = body;

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    originalMessagesCount = messages.length;

    // ✅ 从设置中加载配置
    const summarizePromptTemplate = getSetting('summarize_prompt') || '';
    const summarizeModel = getSetting('summarize_model') || 'auto';
    const maxMessagesStr = getSetting('summarize_max_messages') || '100';
    const maxCharsStr = getSetting('summarize_max_chars') || '100000';

    const MAX_MESSAGES = parseInt(maxMessagesStr, 10);
    const MAX_CHARS = parseInt(maxCharsStr, 10);

    // ✅ 使用 Claude Code SDK 进行总结（而不是直接调用 Anthropic API）
    const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> };
    sdkEnv.HOME = os.homedir();
    sdkEnv.USERPROFILE = os.homedir();
    sdkEnv.PATH = getExpandedPath();

    // Get API config
    const activeProvider = getActiveProvider();
    if (activeProvider && activeProvider.api_key) {
      for (const key of Object.keys(sdkEnv)) {
        if (key.startsWith('ANTHROPIC_')) delete sdkEnv[key];
      }
      sdkEnv.ANTHROPIC_AUTH_TOKEN = activeProvider.api_key;
      sdkEnv.ANTHROPIC_API_KEY = activeProvider.api_key;
      if (activeProvider.base_url) {
        sdkEnv.ANTHROPIC_BASE_URL = activeProvider.base_url;
      }
    }

    // ⚠️ 限制输入长度，防止超过模型上下文窗口
    // 1. 先限制消息数量
    let selectedMessages = messages.slice(-MAX_MESSAGES);

    // 2. 计算总长度，如果超限则进一步截断
    let conversationText = selectedMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    if (conversationText.length > MAX_CHARS) {
      // 智能截断：优先保留最近的消息
      console.log(`[summarize] Conversation too long (${conversationText.length} chars), truncating...`);

      // 逐步减少消息数量直到满足长度限制
      while (conversationText.length > MAX_CHARS && selectedMessages.length > 10) {
        selectedMessages = selectedMessages.slice(-Math.floor(selectedMessages.length * 0.8));
        conversationText = selectedMessages
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n');
      }

      // 如果还是太长，直接截断字符串
      if (conversationText.length > MAX_CHARS) {
        conversationText = conversationText.slice(-MAX_CHARS);
        conversationText = '...(earlier messages truncated)\n\n' + conversationText;
      }

      console.log(`[summarize] Truncated to ${conversationText.length} chars, ${selectedMessages.length} messages`);
    }

    // 使用自定义提示词模板，如果没有配置则使用默认提示词
    let prompt: string;
    if (summarizePromptTemplate) {
      // 替换占位符
      prompt = summarizePromptTemplate.replace('{{conversation}}', conversationText);
    } else {
      // 默认提示词
      prompt = `你是一个专业的对话分析助手。请分析以下对话并生成一个简洁的总结。

对话内容：
${conversationText}

请以 JSON 格式返回总结，包含以下字段：
- name: 简短的标题（不超过50个字符）
- description: 1-2句话概括对话主题
- content: 详细总结，包括关键话题、解决的问题和结果（2-4段）
- tags: 相关标签数组（例如 ["typescript", "api", "debugging"]）

只返回 JSON，不要包含 markdown 代码块或额外文本。`;
    }

    const claudePath = findClaudeBinary();

    // ⚠️ 根据用户配置或自动选择模型
    let selectedModel: string;
    if (summarizeModel === 'auto') {
      // 自动模式：根据 prompt 长度选择
      const useStableModel = prompt.length > 50000;
      selectedModel = useStableModel ? 'sonnet' : 'haiku';
    } else {
      // 使用用户指定的模型
      selectedModel = summarizeModel;
    }

    // ⚠️ 对于简单的总结任务，使用轻量级配置（不需要 claude_code 完整工具系统）
    const queryOptions: Parameters<typeof query>[0]['options'] = {
      cwd: workingDirectory || os.homedir(),
      // 不设置 settingSources 和 systemPrompt，使用最简配置
      model: selectedModel,
      env: sdkEnv,
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
    };

    console.log('[summarize] Starting query with options:', {
      cwd: queryOptions.cwd,
      model: queryOptions.model,
      hasClaudePath: !!claudePath,
      promptLength: prompt.length,
      messagesCount: selectedMessages.length,
    });

    // ✅ 使用 Claude Code SDK query
    const conversation = query({
      prompt,
      options: queryOptions,
    });

    let summaryText = '';
    let hadError = false;
    let errorDetails = '';

    try {
      for await (const message of conversation) {
        console.log('[summarize] Received message:', message.type);

        if (message.type === 'assistant') {
          const text = message.message.content
            .filter((b) => b.type === 'text')
            .map((b) => 'text' in b ? b.text : '')
            .join('');
          summaryText += text;
        }

        // 捕获可能的错误信息
        if (message.type === 'system') {
          const systemMsg = JSON.stringify(message);
          if (systemMsg.includes('error') || systemMsg.includes('failed')) {
            console.warn('[summarize] System message with potential error:', systemMsg);
            errorDetails += systemMsg;
          }
        }
      }

      console.log('[summarize] Summary text length:', summaryText.length);

      // 检查是否成功生成内容
      if (!summaryText.trim()) {
        hadError = true;
        throw new Error('SDK returned empty response. This may indicate context window overflow or API issues.');
      }
    } catch (streamError) {
      hadError = true;
      const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
      console.error('[summarize] Stream error:', errMsg);
      console.error('[summarize] Error details:', errorDetails);

      // 提供更友好的错误信息
      if (errMsg.includes('exited with code 1')) {
        throw new Error(
          `总结失败：对话可能过长或 API 配置有误。` +
          `已处理 ${selectedMessages.length} 条消息（${prompt.length} 字符）。` +
          `请尝试减少消息数量或检查 API 配置。`
        );
      }

      throw new Error(`总结失败：${errMsg}`);
    }

    // Parse JSON response
    let summary: SummarySuggestion;
    try {
      const jsonMatch = summaryText.match(/```json\s*([\s\S]*?)\s*```/) || summaryText.match(/```\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : summaryText;
      summary = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.warn('[summarize] JSON parse failed, trying raw text:', parseError);
      try {
        summary = JSON.parse(summaryText);
      } catch {
        // 如果 JSON 解析失败，但我们有文本内容，就用文本作为总结
        if (summaryText.trim()) {
          console.warn('[summarize] Using raw text as summary content');
          summary = {
            name: '对话会话',
            description: '关于多个主题的对话',
            content: summaryText,
            tags: [],
          };
        } else {
          throw new Error('SDK 返回了空内容，无法生成总结');
        }
      }
    }

    return new Response(JSON.stringify({ summary }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[summarize] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';

    // 记录详细错误以便调试
    console.error('[summarize] Full error details:', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
      originalMessagesCount,
    });

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
