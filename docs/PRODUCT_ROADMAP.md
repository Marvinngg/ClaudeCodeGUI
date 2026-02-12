# CodePilot 产品改进方案

> 版本：v1.0 | 日期：2025-02-11 | 当前产品版本：v0.6.0

---

## 一、产品定位

CodePilot 是 Claude Code 的原生桌面 GUI 套壳客户端。我们只做套壳，不重复造 Claude Code 的轮子。

在此基础上，CodePilot 要成为**组织内部的 AI 编程协作平台**——让团队中每个人的最佳实践变成所有人的生产力，让有价值的对话沉淀为可复用的团队知识。

### 核心理念

```
网络即团队    在 Headscale/Tailscale 网络中即为成员，不搞账号体系
共享即效率    一人配好 Skills/MCP/Prompt，全员受益
对话即知识    不关心用了什么，只关心留下了什么
```

---

## 二、现状评估

### 已有能力

| 模块 | 描述 | 代码位置 |
|------|------|---------|
| 核心聊天 | Claude CLI 代理 + SSE 流式响应 | `src/app/api/chat/route.ts` |
| 会话管理 | SQLite 本地存储，支持创建/重命名/归档 | `src/lib/db.ts` |
| 本地 Skills | 读取 `~/.claude/skills/` 并在聊天中使用 | `src/app/extensions/` |
| 本地 MCP | 管理 `~/.claude/settings.json` 中的 MCP 配置 | `src/components/plugins/` |
| Agent Teams | 多 Agent 协作 + 实时 Dashboard | `src/lib/teams-session-manager.ts` |
| Hub 服务 | 独立 Node.js 服务，支持 Provider/MCP/Prompt 同步 | `hub/server.ts`, `hub/db.ts` |
| Hub 客户端 | 定期同步配置 + 上报使用数据 | `src/lib/hub-client.ts` |

### 缺失能力（本方案要解决的）

| 缺失 | 影响 |
|------|------|
| Skills 无法团队共享 | 好用的 Skill 只有配置者自己能用 |
| MCP 配置共享不够易用 | Hub 有 MCP 表但客户端无一键导入 |
| Prompt 共享仅有后端 | Hub 有 system_prompts 表但客户端无 UI |
| 对话知识无法沉淀 | 解决过的问题关掉窗口就丢了 |
| CLAUDE.md 无法共享 | 项目规范靠口头传递 |
| Hub 无管理界面 | 只有裸 API，管理靠 curl |

---

## 三、网络架构：Headscale/Tailscale 适配

### 设计原则

- **网络即信任边界**：在 Headscale 网络内即为团队成员，不需要账号密码
- **Hub 是内网服务**：部署在 Headscale 网络中，通过 `100.x.x.x` 内网地址访问
- **客户端零改造**：CodePilot 客户端只需要填一个 Hub URL，不感知网络层

### 网络拓扑

```
┌──────────────────── Headscale / Tailscale 网络 ────────────────────┐
│                                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ CodePilot A  │  │ CodePilot B  │  │ CodePilot C  │              │
│  │ 100.64.0.2  │  │ 100.64.0.3  │  │ 100.64.0.4  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                       │
│         └────────────────┼────────────────┘                       │
│                          │                                        │
│                          ▼                                        │
│               ┌───────────────────┐                                │
│               │  CodePilot Hub    │                                │
│               │  100.64.0.1:3100  │                                │
│               │  (Docker 部署)     │                                │
│               └───────────────────┘                                │
└────────────────────────────────────────────────────────────────────┘
```

### CodePilot 侧需要做的事

1. Hub Settings 支持填写 Headscale 内网地址（`http://100.64.0.1:3100`）
2. 健康检查增加网络诊断信息（延迟、连通性）
3. Hub 不可用时所有本地功能正常工作（离线优先）

### 需要额外提供的（不在 CodePilot 代码中）

- Hub 的 Docker Compose 部署文件
- Headscale 网络接入指南（给团队新成员）
- Tailscale 作为备选方案的说明

---

