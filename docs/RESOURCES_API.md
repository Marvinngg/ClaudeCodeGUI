# Resources API 文档

## 概述

CodePilot 提供资源安装和发布 API，用于在本地系统和 Hub 之间同步 Skills、Templates 和 Prompts。

## API 端点

### 1. 安装资源 (Install)

**端点**: `POST /api/resources/install`

**功能**: 从 Hub 安装资源到本地系统

**请求体**:
```json
{
  "type": "skill" | "template" | "prompt",
  "id": <number>
}
```

**响应**:
```json
{
  "success": true,
  "message": "Resource installed successfully",
  "path": "/path/to/installed/resource"  // 仅对 skill/template 返回
}
```

**错误响应**:
```json
{
  "error": "Error message"
}
```

#### 资源类型说明

- **skill**: 安装到 `~/.claude/skills/<name>.json`
- **template**: 安装到 `~/.claude/templates/<name>.md` 或 `.txt`
- **prompt**: 保存到本地数据库（prompts cache 表）

#### 示例

安装 Skill:
```bash
curl -X POST http://localhost:3000/api/resources/install \
  -H "Content-Type: application/json" \
  -d '{"type":"skill","id":1}'
```

安装 Template:
```bash
curl -X POST http://localhost:3000/api/resources/install \
  -H "Content-Type: application/json" \
  -d '{"type":"template","id":5}'
```

安装 Prompt:
```bash
curl -X POST http://localhost:3000/api/resources/install \
  -H "Content-Type: application/json" \
  -d '{"type":"prompt","id":10}'
```

---

### 2. 发布资源 (Publish)

**端点**: `POST /api/resources/publish`

**功能**: 发布本地资源到 Hub

**请求体 (Skill/Template)**:
```json
{
  "type": "skill" | "template",
  "filePath": "/path/to/file",
  "publisher": "Your Name"
}
```

**请求体 (Prompt)**:
```json
{
  "type": "prompt",
  "id": <number>,  // 本地数据库中的 prompt ID
  "publisher": "Your Name"
}
```

**响应**:
```json
{
  "success": true,
  "message": "Resource published successfully",
  "id": <number>  // Hub 上的资源 ID
}
```

**错误响应**:
```json
{
  "error": "Error message"
}
```

#### 示例

发布 Skill:
```bash
curl -X POST http://localhost:3000/api/resources/publish \
  -H "Content-Type: application/json" \
  -d '{
    "type":"skill",
    "filePath":"~/.claude/skills/my_skill.json",
    "publisher":"Alice"
  }'
```

发布 Template:
```bash
curl -X POST http://localhost:3000/api/resources/publish \
  -H "Content-Type: application/json" \
  -d '{
    "type":"template",
    "filePath":"~/.claude/templates/my_template.md",
    "publisher":"Bob"
  }'
```

发布 Prompt:
```bash
curl -X POST http://localhost:3000/api/resources/publish \
  -H "Content-Type: application/json" \
  -d '{
    "type":"prompt",
    "id":1,
    "publisher":"Charlie"
  }'
```

---

## 文件格式

### Skill 文件格式 (`~/.claude/skills/<name>.json`)

```json
{
  "name": "Skill Name",
  "description": "Skill description",
  "publisher": "Publisher Name",
  "version": 1,
  "content": "Skill implementation code",
  "installed_at": "2026-02-11T10:00:00.000Z"
}
```

### Template 文件格式 (`~/.claude/templates/<name>.md`)

```markdown
---
name: Template Name
description: Template description
publisher: Publisher Name
template_type: claude_md
installed_at: 2026-02-11T10:00:00.000Z
---

Template content goes here...
```

---

## 错误处理

### 常见错误

1. **Hub 未配置**
   ```json
   { "error": "Hub URL not configured" }
   ```
   解决方案: 在 Settings 页面配置 Hub URL

2. **资源不存在**
   ```json
   { "error": "Skill with ID 123 not found" }
   ```
   解决方案: 确认资源 ID 正确

3. **文件不存在**
   ```json
   { "error": "File not found: /path/to/file" }
   ```
   解决方案: 确认文件路径正确

4. **无效的 JSON 格式**
   ```json
   { "error": "Invalid JSON format in skill file" }
   ```
   解决方案: 检查 skill 文件的 JSON 格式

5. **缺少必填字段**
   ```json
   { "error": "Missing required fields: type and publisher" }
   ```
   解决方案: 确保请求包含所有必填字段

---

## 实现细节

### 目录自动创建

如果目标目录不存在，API 会自动创建：
- `~/.claude/skills/`
- `~/.claude/templates/`

### 文件命名规则

- Skill: `<name>.json`（名称规范化，特殊字符替换为下划线）
- Template: `<name>.md` 或 `<name>.txt`（根据 template_type 判断）

### 缓存机制

- 安装 Prompt 时会自动更新本地数据库缓存
- 发布资源时会同步更新本地缓存（如果在服务器端运行）

---

## 安全性

- **路径验证**: API 支持 `~` 开头的路径，会自动展开为用户主目录
- **文件存在检查**: 发布前会验证文件是否存在
- **JSON 验证**: Skill 文件必须是有效的 JSON 格式
- **必填字段验证**: 严格验证请求参数

---

## 测试

### 前置条件

1. 确保 Hub 已配置并可访问
2. Settings → Hub URL 已设置
3. 目标目录具有写权限

### 测试流程

1. **安装测试**:
   - 从 Hub 获取资源列表
   - 选择一个资源 ID
   - 调用 install API
   - 验证文件已创建在正确位置

2. **发布测试**:
   - 创建测试文件
   - 调用 publish API
   - 验证 Hub 上已存在该资源
   - 验证本地缓存已更新

---

## 依赖关系

- **hub-client.ts**: Hub 连接和 API 调用
- **db.ts**: 本地数据库操作（Prompts 缓存）
- **fs/os/path**: Node.js 文件系统操作

---

## 版本历史

- **v0.6.0** (2026-02-11): 初始实现
  - 支持 Skill/Template/Prompt 的安装和发布
  - 自动目录创建
  - 完善的错误处理
