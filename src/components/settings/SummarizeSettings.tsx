'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading02Icon, CheckmarkCircle01Icon } from '@hugeicons/core-free-icons';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SummarizeSettingsData {
  summarize_prompt?: string;
  summarize_model?: string;
  summarize_max_messages?: string;
  summarize_max_chars?: string;
}

const DEFAULT_PROMPT = `你是一个专业的对话分析助手。请分析以下对话并生成一个简洁的总结。

对话内容：
{{conversation}}

请以 JSON 格式返回总结，包含以下字段：
- name: 简短的标题（不超过50个字符）
- description: 1-2句话概括对话主题
- content: 详细总结，包括关键话题、解决的问题和结果（2-4段）
- tags: 相关标签数组（例如 ["typescript", "api", "debugging"]）

只返回 JSON，不要包含 markdown 代码块或额外文本。`;

export function SummarizeSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState('auto');
  const [maxMessages, setMaxMessages] = useState('100');
  const [maxChars, setMaxChars] = useState('100000');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/app');
      if (res.ok) {
        const data = await res.json();
        const settings: SummarizeSettingsData = data.settings || {};

        setPrompt(settings.summarize_prompt || DEFAULT_PROMPT);
        setModel(settings.summarize_model || 'auto');
        setMaxMessages(settings.summarize_max_messages || '100');
        setMaxChars(settings.summarize_max_chars || '100000');
      }
    } catch (error) {
      console.error('[SummarizeSettings] Load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      const updates: Record<string, string> = {
        summarize_prompt: prompt,
        summarize_model: model,
        summarize_max_messages: maxMessages,
        summarize_max_chars: maxChars,
      };

      for (const [key, value] of Object.entries(updates)) {
        const res = await fetch('/api/settings/app', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });

        if (!res.ok) {
          throw new Error(`Failed to save ${key}`);
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('[SummarizeSettings] Save error:', error);
      alert(`保存失败：${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('确定要恢复默认设置吗？')) {
      setPrompt(DEFAULT_PROMPT);
      setModel('auto');
      setMaxMessages('100');
      setMaxChars('100000');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <HugeiconsIcon icon={Loading02Icon} className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>总结设置</CardTitle>
          <CardDescription>
            自定义对话总结的提示词、模型选择和输入限制。这些设置会影响"总结对话"功能的行为。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 提示词 */}
          <div className="space-y-2">
            <Label htmlFor="summarize-prompt">总结提示词</Label>
            <Textarea
              id="summarize-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入自定义提示词..."
              rows={12}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              使用 <code className="px-1 py-0.5 bg-muted rounded">{'{{conversation}}'}</code>{' '}
              作为对话内容的占位符。提示词应该引导模型返回 JSON 格式的总结。
            </p>
          </div>

          {/* 模型选择 */}
          <div className="space-y-2">
            <Label htmlFor="summarize-model">模型选择</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="summarize-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动选择（短对话用 Haiku，长对话用 Sonnet）</SelectItem>
                <SelectItem value="haiku">Claude Haiku（更快更便宜）</SelectItem>
                <SelectItem value="sonnet">Claude Sonnet（更稳定，上下文更大）</SelectItem>
                <SelectItem value="opus">Claude Opus（最强大，最贵）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              自动模式会根据对话长度智能选择模型：&lt; 50K 字符用 Haiku，≥ 50K 字符用 Sonnet。
            </p>
          </div>

          {/* 输入限制 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-messages">最大消息数</Label>
              <Input
                id="max-messages"
                type="number"
                value={maxMessages}
                onChange={(e) => setMaxMessages(e.target.value)}
                min="10"
                max="1000"
              />
              <p className="text-xs text-muted-foreground">
                只处理最近的 N 条消息（默认 100）
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-chars">最大字符数</Label>
              <Input
                id="max-chars"
                type="number"
                value={maxChars}
                onChange={(e) => setMaxChars(e.target.value)}
                min="10000"
                max="500000"
              />
              <p className="text-xs text-muted-foreground">
                限制输入字符数（默认 100K）
              </p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground p-3 bg-muted rounded-md">
            <strong>说明：</strong>
            <ul className="mt-1 space-y-1 list-disc list-inside">
              <li>提示词中的 <code>{'{{conversation}}'}</code> 会被替换为实际的对话内容</li>
              <li>输入限制防止超长对话导致 API 错误或超时</li>
              <li>如果对话超过限制，会自动截断并保留最近的消息</li>
              <li>修改这些设置后，新的总结请求将使用新配置</li>
            </ul>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3 pt-4">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <HugeiconsIcon icon={CheckmarkCircle01Icon} className="h-4 w-4" />
              ) : null}
              {saving ? '保存中...' : saved ? '已保存' : '保存设置'}
            </Button>
            <Button onClick={handleReset} variant="outline">
              恢复默认
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
