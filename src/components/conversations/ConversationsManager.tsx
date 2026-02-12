'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HubConversations } from '@/components/hub/HubConversations';
import { LocalSummariesList } from './LocalSummariesList';
import { LocalConversationList } from './LocalConversationList';
import { Badge } from '@/components/ui/badge';

export function ConversationsManager() {
  const [activeTab, setActiveTab] = useState('summaries');

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0 px-6 pt-2">
          <TabsList>
            <TabsTrigger value="summaries">对话总结</TabsTrigger>
            <TabsTrigger value="sessions">聊天会话</TabsTrigger>
            <TabsTrigger value="hub" className="gap-2">
              Hub
              <Badge variant="secondary" className="px-1 py-0 h-4 text-[10px] bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 border-0">
                Shared
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summaries" className="flex-1 min-h-0 mt-0 overflow-hidden">
          <LocalSummariesList />
        </TabsContent>

        <TabsContent value="sessions" className="flex-1 min-h-0 mt-0 overflow-y-auto">
          <LocalConversationList />
        </TabsContent>

        <TabsContent value="hub" className="flex-1 min-h-0 mt-0 overflow-hidden p-4">
          <HubConversations />
        </TabsContent>
      </Tabs>
    </div>
  );
}
