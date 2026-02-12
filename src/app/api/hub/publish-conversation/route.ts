import { NextRequest } from 'next/server';
import { hubClient } from '@/lib/hub-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PublishConversationRequest {
  name: string;
  description: string;
  content: string;
  tags: string;
  sessionId: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: PublishConversationRequest = await request.json();
    const { name, description, content, tags } = body;

    if (!name || !content) {
      return new Response(JSON.stringify({ error: 'name and content are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if Hub is configured
    if (!hubClient.getConfig()?.url) {
      return new Response(JSON.stringify({ error: 'Hub not configured. Please set up Hub in Settings.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get publisher name (use userId from Hub config)
    const publisher = hubClient.getUserId() || 'anonymous';

    // Publish to Hub as a shared prompt
    const result = await hubClient.publishPrompt({
      name,
      description: description || 'Shared conversation from CodePilot',
      content,
      tags: tags || '',
      publisher,
    });

    if (!result) {
      throw new Error('Failed to publish conversation to Hub');
    }

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[publish-conversation] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
