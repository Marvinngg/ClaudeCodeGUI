import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { upsertTemplateCache } from '@/lib/db';
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
 * POST /api/hub/templates/[id]/install
 * Install a template to local cache
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
      return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
    }

    // Fetch all templates from Hub
    const templates = await hubClient.fetchTemplates();
    const template = templates.find(t => t.id === numId);

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Install (cache) the template locally
    upsertTemplateCache(template);

    return NextResponse.json({ success: true, template });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to install template' },
      { status: 500 }
    );
  }
}
