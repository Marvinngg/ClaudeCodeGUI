import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { upsertSkillCache } from '@/lib/db';
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
 * POST /api/hub/skills/[id]/install
 * Install a skill to local cache
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
      return NextResponse.json({ error: 'Invalid skill ID' }, { status: 400 });
    }

    // Fetch all skills from Hub
    const skills = await hubClient.fetchSkills();
    const skill = skills.find(s => s.id === numId);

    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    // Install (cache) the skill locally
    upsertSkillCache(skill);

    return NextResponse.json({ success: true, skill });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to install skill' },
      { status: 500 }
    );
  }
}
