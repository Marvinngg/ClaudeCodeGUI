import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

interface SkillFile {
  name: string;
  description: string;
  content: string;
  source: "global" | "project" | "plugin";
  filePath: string;
}

function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), ".claude", "commands");
}

function getProjectCommandsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), ".claude", "commands");
}

function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

/**
 * Parse YAML front matter from SKILL.md content.
 * Extracts `name` and `description` fields from the --- delimited block.
 */
function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  // Extract front matter between --- delimiters
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fmMatch) return {};

  const frontMatter = fmMatch[1];
  const lines = frontMatter.split(/\r?\n/);
  const result: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match name: value
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

    // Match description: | (multi-line YAML block scalar) — check FIRST
    if (/^description:\s*\|/.test(line)) {
      const descLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+/.test(lines[j])) {
          descLines.push(lines[j].trim());
        } else {
          break;
        }
      }
      if (descLines.length > 0) {
        result.description = descLines.filter(Boolean).join(" ");
      }
      continue;
    }

    // Match description: value (single-line)
    const descMatch = line.match(/^description:\s+(.+)/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
  }
  return result;
}

/**
 * Scan a directory for skills in SKILL.md format (new format).
 * Each skill is a subdirectory containing a SKILL.md with YAML front matter.
 * Used for ~/.claude/skills/ and .claude/skills/
 */
function scanSkillsDirectory(
  dir: string,
  source: "global" | "project"
): SkillFile[] {
  const skills: SkillFile[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, "utf-8");
      const meta = parseSkillFrontMatter(content);
      const name = meta.name || entry.name;
      const description = meta.description || `Skill: /${name}`;

      skills.push({
        name,
        description,
        content,
        source,
        filePath: skillMdPath,
      });
    }
  } catch {
    // ignore read errors
  }
  return skills;
}

/**
 * Scan a directory for commands in .md format (old format).
 * Used for ~/.claude/commands/ and .claude/commands/
 */
function scanCommandsDirectory(
  dir: string,
  source: "global" | "project",
  prefix = ""
): SkillFile[] {
  const skills: SkillFile[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories (e.g. ~/.claude/commands/review/pr.md)
        const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
        skills.push(...scanCommandsDirectory(fullPath, source, subPrefix));
        continue;
      }

      if (!entry.name.endsWith(".md")) continue;
      const baseName = entry.name.replace(/\.md$/, "");
      const name = prefix ? `${prefix}:${baseName}` : baseName;
      const filePath = fullPath;
      const content = fs.readFileSync(filePath, "utf-8");
      const firstLine = content.split("\n")[0]?.trim() || "";
      const description = firstLine.startsWith("#")
        ? firstLine.replace(/^#+\s*/, "")
        : firstLine || `Skill: /${name}`;
      skills.push({ name, description, content, source, filePath });
    }
  } catch {
    // ignore read errors
  }
  return skills;
}