## 四、主线一：共享层

> 目标：一人配好，全员受益。让好用的不止一人能用。

### 4.1 Skills 共享

#### 现状

- 本地 Skills 存储在 `~/.claude/skills/` 目录，客户端已能读取和展示
- Hub 没有 Skills 相关的表和 API

#### 要做的事

**Hub 侧：**

在 `hub/db.ts` 中新增 `shared_skills` 表：

```sql
CREATE TABLE IF NOT EXISTS shared_skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    content     TEXT    NOT NULL,          -- Skill 完整内容（Markdown）
    description TEXT    NOT NULL DEFAULT '',-- 一句话说明
    publisher   TEXT    NOT NULL DEFAULT '',-- 发布者昵称（非账号，自行填写）
    version     INTEGER NOT NULL DEFAULT 1,-- 版本号，每次更新 +1
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

在 `hub/server.ts` 中新增 API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/shared/skills` | 获取所有共享 Skills |
| POST | `/api/shared/skills` | 发布/更新一个 Skill |
| DELETE | `/api/shared/skills/:id` | 删除一个共享 Skill |

**客户端侧：**

在 Extensions 页面的 Skills 管理中增加：

- 「发布到团队」按钮 — 将本地 Skill 上传到 Hub
- 「团队 Skills」Tab — 展示 Hub 上的共享 Skills 列表
- 「安装」按钮 — 将共享 Skill 下载写入 `~/.claude/skills/`
- 「有更新」标记 — Hub 上的 Skill 版本比本地新时提示

#### 用户流程

```
A 写了一个好用的 code-review Skill
    │
    ├── 1. 在 Extensions > Skills 页面，点击「发布到团队」
    ├── 2. 填写简短描述，确认发布
    └── 3. Skill 内容上传到 Hub 的 shared_skills 表
              │
              ├── B 打开 Extensions > 团队 Skills
              ├── 看到 code-review Skill，点击「安装」
              └── Skill 文件写入 B 的 ~/.claude/skills/
```

---

### 4.2 MCP 配置共享

#### 现状

- Hub 已有 `mcp_servers` 表和完整 CRUD API
- `hub-client.ts` 已能从 Hub 拉取 MCP 配置
- 但客户端没有 UI 让用户「一键导入 Hub 上的 MCP 配置到本地」

#### 要做的事

**Hub 侧：**

`mcp_servers` 表新增字段：

```sql
ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE mcp_servers ADD COLUMN publisher   TEXT NOT NULL DEFAULT '';
```

**客户端侧：**

在 Extensions 页面的 MCP 管理中增加：

- 「发布到团队」按钮 — 将本地 MCP 配置上传到 Hub
- 「团队 MCP」Tab — 展示 Hub 上的共享 MCP 列表
- 「导入」按钮 — 将 Hub 上的 MCP 配置写入本地 `~/.claude/settings.json`
- 发布时支持变量模板（如 `${HOME}`），导入时自动替换为当前机器的实际路径

#### MCP 配置模板示例

```json
{
  "name": "内部文档搜索",
  "description": "连接公司内部文档库的 MCP Server",
  "publisher": "Alice",
  "config": {
    "command": "npx",
    "args": ["-y", "@company/docs-mcp-server"],
    "env": {
      "DOCS_PATH": "${HOME}/company-docs"
    }
  }
}
```

---

### 4.3 Prompt 共享

#### 现状

- Hub 已有 `system_prompts` 表和完整 CRUD API
- Hub 的 `/api/sync/config` 已返回 systemPrompts
- 客户端目前没有 Prompt 选择/浏览 UI

#### 要做的事

**Hub 侧：**

`system_prompts` 表新增字段：

```sql
ALTER TABLE system_prompts ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE system_prompts ADD COLUMN publisher   TEXT NOT NULL DEFAULT '';
ALTER TABLE system_prompts ADD COLUMN tags        TEXT NOT NULL DEFAULT '[]'; -- JSON 数组
```

**客户端侧：**

