# LLMHydra Code Wiki

## 1. 项目概述

**LLMHydra** 是一个面向 LLM 应用开发的多模型接入、可视化编排与代理服务平台。项目允许用户：

- 管理多个 LLM 提供商（端点、模型、密钥）。
- 将多个模型串成 **Chain（链路）**，实现请求顺序转发。
- 接入 **MCP（Model Context Protocol）** 服务器，扩展工具调用能力。
- 通过 Web UI 可视化配置模型、分组、链路，并实时聊天测试。

项目采用 **C/S 架构**，前端为 Vue 3 单页应用，后端为 Node.js + Express 服务，前后端通过 HTTP REST 与 SSE（Server-Sent Events）通信。

---

## 2. 整体架构

```
+-------------------+         HTTP / SSE          +-------------------+
|                   |  <----------------------->  |                   |
|   Vue 3 Client    |                             |   Node.js Server  |
|   (Vite + Pinia)  |                             |   (Express + ws)  |
|                   |                             |                   |
+-------------------+                             +-------------------+
        |                                                  |
        | 1. 配置管理 / 消息发送                            | 2. 路由转发
        |                                                  |
        v                                                  v
+-------------------+                             +-------------------+
|   Model Library    |                             |  OpenRouter API   |
|   Group Manager    |                             |  (LLM 提供商)     |
|   Chain Editor     |                             +-------------------+
|   Chat UI          |                             +-------------------+
+-------------------+                             |  MCP Servers      |
                                                    |  (工具扩展)       |
                                                    +-------------------+
```

**核心数据流**：

1. 用户在 **Client** 中配置模型、分组、链路，或发起聊天。
2. **Client** 通过 `POST /api/chat` 等接口将请求发送给 **Server**。
3. **Server** 根据当前激活的 Group 与 Chain，依次调用多个模型（支持 OpenRouter 流式/非流式）。
4. 过程中如需调用工具，**Server** 通过 **MCP** 协议连接外部 MCP Server 执行工具，并支持人工审批敏感工具。
5. 响应、日志、模型状态、工具定义等通过 REST 或 SSE 实时返回前端。

---

## 3. 核心模块与职责

### 3.1 服务端 (`server/`)

| 文件 | 职责 |
|------|------|
| `index.js` | 服务入口，核心业务逻辑集中地：SSE 消息路由、LLM 流式/非流式调用、重试与 fallback、工具执行、MCP 连接管理、RESTful API 路由、聊天生命周期管理、配置加载与校验、健康检查等。 |
| `app.js` | 应用状态与业务逻辑层：维护全局内存状态（`APP_STATE`），提供模型/分组/链路/工具/MCP 连接的 CRUD 操作、统计数据记录、服务重启等高层接口。 |
| `config-manager.js` | 配置文件的读取、写入与默认值生成，基于 YAML。 |
| `circuit-breaker.js` | 故障熔断器实现，用于隔离异常模型，防止 cascading failure。 |
| `stats-manager.js` | 请求统计管理器，记录每个模型的调用次数、Token 消耗，支持历史记录与性能报告。 |
| `log-manager.js` | 日志管理器，支持多级别日志记录与查询。 |
| `openrouter.js` | OpenRouter API 客户端，封装流式（`chatCompletionStream`）与非流式（`chatCompletion`）调用，以及模型列表获取。 |

### 3.2 客户端 (`client/src/`)

| 文件/目录 | 职责 |
|-----------|------|
| `main.js` | Vue 3 应用启动入口，注册 Pinia 状态管理与持久化插件。 |
| `App.vue` | 主布局组件，左侧为 GroupList + ModelLibrary + NodeCanvas，右侧为聊天界面与工具抽屉。负责全局状态编排、消息发送、文件上传、模型编辑器、MCP 管理器等弹窗交互。 |
| `api.js` | 前端统一的 API 请求封装，覆盖配置、模型、分组、链路、聊天、健康、工具、MCP 等接口。 |
| `components/NodeCanvas.vue` | 链路可视化画布：支持滚轮缩放、空白处平移、节点拖拽排序、从模型库拖入节点、拖出删除，SVG 连线与落点幽灵动画。 |
| `components/GroupList.vue` | 配置组侧边栏：展示分组列表、运行状态、重启按钮，支持新增、编辑 ID/名称、删除、复制 ID。 |
| `components/ModelLibrary.vue` | 模型库面板：展示模型卡片，支持搜索过滤、拖拽到画布、统计信息展示、删除模型。 |

