'use client';

import { useRef, useState, useCallback, useEffect, type KeyboardEvent, type FormEvent } from 'react';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AtIcon,
  DivideSignIcon,
  FolderOpenIcon,
  Wrench01Icon,
  ClipboardIcon,
  HelpCircleIcon,
  ArrowDown01Icon,
  CommandLineIcon,
  Attachment01Icon,
  Cancel01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { cn } from '@/lib/utils';
import { FolderPicker } from './FolderPicker';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import type { ChatStatus } from 'ai';
import type { FileAttachment } from '@/types';
import { nanoid } from 'nanoid';
import { useLanguage } from '@/contexts/LanguageContext';

// Accepted file types for upload
const ACCEPTED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/*',
  '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
].join(',');

// Max file sizes
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5MB
const MAX_DOC_SIZE = 10 * 1024 * 1024;   // 10MB
const MAX_FILE_SIZE = MAX_DOC_SIZE;       // Use larger limit; we validate per-type in conversion

interface MessageInputProps {
  onSend: (content: string, files?: FileAttachment[]) => void;
  onCommand?: (command: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  modelName?: string;
  onModelChange?: (model: string) => void;
  workingDirectory?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  mode?: string;
  onModeChange?: (mode: string) => void;
  sdkSlashCommands?: string[]; // SDK init 事件返回的命令名列表
  sdkSkills?: Array<{ name: string; description: string }>; // SDK init 事件返回的 skills 元数据
}

interface PopoverItem {
  label: string;
  value: string;
  description?: string;
  builtIn?: boolean;
  immediate?: boolean;
  installedSource?: "agents" | "claude";
}

interface CommandBadge {
  command: string;
  label: string;
  description: string;
  isSkill: boolean;
  installedSource?: "agents" | "claude";
}

type PopoverMode = 'file' | 'skill' | null;

// Frontend-only commands — handled entirely by the app, not sent to SDK
const FRONTEND_COMMANDS: PopoverItem[] = [
  { label: 'help', value: '/help', description: 'Show available commands', builtIn: true, immediate: true },
  { label: 'clear', value: '/clear', description: 'Clear conversation history', builtIn: true, immediate: true },
  { label: 'cost', value: '/cost', description: 'Show token usage statistics', builtIn: true, immediate: true },
];

interface ModeOption {
  value: string;
  label: string;
  icon: typeof Wrench01Icon;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'code', label: 'Code', icon: Wrench01Icon, description: 'Read, write files & run commands' },
  { value: 'plan', label: 'Plan', icon: ClipboardIcon, description: 'Analyze & plan without executing' },
  { value: 'ask', label: 'Ask', icon: HelpCircleIcon, description: 'Answer questions only' },
  // Teams mode: 后端代码保留，前端暂不提供入口（CLI --print 模式不适合长时间 agent 协作）
  // { value: 'teams', label: 'Teams', icon: UserGroupIcon, description: 'Multi-agent collaboration (experimental)' },
];

// Default Claude model options — labels are dynamically overridden by active provider
const DEFAULT_MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet 4.5' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// Provider-specific model label mappings (alias → display name)
const PROVIDER_MODEL_LABELS: Record<string, Record<string, string>> = {
  // GLM Coding Plan (Z.AI / 智谱)
  'https://api.z.ai/api/anthropic': {
    sonnet: 'GLM-4.7',
    opus: 'GLM-4.7',
    haiku: 'GLM-4.5-Air',
  },
  'https://open.bigmodel.cn/api/anthropic': {
    sonnet: 'GLM-4.7',
    opus: 'GLM-4.7',
    haiku: 'GLM-4.5-Air',
  },
  // Kimi Coding Plan
  'https://api.kimi.com/coding/': {
    sonnet: 'Kimi K2.5',
    opus: 'Kimi K2.5',
    haiku: 'Kimi K2.5',
  },
  // Moonshot Open Platform
  'https://api.moonshot.ai/anthropic': {
    sonnet: 'Kimi K2.5',
    opus: 'Kimi K2.5',
    haiku: 'Kimi K2.5',
  },
  'https://api.moonshot.cn/anthropic': {
    sonnet: 'Kimi K2.5',
    opus: 'Kimi K2.5',
    haiku: 'Kimi K2.5',
  },
  // MiniMax Coding Plan
  'https://api.minimaxi.com/anthropic': {
    sonnet: 'MiniMax-M2.1',
    opus: 'MiniMax-M2.1',
    haiku: 'MiniMax-M2.1',
  },
  'https://api.minimax.io/anthropic': {
    sonnet: 'MiniMax-M2.1',
    opus: 'MiniMax-M2.1',
    haiku: 'MiniMax-M2.1',
  },
  // OpenRouter — keeps Claude names, provider handles routing
  'https://openrouter.ai/api': {
    sonnet: 'Sonnet 4.5',
    opus: 'Opus 4.6',
    haiku: 'Haiku 4.5',
  },
};

/**
 * Convert a data URL to a FileAttachment object.
 */
