import { NextResponse } from 'next/server';
import { hubClient } from '@/lib/hub-client';
import { getSetting } from '@/lib/db';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Validate skill content from Hub (YAML front matter format)
 */
function validateHubSkillContent(name: string, description: string, content: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Skill name is required' };
  }
  if (!description || typeof description !== 'string') {
    return { valid: false, error: 'Skill description is required' };
  }
  // Content can be empty, but should be a string
  if (typeof content !== 'string') {
    return { valid: false, error: 'Skill content must be a string' };
  }
  return { valid: true };
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
 * Ensure directory exists, create if not
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Install a skill to ~/.claude/skills/{skill-name}/SKILL.md (global)
 * or .claude/skills/{skill-name}/SKILL.md (project)
 * Format: YAML Front Matter (compatible with Claude Code CLI)
 */
async function installSkill(id: number, scope: 'global' | 'project', cwd?: string): Promise<{ success: boolean; message: string; path?: string }> {
  try {
    ensureHubConfigured();

    // Fetch skill from Hub
    const skills = await hubClient.fetchSkills();
    const skill = skills.find(s => s.id === id);

    if (!skill) {
      return { success: false, message: `Skill with ID ${id} not found` };
    }

    // ✅ 验证 Hub skill 内容格式
    const validation = validateHubSkillContent(skill.name, skill.description, skill.content);
    if (!validation.valid) {
      return { success: false, message: `Invalid skill format: ${validation.error}` };
    }

    // ✅ 根据 scope 决定安装目录
    const skillsBaseDir = scope === 'project'
      ? path.join(cwd || process.cwd(), '.claude', 'skills')
      : path.join(os.homedir(), '.claude', 'skills');

    ensureDirectoryExists(skillsBaseDir);

    // Normalize skill name for directory (remove special characters)
    const skillDirName = skill.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const skillDir = path.join(skillsBaseDir, skillDirName);

    // Check for existing skill
    if (fs.existsSync(skillDir)) {
      // ✅ 检查是否真的安装了 (SKILL.md 存在)
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        return {
          success: false,
          message: `Skill "${skill.name}" is already installed at ${skillDir}`
        };
      }
      // 如果目录存在但没有 SKILL.md，视为残留空目录，允许覆盖安装
    }

    // Create skill directory
    ensureDirectoryExists(skillDir);

    // Write SKILL.md
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillMdPath, skill.content, 'utf-8');

    const scopeLabel = scope === 'project' ? '当前项目' : '全局';
    return {
      success: true,
      message: `Skill "${skill.name}" 已安装到${scopeLabel}。使用 /${skill.name} 调用。`,
      path: skillMdPath,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to install skill',
    };
  }
}

/**
 * Install a template to ~/.claude/templates/
 */
async function installTemplate(id: number): Promise<{ success: boolean; message: string; path?: string }> {
  try {
    ensureHubConfigured();

    // Fetch template from Hub
    const templates = await hubClient.fetchTemplates();
    const template = templates.find(t => t.id === id);

    if (!template) {
      return { success: false, message: `Template with ID ${id} not found` };
    }

    // Prepare installation path
    const templatesDir = path.join(os.homedir(), '.claude', 'templates');
    ensureDirectoryExists(templatesDir);

    // Determine file extension based on template type
    const ext = template.template_type === 'claude_md' ? '.md' : '.txt';
    const fileName = `${template.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}${ext}`;
    const filePath = path.join(templatesDir, fileName);

    // Write template content with metadata as front matter
    const contentWithMetadata = `---
name: ${template.name}
description: ${template.description}
publisher: ${template.publisher}
template_type: ${template.template_type}
installed_at: ${new Date().toISOString()}
---

${template.content}
`;

    fs.writeFileSync(filePath, contentWithMetadata, 'utf-8');

    return {
      success: true,
      message: `Template "${template.name}" installed successfully`,
      path: filePath,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to install template',
    };
  }
}

/**
 * Install a prompt to local database
 */
async function installPrompt(id: number): Promise<{ success: boolean; message: string }> {
  try {
    ensureHubConfigured();

    // Fetch prompt from Hub
    const prompts = await hubClient.fetchPrompts();
    const prompt = prompts.find(p => p.id === id);

    if (!prompt) {
      return { success: false, message: `Prompt with ID ${id} not found` };
    }

    // Import db module to save prompt
    const db = await import('@/lib/db');

    // Cache prompt to local database
    db.upsertPromptCache({
      id: prompt.id,
      name: prompt.name,
      content: prompt.content,
      description: prompt.description || '',
      publisher: prompt.publisher || '',
      tags: prompt.tags || '',
    });

    return {
      success: true,
      message: `Prompt "${prompt.name}" installed successfully`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to install prompt',
    };
  }
}

/**
 * POST /api/resources/install
 * Install a resource from Hub to local system
 *
 * Body: {
 *   type: 'skill' | 'template' | 'prompt',
 *   id: number,
 *   scope?: 'global' | 'project',  // for skills
 *   cwd?: string  // working directory for project scope
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, id, scope = 'global', cwd } = body;

    if (!type || !id) {
      return NextResponse.json(
        { error: 'Missing required fields: type and id' },
        { status: 400 }
      );
    }

    if (typeof id !== 'number') {
      return NextResponse.json(
        { error: 'ID must be a number' },
        { status: 400 }
      );
    }

    let result;

    switch (type) {
      case 'skill':
        // ✅ 传递 scope 和 cwd 参数
        result = await installSkill(id, scope, cwd);
        break;
      case 'template':
        result = await installTemplate(id);
        break;
      case 'prompt':
        result = await installPrompt(id);
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
        ...(('path' in result) && { path: result.path }),
      });
    } else {
      return NextResponse.json(
        { error: result.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[resources/install] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to install resource' },
      { status: 500 }
    );
  }
}