---

## 4. 关键类与函数说明

### 4.1 服务端 (`server/`)

#### `index.js`（核心引擎）

| 函数/对象 | 说明 |
|-----------|------|
| `GLOBAL_HANDLERS` | 全局工具函数集合，供 SSE 消息路由调用。包含 `updateLatestThinking`（流式思维链）、`sendLatestText`（增量文本）、`updateToolsList`（工具列表）、`isMainAgent`/`getMainAgent`（主代理识别）。 |
| `generateRequestId()` | 生成 UUID v4 作为请求唯一标识。 |
| `extractMessages(payload)` | 从 MCP 请求对象中提取 `messages` 字段，兼容不同格式。 |
| `forwardToTarget(endpoint, data)` | 将数据转发到 SSE 端点，处理 CORS 与连接保活。 |
| `handleSSEMessage(event, chatId, client)` | SSE 事件分发器：根据事件类型（`message.start`、`message.delta`、`message.complete`、`message.error`、`tool_call` 等）更新聊天状态并转发给前端。 |
| `createOpenRouterStream(endpoint, payload)` | 使用 `node-fetch` + `ReadableStream` 实现 OpenRouter 流式响应的逐 chunk 转发，支持 early stop。 |
| `callLLM(endpoint, payload, retryConfig, requestId)` | 组装最终请求体，调用 `createOpenRouterStream`，处理重试、fallback 组与熔断逻辑。 |
| `retryOrFallback(endpoints, payload, chatId, abortSignal, handlers, retryConfig, requestId)` | 多级重试/故障转移：在失败时切换到同一 Group 的备用端点或其他 Group。 |
| `saveMessage(chatId, message)` | 将聊天消息持久化到 `./messages/` 目录。 |
| `handlePrompt(endpoint, payload, chatId, client, abortSignal, handlers)` | 统一入口：处理 `thinking`/`text`/`computer` 类型 prompt，调用 `callLLM` 并管理重试。 |
| `handleChat(req, res)` | 聊天接口核心：创建 SSE 响应流，管理 `chatStates`，处理用户消息、MCP 工具审批、思考链、完整响应流。 |
| `cleanupChat(chatId)` | 清理单个聊天的内存状态、超时器、文件缓存。 |
| `cleanupExpiredChats()` | 定期清理过期聊天，防止内存泄漏。 |
| `executeTool(toolCall, handlers, options)` | 执行 MCP 工具调用，支持同步/异步、审批流程、超时与错误处理。 |
| `createMcpConnection(group, tool)` | 建立 MCP 连接（WebSocket 或 SSE），返回连接实例。 |
| `setupMcpListener(mcpConnection, tool)` | 监听 MCP 消息并处理。 |
| `getModel(modelId)` | 根据 ID 查找模型，支持端点回退。 |
| `switchGroup(req, res)` | 切换当前激活的分组。 |
| `updateGroup(req, res)` | 更新分组名称与 Chain。 |
| `addGroup(req, res)` | 新增分组。 |
| `deleteGroup(req, res)` | 删除分组并清理关联状态。 |
| `getToolsForGroup(req, res)` | 获取当前分组可用工具列表（MCP 工具）。 |
| `healthCheckAll()` | 对所有端点执行健康检查。 |
| `setupHealthCheckInterval()` | 启动定时健康检查。 |
| `getConnectionStatus(req, res)` | 获取 MCP 连接状态。 |
| `createProxyServer()` | 创建并返回 Express HTTP 服务器实例。 |
| `setupRoutes(app, state)` | 注册所有 API 路由（模型、分组、聊天、健康、MCP 等）。 |
| `main()` | 主函数：解析命令行参数、加载配置、校验、初始化状态、创建服务器、启动健康检查、优雅关闭。 |

#### `app.js`（状态与业务逻辑层）

