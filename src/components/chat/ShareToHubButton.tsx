'use client';

import { useState } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import { Share01Icon } from "@hugeicons/core-free-icons";
import type { Message } from '@/types';

interface ShareToHubButtonProps {
  sessionId: string;
  messages: Message[];
}

interface Summary {
  name: string;
  description: string;
  content: string;
  tags: string[];
}

export function ShareToHubButton({ sessionId, messages }: ShareToHubButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [editedName, setEditedName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [editedTags, setEditedTags] = useState('');

  const handleShare = async () => {
    if (messages.length === 0) {
      setError('No messages to share');
      return;
    }

    setIsOpen(true);
    setIsLoading(true);
    setError(null);

    try {
      // Get Hub URL from settings
      const settingsRes = await fetch('/api/settings/app');
      const settings = await settingsRes.json();
      const hubUrl = settings.hubUrl || 'http://localhost:3100';

      // Call Hub's summarize API
      const response = await fetch(`${hubUrl}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })),
          summary_type: 'prompt',
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to generate summary');
      }

      const generatedSummary = await response.json() as Summary;
      setSummary(generatedSummary);
      setEditedName(generatedSummary.name);
      setEditedDescription(generatedSummary.description);
      setEditedContent(generatedSummary.content);
      setEditedTags(generatedSummary.tags.join(', '));
    } catch (err) {
      console.error('[ShareToHubButton] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!summary) return;

    setIsLoading(true);
    setError(null);

    try {
      // Call Hub client to publish via our internal proxy
      const response = await fetch('/api/hub/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editedName,
          description: editedDescription,
          content: JSON.stringify(messages), // Store full conversation history
          tags: editedTags,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to publish to Hub');
      }

      // Success
      setIsOpen(false);
      setSummary(null);
      alert('Successfully shared to Hub!');
    } catch (err) {
      console.error('[ShareToHubButton] Publish error:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setSummary(null);
    setError(null);
  };

  return (
    <>
      <button
        onClick={handleShare}
        disabled={messages.length === 0}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Share conversation to Hub"
      >
        <HugeiconsIcon icon={Share01Icon} size={16} />
        <span>Share to Hub</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-zinc-900 rounded-lg shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Share Conversation to Hub</h2>
              <button
                onClick={handleClose}
                className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            {isLoading && !summary && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Generating summary...
                </span>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            )}

            {summary && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-sm"
                    placeholder="Enter a title for this conversation"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-sm"
                    placeholder="Brief description (1-2 sentences)"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Content</label>
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-sm font-mono"
                    placeholder="Detailed summary of the conversation"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Tags</label>
                  <input
                    type="text"
                    value={editedTags}
                    onChange={(e) => setEditedTags(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-sm"
                    placeholder="Comma-separated tags (e.g., typescript, api, debugging)"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <button
                    onClick={handlePublish}
                    disabled={isLoading || !editedName.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Publishing...' : 'Publish to Hub'}
                  </button>
                  <button
                    onClick={handleClose}
                    disabled={isLoading}
                    className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