- 新建会话时，增加「选择 Prompt」下拉/弹窗，列出 Hub 上的共享 Prompts
- Prompt 带标签分类（如：`代码审查`、`架构设计`、`调试`、`文档编写`）
- 「发布当前会话的 System Prompt 到团队」按钮
- Settings 中增加 Prompt 管理入口

#### 用户流程

```
新建会话
    │
    ├── 选择模式（Code / Plan / Ask）
    ├── 选择工作目录
    └── [新增] 选择 Prompt（可选）
              │
              ├── 显示团队共享的 Prompts 列表
              ├── 按标签筛选（代码审查 / 架构设计 / ...）
              └── 选中后自动填入 System Prompt
```

---

### 4.4 CLAUDE.md 模板共享

#### 现状

- CLAUDE.md 是 Claude Code 的项目级指令文件
- 各项目的 CLAUDE.md 靠手动复制或口头传递

#### 要做的事

**Hub 侧：**

新增 `shared_templates` 表：

```sql
CREATE TABLE IF NOT EXISTS shared_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,           -- 如「前端项目规范」
    content     TEXT    NOT NULL,           -- CLAUDE.md 完整内容
    description TEXT    NOT NULL DEFAULT '',
    publisher   TEXT    NOT NULL DEFAULT '',
    template_type TEXT  NOT NULL DEFAULT 'claude_md', -- 预留扩展
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

新增 API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/shared/templates` | 获取所有共享模板 |
| POST | `/api/shared/templates` | 发布/更新模板 |
| DELETE | `/api/shared/templates/:id` | 删除模板 |

**客户端侧：**

- Settings 中增加「团队模板」管理
- 新建项目时可选择套用团队 CLAUDE.md 模板
- 支持将当前项目的 CLAUDE.md 发布到团队

---

## 五、主线二：知识层

> 目标：不关心用了什么，只关心留下了什么。让对话中解决的问题沉淀为团队资产。

### 5.1 对话知识沉淀

#### 核心思路

对话的原始数据不上传。用户主动选择「沉淀」时，调用 Claude 将对话提炼为一条结构化的知识条目，然后存入 Hub。

#### 知识条目结构

一条知识条目 = 一个被解决的问题 + 它的解决方案：

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│  标题：Next.js 13 动态路由参数获取方式变更             │
│                                                      │
│  问题：                                               │
│    从 Next.js 12 升级到 13 后，动态路由 [id] 页面的    │
│    params 变成了 Promise，直接解构会报类型错误          │
│                                                      │
│  解决方案：                                            │
│    在 Next.js 13+ 中，page 组件的 params 需要 await：  │
│                                                      │
│    // 旧写法（Next.js 12）                             │
│    export default function Page({ params }) {         │
│      const { id } = params;                          │
│    }                                                  │
│                                                      │
│    // 新写法（Next.js 13+）                            │
│    export default async function Page({ params }) {   │
│      const { id } = await params;                    │
│    }                                                  │
│                                                      │
│  标签：nextjs, migration, routing                     │
│  来源：Alice · 2025-02-10 · project-web               │
│                                                      │
└─────────────────────────────────────────────────────┘
```

#### 数据模型

**Hub 侧新增：**

```sql
CREATE TABLE IF NOT EXISTS knowledge_entries (
    id              TEXT    PRIMARY KEY,      -- UUID
    title           TEXT    NOT NULL,
    problem         TEXT    NOT NULL,          -- 问题描述
    solution        TEXT    NOT NULL,          -- 解决方案
    key_code        TEXT    NOT NULL DEFAULT '',-- 关键代码（可选）
    tags            TEXT    NOT NULL DEFAULT '[]',-- JSON 数组
    project         TEXT    NOT NULL DEFAULT '',-- 关联项目名
    publisher       TEXT    NOT NULL DEFAULT '',-- 来源（昵称）
    source_messages TEXT    NOT NULL DEFAULT '',-- 原始对话片段（可选，供参考）
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title,
    problem,
    solution,
    key_code,
    tags,
    content=knowledge_entries,
    content_rowid=rowid
);
```

**Hub 侧新增 API：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge` | 搜索/列出知识条目，支持 `?q=关键词` 和 `?tag=标签` |
| GET | `/api/knowledge/:id` | 获取单条知识详情 |
| POST | `/api/knowledge` | 创建知识条目 |
| PUT | `/api/knowledge/:id` | 更新知识条目 |
| DELETE | `/api/knowledge/:id` | 删除知识条目 |

