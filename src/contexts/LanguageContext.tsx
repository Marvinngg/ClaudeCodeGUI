'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Language = 'zh' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'codepilot-language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY) as Language;
    if (stored === 'zh' || stored === 'en') {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  };

  const t = (key: string): string => {
    if (!mounted) return key;
    return translations[language]?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}

// 翻译映射
const translations: Record<Language, Record<string, string>> = {
  zh: {
    // NavRail
    'New Chat': '新对话',
    'Chats': '对话',
    'Extensions': '扩展',
    'Settings': '设置',
    'Toggle theme': '切换主题',
    'Light mode': '浅色模式',
    'Dark mode': '深色模式',
    'Switch Language': '切换语言',

    // Chat
    'Type a message': '输入消息',
    'Message Claude...': '给 Claude 发消息...',
    'Add details (optional), then press Enter...': '添加详细信息（可选），然后按回车...',
    'Send': '发送',
    'Stop': '停止',
    'Continue': '继续',
    'Summarize Conversation': '总结对话',
    'Summarizing...': '正在总结...',
    'Open Chat': '打开聊天',
    'Delete': '删除',
    'Share to Hub': '分享到 Hub',
    'Upload to Hub': '上传到 Hub',
    'Download Markdown': '下载 Markdown',
    'Download': '下载',
    'Install to Local': '安装到本地',
    'Install': '安装',
    'Installed': '已安装',
    'Installing...': '安装中...',
    'Installation Successful!': '安装成功！',

    // Extensions
    'Skills': 'Skills',
    'Conversations': '对话',
    'Hub': 'Hub',
    'Installed Skills': '已安装 Skills',
    'Hub Skills': 'Hub Skills',
    'Conversation Summaries': '对话总结',
    'Hub Conversations': 'Hub 对话',
    'All': '全部',
    'Local': '本地',
    'From Hub': '来自 Hub',
    'Install from Hub': '从 Hub 安装',
    'MCP Servers': 'MCP 服务器',

    // Conversation List
    'total conversations': '共 {{count}} 个',
    'No conversation summaries': '暂无对话总结',
    'Click "Summarize Conversation" in chat to create': '在聊天页面点击"总结对话"按钮创建',
    'Select a conversation to view details': '选择一个对话查看详情',
    'No Hub conversations': '暂无 Hub 对话',
    'Shared conversations will appear here': '其他用户分享的对话将显示在这里',

    // Settings
    'API Settings': 'API 设置',
    'Provider Management': 'Provider 管理',
    'Summarization Settings': '总结设置',
    'Hub Settings': 'Hub 设置',
    'Manage CodePilot and Claude CLI settings': '管理 CodePilot 和 Claude CLI 设置',
    'Visual Editor': '可视化编辑器',
    'JSON Editor': 'JSON 编辑器',
    'Loading settings...': '加载设置中...',
    'Enabled': '已启用',
    'Disabled': '已禁用',
    'Save Changes': '保存修改',
    'Saving...': '保存中...',
    'Settings saved successfully': '设置保存成功',
    'Save JSON': '保存 JSON',
    'Format': '格式化',
    'Reset': '重置',
    'Confirm Save': '确认保存',
    'Confirm save description': '这将覆盖当前的 ~/.claude/settings.json 文件。确定要继续吗？',

    // Common
    'Save': '保存',
    'Cancel': '取消',
    'Close': '关闭',
    'Edit': '编辑',
    'Add': '添加',
    'Remove': '移除',
    'Search': '搜索',
    'Loading': '加载中',
    'Error': '错误',
    'Success': '成功',
    'Confirm': '确认',
    'Name': '名称',
    'Description': '描述',
    'Content': '内容',
    'Tags': '标签',
    'Created': '创建时间',
    'Updated': '更新时间',
    'Publisher': '发布者',
    'Already installed': '此对话已安装到本地',
    'Confirm install': '确定要将"{{name}}"安装到本地吗？\n\n安装后可在 Extensions → Conversations → 对话总结 中查看。',
  },
  en: {
    // NavRail
    'New Chat': 'New Chat',
    'Chats': 'Chats',
    'Extensions': 'Extensions',
    'Settings': 'Settings',
    'Toggle theme': 'Toggle theme',
    'Light mode': 'Light mode',
    'Dark mode': 'Dark mode',
    'Switch Language': 'Switch Language',

    // Chat
    'Type a message': 'Type a message',
    'Message Claude...': 'Message Claude...',
    'Add details (optional), then press Enter...': 'Add details (optional), then press Enter...',
    'Send': 'Send',
    'Stop': 'Stop',
    'Continue': 'Continue',
    'Summarize Conversation': 'Summarize Conversation',
    'Summarizing...': 'Summarizing...',
    'Open Chat': 'Open Chat',
    'Delete': 'Delete',
    'Share to Hub': 'Share to Hub',
    'Upload to Hub': 'Upload to Hub',
    'Download Markdown': 'Download Markdown',
    'Download': 'Download',
    'Install to Local': 'Install to Local',
    'Install': 'Install',
    'Installed': 'Installed',
    'Installing...': 'Installing...',
    'Installation Successful!': 'Installation Successful!',

    // Extensions
    'Skills': 'Skills',
    'Conversations': 'Conversations',
    'Hub': 'Hub',
    'Installed Skills': 'Installed Skills',
    'Hub Skills': 'Hub Skills',
    'Local Summaries': 'Local Summaries',
    'Hub Conversations': 'Hub Conversations',
    'All': 'All',
    'Local': 'Local',
    'From Hub': 'From Hub',

    // Settings
    'API Settings': 'API Settings',
    'Provider Management': 'Provider Management',
    'Summarization Settings': 'Summarization Settings',
    'Hub Settings': 'Hub Settings',
    'Manage CodePilot and Claude CLI settings': 'Manage CodePilot and Claude CLI settings',
    'Visual Editor': 'Visual Editor',
    'JSON Editor': 'JSON Editor',
    'Loading settings...': 'Loading settings...',
    'Enabled': 'Enabled',
    'Disabled': 'Disabled',
    'Save Changes': 'Save Changes',
    'Saving...': 'Saving...',
    'Settings saved successfully': 'Settings saved successfully',
    'Save JSON': 'Save JSON',
    'Format': 'Format',
    'Reset': 'Reset',
    'Confirm Save': 'Confirm Save',
    'Confirm save description': 'This will overwrite your current ~/.claude/settings.json file. Are you sure you want to continue?',

    // Common
    'Save': 'Save',
    'Cancel': 'Cancel',
    'Close': 'Close',
    'Edit': 'Edit',
    'Add': 'Add',
    'Remove': 'Remove',
    'Search': 'Search',
    'Loading': 'Loading',
    'Error': 'Error',
    'Success': 'Success',
    'Confirm': 'Confirm',
    'Name': 'Name',
    'Description': 'Description',
    'Content': 'Content',
    'Tags': 'Tags',
    'Created': 'Created',
    'Updated': 'Updated',
    'Publisher': 'Publisher',
    'Already installed': 'This conversation is already installed',
    'Confirm install': 'Install "{{name}}" to local database?\n\nYou can view it in Extensions → Conversations → Conversation Summaries after installation.',
    'MCP Servers': 'MCP Servers',
    'No Hub conversations': 'No Hub conversations',
    'Shared conversations will appear here': 'Shared conversations will appear here',
    'Select a conversation to view details': 'Select a conversation to view details',
    'total conversations': '{{count}} total',
    'No conversation summaries': 'No conversation summaries',
    'Click "Summarize Conversation" in chat to create': 'Click "Summarize Conversation" in chat to create',
  },
};
