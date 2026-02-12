'use client';

import { useState, useEffect } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  File01Icon,
  Download01Icon,
  Loading02Icon,
  Calendar03Icon,
  CheckmarkCircle01Icon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';

interface HubConversation {
  id: number;
  title: string;
  content: string;
  user_id: string;
  description: string;
  tags: string;
  raw_messages?: string | null; // ✅ 原始对话
  created_at: string;
  updated_at: string;
}

export function HubConversations() {
  const [conversations, setConversations] = useState<HubConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<HubConversation | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<number>>(new Set());
  const [installing, setInstalling] = useState<number | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    loadConversations();
  }, []);

  // ✅ 当 Hub 对话加载完成后，检查已安装状态
  useEffect(() => {
    if (conversations.length > 0) {
      loadInstalledConversations();
    }
  }, [conversations]);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hub/conversations');
      if (!res.ok) throw new Error('Failed to load Hub conversations');
      const data = await res.json();
      setConversations(data || []);
    } catch (error) {
      console.error('[HubConversations] Load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadInstalledConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) return;
      const data = await res.json();
      const installed = data.conversations || [];

      // ✅ 通过对比 title 和 source='hub' 来判断是否已安装
      const ids = new Set<number>();
      conversations.forEach((hubConv) => {
        const isInstalled = installed.some(
          (localConv: any) =>
            localConv.source === 'hub' &&
            localConv.name === hubConv.title
        );
        if (isInstalled) {
          ids.add(hubConv.id);
        }
      });
      setInstalledIds(ids);
    } catch (error) {
      console.error('[HubConversations] Load installed error:', error);
    }
  };

  const handleSelectConversation = (conv: HubConversation) => {
    setSelectedId(conv.id);
    setSelectedConversation(conv);
  };

  const handleInstall = async (conv: HubConversation, e?: React.MouseEvent) => {
    e?.stopPropagation();

    if (installedIds.has(conv.id)) {
      alert(t('Already installed'));
      return;
    }

    if (!confirm(t('Confirm install').replace('{{name}}', conv.title))) {
      return;
    }

    setInstalling(conv.id);
    try {
      // ✅ 保存到本地数据库（自动创建真实的聊天会话）
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 不传 session_id，让 API 自动创建真实会话
          name: `${conv.title}`, // 不需要 [Hub-] 标记，用 source 字段区分
          description: conv.description,
          content: conv.content,
          tags: conv.tags.split(',').map(t => t.trim()).filter(Boolean),
          raw_messages: conv.raw_messages || null, // ✅ 保存原始对话
          source: 'hub', // ✅ 标记来自 Hub
          working_directory: '', // 空工作目录
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to install conversation');
      }

      const data = await res.json();

      // 更新已安装列表
      setInstalledIds(prev => new Set(prev).add(conv.id));

      // 提示成功
      alert(t('Installation Successful!'));
    } catch (error) {
      console.error('[HubConversations] Install error:', error);
      alert(t('Installation Failed').replace('{{error}}', error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setInstalling(null);
    }
  };

  const handleDownloadMarkdown = async (conv: HubConversation, e?: React.MouseEvent) => {
    e?.stopPropagation();

    try {
      // 生成 Markdown 内容
      const markdown = `# ${conv.title}

> ${conv.description}

${conv.tags ? `**Tags:** ${conv.tags}\n\n` : ''}**Publisher:** ${conv.user_id}
**Created:** ${formatDate(conv.created_at)}
**Updated:** ${formatDate(conv.updated_at)}

---

${conv.content}

---

_Downloaded from Hub_
`;

      // 创建下载链接
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${conv.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[HubConversations] Download error:', error);
      alert(`下载失败：${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const parseTags = (tagsStr: string): string[] => {
    return tagsStr.split(',').map(t => t.trim()).filter(Boolean);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <HugeiconsIcon icon={Loading02Icon} className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 左侧：列表 */}
      <div className="w-1/3 border-r border-border overflow-y-auto">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{t('Hub Conversations')}</h2>
          <p className="text-sm text-muted-foreground">{t('total conversations').replace('{{count}}', String(conversations.length))}</p>
        </div>

        <div className="divide-y divide-border">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <HugeiconsIcon icon={File01Icon} className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>{t('No Hub conversations')}</p>
              <p className="text-xs mt-1">{t('Shared conversations will appear here')}</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const isInstalled = installedIds.has(conv.id);
              const isInstalling = installing === conv.id;

              return (
                <div
                  key={conv.id}
                  className={`p-4 cursor-pointer hover:bg-accent transition-colors group ${
                    selectedId === conv.id ? 'bg-accent' : ''
                  }`}
                  onClick={() => handleSelectConversation(conv)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium truncate">{conv.title}</h3>
                        {isInstalled && (
                          <HugeiconsIcon
                            icon={CheckmarkCircle01Icon}
                            className="h-4 w-4 text-green-500 shrink-0"
                          />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {conv.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <HugeiconsIcon icon={Calendar03Icon} className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {conv.user_id} • {formatDate(conv.updated_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => handleDownloadMarkdown(conv, e)}
                        title={t('Download Markdown')}
                      >
                        <HugeiconsIcon icon={Download01Icon} className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* 标签和发布者 */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {/* 发布者标签 */}
                    {conv.user_id && (
                      <Badge variant="outline" className="text-xs">
                        @ {conv.user_id}
                      </Badge>
                    )}
                    {/* 内容标签 */}
                    {parseTags(conv.tags).slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {parseTags(conv.tags).length > 2 && (
                      <Badge variant="secondary" className="text-xs">
                        +{parseTags(conv.tags).length - 2}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 右侧：详情 */}
      <div className="flex-1 overflow-y-auto">
        {selectedConversation ? (
          <div className="p-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle>{selectedConversation.title}</CardTitle>
                      {installedIds.has(selectedConversation.id) && (
                        <Badge variant="outline" className="gap-1">
                          <HugeiconsIcon icon={CheckmarkCircle01Icon} className="h-3 w-3" />
                          {t('Installed')}
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="mt-2">
                      {selectedConversation.description}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={(e) => handleInstall(selectedConversation, e)}
                      disabled={installedIds.has(selectedConversation.id) || installing === selectedConversation.id}
                    >
                      {installing === selectedConversation.id ? (
                        <>
                          <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 mr-1 animate-spin" />
                          {t('Installing...')}
                        </>
                      ) : installedIds.has(selectedConversation.id) ? (
                        <>
                          <HugeiconsIcon icon={CheckmarkCircle01Icon} className="h-4 w-4 mr-1" />
                          {t('Installed')}
                        </>
                      ) : (
                        t('Install to Local')
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleDownloadMarkdown(selectedConversation, e)}
                      title={t('Download Markdown')}
                    >
                      <HugeiconsIcon icon={Download01Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {parseTags(selectedConversation.tags).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {parseTags(selectedConversation.tags).map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span>{t('Publisher')}：{selectedConversation.user_id}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <HugeiconsIcon icon={Calendar03Icon} className="h-4 w-4" />
                    <span>{t('Created')}：{formatDate(selectedConversation.created_at)}</span>
                  </div>
                  {selectedConversation.updated_at !== selectedConversation.created_at && (
                    <div className="flex items-center gap-1">
                      <HugeiconsIcon icon={Calendar03Icon} className="h-4 w-4" />
                      <span>{t('Updated')}：{formatDate(selectedConversation.updated_at)}</span>
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <div className="whitespace-pre-wrap">{selectedConversation.content}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <HugeiconsIcon icon={File01Icon} className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p>{t('Select a conversation to view details')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