async function dataUrlToFileAttachment(
  dataUrl: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  // data:image/png;base64,<data>  — extract the base64 part
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  // Estimate raw size from base64 length
  const size = Math.ceil((base64.length * 3) / 4);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || 'application/octet-stream',
    size,
    data: base64,
  };
}

/**
 * Submit button that's aware of file attachments. Must be rendered inside PromptInput.
 */
function FileAwareSubmitButton({
  status,
  onStop,
  disabled,
  inputValue,
  hasBadge,
}: {
  status: ChatStatus;
  onStop?: () => void;
  disabled?: boolean;
  inputValue: string;
  hasBadge: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const hasFiles = attachments.files.length > 0;
  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <PromptInputSubmit
      status={status}
      onStop={onStop}
      disabled={disabled || (!isStreaming && !inputValue.trim() && !hasBadge && !hasFiles)}
    />
  );
}

/**
 * Attachment button that opens the file dialog. Must be rendered inside PromptInput.
 */
function AttachFileButton() {
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputButton
      onClick={() => attachments.openFileDialog()}
      tooltip="Attach files"
    >
      <HugeiconsIcon icon={Attachment01Icon} className="h-3.5 w-3.5" />
    </PromptInputButton>
  );
}

/**
 * Capsule display for attached files, rendered inside PromptInput context.
 */
