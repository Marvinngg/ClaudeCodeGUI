'use client';

import { useEffect, useState, use } from 'react';
import type { Message, MessagesResponse, ChatSession } from '@/types';
import { ChatView } from '@/components/chat/ChatView';
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { usePanel } from '@/hooks/usePanel';

interface ChatSessionPageProps {
  params: Promise<{ id: string }>;
}

export default function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { id } = use(params);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sessionModel, setSessionModel] = useState<string>('');
  const [sessionMode, setSessionMode] = useState<string>('');
  const { setSessionId, setSessionTitle: setPanelSessionTitle, setPanelOpen, setWorkingDirectory: setGlobalWorkingDirectory } = usePanel();
  const [sessionWorkingDir, setSessionWorkingDir] = useState<string>('');

  // 🔧 Load session info - 只设置当前 session 的工作目录，不污染全局状态
  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch(`/api/chat/sessions/${id}`);
        if (res.ok) {
          const data: { session: ChatSession } = await res.json();
          // 🔧 设置本地 state，同时同步到全局供 RightPanel 显示
          const wd = data.session.working_directory || '';
          setSessionWorkingDir(wd);
          setGlobalWorkingDirectory(wd);
          setSessionId(id);
          setPanelOpen(true);
          const title = data.session.title || 'New Conversation';
          setSessionTitle(title);
          setPanelSessionTitle(title);
          setSessionModel(data.session.model || '');
          setSessionMode(data.session.mode || 'code');
        }
      } catch {
        // Session info load failed - panel will still work without directory
      }
    }

    loadSession();
  }, [id, setSessionId, setPanelSessionTitle, setPanelOpen, setGlobalWorkingDirectory]);

  useEffect(() => {
    // Reset state when switching sessions
    setLoading(true);
    setError(null);
    setMessages([]);

    let cancelled = false;

    async function loadMessages() {
      try {
        const res = await fetch(`/api/chat/sessions/${id}/messages`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setError('Session not found');
            return;
          }
          throw new Error('Failed to load messages');
        }
        const data: MessagesResponse = await res.json();
        if (cancelled) return;
        setMessages(data.messages);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMessages();

    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <HugeiconsIcon icon={Loading02Icon} className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">{error}</p>
          <a href="/chat" className="text-sm text-muted-foreground hover:underline">
            Start a new chat
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Chat title bar */}
      {sessionTitle && (
        <div
          className="flex items-center justify-center px-4 py-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <h2 className="text-sm font-medium text-foreground/80 truncate max-w-md">
            {sessionTitle}
          </h2>
        </div>
      )}
      <ChatView
        key={id}
        sessionId={id}
        initialMessages={messages}
        modelName={sessionModel}
        initialMode={sessionMode}
        initialWorkingDirectory={sessionWorkingDir}
      />
    </div>
  );
}