export async function GET(request: NextRequest) {
  try {
    // Accept optional cwd query param for project-level skills
    const cwd = request.nextUrl.searchParams.get("cwd") || undefined;

    // ✅ 只扫描 Claude Code CLI 原生支持的目录
    // CLI 支持 4 种 skills 来源：
    // 1. ~/.claude/commands/*.md (global, 旧格式)
    // 2. ~/.claude/skills/{name}/SKILL.md (global, 新格式)
    // 3. .claude/commands/*.md (project, 旧格式)
    // 4. .claude/skills/{name}/SKILL.md (project, 新格式)

    const globalCommandsDir = getGlobalCommandsDir();    // ~/.claude/commands/
    const globalSkillsDir = getClaudeSkillsDir();        // ~/.claude/skills/
    const projectCommandsDir = getProjectCommandsDir(cwd); // .claude/commands/
    const projectSkillsDir = path.join(cwd || process.cwd(), ".claude", "skills"); // .claude/skills/

    console.log(`[skills] Scanning global commands: ${globalCommandsDir} (exists: ${fs.existsSync(globalCommandsDir)})`);
    console.log(`[skills] Scanning global skills: ${globalSkillsDir} (exists: ${fs.existsSync(globalSkillsDir)})`);
    console.log(`[skills] Scanning project commands: ${projectCommandsDir} (exists: ${fs.existsSync(projectCommandsDir)})`);
    console.log(`[skills] Scanning project skills: ${projectSkillsDir} (exists: ${fs.existsSync(projectSkillsDir)})`);

    // 扫描旧格式 commands（.md 文件）
    const globalCommands = scanCommandsDirectory(globalCommandsDir, "global");
    const projectCommands = scanCommandsDirectory(projectCommandsDir, "project");

    // 扫描新格式 skills（{name}/SKILL.md）
    const globalSkills = scanSkillsDirectory(globalSkillsDir, "global");
    const projectSkills = scanSkillsDirectory(projectSkillsDir, "project");

    const all = [
      ...globalCommands,
      ...globalSkills,
      ...projectCommands,
      ...projectSkills,
    ];

    console.log(`[skills] Found: global commands=${globalCommands.length}, global skills=${globalSkills.length}, project commands=${projectCommands.length}, project skills=${projectSkills.length}`);

    return NextResponse.json({ skills: all });
  } catch (error) {
    console.error('[skills] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load skills" },
      { status: 500 }
    );
  }
}

/**
 * Validate SKILL.md format (YAML front matter + content)
 */
function validateSkillFormat(content: string): { valid: boolean; error?: string } {
  // Must have YAML front matter
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fmMatch) {
    return { valid: false, error: "Missing YAML front matter. Skill must start with ---\\nname: ...\\ndescription: ...\\n---" };
  }

  const meta = parseSkillFrontMatter(content);
  if (!meta.name) {
    return { valid: false, error: "Missing 'name' field in YAML front matter" };
  }
  if (!meta.description) {
    return { valid: false, error: "Missing 'description' field in YAML front matter" };
  }

  // ✅ 关键修复：必须有 prompt 内容（YAML 后面不能只有空白）
  // 提取 YAML 后面的内容
  const afterYaml = content.slice(fmMatch[0].length).trim();
  if (!afterYaml) {
    return {
      valid: false,
      error: "Skill must have prompt content after YAML front matter. Skills without prompt content will not be visible to the model."
    };
  }

  return { valid: true };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, content, scope, cwd } = body as {
      name: string;
      content: string;
      scope: "global" | "project";
      cwd?: string;
    };

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Skill name is required" },
        { status: 400 }
      );
    }

    // Sanitize name: only allow alphanumeric, hyphens, underscores
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!safeName) {
      return NextResponse.json(
        { error: "Invalid skill name" },
        { status: 400 }
      );
    }

    // ✅ 创建新格式 skills：{name}/SKILL.md（而不是旧格式的 {name}.md）
    const baseDir = scope === "project"
      ? path.join(cwd || process.cwd(), ".claude", "skills")
      : path.join(os.homedir(), ".claude", "skills");

    const skillDir = path.join(baseDir, safeName);
    const skillFilePath = path.join(skillDir, "SKILL.md");

    if (fs.existsSync(skillFilePath)) {
      return NextResponse.json(
        { error: "A skill with this name already exists" },
        { status: 409 }
      );
    }

    // 创建 skill 目录
    fs.mkdirSync(skillDir, { recursive: true });

    // 生成带 YAML Front Matter 的内容
    const firstLine = (content || "").split("\n")[0]?.trim() || "";
    const description = firstLine.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "")
      : firstLine || `Skill: /${safeName}`;

    const skillContent = `---
name: ${safeName}
description: ${description}
---

${content || ""}`;

    // ✅ 验证生成的内容格式
    const validation = validateSkillFormat(skillContent);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    fs.writeFileSync(skillFilePath, skillContent, "utf-8");

    return NextResponse.json(
      {
        skill: {
          name: safeName,
          description,
          content: skillContent,
          source: scope || "global",
          filePath: skillFilePath,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create skill" },
      { status: 500 }
    );
  }
}
