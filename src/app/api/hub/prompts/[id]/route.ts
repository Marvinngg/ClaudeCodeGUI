import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
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
 * DELETE /api/hub/prompts/[id]
 * Delete a prompt from Hub
 */
export async function DELETE(
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

    const success = await hubClient.deletePrompt(numId);

    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete prompt' },
      { status: 500 }
    );
  }
}
