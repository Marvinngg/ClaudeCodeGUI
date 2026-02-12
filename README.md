# CodePilot

**Claude Code 的原生桌面 GUI** — 通过可视化界面与 Claude 对话、编程、管理项目，而不是使用终端。

[![GitHub release](https://img.shields.io/github/v/release/Marvinngg/ClaudeCodeGUI)](https://github.com/Marvinngg/ClaudeCodeGUI/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](https://github.com/Marvinngg/ClaudeCodeGUI/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](./README_EN.md)

---

## 核心理念

**CodePilot 是 Claude Code 的套壳 GUI，不是重新实现。**

- 所有 AI 能力通过 [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 实现，完整支持 Claude Code CLI 的功能（skills、slash commands、工具调用、权限管理等）
- 不自己实现 AI 功能，只做界面层的封装和优化
- 保持与官方 CLI 的行为一致，确保稳定性和可维护性

<!-- 主界面截图：展示整体 UI 布局（左侧导航、中间聊天、右侧文件树） -->
![主界面](docs/screenshot-main.png)

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动应用

```bash
# 启动 Electron 桌面应用（包含 Hub 服务）
npm run electron:dev:hub

# 或仅启动浏览器版本
npm run dev
```

### 3. 配置 API Key

首次启动后，在 Settings 页面配置 Anthropic API Key，或设置环境变量 `ANTHROPIC_API_KEY`。

---

## 私域部署

CodePilot 支持私域 Hub，用于团队内部分享 Skills 和对话总结：

**启动私域 Hub 服务器：**

```bash
cd hub
node server.js
```

默认运行在 `http://localhost:2999`，可通过以下环境变量配置：

- `PORT` — 服务端口（默认 2999）
- `DB_PATH` — 数据库路径（默认 `./data/hub.db`）

**客户端配置：**

在 Settings → Hub Settings 中配置：
- **Hub URL**: `http://your-hub-server:2999`
- **User Identifier**: 团队内唯一标识（用于标记分享来源）

配置完成后，可在 Extensions 页面查看 Hub 中的 Skills 和对话，并安装到本地使用。

<!-- Hub 配置截图：展示 Settings → Hub Settings 配置界面 -->
![Hub 配置](docs/screenshot-hub-settings.png)

<!-- Hub 管理截图：展示 Extensions → Hub 页面的 Skills 和 Conversations 列表 -->
![Hub 管理](docs/screenshot-hub-manager.png)

---

## 关键用法

### 多模式对话

CodePilot 支持三种对话模式：

- **Code** — 完整的代码能力（读写文件、执行命令）
- **Plan** — 只分析和规划，不执行操作
- **Ask** — 纯问答模式

<!-- 模式切换截图：展示输入框左侧的模式选择器 -->
![模式切换](docs/screenshot-mode-selector.png)

### Skills 管理

- **本地 Skills**: 在 Extensions → Skills 中创建和管理，支持全局或项目级作用域
- **Hub Skills**: 从 Hub 安装团队共享的 Skills，一键添加到本地

<!-- Skills 管理截图：展示 Extensions → Skills 页面 -->
![Skills 管理](docs/screenshot-skills.png)

### 对话总结与分享

- 点击聊天界面的 "Summarize Conversation" 按钮，AI 自动生成对话总结
- 总结包含原始对话记录，可上传到 Hub 分享给团队
- 从 Hub 安装对话后，可在本地继续聊天

<!-- 对话总结截图：展示 Extensions → Conversations 页面 -->
![对话总结](docs/screenshot-conversations.png)

### 导入 CLI 会话

支持导入 Claude Code CLI 的历史会话，无缝迁移：

- 点击 Chat 侧边栏的 "Import CLI Session" 按钮
- 选择要导入的会话，历史记录完整保留

<!-- 导入会话截图：展示导入 CLI 会话对话框 -->
![导入会话](docs/screenshot-import.png)

### 多语言支持

点击左下角语言切换按钮（中/EN），在中英文界面间切换。

<!-- 语言切换截图：展示左下角的语言切换按钮 -->
![语言切换](docs/screenshot-language.png)

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面框架 | Electron 40 + Next.js 16 |
| UI 组件 | Radix UI + shadcn/ui + Tailwind CSS |
| AI 集成 | Claude Agent SDK |
| 数据库 | better-sqlite3 (本地嵌入式) |
| Markdown | react-markdown + Shiki (语法高亮) |
| 图标 | Hugeicons + Lucide |

---

## 下载

预编译版本见 [Releases](https://github.com/op7418/CodePilot/releases) 页面，支持 macOS (arm64/x64) 和 Windows (x64)。

**macOS 安装提示：** 首次打开时，右键点击 → "打开"，或前往 系统设置 → 隐私与安全性 → 点击 "仍要打开"。

---

## License

MIT
