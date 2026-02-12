"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  Add01Icon,
  Delete02Icon,
  CloudUploadIcon,
  RefreshIcon,
  Download01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HubConversations } from "./HubConversations";

interface HubSkill {
  id: number;
  name: string;
  content: string;
  description: string;
  publisher: string;
  version: number;
}

type ResourceType = "skills" | "conversations";

interface HubResourcesManagerProps {
  hubUrl?: string;
  userId?: string;
}

export function HubResourcesManager({ hubUrl, userId }: HubResourcesManagerProps) {
  const [activeTab, setActiveTab] = useState<ResourceType>("skills");
  const [skills, setSkills] = useState<HubSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<number>>(new Set());
  const [installingId, setInstallingId] = useState<number | null>(null);

  // New resource form (only for skills)
  const [newResource, setNewResource] = useState({
    name: "",
    content: "",
    description: "",
  });

  const isHubConfigured = !!hubUrl;

  const fetchResources = async (type: ResourceType) => {
    if (!isHubConfigured || type === "conversations") return;

    setLoading(true);
    try {
      const res = await fetch("/api/hub/skills");
      if (res.ok) {
        const data = await res.json();
        setSkills(data);
      }

      // Fetch installed status
      const statusRes = await fetch("/api/hub/skills/installed");
      if (statusRes.ok) {
        const installed = await statusRes.json();
        setInstalledIds(new Set(installed.map((item: any) => item.id)));
      }
    } catch (error) {
      console.error(`Failed to fetch skills:`, error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources(activeTab);
  }, [activeTab, hubUrl]);

  const handlePublish = async () => {
    if (!isHubConfigured || !userId) return;

    try {
      const res = await fetch("/api/hub/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newResource,
          publisher: userId,
        }),
      });

      if (res.ok) {
        setShowPublishDialog(false);
        setNewResource({ name: "", content: "", description: "" });
        fetchResources(activeTab);
      }
    } catch (error) {
      console.error("Failed to publish skill:", error);
    }
  };

  const handleInstall = async (id: number) => {
    setInstallingId(id);
    try {
      const res = await fetch(`/api/hub/skills/${id}/install`, { method: "POST" });

      if (res.ok) {
        setInstalledIds((prev) => new Set([...prev, id]));
      }
    } catch (error) {
      console.error("Failed to install skill:", error);
    } finally {
      setInstallingId(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem) return;

    try {
      const res = await fetch(`/api/hub/skills/${selectedItem}`, { method: "DELETE" });

      if (res.ok) {
        setShowDeleteDialog(false);
        setSelectedItem(null);
        fetchResources(activeTab);
      }
    } catch (error) {
      console.error("Failed to delete skill:", error);
    }
  };

  if (!isHubConfigured) {
    return (
      <div className="rounded-lg border border-border/50 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Hub 未配置。请先在上方配置 Hub URL 和 User ID。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Hub 资源管理</h3>
        <div className="flex gap-2">
          {activeTab === "skills" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchResources(activeTab)}
              disabled={loading}
              className="gap-1.5"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              刷新
            </Button>
          )}
          {activeTab === "skills" && (
            <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <HugeiconsIcon icon={Add01Icon} className="h-3.5 w-3.5" />
                  发布新 Skill
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>发布新 Skill</DialogTitle>
                <DialogDescription>
                  发布到团队 Hub，所有成员都可以同步使用
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">名称</Label>
                  <Input
                    id="name"
                    value={newResource.name}
                    onChange={(e) =>
                      setNewResource({ ...newResource, name: e.target.value })
                    }
                    placeholder="Skill 名称"
                  />
                </div>
                <div>
                  <Label htmlFor="description">描述</Label>
                  <Input
                    id="description"
                    value={newResource.description}
                    onChange={(e) =>
                      setNewResource({ ...newResource, description: e.target.value })
                    }
                    placeholder="简短描述"
                  />
                </div>
                <div>
                  <Label htmlFor="content">内容</Label>
                  <Textarea
                    id="content"
                    value={newResource.content}
                    onChange={(e) =>
                      setNewResource({ ...newResource, content: e.target.value })
                    }
                    placeholder="Skill 内容（YAML front matter + prompt）"
                    rows={10}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowPublishDialog(false)}
                >
                  取消
                </Button>
                <Button onClick={handlePublish} className="gap-1.5">
                  <HugeiconsIcon icon={CloudUploadIcon} className="h-4 w-4" />
                  发布
                </Button>
              </DialogFooter>
            </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border/50">
        {(["skills", "conversations"] as ResourceType[]).map((type) => (
          <button
            key={type}
            onClick={() => setActiveTab(type)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${activeTab === type
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            {type === "skills" ? "Skills" : "Conversations"}
            {type === "skills" && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {skills.length}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {activeTab === "conversations" ? (
        <HubConversations />
      ) : (
        /* Skills Content */
        <>
          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <HugeiconsIcon
                icon={Loading02Icon}
                className="h-5 w-5 animate-spin text-muted-foreground"
              />
              <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
            </div>
          ) : skills.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                暂无 Skills
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                点击"发布新资源"来添加第一个
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {skills.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border/50 p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium truncate">{item.name}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">
                          by {item.publisher}
                        </span>
                        {item.version && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">
                            v{item.version}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {installedIds.has(item.id) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          className="gap-1.5"
                        >
                          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5 text-green-600" />
                          已安装
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleInstall(item.id)}
                          disabled={installingId === item.id}
                          className="gap-1.5"
                        >
                          {installingId === item.id ? (
                            <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <HugeiconsIcon icon={Download01Icon} className="h-3.5 w-3.5" />
                          )}
                          {installingId === item.id ? "安装中..." : "安装"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedItem(item.id);
                          setShowDeleteDialog(true);
                        }}
                      >
                        <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这个资源吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedItem(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
