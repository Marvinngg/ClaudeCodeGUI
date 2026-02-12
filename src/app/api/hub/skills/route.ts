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
 * GET /api/hub/skills
 * Fetch all skills from Hub
 */
export async function GET() {
  try {
    ensureHubConfigured();
    const skills = await hubClient.fetchSkills();
    return NextResponse.json(skills);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch skills' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hub/skills
 * Publish a new skill to Hub
 */
export async function POST(request: Request) {
  try {
    ensureHubConfigured();
    const body = await request.json();
    const { name, content, description, publisher } = body;

    if (!name || !content || !publisher) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const skill = await hubClient.publishSkill({
      name,
      content,
      description: description || '',
      publisher,
    });

    return NextResponse.json(skill);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish skill' },
      { status: 500 }
    );
  }
}
