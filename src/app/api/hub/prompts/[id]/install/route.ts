import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { upsertPromptCache } from '@/lib/db';
import { getSetting } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Configure hubClient before making requests
 */
function ensureHubConfigured() {
  const hubUrl = getSetting('hub_url');
  const hubUserId = getSetting('hub_user_id');
  const hubSyncInterval = getSetting('hub_sync_interval');

  if (!hubUrl) {
    throw new Error('Hub URL not configured');
  }

  hubClient.configure({
    url: hubUrl,
    userId: hubUserId || 'anonymous',
    syncInterval: parseInt(hubSyncInterval || '300', 10),
  });
}

/**
 * POST /api/hub/prompts/[id]/install
 * Install a prompt to local cache
 */
export async function POST(
  request: Request,
  context: RouteContext
) {
  try {
    ensureHubConfigured();

    const { id } = await context.params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ error: 'Invalid prompt ID' }, { status: 400 });
    }

    // Fetch all prompts from Hub
    const prompts = await hubClient.fetchPrompts();
    const prompt = prompts.find(p => p.id === numId);

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    // Install (cache) the prompt locally
    upsertPromptCache(prompt);

    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to install prompt' },
      { status: 500 }
    );
  }
}