#### 用户流程：沉淀

```
一段有价值的对话结束后
    │
    ├── 1. 用户点击会话菜单中的「沉淀为知识」
    │
    ├── 2. 客户端将对话内容发送给 Claude，请求生成结构化总结
    │      Prompt 大意：
    │      "请将以下对话提炼为一条知识记录，包含：
    │       - title: 一句话标题
    │       - problem: 遇到了什么问题
    │       - solution: 怎么解决的
    │       - key_code: 关键代码片段（如有）
    │       - tags: 相关标签（3-5个）"
    │
    ├── 3. 客户端展示生成的知识条目预览
    │      用户可以编辑标题、问题、方案、标签
    │
    ├── 4. 用户确认后，POST 到 Hub 的 /api/knowledge
    │
    └── 5. 知识条目存入 Hub，团队可见
```

#### 用户流程：发现

```
B 遇到一个问题
    │
    ├── 方式一：主动搜索
    │   └── 打开「团队知识库」，搜索关键词
    │       └── 看到匹配的条目，参考解决方案
    │
    └── 方式二：新建会话时引用
        └── 新建会话 → 「引用知识」→ 搜索 → 选中
            └── 知识内容注入为对话的初始上下文
```

---

### 5.2 客户端 UI 设计

#### 入口位置

```
AppShell 左侧导航栏
    │
    ├── 💬 聊天（已有）
    ├── 🔌 扩展（已有，Skills + MCP）
    ├── 📚 知识库（新增）
    ├── ⚙️ 设置（已有）
```

#### 知识库页面

```
┌──────────────────────────────────────────────┐
│  📚 团队知识库                    [搜索框...]  │
├──────────────────────────────────────────────┤
│                                              │
│  标签过滤：                                    │
│  [react] [nextjs] [docker] [database] [全部]  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Next.js 13 动态路由参数获取方式变更      │  │
│  │ 问题：params 变成 Promise，解构报错...   │  │
│  │ 🏷 nextjs migration routing             │  │
│  │ 👤 Alice · 2025-02-10                   │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Docker 容器内 SQLite 锁超时问题         │  │
│  │ 问题：并发写入时频繁报 SQLITE_BUSY...    │  │
│  │ 🏷 docker sqlite concurrency            │  │
│  │ 👤 Bob · 2025-02-08                     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ...                                         │
└──────────────────────────────────────────────┘
```

#### 沉淀对话弹窗

```
┌──────────────────────────────────────────────┐
│  沉淀为团队知识                       [✕ 关闭] │
├──────────────────────────────────────────────┤
│                                              │
│  标题（自动生成，可编辑）：                      │
│  ┌────────────────────────────────────────┐  │
│  │ Next.js 13 动态路由参数获取方式变更      │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  问题描述：                                    │
│  ┌────────────────────────────────────────┐  │
│  │ 从 Next.js 12 升级到 13 后...           │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  解决方案：                                    │
│  ┌────────────────────────────────────────┐  │
│  │ 在 Next.js 13+ 中，page 组件的         │  │
│  │ params 需要 await...                   │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  关键代码：                                    │
│  ┌────────────────────────────────────────┐  │
│  │ const { id } = await params;           │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  标签：                                       │
│  [nextjs] [migration] [routing] [+ 添加]     │
│                                              │
│  发布者昵称：[Alice          ]                 │
│  关联项目：  [project-web    ]                 │
│                                              │
│              [取消]  [发布到团队知识库]          │
└──────────────────────────────────────────────┘
```

---

## 六、Hub 管理后台

### 现状

Hub 目前只有裸 API，所有管理操作需要 curl 或 Postman。

