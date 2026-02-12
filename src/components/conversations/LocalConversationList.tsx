
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Message01Icon,
  Delete02Icon,
  Share01Icon,
  Loading02Icon,
  ArrowRight01Icon
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChatSession } from '@/types';
import { ShareToHubButton } from '@/components/chat/ShareToHubButton'; // We might need to adapt this or create a wrapper

export function LocalConversationList() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this conversation?')) return;

    try {
      const res = await fetch(`/api/chat/sessions/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleOpen = (id: string) => {
    router.push(`/chat/${id}`);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <HugeiconsIcon icon={Message01Icon} className="h-8 w-8 opacity-30" />
        <p>No local conversations found</p>
        <Button onClick={() => router.push('/')} variant="outline" className="mt-2">
          Start a new chat
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group"
          onClick={() => handleOpen(session.id)}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-1 p-1.5 bg-primary/10 rounded-full text-primary">
              <HugeiconsIcon icon={Message01Icon} className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-medium truncate pr-2 text-sm text-foreground">
                {session.title || 'Untitled Conversation'}
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                <span>•</span>
                <span>{session.model || 'Unknown Model'}</span>
                {session.project_name && (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[150px]">{session.project_name}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
             {/*
                Note: Direct sharing from this list requires fetching messages first.
                For now we'll just show the delete button and let them share from the chat view.
                We could add a 'ShareButtonWrapper' later that fetches messages on click.
             */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={(e) => handleDelete(session.id, e)}
              title="Delete conversation"
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => handleOpen(session.id)}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
