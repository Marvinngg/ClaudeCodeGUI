import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Find skill file in Claude Code native directories.
 * Priority: project commands > global commands > project skills > global skills
 */
function findSkillFile(
  name: string,
  cwd?: string
): { filePath: string; source: "global" | "project"; isSkillFormat: boolean } | null {
  const projectCommandsDir = path.join(cwd || process.cwd(), ".claude", "commands");
  const globalCommandsDir = path.join(os.homedir(), ".claude", "commands");
  const projectSkillsDir = path.join(cwd || process.cwd(), ".claude", "skills");
  const globalSkillsDir = path.join(os.homedir(), ".claude", "skills");

  // 1. Check project commands (.md format)
  const projectCommandPath = path.join(projectCommandsDir, `${name}.md`);
  if (fs.existsSync(projectCommandPath)) {
    return { filePath: projectCommandPath, source: "project", isSkillFormat: false };
  }

  // 2. Check global commands (.md format)
  const globalCommandPath = path.join(globalCommandsDir, `${name}.md`);
  if (fs.existsSync(globalCommandPath)) {
    return { filePath: globalCommandPath, source: "global", isSkillFormat: false };
  }

  // 3. Check project skills (SKILL.md format)
  const projectSkillPath = path.join(projectSkillsDir, name, "SKILL.md");
  if (fs.existsSync(projectSkillPath)) {
    return { filePath: projectSkillPath, source: "project", isSkillFormat: true };
  }

  // 4. Check global skills (SKILL.md format)
  const globalSkillPath = path.join(globalSkillsDir, name, "SKILL.md");
  if (fs.existsSync(globalSkillPath)) {
    return { filePath: globalSkillPath, source: "global", isSkillFormat: true };
  }

  return null;
}

/**
 * Parse YAML front matter
 */
function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fmMatch) return {};

  const frontMatter = fmMatch[1];
  const lines = frontMatter.split(/\r?\n/);
  const result: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

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

    const descMatch = line.match(/^description:\s+(.+)/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
  }
  return result;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const url = new URL(request.url);
    const cwd = url.searchParams.get("cwd") || undefined;

    const found = findSkillFile(name, cwd);
    if (!found) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const content = fs.readFileSync(found.filePath, "utf-8");
    let description = "";

    if (found.isSkillFormat) {
      const meta = parseSkillFrontMatter(content);
      description = meta.description || `Skill: /${name}`;
    } else {
      const firstLine = content.split("\n")[0]?.trim() || "";
      description = firstLine.startsWith("#")
        ? firstLine.replace(/^#+\s*/, "")
        : firstLine || `Skill: /${name}`;
    }

    return NextResponse.json({
      skill: {
        name,
        description,
        content,
        source: found.source,
        filePath: found.filePath,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read skill" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const { content } = body as { content: string };
    const url = new URL(request.url);
    const cwd = url.searchParams.get("cwd") || undefined;

    const found = findSkillFile(name, cwd);
    if (!found) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    // ✅ 检测是否需要重命名（YAML name 和目录名不一致）
    let finalFilePath = found.filePath;
    let finalName = name;

    if (found.isSkillFormat) {
      const meta = parseSkillFrontMatter(content);
      const yamlName = meta.name;

      if (yamlName && yamlName !== name) {
        // ✅ 需要重命名 skill 目录
        const skillDir = path.dirname(found.filePath);
        const parentDir = path.dirname(skillDir);
        const newSkillDir = path.join(parentDir, yamlName);
        const newFilePath = path.join(newSkillDir, "SKILL.md");

        // 检查新名称是否已存在
        if (fs.existsSync(newSkillDir)) {
          return NextResponse.json(
            { error: `A skill named "${yamlName}" already exists` },
            { status: 409 }
          );
        }

        // 验证新名称格式
        if (!/^[a-zA-Z0-9_-]+$/.test(yamlName)) {
          return NextResponse.json(
            { error: "Skill name can only contain letters, numbers, hyphens, and underscores" },
            { status: 400 }
          );
        }

        // 重命名目录
        fs.renameSync(skillDir, newSkillDir);
        finalFilePath = newFilePath;
        finalName = yamlName;
      }
    }

    // 保存内容
    fs.writeFileSync(finalFilePath, content ?? "", "utf-8");

    let description = "";
    if (found.isSkillFormat) {
      const meta = parseSkillFrontMatter(content);
      description = meta.description || `Skill: /${finalName}`;
    } else {
      const firstLine = (content ?? "").split("\n")[0]?.trim() || "";
      description = firstLine.startsWith("#")
        ? firstLine.replace(/^#+\s*/, "")
        : firstLine || `Skill: /${finalName}`;
    }

    return NextResponse.json({
      skill: {
        name: finalName,
        description,
        content: content ?? "",
        source: found.source,
        filePath: finalFilePath,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update skill" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const url = new URL(request.url);
    const cwd = url.searchParams.get("cwd") || undefined;

    const found = findSkillFile(name, cwd);
    if (!found) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    // ✅ 删除逻辑：
    // - 对于旧格式 (.md 文件)：直接删除文件
    // - 对于新格式 (SKILL.md)：删除整个目录
    if (found.isSkillFormat) {
      // 删除整个 skill 目录 (例如 ~/.claude/skills/my-skill/)
      const skillDir = path.dirname(found.filePath);
      fs.rmSync(skillDir, { recursive: true, force: true });
    } else {
      // 删除单个 .md 文件
      fs.unlinkSync(found.filePath);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete skill" },
      { status: 500 }
    );
  }
}
