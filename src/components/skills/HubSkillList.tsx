"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import {
    Search01Icon,
    ZapIcon,
    Loading02Icon,
    Download01Icon,
    CheckmarkCircle02Icon,
    WifiDisconnected01Icon,
    RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SkillListItem, type SkillItem } from "./SkillListItem";
import { SkillEditor } from "./SkillEditor";

interface HubSkill {
    id: number;
    name: string;
    content: string;
    description: string;
    publisher: string;
    version: number;
}

interface HubSkillListProps {
    hubUrl: string;
    onInstall: (skill: HubSkill, scope: 'global' | 'project', projectPath?: string) => Promise<void>;
    installedSkillNames: Set<string>;
    workingDirectory?: string;
}

export function HubSkillList({ hubUrl, onInstall, installedSkillNames, workingDirectory }: HubSkillListProps) {
    const [skills, setSkills] = useState<HubSkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedSkill, setSelectedSkill] = useState<HubSkill | null>(null);
    const [installingId, setInstallingId] = useState<number | null>(null);

    // ✅ 新增：安装位置选择对话框
    const [showInstallDialog, setShowInstallDialog] = useState(false);
    const [skillToInstall, setSkillToInstall] = useState<HubSkill | null>(null);
    const [installScope, setInstallScope] = useState<'global' | 'project'>('global');
    const [selectedProjectPath, setSelectedProjectPath] = useState<string>('');

    const fetchHubSkills = useCallback(async () => {
        if (!hubUrl) return;
        setLoading(true);
        try {
            const res = await fetch("/api/hub/skills");
            if (res.ok) {
                const data = await res.json();
                setSkills(data || []);
            }
        } catch (error) {
            console.error("Failed to fetch hub skills:", error);
        } finally {
            setLoading(false);
        }
    }, [hubUrl]);

    useEffect(() => {
        fetchHubSkills();
    }, [fetchHubSkills]);

    // ✅ 打开安装对话框
    const handleInstallClick = (skill: HubSkill) => {
        setSkillToInstall(skill);
        setInstallScope('global');
        setSelectedProjectPath(workingDirectory || '');
        setShowInstallDialog(true);
    };

    // ✅ 选择项目文件夹
    const handleSelectProjectFolder = async () => {
        if (typeof window !== 'undefined' && (window as any).electron) {
            try {
                const result = await (window as any).electron.selectDirectory();
                if (result && !result.canceled && result.filePaths.length > 0) {
                    setSelectedProjectPath(result.filePaths[0]);
                }
            } catch (error) {
                console.error('Failed to select directory:', error);
            }
        }
    };

    // ✅ 确认安装
    const handleConfirmInstall = async () => {
        if (!skillToInstall) return;

        // 如果是项目安装，必须选择文件夹
        if (installScope === 'project' && !selectedProjectPath) {
            alert('请选择项目文件夹');
            return;
        }

        setInstallingId(skillToInstall.id);
        setShowInstallDialog(false);

        try {
            await onInstall(skillToInstall, installScope, installScope === 'project' ? selectedProjectPath : undefined);
        } finally {
            setInstallingId(null);
            setSkillToInstall(null);
            setSelectedProjectPath('');
        }
    };

    const filtered = skills.filter(
        (s) =>
            s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.description.toLowerCase().includes(search.toLowerCase())
    );

    const mapHubSkillToItem = (hubSkill: HubSkill): SkillItem => ({
        name: hubSkill.name,
        description: hubSkill.description,
        content: hubSkill.content,
        source: "hub",
        publisher: hubSkill.publisher, // ✅ Pass publisher to allow displaying ID instead of "hub"
        filePath: `v${hubSkill.version || "1.0"} • by ${hubSkill.publisher || "Unknown"}`,
    });

    if (!hubUrl) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4 p-8">
                <HugeiconsIcon icon={WifiDisconnected01Icon} className="h-12 w-12 opacity-30" />
                <div className="text-center">
                    <h3 className="text-lg font-medium mb-1">Hub Not Configured</h3>
                    <p className="text-sm">Please configure the Hub URL in Settings to access the Skill Market.</p>
                </div>
                <Button variant="outline" onClick={() => window.location.href = '/settings'}>
                    Go to Settings
                </Button>
            </div>
        );
    }

    const selectedItem = selectedSkill ? mapHubSkillToItem(selectedSkill) : null;
    const isSelectedInstalled = selectedSkill ? installedSkillNames.has(selectedSkill.name) : false;

    return (
        <>
            <div className="flex gap-4 h-full">
                {/* Left Column: Skill List */}
                <div className="w-64 shrink-0 flex flex-col border border-border rounded-lg overflow-hidden h-full">
                    {/* Search Header */}
                    <div className="p-2 border-b border-border bg-card shrink-0">
                        <div className="flex items-center justify-between mb-2 px-1">
                            <span className="text-sm font-medium">Hub Skills</span>
                            <Button variant="ghost" size="icon-xs" onClick={fetchHubSkills} disabled={loading} title="Refresh">
                                <HugeiconsIcon icon={RefreshIcon} className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                            </Button>
                        </div>
                        <div className="relative">
                            <HugeiconsIcon icon={Search01Icon} className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-7 h-8 text-sm"
                            />
                        </div>
                    </div>

                    {/* List Content */}
                    <div className="flex-1 overflow-y-auto min-h-0">
                        <div className="p-1">
                            {loading && skills.length === 0 ? (
                                <div className="flex items-center justify-center py-8">
                                    <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                                    <HugeiconsIcon icon={ZapIcon} className="h-8 w-8 opacity-40" />
                                    <p className="text-xs">No skills found</p>
                                </div>
                            ) : (
                                <div>
                                    <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                                        Organization
                                    </span>
                                    {filtered.map((skill) => {
                                        const isInstalled = installedSkillNames.has(skill.name);
                                        const isSelected = selectedSkill?.id === skill.id;
                                        const listItem = mapHubSkillToItem(skill);

                                        return (
                                            <div key={skill.id} className="relative">
                                                <SkillListItem
                                                    skill={listItem}
                                                    selected={isSelected}
                                                    onSelect={() => setSelectedSkill(skill)}
                                                    onDelete={undefined} // ✅ Explicitly undefined to hide delete button
                                                />
                                                {isInstalled && (
                                                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                                        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4 text-green-500" />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Skill Editor */}
                <div className="flex-1 min-w-0 border border-border rounded-lg overflow-hidden h-full">
                    {selectedItem ? (
                        <SkillEditor
                            skill={selectedItem}
                            readOnly={true}
                            extraActions={
                                !isSelectedInstalled && selectedSkill && (
                                    <Button
                                        size="xs"
                                        onClick={() => handleInstallClick(selectedSkill)}
                                        disabled={installingId === selectedSkill.id}
                                        className="gap-1"
                                    >
                                        {installingId === selectedSkill.id ? (
                                            <HugeiconsIcon icon={Loading02Icon} className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <HugeiconsIcon icon={Download01Icon} className="h-3 w-3" />
                                        )}
                                        {installingId === selectedSkill.id ? "Installing..." : "Install"}
                                    </Button>
                                )
                            }
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                            <div className="h-12 w-12 rounded-lg bg-muted/20 flex items-center justify-center">
                                <HugeiconsIcon icon={ZapIcon} className="h-6 w-6 opacity-30" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium">No skill selected</p>
                                <p className="text-xs max-w-xs mx-auto mt-1">
                                    Select a skill from the list to view its details and source code
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ✅ 安装位置选择对话框 */}
            <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>安装 Skill 到哪里？</DialogTitle>
                        <DialogDescription>
                            选择将 <span className="font-mono font-semibold">/{skillToInstall?.name}</span> 安装到全局还是当前项目
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <RadioGroup value={installScope} onValueChange={(v) => setInstallScope(v as 'global' | 'project')}>
                            <div className="flex items-start space-x-3 space-y-0 rounded-md border p-4 hover:bg-accent/50 transition-colors">
                                <RadioGroupItem value="global" id="global" />
                                <div className="flex-1">
                                    <Label htmlFor="global" className="text-sm font-medium cursor-pointer">
                                        全局 (~/.claude/skills/)
                                    </Label>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        所有项目都可以使用此 Skill
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start space-x-3 space-y-0 rounded-md border p-4 hover:bg-accent/50 transition-colors">
                                <RadioGroupItem value="project" id="project" />
                                <div className="flex-1">
                                    <Label htmlFor="project" className="text-sm font-medium cursor-pointer">
                                        项目 (.claude/skills/)
                                    </Label>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        仅在指定项目中可用
                                    </p>
                                </div>
                            </div>
                        </RadioGroup>

                        {/* ✅ 项目文件夹选择器 */}
                        {installScope === 'project' && (
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">项目文件夹</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={selectedProjectPath}
                                        readOnly
                                        placeholder="点击选择项目文件夹..."
                                        className="flex-1 text-sm"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleSelectProjectFolder}
                                    >
                                        选择文件夹
                                    </Button>
                                </div>
                                {selectedProjectPath && (
                                    <p className="text-xs text-muted-foreground">
                                        将安装到: {selectedProjectPath}/.claude/skills/
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowInstallDialog(false)}>
                            取消
                        </Button>
                        <Button onClick={handleConfirmInstall}>
                            安装
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