### 要做的事

在 Hub 中增加一个轻量 Web 管理界面，用纯 HTML + 原生 JS 实现（不引入前端框架，保持 Hub 轻量）。

访问方式：浏览器打开 `http://<hub-ip>:3100/admin`

### 功能

| 模块 | 说明 |
|------|------|
| 共享 Skills | 查看/删除团队共享的 Skills |
| 共享 MCP | 查看/删除团队共享的 MCP 配置 |
| 共享 Prompts | 查看/编辑/删除团队共享的 Prompts |
| 模板管理 | 查看/编辑/删除 CLAUDE.md 模板 |
| 知识库管理 | 查看/编辑/删除知识条目 |
| Provider 管理 | 管理共享的 API Provider（已有 API） |

不做用户管理。不做权限控制。网络内即可访问。

---

## 七、实施计划

### Phase 1：共享层（3-4 周）

```
Week 1  Hub 扩展
        ├── shared_skills 表 + CRUD API
        ├── shared_templates 表 + CRUD API
        ├── system_prompts 表加字段 (description, publisher, tags)
        ├── mcp_servers 表加字段 (description, publisher)
        └── 更新 /api/sync/config 返回新数据

Week 2  客户端 - Skills & MCP 共享
        ├── Extensions > Skills：发布 / 团队列表 / 安装 / 更新提示
        └── Extensions > MCP：发布 / 团队列表 / 导入 / 变量模板

Week 3  客户端 - Prompt & 模板共享
        ├── 新建会话时选择团队 Prompt
        ├── Prompt 发布 / 浏览 / 标签筛选
        └── CLAUDE.md 模板管理和导入

Week 4  网络适配 & 收尾
        ├── Hub Docker Compose 部署文件
        ├── Headscale 环境端到端测试
        ├── 离线降级验证
        └── Hub 简易管理后台
```

### Phase 2：知识层（4-5 周）

```
Week 5  Hub 知识库后端
        ├── knowledge_entries 表 + FTS5 全文搜索
        ├── 知识 CRUD API + 搜索 API
        └── Hub 管理后台新增知识库模块

Week 6  客户端 - 知识沉淀
        ├── 会话菜单增加「沉淀为知识」
        ├── 调用 Claude 生成结构化总结
        └── 知识条目预览 / 编辑 / 确认发布

Week 7  客户端 - 知识发现
        ├── 左侧导航新增「知识库」入口
        ├── 知识库列表 / 搜索 / 标签筛选
        ├── 知识详情页
        └── 新建会话时引用知识条目

Week 8  打磨 & 测试
        ├── 总结生成的 Prompt 调优
        ├── 搜索结果排序和体验优化
        └── Headscale 环境完整测试
```

### Phase 3：智能关联（可选，视反馈决定）

```
Week 9+  对话中自动匹配知识库
         ├── 后台对当前对话提取关键词
         ├── 检索知识库中的相关条目
         └── 侧边栏提示「团队中有人解决过类似问题」
```

---

## 八、技术决策

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 身份认证 | 不做 | 网络即信任，Headscale 网络内即为成员 |
| Hub 数据库 | 继续用 SQLite | 团队规模在几十人内，SQLite 完全够用，不增加运维负担 |
| 全文搜索 | SQLite FTS5 | 内置于 SQLite，无需额外依赖，中文搜索通过分词处理 |
| Hub 管理界面 | 纯 HTML + JS | Hub 保持轻量，不引入前端构建工具 |
| 知识生成 | 调用 Claude 提炼 | 利用 AI 能力做结构化提取，比手动填写质量高 |
| 数据上传策略 | 全部用户主动触发 | 不自动上传任何数据，尊重隐私 |
| 离线策略 | 离线优先 | Hub 不可用时本地功能完全正常 |

---

## 九、不做的事

明确边界，以下不在本方案范围内：