| 函数/对象 | 说明 |
|-----------|------|
| `APP_STATE` | 全局单例状态对象，存储 `models`、`groups`、`activeGroupId`、`currentChain`、`modelStats`、`proxyPort`、`chatStates`、`mcpConnections` 等。 |
| `loadConfig()` | 从 YAML 加载配置，初始化模型、分组、端点、工具、MCP 连接。 |
| `switchGroup(groupId)` | 切换激活分组，切换时更新当前 Chain。 |
| `updateGroup(groupId, name, chain)` | 更新分组信息。 |
| `addGroup(group)` | 添加新分组。 |
| `deleteGroup(groupId)` | 删除分组，清理关联的 MCP 连接与状态。 |
| `setCurrentChain(chain)` | 设置当前激活分组的 Chain。 |
| `getAllChains()` | 获取所有分组的 Chain 映射。 |
| `addToChain(modelId, targetIdx?)` | 向当前 Chain 添加模型。 |
| `removeFromChain(modelId)` | 从当前 Chain 移除模型。 |
| `reorderChain(fromIdx, toIdx)` | 重排当前 Chain。 |
| `recordRequest(modelId, stats)` | 记录请求统计数据。 |
| `getStats(modelId)` | 获取模型统计数据。 |
| `checkMcpConnection(groupId)` | 检查指定分组的 MCP 连接健康状态。 |

#### `config-manager.js`

| 函数 | 说明 |
|------|------|
| `getConfigPath()` | 按优先级查找配置文件路径：`/data/config.yaml`、当前目录 `config.yaml`。 |
| `loadConfig()` | 读取 YAML 并校验配置结构。 |
| `saveConfig(config)` | 将配置对象写回 YAML 文件。 |
| `createDefaultConfig()` | 生成包含示例端点、分组、模型的默认配置。 |

#### `circuit-breaker.js`

| 类/函数 | 说明 |
|----------|------|
| `CircuitBreaker` | 熔断器类，维护 `failureThreshold`、`recoveryTimeout`、`failureCount`、`state`。方法：`canExecute()`、`recordSuccess()`、`recordFailure()`、`getState()`、`reset()`。 |
| `CIRCUIT_BREAKERS` | 单例 Map，以模型 ID 为键存储熔断器实例。 |

#### `stats-manager.js`

| 类/函数 | 说明 |
|----------|------|
| `StatsManager` | 统计管理器，支持内存统计与持久化存储。方法：`recordRequest()`、`getStats()`、`getAllStats()`、`resetStats()`、`getStatsHistory()`、`getPerformanceReport()`。 |
| `statsManager` | 全局单例。 |

#### `log-manager.js`

| 类/函数 | 说明 |
|----------|------|
| `LogManager` | 日志管理器，维护固定长度的日志环缓冲区。方法：`log()`、`getLogs()`、`getLogsByLevel()`、`clearLogs()`、`getLogStats()`。 |
| `logManager` | 全局单例。 |

#### `openrouter.js`

| 类/函数 | 说明 |
|----------|------|
| `OpenRouterClient` | OpenRouter API 客户端。`chatCompletionStream()` 使用 `ReadableStream` 流式读取；`chatCompletion()` 非流式调用；`getModels()` 拉取可用模型；`validateConnection()` 验证连通性。 |
| `openRouterClient` | 全局单例。 |

---

### 4.2 客户端 (`client/src/`)

#### `api.js`

| 方法 | 说明 |
|------|------|
| `API.getModels()` | 获取模型列表。 |
| `API.getGroups()` | 获取分组列表。 |
| `API.getCurrentChain()` | 获取当前分组 Chain。 |
| `API.getAllChains()` | 获取所有分组 Chain。 |
| `API.switchGroup(groupId)` | 切换分组。 |
| `API.addGroup(id, name)` | 新增分组。 |
| `API.renameGroup(oldId, newId, name)` | 重命名分组。 |
| `API.deleteGroup(oldId)` | 删除分组。 |
| `API.setChain(chain)` | 更新当前分组 Chain。 |
| `API.addToChain(modelId, targetIdx?)` | 添加模型到 Chain。 |
| `API.removeFromChain(modelId)` | 从 Chain 移除模型。 |
| `API.reorderChain(fromIdx, toIdx)` | 重排 Chain。 |
| `API.sendMessage(messages, modelOverride, useChain, groupId?)` | 发送聊天消息。 |
| `API.stopChat(chatId)` | 停止指定聊天。 |
| `API.clearChat()` | 清除当前聊天记录。 |
| `API.uploadFile(file)` | 上传文件（图片等）。 |
| `API.getHealth()` | 获取健康状态。 |
| `API.getPort()` | 获取代理端口。 |
| `API.getTools(groupId?)` | 获取工具列表。 |
| `API.addMcpServer(name, endpoint, config?)` | 添加 MCP 服务器。 |
| `API.removeMcpServer(name)` | 删除 MCP 服务器。 |
| `API.checkMcpConnection(name)` | 检查 MCP 连接状态。 |

#### `App.vue`

