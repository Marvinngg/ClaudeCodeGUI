"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlusSignIcon,
  Search01Icon,
  ZapIcon,
  Loading02Icon,
  CloudUploadIcon,
} from "@hugeicons/core-free-icons";
import { SkillListItem } from "./SkillListItem";
import { SkillEditor } from "./SkillEditor";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { HubSkillList } from "./HubSkillList";
import type { SkillItem } from "./SkillListItem";

interface HubSkill {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  version: number;
}

interface SkillsManagerProps {
  workingDirectory?: string;
}

export function SkillsManager({ workingDirectory }: SkillsManagerProps) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selected, setSelected] = useState<SkillItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState("installed");

  // Hub functionality
  const [hubUrl, setHubUrl] = useState("");
  const [installedHubIds, setInstalledHubIds] = useState<Set<number>>(new Set());
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [skillToPublish, setSkillToPublish] = useState<SkillItem | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      // ✅ 传递工作目录，加载项目级 skills
      const params = new URLSearchParams();
      if (workingDirectory) {
        params.set('cwd', workingDirectory);
      }

      const res = await fetch(`/api/skills?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workingDirectory]);

  const fetchHubSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        const url = data.settings?.hub_url || "";
        setHubUrl(url);
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch installed Hub skills status
  const fetchInstalledHubSkills = useCallback(async () => {
    if (!hubUrl) return;
    try {
      const res = await fetch("/api/hub/skills/installed");
      if (res.ok) {
        const installed = await res.json();
        setInstalledHubIds(new Set(installed.map((item: any) => item.id)));
      }
    } catch {
      // ignore
    }
  }, [hubUrl]);

  useEffect(() => {
    fetchSkills();
    fetchHubSettings();
  }, [fetchSkills, fetchHubSettings]);

  useEffect(() => {
    fetchInstalledHubSkills();
  }, [fetchInstalledHubSkills]);

  const handleCreate = useCallback(
    async (name: string, scope: "global" | "project", content: string, projectPath?: string) => {
      // ✅ 新建项目 skills 时传递用户选择的项目目录
      const body: Record<string, unknown> = { name, content, scope };
      if (scope === 'project' && projectPath) {
        body.cwd = projectPath;
      }

      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create skill");
      }
      const data = await res.json();
      setSkills((prev) => [...prev, data.skill]);
      setSelected(data.skill);
    },
    []
  );

  const buildSkillUrl = useCallback((skill: SkillItem) => {
    // ✅ 从 filePath 提取真实的 skill 名称（目录名或文件名），而不是 YAML 中的 name
    // SKILL.md 格式: /path/.claude/skills/test/SKILL.md → test
    // 旧格式: /path/.claude/commands/test.md → test
    const filePath = skill.filePath;
    let realName: string;

    if (filePath.endsWith('/SKILL.md') || filePath.endsWith('\\SKILL.md')) {
      // 新格式：提取目录名
      const parts = filePath.split(/[/\\]/);
      realName = parts[parts.length - 2]; // SKILL.md 的上一级目录
    } else {
      // 旧格式：提取文件名（去掉 .md）
      const fileName = filePath.split(/[/\\]/).pop() || '';
      realName = fileName.replace(/\.md$/, '');
    }

    return `/api/skills/${encodeURIComponent(realName)}`;
  }, []);

  const handleSave = useCallback(
    async (skill: SkillItem, content: string) => {
      const res = await fetch(buildSkillUrl(skill), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save skill");
      }
      const data = await res.json();

      // ✅ 处理重命名：如果 skill name 改变了，需要删除旧的并添加新的
      const oldName = skill.name;
      const newName = data.skill.name;
      const isRenamed = oldName !== newName;

      if (isRenamed) {
        // 重命名：删除旧的，添加新的
        setSkills((prev) =>
          prev
            .filter((s) => !(s.name === oldName && s.source === skill.source))
            .concat(data.skill)
        );
      } else {
        // 正常更新
        setSkills((prev) =>
          prev.map((s) =>
            s.name === skill.name && s.source === skill.source
              ? data.skill
              : s
          )
        );
      }

      // Update selected
      setSelected(data.skill);
    },
    [buildSkillUrl]
  );

  const handleDelete = useCallback(
    async (skill: SkillItem) => {
      const res = await fetch(buildSkillUrl(skill), { method: "DELETE" });
      if (res.ok) {
        setSkills((prev) =>
          prev.filter(
            (s) => !(s.name === skill.name && s.source === skill.source)
          )
        );
        if (
          selected?.name === skill.name &&
          selected?.source === skill.source
        ) {
          setSelected(null);
        }
      }
    },
    [buildSkillUrl, selected]
  );

  const handleInstallFromHub = useCallback(
    async (hubSkill: HubSkill, scope: 'global' | 'project', projectPath?: string) => {
      try {
        // ✅ 传递 scope 和 cwd 参数（项目安装时使用用户选择的路径）
        const res = await fetch('/api/resources/install', {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "skill",
            id: hubSkill.id,
            scope,
            cwd: scope === 'project' ? (projectPath || workingDirectory) : undefined,
          })
        });
        if (res.ok) {
          // Refresh local skills list
          await fetchSkills();
          // Mark as installed
          setInstalledHubIds((prev) => new Set([...prev, hubSkill.id]));
        } else {
          const data = await res.json();
          alert(`安装失败: ${data.error || "未知错误"}`);
        }
      } catch (error) {
        alert(`安装失败: ${error instanceof Error ? error.message : "未知错误"}`);
      }
    },
    [fetchSkills, workingDirectory]
  );

  const handlePublishClick = (skill: SkillItem) => {
    setSkillToPublish(skill);
    setShowPublishDialog(true);
  };

  const handleConfirmPublish = async () => {
    if (!skillToPublish || !hubUrl) return;

    setIsPublishing(true);
    try {
      // Get settings including user_id
      const settingsRes = await fetch("/api/settings/app");
      if (!settingsRes.ok) {
        throw new Error("Failed to fetch settings");
      }

      const settingsData = await settingsRes.json();
      const userId = settingsData.settings?.hub_user_id;

      if (!userId) {
        throw new Error("User ID not configured. Please set 'User Identifier' in Settings → Hub Settings.");
      }

      // Publish to Hub with skill's existing description
      const res = await fetch("/api/hub/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: skillToPublish.name,
          content: skillToPublish.content || "",
          description: skillToPublish.description || `Skill: ${skillToPublish.name}`,
          publisher: userId,
          tags: "" // Empty tags, can be enhanced later
        }),
      });

      if (res.ok) {
        alert("发布成功！");
        setShowPublishDialog(false);
        setSkillToPublish(null);
        fetchInstalledHubSkills();
      } else {
        const err = await res.json();
        throw new Error(err.error || "Publish failed");
      }
    } catch (error) {
      alert(`发布失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  );

  const globalSkills = filtered.filter((s) => s.source === "global");
  const projectSkills = filtered.filter((s) => s.source === "project");
  const pluginSkills = filtered.filter((s) => s.source === "plugin");

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading skills...
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <TabsList>
            <TabsTrigger value="installed">已安装</TabsTrigger>
            <TabsTrigger value="market" className="gap-2">
              Organization
              <Badge variant="secondary" className="px-1 py-0 h-4 text-[10px] bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 border-0">
                Hub
              </Badge>
            </TabsTrigger>
          </TabsList>

          {activeTab === "installed" && (
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
              <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" />
              New Skill
            </Button>
          )}
        </div>

        <TabsContent value="installed" className="flex-1 min-h-0 mt-0">
          <div className="flex gap-4 h-full">
            {/* Left: skill list */}
            <div className="w-64 shrink-0 flex flex-col border border-border rounded-lg overflow-hidden h-full">
              <div className="p-2 border-b border-border shrink-0">
                <div className="relative">
                  <HugeiconsIcon icon={Search01Icon} className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search skills..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-7 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-1">
                  {projectSkills.length > 0 && (
                    <div className="mb-1">
                      <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                        Project
                      </span>
                      {projectSkills.map((skill) => (
                        <SkillListItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={
                            selected?.name === skill.name &&
                            selected?.source === skill.source
                          }
                          onSelect={() => setSelected(skill)}
                          onDelete={handleDelete}
                          onPublish={hubUrl ? () => handlePublishClick(skill) : undefined}
                        />
                      ))}
                    </div>
                  )}
                  {globalSkills.length > 0 && (
                    <div className="mb-1">
                      <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                        Global
                      </span>
                      {globalSkills.map((skill) => (
                        <SkillListItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={
                            selected?.name === skill.name &&
                            selected?.source === skill.source
                          }
                          onSelect={() => setSelected(skill)}
                          onDelete={handleDelete}
                          onPublish={hubUrl ? () => handlePublishClick(skill) : undefined}
                        />
                      ))}
                    </div>
                  )}
                  {pluginSkills.length > 0 && (
                    <div className="mb-1">
                      <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                        Plugins
                      </span>
                      {pluginSkills.map((skill) => (
                        <SkillListItem
                          key={skill.filePath || `${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={
                            selected?.name === skill.name &&
                            selected?.source === skill.source
                          }
                          onSelect={() => setSelected(skill)}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}

                  {filtered.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                      <HugeiconsIcon icon={ZapIcon} className="h-8 w-8 opacity-40" />
                      <p className="text-xs">
                        {search ? "No skills match your search" : "No skills yet"}
                      </p>
                      {!search && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setShowCreate(true)}
                          className="gap-1"
                        >
                          <HugeiconsIcon icon={PlusSignIcon} className="h-3 w-3" />
                          Create one
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: editor */}
            <div className="flex-1 min-w-0 border border-border rounded-lg overflow-hidden h-full">
              {selected ? (
                <SkillEditor
                  key={`${selected.source}:${selected.name}`}
                  skill={selected}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  onPublish={hubUrl ? () => handlePublishClick(selected) : undefined}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                  <HugeiconsIcon icon={ZapIcon} className="h-12 w-12 opacity-30" />
                  <div className="text-center">
                    <p className="text-sm font-medium">No skill selected</p>
                    <p className="text-xs">
                      Select a skill from the list or create a new one
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreate(true)}
                    className="gap-1"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" />
                    New Skill
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="market" className="flex-1 min-h-0 mt-0">
          <div className="h-full">
            <HubSkillList
              hubUrl={hubUrl}
              onInstall={handleInstallFromHub}
              installedSkillNames={new Set(skills.map(s => s.name))}
              workingDirectory={workingDirectory}
            />
          </div>
        </TabsContent>
      </Tabs>

      <CreateSkillDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={handleCreate}
        currentWorkingDirectory={workingDirectory}
      />

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布到 Hub</DialogTitle>
            <DialogDescription>
              确认将此 Skill 分享给团队成员
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-md bg-muted/30 p-3 space-y-2">
              <div>
                <Label className="text-xs text-muted-foreground">名称</Label>
                <p className="text-sm font-medium">{skillToPublish?.name}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">描述</Label>
                <p className="text-sm">{skillToPublish?.description || "无描述"}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              此 Skill 将发布到组织 Hub，所有团队成员都可以安装使用。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublishDialog(false)}>取消</Button>
            <Button onClick={handleConfirmPublish} disabled={isPublishing} className="gap-1.5">
              {isPublishing ? (
                <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
              ) : (
                <HugeiconsIcon icon={CloudUploadIcon} className="h-4 w-4" />
              )}
              {isPublishing ? '发布中...' : '确认发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
