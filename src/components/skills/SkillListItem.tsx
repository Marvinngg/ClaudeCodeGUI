"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ZapIcon, Delete02Icon, GlobeIcon, FolderOpenIcon, Plug01Icon, Download04Icon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";

export interface SkillItem {
  name: string;
  description: string;
  content: string;
  source: "global" | "project" | "plugin" | "hub";
  filePath: string;
  publisher?: string; // For hub skills
}

interface SkillListItemProps {
  skill: SkillItem;
  selected: boolean;
  onSelect: () => void;
  onDelete?: (skill: SkillItem) => void; // Optional - hub skills should not have delete
  onPublish?: (skill: SkillItem) => void;
}

export function SkillListItem({
  skill,
  selected,
  onSelect,
  onDelete,
  onPublish,
}: SkillListItemProps) {
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return; // No delete handler provided
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const handlePublish = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPublish) {
      onPublish(skill);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
    >
      <HugeiconsIcon icon={ZapIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">/{skill.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
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
            ) : skill.source === "plugin" ? (
              <HugeiconsIcon icon={Plug01Icon} className="h-2.5 w-2.5 mr-0.5" />
            ) : skill.source === "hub" ? (
              <HugeiconsIcon icon={CloudUploadIcon} className="h-2.5 w-2.5 mr-0.5" />
            ) : (
              <HugeiconsIcon icon={FolderOpenIcon} className="h-2.5 w-2.5 mr-0.5" />
            )}
            {/* ✅ Hub skills 显示 publisher，其他显示 source */}
            {skill.source === "hub" && skill.publisher ? skill.publisher : skill.source}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {skill.description}
        </p>
      </div>
      {(hovered || confirmDelete) && (
        <div className="flex items-center gap-1">
          {onPublish && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={handlePublish}
                >
                  <HugeiconsIcon icon={CloudUploadIcon} className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Publish to Hub</TooltipContent>
            </Tooltip>
          )}
          {/* ✅ 只有提供了 onDelete 才显示删除按钮 (hub skills 不提供) */}
          {onDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={confirmDelete ? "destructive" : "ghost"}
                  size="icon-xs"
                  className="shrink-0"
                  onClick={handleDelete}
                >
                  <HugeiconsIcon icon={Delete02Icon} className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {confirmDelete ? "Click again to confirm" : "Delete"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