| 函数/逻辑 | 说明 |
|-----------|------|
| `fetchModels()` | 拉取模型列表并同步到状态。 |
| `fetchGroups()` | 拉取分组列表。 |
| `fetchChain()` | 拉取当前 Chain。 |
| `fetchPort()` | 获取服务端口。 |
| `fetchTools()` | 获取工具列表。 |
| `fetchMcpConnections()` | 获取 MCP 连接状态。 |
| `handleGroupSelect(id)` | 切换分组并刷新 Chain。 |
| `handleAddGroup({ id, name })` | 新增分组。 |
| `handleRename(payload)` / `handleRenameName(payload)` | 重命名分组。 |
| `handleDeleteGroup(payload)` | 删除分组。 |
| `sendChat()` | 发送用户消息到后端，处理流式响应。 |
| `handleFileUpload()` | 处理文件上传与预览。 |
| `openModelEditor(modelId)` | 打开模型编辑器弹窗。 |
| `openMcpManager()` | 打开 MCP 管理器弹窗。 |
| `openToolDrawer()` | 打开工具抽屉。 |

#### `NodeCanvas.vue`

| 函数/逻辑 | 说明 |
|-----------|------|
| `onWheel(e)` | 以鼠标为中心进行画布缩放（0.5x ~ 2x）。 |
| `onCanvasMouseDown/Move/Up()` | 画布空白处平移。 |
| `onNodeDragStart/Drop()` | 节点拖拽排序（画布内重排）。 |
| `onWireDrop()` | 在连线间隙插入模型。 |
| `onDropToCanvas()` | 从模型库拖入模型，或拖出链外实现删除。 |
| `computeInsertIndex()` | 根据鼠标 X 坐标计算最近插入间隙。 |
| `setLibraryDrag(modelId)` | 供 `ModelLibrary` 调用，标记当前拖拽来源为模型库。 |

#### `GroupList.vue`

| 函数 | 说明 |
|------|------|
| `confirmAdd()` | 校验并提交新增分组表单。 |
| `confirmEdit()` | 校验并提交修改分组 ID/名称，支持复制 ID。 |
| `confirmDelete()` | 确认删除分组。 |

#### `ModelLibrary.vue`

| 函数 | 说明 |
|------|------|
| `onDragStart()` | 开始拖拽模型，触发全局 `library-drag-start` 事件供 `NodeCanvas` 响应。 |
| `filteredModels` | 根据名称/ID/域名过滤模型列表。 |
| `getStats(modelId)` | 格式化展示模型调用次数与 Token 统计。 |

---

## 5. 依赖关系

### 5.1 服务端依赖

| 依赖 | 用途 |
|------|------|
| `express` | HTTP 服务器与路由。 |
| `ws` | WebSocket 支持（用于 MCP SSE 传输）。 |
| `yaml` | 解析与生成 YAML 配置文件。 |
| `node-fetch` | HTTP 客户端，用于调用 OpenRouter API 与 MCP 端点。 |
| `cors` | 跨域资源共享中间件。 |
| `node-uuid` / `uuid` | 生成请求唯一 ID。 |

### 5.2 客户端依赖

| 依赖 | 用途 |
|------|------|
| `vue` | 前端框架。 |
| `pinia` | 状态管理。 |
| `pinia-plugin-persistedstate` | Pinia 状态持久化（localStorage）。 |
| `@tabler/icons-vue` | 图标库。 |
| `vite` | 构建工具与开发服务器。 |
| `@vitejs/plugin-vue` | Vite Vue 插件。 |

### 5.3 外部依赖

- **OpenRouter API**：作为统一的 LLM 网关，代理实际模型提供商（如 OpenAI、Anthropic、DeepSeek 等）。
- **MCP Servers**：通过 SSE/WebSocket 协议连接外部 MCP 服务，提供文件系统、数据库、搜索等工具能力。

---

## 6. 项目运行方式

### 6.1 环境要求

- **Node.js**（建议 >= 16.x）
- **pnpm**（monorepo 工作区管理）

### 6.2 安装与启动

```bash
# 1. 安装根依赖与工作区依赖
pnpm install

# 2. 准备配置文件（首次运行前）
# 方式 A：将 server/config.yaml.example 复制为 config.yaml（若存在）
# 方式 B：服务首次启动时会自动生成默认配置
# 支持路径：
#   - /data/config.yaml
#   - ./server/config.yaml

# 3. 启动后端服务
cd server
node index.js
# 或使用 npm 脚本（若 package.json 中定义了 dev 脚本）
# npm run dev

# 4. 启动前端开发服务器（新终端）
cd client
npm run dev
# 默认运行在 http://localhost:5173
```