function FileAttachmentsCapsules() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith('image/');
        return (
          <span
            key={file.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 pl-2 pr-1 py-0.5 text-xs font-medium border border-emerald-500/20"
          >
            {isImage && file.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={file.filename || 'image'}
                className="h-5 w-5 rounded object-cover"
              />
            )}
            <span className="max-w-[120px] truncate text-[11px]">
              {file.filename || 'file'}
            </span>
            <button
              type="button"
              onClick={() => attachments.remove(file.id)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 transition-colors"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function MessageInput({
  onSend,
  onCommand,
  onStop,
  disabled,
  isStreaming,
  sessionId,
  modelName,
  onModelChange,
  workingDirectory,
  onWorkingDirectoryChange,
  mode = 'code',
  onModeChange,
  sdkSlashCommands = [],
  sdkSkills = [],
}: MessageInputProps) {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverItems, setPopoverItems] = useState<PopoverItem[]>([]);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [badge, setBadge] = useState<CommandBadge | null>(null);
  const [activeProviderBaseUrl, setActiveProviderBaseUrl] = useState<string | null>(null);
  const [activeProviderName, setActiveProviderName] = useState<string | null>(null);

  // Fetch active provider to adapt model labels
  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then((data) => {
        const active = (data.providers || []).find((p: { is_active: number }) => p.is_active === 1);
        if (active) {
          setActiveProviderBaseUrl(active.base_url || null);
          setActiveProviderName(active.name || null);
        } else {
          setActiveProviderBaseUrl(null);
          setActiveProviderName(null);
        }
      })
      .catch(() => {});
  }, []);

  // Compute model options based on active provider
  const MODEL_OPTIONS = DEFAULT_MODEL_OPTIONS.map((opt) => {
    if (activeProviderBaseUrl && PROVIDER_MODEL_LABELS[activeProviderBaseUrl]) {
      const label = PROVIDER_MODEL_LABELS[activeProviderBaseUrl][opt.value];
      if (label) return { ...opt, label };
    }
    return opt;
  });

  // Fetch files for @ mention
  const fetchFiles = useCallback(async (filter: string) => {
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set('session_id', sessionId);
      if (filter) params.set('q', filter);
      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      const tree = data.tree || [];
      const items: PopoverItem[] = [];
      function flattenTree(nodes: Array<{ name: string; path: string; type: string; children?: unknown[] }>) {
        for (const node of nodes) {
          items.push({ label: node.name, value: node.path });
          if (node.children) flattenTree(node.children as typeof nodes);
        }
      }
      flattenTree(tree);
      return items.slice(0, 20);
    } catch {
      return [];
    }
  }, [sessionId]);

  // Fetch all available / commands: frontend commands + SDK skills
  // ✅ 优先使用 SDK 返回的 skills（确保与模型看到的一致），fallback 到文件系统扫描
  const fetchCommands = useCallback(async (filter: string) => {
    const lowerFilter = filter.toLowerCase();
    const items: PopoverItem[] = [];
    const seen = new Set<string>();

    // 1. Frontend-only commands (help, clear, cost)
    for (const cmd of FRONTEND_COMMANDS) {
      if (cmd.label.toLowerCase().includes(lowerFilter)) {
        items.push(cmd);
        seen.add(cmd.value);
      }
    }

    // 2. SDK skills（优先使用 SDK 返回的完整 skills 列表，确保与模型一致）
    if (sdkSkills && sdkSkills.length > 0) {
      // ✅ SDK 已返回 skills 元数据，直接使用（包含内置命令 + 用户自定义 skills）
      for (const skill of sdkSkills) {
        const value = `/${skill.name}`;
        if (seen.has(value)) continue;
        if (skill.name.toLowerCase().includes(lowerFilter)) {
          items.push({
            label: skill.name,
            value,
            description: skill.description,
            builtIn: false, // SDK 返回的都是 skills（包括内置和用户自定义）
          });
          seen.add(value);
        }
      }
    } else {
      // ⚠️ Fallback：SDK 未返回 skills（旧版本或未初始化），使用 slash_commands + 文件系统
      // 2a. SDK built-in slash commands（只有命令名，无 description）
      for (const name of sdkSlashCommands) {
        const value = `/${name}`;
        if (seen.has(value)) continue;
        if (name.toLowerCase().includes(lowerFilter)) {
          items.push({ label: name, value, builtIn: true });
          seen.add(value);
        }
      }

      // 2b. 文件系统扫描（补充 description）
      try {
        const params = new URLSearchParams();
        if (workingDirectory) params.set('cwd', workingDirectory);
        const res = await fetch(`/api/skills?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          for (const skill of data.skills || []) {
            const value = `/${skill.name}`;
            if (seen.has(value)) continue;
            if (skill.name.toLowerCase().includes(lowerFilter)) {
              items.push({
                label: skill.name,
                value,
                description: skill.description,
                installedSource: skill.installedSource,
              });
              seen.add(value);
            }
          }
        }
      } catch {
        // silent — skills API unavailable
      }
    }

    return items.slice(0, 30);
  }, [sdkSkills, sdkSlashCommands, workingDirectory]);

  // Close popover
  const closePopover = useCallback(() => {
    setPopoverMode(null);
    setPopoverItems([]);
    setPopoverFilter('');
    setSelectedIndex(0);
    setTriggerPos(null);
  }, []);

  // Remove active badge
  const removeBadge = useCallback(() => {
    setBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // Insert selected item
  const insertItem = useCallback((item: PopoverItem) => {
    if (triggerPos === null) return;

    // Frontend immediate commands (help, clear): execute right away
    if (item.immediate && onCommand) {
      setInputValue('');
      closePopover();
      onCommand(item.value);
      return;
    }

    // Slash commands and skills: show as badge, user can add args, then send to SDK
    if (popoverMode === 'skill') {
      setBadge({
        command: item.value,
        label: item.label,
        description: item.description || '',
        isSkill: !item.builtIn,
        installedSource: item.installedSource,
      });
      setInputValue('');
      closePopover();
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    // File mention: insert into text
    const currentVal = inputValue;
    const before = currentVal.slice(0, triggerPos);
    const cursorEnd = triggerPos + popoverFilter.length + 1;
    const after = currentVal.slice(cursorEnd);
    const insertText = `@${item.value} `;

    setInputValue(before + insertText + after);
    closePopover();

    // Refocus textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [triggerPos, popoverMode, closePopover, onCommand, inputValue, popoverFilter]);

  // Handle input changes to detect @ and /
  const handleInputChange = useCallback(async (val: string) => {
    setInputValue(val);

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);

    // Check for @ trigger
    const atMatch = beforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      const filter = atMatch[1];
      setPopoverMode('file');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - atMatch[0].length);
      setSelectedIndex(0);
      const items = await fetchFiles(filter);
      setPopoverItems(items);
      return;
    }

    // Check for / trigger (only at start of line or after space)
    const slashMatch = beforeCursor.match(/(^|\s)\/([^\s]*)$/);
    if (slashMatch) {
      const filter = slashMatch[2];
      setPopoverMode('skill');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - slashMatch[2].length - 1);
      setSelectedIndex(0);
      const items = await fetchCommands(filter);  // ← 改为 fetchCommands
      setPopoverItems(items);
      return;
    }

    if (popoverMode) {
      closePopover();
    }
  }, [fetchFiles, fetchCommands, popoverMode, closePopover]);

  const handleSubmit = useCallback(async (msg: { text: string; files: Array<{ type: string; url: string; filename?: string; mediaType?: string }> }, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = inputValue.trim();

    closePopover();

    // Convert PromptInput FileUIParts (with data URLs) to FileAttachment[]
    const convertFiles = async (): Promise<FileAttachment[]> => {
      if (!msg.files || msg.files.length === 0) return [];

      const attachments: FileAttachment[] = [];
      for (const file of msg.files) {
        if (!file.url) continue;
        try {
          const attachment = await dataUrlToFileAttachment(
            file.url,
            file.filename || 'file',
            file.mediaType || 'application/octet-stream',
          );
          // Enforce per-type size limits
          const isImage = attachment.type.startsWith('image/');
          const sizeLimit = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
          if (attachment.size <= sizeLimit) {
            attachments.push(attachment);
          }
        } catch {
          // Skip files that fail conversion
        }
      }
      return attachments;
    };

    // Badge active: send /command [args] directly to SDK
    if (badge) {
      const files = await convertFiles();
      // 直接发 /command-name 给 SDK，SDK 原生处理
      // 用户输入的内容作为命令参数追加
      const finalPrompt = content
        ? `${badge.command} ${content}`
        : badge.command;

      setBadge(null);
      setInputValue('');
      onSend(finalPrompt, files.length > 0 ? files : undefined);
      return;
    }

    const files = await convertFiles();
    const hasFiles = files.length > 0;

    if ((!content && !hasFiles) || disabled) return;

    // Slash command handling
    if (content.startsWith('/') && !hasFiles) {
      // Frontend-only commands (help, clear): handle locally
      const frontendCmd = FRONTEND_COMMANDS.find(c => c.value === content);
      if (frontendCmd?.immediate && onCommand) {
        setInputValue('');
        onCommand(content);
        return;
      }

      // All other /commands: send directly to SDK
      onSend(content);
      setInputValue('');
      return;
    }

    onSend(content || 'Please review the attached file(s).', hasFiles ? files : undefined);
    setInputValue('');
  }, [inputValue, onSend, onCommand, disabled, closePopover, badge]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Popover navigation
      if (popoverMode && popoverItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (filteredItems[selectedIndex]) {
            e.preventDefault();
            insertItem(filteredItems[selectedIndex]);
            return;
          }
          // ✅ 没有匹配项时，关闭 popover 并正常提交
          closePopover();
          // 不 return，让 Enter 继续触发表单提交
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closePopover();
          return;
        }
      }

      // Backspace removes badge when input is empty
      if (e.key === 'Backspace' && badge && !inputValue) {
        e.preventDefault();
        removeBadge();
        return;
      }

      // Escape removes badge
      if (e.key === 'Escape' && badge) {
        e.preventDefault();
        removeBadge();
        return;
      }
    },
    [popoverMode, popoverItems, popoverFilter, selectedIndex, insertItem, closePopover, badge, inputValue, removeBadge]
  );

  // Click outside to close popover
  useEffect(() => {
    if (!popoverMode) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverMode, closePopover]);

  // Click outside to close mode menu
  useEffect(() => {
    if (!modeMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modeMenuOpen]);

  // Click outside to close model menu
  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  const filteredItems = popoverItems.filter((item) =>
    item.label.toLowerCase().includes(popoverFilter.toLowerCase())
  );

  const currentModelValue = modelName || '';
  const currentModelOption = MODEL_OPTIONS.find((m) => m.value === currentModelValue) || MODEL_OPTIONS[0];
  const currentMode = MODE_OPTIONS.find((m) => m.value === mode) || MODE_OPTIONS[0];

  const folderShortName = workingDirectory
    ? workingDirectory.split('/').filter(Boolean).pop() || workingDirectory
    : '';

  // Map isStreaming to ChatStatus for PromptInputSubmit
  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';

  return (
    <div className="bg-background/80 backdrop-blur-lg px-4 py-3">
      <div className="mx-auto">
        <div className="relative">
          {/* Popover */}
          {popoverMode && filteredItems.length > 0 && (
            <div
              ref={popoverRef}
              className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                {popoverMode === 'file' ? 'Files' : 'Commands'}
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {filteredItems.map((item, i) => (
                  <button
                    key={`${item.value}-${i}`}
                    ref={i === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                      i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    )}
                    onClick={() => insertItem(item)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    {popoverMode === 'file' ? (
                      <HugeiconsIcon icon={AtIcon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : item.builtIn ? (
                      <HugeiconsIcon icon={CommandLineIcon} className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                    ) : (
                      <HugeiconsIcon icon={DivideSignIcon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono text-xs truncate">{item.label}</span>
                    {item.immediate && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-500/10 text-zinc-400 font-medium shrink-0">
                        App
                      </span>
                    )}
                    {item.description && (
                      <span className="ml-auto text-xs text-muted-foreground truncate max-w-[200px]">
                        {item.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PromptInput replaces the old input area */}
          <PromptInput
            onSubmit={handleSubmit}
            accept={ACCEPTED_FILE_TYPES}
            multiple
            maxFileSize={MAX_FILE_SIZE}
          >
            {/* Command badge */}
            {badge && (
              <div className="flex w-full items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 pl-2.5 pr-1.5 py-1 text-xs font-medium border border-blue-500/20">
                  <span className="font-mono">{badge.command}</span>
                  {badge.description && (
                    <span className="text-blue-500/60 dark:text-blue-400/60 text-[10px]">{badge.description}</span>
                  )}
                  <button
                    type="button"
                    onClick={removeBadge}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-blue-500/20 transition-colors"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </span>
              </div>
            )}
            {/* File attachment capsules */}
            <FileAttachmentsCapsules />
            <PromptInputTextarea
              ref={textareaRef}
              placeholder={badge ? t('Add details (optional), then press Enter...') : t('Message Claude...')}
              value={inputValue}
              onChange={(e) => handleInputChange(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || isStreaming}
              className="min-h-10"
            />
            <PromptInputFooter>
              <PromptInputTools>
                {/* Attach file button */}
                <AttachFileButton />

                {/* Folder picker button */}
                <PromptInputButton
                  onClick={() => setFolderPickerOpen(true)}
                  tooltip={workingDirectory || 'Select project folder'}
                >
                  <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5" />
                  <span className="max-w-[120px] truncate text-xs">
                    {folderShortName || 'Folder'}
                  </span>
                </PromptInputButton>

                {/* Mode selector */}
                <div className="relative" ref={modeMenuRef}>
                  <PromptInputButton
                    onClick={() => setModeMenuOpen((prev) => !prev)}
                  >
                    <HugeiconsIcon icon={currentMode.icon} className="h-3.5 w-3.5" />
                    <span className="text-xs">{currentMode.label}</span>
                    <HugeiconsIcon icon={ArrowDown01Icon} className="h-2.5 w-2.5" />
                  </PromptInputButton>

                  {/* Mode dropdown */}
                  {modeMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-56 rounded-lg border bg-popover shadow-lg overflow-hidden z-50">
                      <div className="py-1">
                        {MODE_OPTIONS.map((opt) => {
                          const isActive = opt.value === mode;
                          return (
                            <button
                              key={opt.value}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                              )}
                              onClick={() => {
                                onModeChange?.(opt.value);
                                setModeMenuOpen(false);
                              }}
                            >
                              <HugeiconsIcon icon={opt.icon} className="h-4 w-4 shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <span className="font-medium text-xs">{opt.label}</span>
                                <span className="text-[10px] text-muted-foreground truncate">
                                  {opt.description}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </PromptInputTools>

              <div className="flex items-center gap-1.5">
                {/* Model selector */}
                <div className="relative" ref={modelMenuRef}>
                  <PromptInputButton
                    onClick={() => setModelMenuOpen((prev) => !prev)}
                  >
                    <span className="text-xs font-mono">{currentModelOption.label}</span>
                    <HugeiconsIcon icon={ArrowDown01Icon} className="h-2.5 w-2.5" />
                  </PromptInputButton>

                  {modelMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-1.5 w-48 rounded-lg border bg-popover shadow-lg overflow-hidden z-50">
                      <div className="py-1">
                        {MODEL_OPTIONS.map((opt) => {
                          const isActive = opt.value === currentModelValue;
                          return (
                            <button
                              key={opt.value}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                                isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                              )}
                              onClick={() => {
                                onModelChange?.(opt.value);
                                setModelMenuOpen(false);
                              }}
                            >
                              <span className="font-mono text-xs">{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <FileAwareSubmitButton
                  status={chatStatus}
                  onStop={onStop}
                  disabled={disabled}
                  inputValue={inputValue}
                  hasBadge={!!badge}
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

      {/* FolderPicker dialog */}
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(dir) => {
          onWorkingDirectoryChange?.(dir);
        }}
        initialPath={workingDirectory || undefined}
      />
    </div>
  );
}
