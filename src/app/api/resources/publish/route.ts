import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { getSetting } from '@/lib/db';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
 * Parse front matter from template content
 */
function parseFrontMatter(content: string): { metadata: Record<string, string>; body: string } {
  const frontMatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontMatterRegex);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const [, frontMatter, body] = match;
  const metadata: Record<string, string> = {};

  frontMatter.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      metadata[key.trim()] = valueParts.join(':').trim();
    }
  });

  return { metadata, body: body.trim() };
}

/**
 * Publish a skill from local file to Hub
 */
async function publishSkill(filePath: string, publisher: string): Promise<{ success: boolean; message: string; id?: number }> {
  try {
    ensureHubConfigured();

    // Resolve file path
    const absolutePath = filePath.startsWith('~')
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return { success: false, message: `File not found: ${absolutePath}` };
    }

    // Read and parse skill file
    const content = fs.readFileSync(absolutePath, 'utf-8');
    let skillData;

    try {
      skillData = JSON.parse(content);
    } catch {
      return { success: false, message: 'Invalid JSON format in skill file' };
    }

    // Validate required fields
    if (!skillData.name || !skillData.content) {
      return { success: false, message: 'Skill file must contain name and content fields' };
    }

    // Publish to Hub
    const result = await hubClient.publishSkill({
      name: skillData.name,
      content: skillData.content,
      description: skillData.description || '',
      publisher: publisher,
    });

    if (result) {
      return {
        success: true,
        message: `Skill "${skillData.name}" published successfully`,
        id: result.id,
      };
    } else {
      return { success: false, message: 'Failed to publish skill to Hub' };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to publish skill',
    };
  }
}

/**
 * Publish a template from local file to Hub
 */
async function publishTemplate(filePath: string, publisher: string): Promise<{ success: boolean; message: string; id?: number }> {
  try {
    ensureHubConfigured();

    // Resolve file path
    const absolutePath = filePath.startsWith('~')
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return { success: false, message: `File not found: ${absolutePath}` };
    }

    // Read template file
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const { metadata, body } = parseFrontMatter(content);

    // Extract or infer template name
    const fileName = path.basename(absolutePath, path.extname(absolutePath));
    const name = metadata.name || fileName;

    // Determine template type from file extension
    const ext = path.extname(absolutePath).toLowerCase();
    const templateType = ext === '.md' ? 'claude_md' : metadata.template_type || 'text';

    // Publish to Hub
    const result = await hubClient.publishTemplate({
      name: name,
      content: body || content,
      description: metadata.description || '',
      publisher: publisher,
      template_type: templateType,
    });

    if (result) {
      return {
        success: true,
        message: `Template "${name}" published successfully`,
        id: result.id,
      };
    } else {
      return { success: false, message: 'Failed to publish template to Hub' };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to publish template',
    };
  }
}

/**
 * Publish a prompt from database to Hub
 */
async function publishPromptFromDb(promptId: number, publisher: string): Promise<{ success: boolean; message: string; id?: number }> {
  try {
    ensureHubConfigured();

    // Get prompt from local cache
    const db = await import('@/lib/db');
    const prompts = db.getCachedPrompts();
    const prompt = prompts.find(p => p.id === promptId);

    if (!prompt) {
      return { success: false, message: `Prompt with ID ${promptId} not found in local database` };
    }

    // Publish to Hub
    const result = await hubClient.publishPrompt({
      name: prompt.name,
      content: prompt.content,
      description: prompt.description || '',
      publisher: publisher,
      tags: prompt.tags || '',
    });

    if (result) {
      return {
        success: true,
        message: `Prompt "${prompt.name}" published successfully`,
        id: result.id,
      };
    } else {
      return { success: false, message: 'Failed to publish prompt to Hub' };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to publish prompt',
    };
  }
}

/**
 * POST /api/resources/publish
 * Publish a local resource to Hub
 *
 * For skill/template:
 *   Body: { type: 'skill' | 'template', filePath: string, publisher: string }
 *
 * For prompt:
 *   Body: { type: 'prompt', id: number, publisher: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, filePath, id, publisher } = body;

    if (!type || !publisher) {
      return NextResponse.json(
        { error: 'Missing required fields: type and publisher' },
        { status: 400 }
      );
    }

    let result;

    switch (type) {
      case 'skill':
        if (!filePath) {
          return NextResponse.json(
            { error: 'Missing required field: filePath' },
            { status: 400 }
          );
        }
        result = await publishSkill(filePath, publisher);
        break;

      case 'template':
        if (!filePath) {
          return NextResponse.json(
            { error: 'Missing required field: filePath' },
            { status: 400 }
          );
        }
        result = await publishTemplate(filePath, publisher);
        break;

      case 'prompt':
        if (typeof id !== 'number') {
          return NextResponse.json(
            { error: 'Missing or invalid required field: id (must be a number)' },
            { status: 400 }
          );
        }
        result = await publishPromptFromDb(id, publisher);
        break;

      default:
        return NextResponse.json(
          { error: `Unknown resource type: ${type}` },
          { status: 400 }
        );
    }

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        id: result.id,
      });
    } else {
      return NextResponse.json(
        { error: result.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[resources/publish] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish resource' },
      { status: 500 }
    );
  }
}
