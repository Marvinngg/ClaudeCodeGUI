'use client';

import type { Message, PermissionRequestEvent } from '@/types';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';
import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon } from "@hugeicons/core-free-icons";

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface TeamNotification {
  task_id: string;
  status: string;
  summary: string;
}

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  statusText?: string;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny') => void;
  permissionResolved?: 'allow' | 'deny' | null;
  teamNotifications?: TeamNotification[];
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  statusText,
  pendingPermission,
  onPermissionResponse,
  permissionResolved,
  teamNotifications,
}: MessageListProps) {
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ConversationEmptyState
          title="Claude Chat"
          description="Start a conversation with Claude. Ask questions, get help with code, or explore ideas."
          icon={
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20">
              <HugeiconsIcon icon={BotIcon} className="h-8 w-8 text-violet-500" />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <Conversation>
      <ConversationContent className="mx-auto max-w-3xl px-4 py-6 gap-6">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}

        {isStreaming && (
          <StreamingMessage
            content={streamingContent}
            isStreaming={isStreaming}
            toolUses={toolUses}
            toolResults={toolResults}
            streamingToolOutput={streamingToolOutput}
            statusText={statusText}
            pendingPermission={pendingPermission}
            onPermissionResponse={onPermissionResponse}
            permissionResolved={permissionResolved}
            teamNotifications={teamNotifications}
          />
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