### 6.3 关键配置说明

配置文件 `config.yaml` 结构示例：

```yaml
endpoints:
  - name: openrouter
    url: https://openrouter.ai/api/v1
    key: YOUR_API_KEY
    models:
      - model_id: gpt-4o
        name: GPT-4o
        display_name: GPT-4o
        endpoint: openrouter
        group: default

groups:
  - id: default
    name: 默认分组
    chain: []
```

- `endpoints`：定义 LLM 提供商端点与可用模型。
- `groups`：定义配置组，每个组包含一个 `chain`（模型调用链路）。
- 服务默认监听端口可通过配置文件或启动参数指定（`proxyPort`）。

### 6.4 API 接口概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/models` | 获取所有模型列表。 |
| GET | `/api/groups` | 获取所有分组。 |
| POST | `/api/groups/add` | 新增分组。 |
| POST | `/api/groups/rename` | 重命名分组。 |
| POST | `/api/groups/delete` | 删除分组。 |
| POST | `/api/group/switch` | 切换激活分组。 |
| POST | `/api/chain` | 更新当前分组 Chain。 |
| POST | `/api/chain/add` | 向 Chain 添加模型。 |
| POST | `/api/chain/remove` | 从 Chain 移除模型。 |
| POST | `/api/chain/reorder` | 重排 Chain。 |
| POST | `/api/chat` | 发起聊天（SSE 流式响应）。 |
| POST | `/api/chat/stop` | 停止聊天。 |
| POST | `/api/chat/clear` | 清除聊天记录。 |
| GET | `/api/health` | 健康检查。 |
| GET | `/api/tools` | 获取可用工具。 |
| POST | `/api/mcp/add` | 添加 MCP 服务器。 |
| POST | `/api/mcp/remove` | 删除 MCP 服务器。 |
| GET | `/api/mcp/status` | 获取 MCP 连接状态。 |

> 注意：前端开发服务器（Vite）通过代理将 `/api` 请求转发到后端（默认 `http://localhost:8093`）。

---

## 7. 目录结构

```
LLMHydra/
├── package.json              # 根工作区配置（pnpm workspace）
├── README.md                 # 项目说明文档
├── CODE_WIKI.md              # 本文件：项目结构化的代码 Wiki
├── server/
│   ├── package.json          # 服务端依赖与脚本
│   ├── index.js              # 服务入口与核心引擎（路由、SSE、LLM、MCP、工具执行）
│   ├── app.js                # 应用状态层（模型、分组、Chain、统计、MCP 连接管理）
│   ├── config-manager.js     # 配置文件读写与默认值生成
│   ├── circuit-breaker.js    # 熔断器实现
│   ├── stats-manager.js      # 请求统计管理
│   ├── log-manager.js        # 日志管理
│   └── openrouter.js         # OpenRouter API 客户端
└── client/
    ├── package.json          # 前端依赖与脚本
    ├── vite.config.js        # Vite 配置（端口 5173，API 代理到 8093）
    └── src/
        ├── main.js           # Vue 应用入口
        ├── App.vue           # 根组件（布局、聊天、配置编排）
        ├── api.js            # 前端 API 统一封装
        └── components/
            ├── NodeCanvas.vue   # 链路可视化画布（拖拽、缩放、连线）
            ├── GroupList.vue    # 配置组管理（增删改查）
            └── ModelLibrary.vue # 模型库（搜索、拖拽、统计展示）
```

---

## 8. 扩展点与设计亮点

1. **多模型 Chain 编排**：通过可视化画布将多个模型串成调用链，前端 `NodeCanvas` 提供拖拽排序、间隙插入、动画反馈。
2. **故障隔离**：服务端内置 `CircuitBreaker`，对持续失败的模型自动熔断，避免拖垮整体服务。
3. **流式代理**：`createOpenRouterStream` 基于 `ReadableStream` 实现低延迟的 LLM 流式响应转发，支持 early stop。
4. **MCP 工具生态**：通过 `executeTool` 与 `createMcpConnection` 接入外部 MCP Server，并支持工具调用的人工审批流程。
5. **状态持久化**：客户端使用 `pinia-plugin-persistedstate` 持久化配置与 UI 状态；服务端将聊天消息持久化到本地文件系统。
6. **可观测性**：`stats-manager` 与 `log-manager` 提供调用统计、历史记录与日志查询能力，便于调试与运维。
