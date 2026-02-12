"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, GlobeIcon, FolderOpenIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, scope: "global" | "project", content: string, projectPath?: string) => Promise<void>;
  currentWorkingDirectory?: string;
}

const TEMPLATES: { label: string; content: string }[] = [
  {
    label: "Simple Skill",
    content: `This is a simple skill template. Replace this text with instructions for Claude on how to handle this command.

For example:
- What should Claude do when this command is called?
- What format should the output be in?
- Any specific rules or constraints to follow?
`,
  },
  {
    label: "Commit Helper",
    content: `# Commit Helper

Review the staged changes and generate a concise, descriptive commit message following conventional commit format.

Rules:
- Use conventional commit prefixes: feat, fix, refactor, docs, test, chore
- Keep the first line under 72 characters
- Add a blank line and detailed description if needed
- Reference relevant issue numbers if applicable
`,
  },
  {
    label: "Code Reviewer",
    content: `# Code Reviewer

Review the provided code and give feedback on:

1. **Correctness** - Logic errors, edge cases, potential bugs
2. **Performance** - Inefficiencies, unnecessary allocations
3. **Readability** - Naming, structure, comments where needed
4. **Security** - Input validation, injection risks, data exposure

Be specific with line references. Suggest concrete improvements, not just problems.
`,
  },
];

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreate,
  currentWorkingDirectory,
}: CreateSkillDialogProps) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"global" | "project">("project");
  const [templateIdx, setTemplateIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [projectPath, setProjectPath] = useState(currentWorkingDirectory || "");

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError("Name can only contain letters, numbers, hyphens, and underscores");
      return;
    }

    // ✅ 验证：Skill 必须有 prompt 内容（不能是空白模板）
    const templateContent = TEMPLATES[templateIdx].content.trim();
    if (!templateContent) {
      setError("Please select a template or add prompt content. Skills without prompt content will not be visible to the model.");
      return;
    }

    // ✅ 项目级 skills 必须选择项目目录
    if (scope === 'project' && !projectPath.trim()) {
      setError("Please select a project directory");
      return;
    }

    setCreating(true);
    setError("");
    try {
      await onCreate(trimmed, scope, TEMPLATES[templateIdx].content, scope === 'project' ? projectPath : undefined);
      // Reset on success
      setName("");
      setScope("project");
      setTemplateIdx(0);
      setProjectPath(currentWorkingDirectory || "");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Skill</DialogTitle>
          <DialogDescription>
            Create a new slash command skill. The skill name will be used as both the directory name and command name (/{name || 'skill-name'}). Skills must have prompt content to be visible to the model.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="skill-name">Name</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                id="skill-name"
                placeholder="my-skill"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
          </div>

          {/* Project directory (only for project scope) */}
          {scope === "project" && (
            <div className="space-y-2">
              <Label htmlFor="project-path">Project Directory</Label>
              <div className="flex gap-2">
                <Input
                  id="project-path"
                  placeholder="Select project directory..."
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (typeof window !== 'undefined' && (window as any).electron) {
                      try {
                        const result = await (window as any).electron.selectDirectory();
                        if (result && !result.canceled && result.filePaths.length > 0) {
                          setProjectPath(result.filePaths[0]);
                        }
                      } catch (err) {
                        console.error('Failed to select directory:', err);
                      }
                    } else {
                      alert('Directory picker is only available in Electron app');
                    }
                  }}
                >
                  Browse
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Skill will be saved in {projectPath || '(select a directory)'}/.claude/skills/
              </p>
            </div>
          )}

          {/* Scope selection */}
          <div className="space-y-2">
            <Label>Scope</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope("project")}
                className={cn(
                  "flex-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                  scope === "project"
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "border-border hover:bg-accent"
                )}
              >
                <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
                Project
              </button>
              <button
                type="button"
                onClick={() => setScope("global")}
                className={cn(
                  "flex-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                  scope === "global"
                    ? "border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400"
                    : "border-border hover:bg-accent"
                )}
              >
                <HugeiconsIcon icon={GlobeIcon} className="h-4 w-4" />
                Global
              </button>
            </div>
            {scope === "global" && (
              <p className="text-xs text-muted-foreground">
                Saved in ~/.claude/skills/ (available everywhere)
              </p>
            )}
          </div>

          {/* Template selection */}
          <div className="space-y-2">
            <Label>Template</Label>
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setTemplateIdx(i)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs transition-colors",
                    templateIdx === i
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-accent"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating} className="gap-2">
            {creating && <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />}
            Create Skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
