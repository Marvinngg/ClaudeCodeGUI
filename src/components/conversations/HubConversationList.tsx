
import { useState } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Share01Icon,
  Delete02Icon,
  Message01Icon,
  Loading02Icon,
  Tick01Icon,
  Download01Icon
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { HubConversation } from '@/lib/hub-client';
import { useRouter } from 'next/navigation';

interface HubConversationListProps {
  hubUrl: string;
}

export function HubConversationList({ hubUrl }: HubConversationListProps) {
  const [conversations, setConversations] = useState<HubConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<number | null>(null);
  const router = useRouter();

  // Fetch conversations on mount
  useState(() => {
    async function fetchConversations() {
      try {
        const res = await fetch('/api/hub/conversations');
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch (error) {
        console.error('Failed to fetch hub conversations:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchConversations();
  });

  const handleImport = async (conversation: HubConversation) => {
    setImportingId(conversation.id);
    try {
      const res = await fetch('/api/chat/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: conversation.title,
          content: conversation.content,
          description: conversation.description
        })
      });

      if (res.ok) {
        const data = await res.json();
        // Redirect to the new chat
        router.push(`/chat/${data.sessionId}`);
      } else {
        alert('Failed to import conversation');
      }
    } catch (error) {
      console.error('Error importing:', error);
      alert('Error importing conversation');
    } finally {
      setImportingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <HugeiconsIcon icon={Message01Icon} className="h-8 w-8 opacity-30" />
        <p>No shared conversations found in Hub</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {conversations.map((conv) => (
        <div key={conv.id} className="group border border-border rounded-lg p-4 hover:border-blue-500/50 transition-colors bg-card">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-medium truncate pr-2" title={conv.title}>{conv.title}</h3>
            {conv.tags && conv.tags.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                {conv.tags.split(',')[0]}
              </Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground line-clamp-3 mb-4 h-[4.5em]">
            {conv.description || "No description provided."}
          </p>

          <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
            <div className="text-xs text-muted-foreground">
              By {conv.user_id}
            </div>
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 h-7 text-xs"
              onClick={() => handleImport(conv)}
              disabled={importingId === conv.id}
            >
              {importingId === conv.id ? (
                <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" />
              )}
              {importingId === conv.id ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
