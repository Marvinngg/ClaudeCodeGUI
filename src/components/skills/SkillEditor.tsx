"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FloppyDiskIcon,
  Delete02Icon,
  EyeIcon,
  Edit02Icon,
  GlobeIcon,
  FolderOpenIcon,
  Loading02Icon,
  LayoutTwoColumnIcon,
  CloudUploadIcon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SkillItem } from "./SkillListItem";

type ViewMode = "edit" | "preview" | "split";

interface SkillEditorProps {
  skill: SkillItem;
  onSave?: (skill: SkillItem, content: string) => Promise<void>;
  onDelete?: (skill: SkillItem) => void;
  onPublish?: () => void;
  readOnly?: boolean;
  extraActions?: React.ReactNode;
}

export function SkillEditor({ skill, onSave, onDelete, onPublish, readOnly = false, extraActions }: SkillEditorProps) {
  const [content, setContent] = useState(skill.content);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = content !== skill.content;

  // Reset content when skill changes
  useEffect(() => {
    setContent(skill.content);
    setConfirmDelete(false);
    setSaved(false);
  }, [skill.name, skill.filePath, skill.content]);

  const handleSave = useCallback(async () => {
    // ✅ 提取真实的 skill 名称（从 filePath）
    const filePath = skill.filePath;
    let realSkillName: string;

    if (filePath.endsWith('/SKILL.md') || filePath.endsWith('\\SKILL.md')) {
      // 新格式：提取目录名
      const parts = filePath.split(/[/\\]/);
      realSkillName = parts[parts.length - 2];
    } else {
      // 旧格式：提取文件名（去掉 .md）
      const fileName = filePath.split(/[/\\]/).pop() || '';
      realSkillName = fileName.replace(/\.md$/, '');
    }

    // ✅ 检查 YAML 中的 name 是否和目录名/文件名一致
    const yamlMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
    if (yamlMatch && yamlMatch[1]) {
      const yamlContent = yamlMatch[1];
      const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        const yamlName = nameMatch[1].trim();
        if (yamlName !== realSkillName) {
          // ✅ 检测到重命名：提示用户确认
          const confirmed = confirm(
            `You are renaming this skill from "${realSkillName}" to "${yamlName}".\n\n` +
            `This will:\n` +
            `- Rename the skill directory/file\n` +
            `- Update the command from /${realSkillName} to /${yamlName}\n\n` +
            `Continue?`
          );

          if (!confirmed) {
            // 用户取消，不保存
            return;
          }
          // 继续保存，后端会自动处理重命名
        }
      }

      // ✅ 验证：检查是否有 prompt 内容（YAML 后面不能只有空白）
      const afterYaml = content.slice(yamlMatch[0].length).trim();
      if (!afterYaml) {
        const confirmed = confirm(
          "Warning: This skill has no prompt content after the YAML front matter.\n\n" +
          "Skills without prompt content will NOT be visible to the model, even though they appear in the / command list.\n\n" +
          "Do you still want to save?"
        );
        if (!confirmed) return;
      }
    }

    setSaving(true);
    try {
      await onSave?.(skill, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [skill, content, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab indentation
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newContent =
          content.substring(0, start) + "  " + content.substring(end);
        setContent(newContent);
        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          textarea.selectionStart = start + 2;
          textarea.selectionEnd = start + 2;
        });
      }
      // Ctrl/Cmd + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty) handleSave();
      }
    },
    [content, isDirty, handleSave]
  );

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete?.(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const markdownContent = (
    <div className="prose prose-sm dark:prose-invert max-w-none p-4 overflow-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold truncate">/{skill.name}</span>
          {isDirty && (
            <span
              className="h-2 w-2 rounded-full bg-orange-400 shrink-0"
              title="Unsaved changes"
            />
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0 shrink-0",
              skill.source === "global"
                ? "border-green-500/40 text-green-600 dark:text-green-400"
                : skill.source === "plugin"
                  ? "border-purple-500/40 text-purple-600 dark:text-purple-400"
                  : skill.source === "hub"
                    ? "border-cyan-500/40 text-cyan-600 dark:text-cyan-400"
                    : "border-blue-500/40 text-blue-600 dark:text-blue-400"
            )}
          >
            {skill.source === "global" ? (
              <HugeiconsIcon icon={GlobeIcon} className="h-2.5 w-2.5 mr-0.5" />
            ) : skill.source === "hub" ? (
              <HugeiconsIcon icon={CloudUploadIcon} className="h-2.5 w-2.5 mr-0.5" />
            ) : (
              <HugeiconsIcon icon={FolderOpenIcon} className="h-2.5 w-2.5 mr-0.5" />
            )}
            {skill.source}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {onPublish && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={onPublish}>
                    <HugeiconsIcon icon={CloudUploadIcon} className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Publish to Hub</TooltipContent>
              </Tooltip>
              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}

          {extraActions}

          <div className="w-px h-4 bg-border mx-1" />

          {/* View mode toggles */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "edit" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("edit")}
              >
                <HugeiconsIcon icon={Edit02Icon} className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "preview" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("preview")}
              >
                <HugeiconsIcon icon={EyeIcon} className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Preview</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "split" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setViewMode("split")}
              >
                <HugeiconsIcon icon={LayoutTwoColumnIcon} className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split</TooltipContent>
          </Tooltip>

          {(!readOnly) && (
            <>
              <div className="w-px h-4 bg-border mx-1" />

              {/* Save */}
              <Button
                size="xs"
                onClick={handleSave}
                disabled={!isDirty || saving || !onSave}
                className="gap-1"
              >
                {saving ? (
                  <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={FloppyDiskIcon} className="h-3 w-3" />
                )}
                {saving ? "Saving" : saved ? "Saved" : "Save"}
              </Button>

              {/* Delete */}
              <Button
                variant={confirmDelete ? "destructive" : "ghost"}
                size="icon-xs"
                onClick={handleDelete}
                disabled={!onDelete}
              >
                <HugeiconsIcon icon={Delete02Icon} className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewMode === "edit" && (
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => !readOnly && setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={readOnly}
            className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0 min-h-[400px]"
            placeholder="Write your skill prompt in Markdown..."
          />
        )}
        {viewMode === "preview" && (
          <div className="h-full overflow-auto">{markdownContent}</div>
        )}
        {viewMode === "split" && (
          <div className="flex h-full divide-x divide-border">
            <div className="flex-1 min-w-0">
              <Textarea
                value={content}
                onChange={(e) => !readOnly && setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                readOnly={readOnly}
                className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder="Write your skill prompt in Markdown..."
              />
            </div>
            <div className="flex-1 min-w-0 overflow-auto">
              {markdownContent}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-1.5 shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          {skill.filePath}
        </span>
      </div>
    </div>
  );
}
