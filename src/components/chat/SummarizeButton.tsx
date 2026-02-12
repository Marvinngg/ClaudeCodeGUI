'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { File01Icon, Loading02Icon } from '@hugeicons/core-free-icons';
import type { Message } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';

interface SummarizeButtonProps {
  sessionId: string;
  messages: Message[];
  workingDirectory?: string;
  onSummarizeComplete?: () => void;
}

export function SummarizeButton({
  sessionId,
  messages,
  workingDirectory,
  onSummarizeComplete,
}: SummarizeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  const handleSummarize = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. 调用总结 API（使用 Claude Code SDK）
      const summarizeRes = await fetch('/api/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          workingDirectory,
        }),
      });

      if (!summarizeRes.ok) {
        const data = await summarizeRes.json();
        throw new Error(data.error || 'Failed to summarize');
      }

      const { summary } = await summarizeRes.json();

      // 准备原始消息JSON
      const rawMessagesJson = JSON.stringify(messages.map((m) => ({
        role: m.role,
        content: m.content,
      })));

      // 2. 保存总结到数据库（覆盖已有的）+ 包含原始对话
      const saveRes = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          name: summary.name,
          description: summary.description,
          content: summary.content,
          tags: summary.tags || [],
          raw_messages: rawMessagesJson, // ✅ 保存原始对话
          source: 'local', // ✅ 标记来源
        }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json();
        throw new Error(data.error || 'Failed to save summary');
      }

      // 成功提示
      alert(`总结已保存：\n\n${summary.name}\n\n${summary.description}`);
      onSummarizeComplete?.();
    } catch (err) {
      console.error('[SummarizeButton] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to summarize');
      alert(`总结失败：${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSummarize}
      disabled={loading || messages.length === 0}
      className="gap-2"
    >
      {loading ? (
        <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
      ) : (
        <HugeiconsIcon icon={File01Icon} className="h-4 w-4" />
      )}
      {loading ? t('Summarizing...') : t('Summarize Conversation')}
    </Button>
  );
}
