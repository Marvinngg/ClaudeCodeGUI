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
 * GET /api/hub/templates
 * Fetch all templates from Hub
 */
export async function GET() {
  try {
    ensureHubConfigured();
    const templates = await hubClient.fetchTemplates();
    return NextResponse.json(templates);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hub/templates
 * Publish a new template to Hub
 */
export async function POST(request: Request) {
  try {
    ensureHubConfigured();
    const body = await request.json();
    const { name, content, description, publisher, template_type } = body;

    if (!name || !content || !publisher) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const template = await hubClient.publishTemplate({
      name,
      content,
      description: description || '',
      publisher,
      template_type: template_type || 'claude_md',
    });

    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish template' },
      { status: 500 }
    );
  }
}