| 不做 | 原因 |
|------|------|
| 用户账号体系 | 网络即身份，不增加复杂度 |
| 权限/角色管理 | 内部工具，信任团队成员 |
| 用量统计分析 | 不关心用了什么，只关心留下了什么 |
| 原始对话上传 | 只上传提炼后的知识条目 |
| 实时协作/在线状态 | 超出套壳定位 |
| 会话转交 | 超出套壳定位 |
| Headscale 网络管理 | 网络基础设施由 Tailscale/Headscale 本身负责 |

---

## 十、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Hub 单点故障 | 离线优先设计 + Docker 快速恢复 + 数据定期备份 |
| SQLite FTS5 中文支持有限 | 可引入 jieba 分词或使用 LIKE 模糊搜索兜底 |
| Claude Code CLI 升级不兼容 | 锁定 CLI 版本 + 发版前兼容性测试 |
| 知识条目质量参差不齐 | Claude 提炼 + 用户编辑确认，双重保障 |
| 团队不愿意用沉淀功能 | 降低操作门槛（一键生成），靠有用的知识自然吸引使用 |

---

## 附录 A：Hub API 总览（含新增）

### 现有 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/sync/config` | 同步共享配置 |
| POST | `/api/usage/report` | 上报使用数据 |
| GET | `/api/admin/usage` | 使用统计 |
| GET/POST | `/api/admin/providers` | Provider 管理 |
| DELETE/GET | `/api/admin/providers/:id` | 单个 Provider |
| GET/POST | `/api/admin/mcp` | MCP 管理 |
| DELETE/GET | `/api/admin/mcp/:id` | 单个 MCP |

### 新增 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/shared/skills` | 获取共享 Skills 列表 |
| POST | `/api/shared/skills` | 发布/更新 Skill |
| DELETE | `/api/shared/skills/:id` | 删除 Skill |
| GET | `/api/shared/templates` | 获取共享模板列表 |
| POST | `/api/shared/templates` | 发布/更新模板 |
| DELETE | `/api/shared/templates/:id` | 删除模板 |
| GET | `/api/knowledge` | 搜索/列出知识条目 |
| GET | `/api/knowledge/:id` | 获取知识详情 |
| POST | `/api/knowledge` | 创建知识条目 |
| PUT | `/api/knowledge/:id` | 更新知识条目 |
| DELETE | `/api/knowledge/:id` | 删除知识条目 |

### 现有 API 改动

| 路径 | 改动 |
|------|------|
| `/api/sync/config` | 返回数据增加 `sharedSkills`、`templates` 字段 |
| `/api/admin/mcp` POST | 支持 `description`、`publisher` 字段 |

---

## 附录 B：Hub 数据库 Schema 变更汇总

```sql
-- 新增表：shared_skills
CREATE TABLE IF NOT EXISTS shared_skills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    publisher   TEXT    NOT NULL DEFAULT '',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 新增表：shared_templates
CREATE TABLE IF NOT EXISTS shared_templates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    publisher     TEXT    NOT NULL DEFAULT '',
    template_type TEXT    NOT NULL DEFAULT 'claude_md',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 新增表：knowledge_entries
CREATE TABLE IF NOT EXISTS knowledge_entries (
    id              TEXT    PRIMARY KEY,
    title           TEXT    NOT NULL,
    problem         TEXT    NOT NULL,
    solution        TEXT    NOT NULL,
    key_code        TEXT    NOT NULL DEFAULT '',
    tags            TEXT    NOT NULL DEFAULT '[]',
    project         TEXT    NOT NULL DEFAULT '',
    publisher       TEXT    NOT NULL DEFAULT '',
    source_messages TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 新增表：全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title,
    problem,
    solution,
    key_code,
    tags,
    content=knowledge_entries,
    content_rowid=rowid
);

-- 现有表改动
ALTER TABLE mcp_servers ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE mcp_servers ADD COLUMN publisher   TEXT NOT NULL DEFAULT '';

ALTER TABLE system_prompts ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE system_prompts ADD COLUMN publisher   TEXT NOT NULL DEFAULT '';
ALTER TABLE system_prompts ADD COLUMN tags        TEXT NOT NULL DEFAULT '[]';
```
