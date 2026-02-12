import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { getSetting } from '@/lib/db';

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
 * GET /api/hub/prompts
 * Fetch all prompts from Hub
 */
export async function GET() {
  try {
    ensureHubConfigured();
    const prompts = await hubClient.fetchPrompts();
    return NextResponse.json(prompts);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch prompts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hub/prompts
 * Publish a new prompt to Hub
 */
export async function POST(request: Request) {
  try {
    ensureHubConfigured();
    const body = await request.json();
    const { name, content, description, publisher, tags } = body;

    if (!name || !content || !publisher) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const prompt = await hubClient.publishPrompt({
      name,
      content,
      description: description || '',
      publisher,
      tags: tags || '',
    });

    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish prompt' },
      { status: 500 }
    );
  }
}
