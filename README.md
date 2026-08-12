# LLMHydra 🐉

> 多端点自动故障转移的 LLM 代理网关 —— 一个端点挂了，下一个立刻接上。

LLMHydra 是一个轻量级 OpenAI 兼容的 LLM 代理服务，以**节点画布**方式进行可视化编排：将多个模型端点按顺序组成一条"重试链"，当链上的某个端点出错时自动切换到下一个端点，实现高可用接入，同时对外暴露统一的 OpenAI 兼容 API。

## ✨ 特性

- **多端点自动故障转移**：401/403、5xx 错误、连接失败、超时自动切换下一个端点
- **SSE 流式透传**：完整支持 `stream: true` 的流式响应，连接建立后不切换端点
- **节点画布 UI**：ComfyUI 风格的拖拽编排界面，从模型库拖入节点、拖拽排序、实时保存
- **配置组**：每个配置组拥有独立 ID（即调用时的 `model` 字段），包含一条按顺序重试的模型链
- **独立端点配置**：每个模型独立配置 URL、API Key、超时时间、SSL 校验、thinking 开关
- **兼容旧配置**：自动迁移旧的 `upstream` 单端点配置为 `endpoints` 结构
- **JSON 实时存储**：所有修改立即落盘至 `proxy_config.json`，无需数据库
- **内建测试工具**：配置模型中可直接对端点发起连通性测试

## 🏗 架构

```
┌─────────────┐      OpenAI 兼容 API       ┌──────────────────────────┐
│   AI 工具    │ ──────────────────────────► │        LLMHydra           │
│ (Trae/Cursor│     POST /v1/chat/completions │  ┌────────────────────┐  │
│ /Cherry...) │   {"model":"配置组ID",...}     │  │ 重试链 (chain)      │  │
└─────────────┘                             │  │ 模型 A ─► 模型 B ─►  │  │
                                            │  │ 模型 C (依次重试)     │  │
                                            │  └────────────────────┘  │
                                            │        │                 │
                                            │        ▼                 │
                                            │  ┌────────────────────┐  │
                                            │  │ 管理 API (/api/*)   │  │
                                            │  │ + 节点画布 Web UI   │  │
                                            │  └────────────────────┘  │
                                            └──────────────────────────┘
```

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+（项目使用 pnpm workspace）

### 安装与启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发环境（前端 + 后端）
pnpm dev
```

- 管理面板：<http://localhost:5173>
- 代理服务：<http://localhost:8093>（端口可在面板中修改）

> ⚠️ 首次使用请先通过管理面板添加模型和配置组。配置保存在 `proxy_config.json`（该文件包含 API Key，已加入 `.gitignore`，不会被提交）。

## 🎮 使用方式

### 1. 添加模型

在模型库区域添加模型，填写：

| 字段 | 说明 |
|---|---|
| 显示名称 | 仅用于 UI 展示 |
| 模型 ID | 调用上游 API 时使用的实际模型标识（如 `deepseek-chat`） |
| 端点 URL | 上游 API 地址，如 `https://api.deepseek.com/v1` |
| API Key | 该端点的密钥（可选） |
| 超时时间 | 端点为 30 秒，超出自动切换（默认 30s） |
| Thinking | 是否注入思考模式参数 |

### 2. 创建配置组

创建配置组时自定义组 ID（仅允许中英文、数字和 `-`），该 ID 就是对外调用时的 `model` 字段值。

### 3. 编排重试链

从模型库**拖拽模型**到画布中，按顺序排列成重试链（链条可拖拽排序、可移除）。画布中的所有操作实时保存。

### 4. 接入 AI 工具

在 AI 工具（Trae / Cursor / Cherry Studio 等）中配置：

```
Base URL  : http://localhost:8093
Model     : <配置组 ID>
Api Key   : 任意值（可留空）
```

调用示例：

```bash
curl http://localhost:8093/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

支持 `/v1/chat/completions` 与 `/chat/completions` 两种路径；所有非 `/api/*` 的请求自动代理到上游。

## 🔑 故障转移规则

| 情况 | 是否切换 |
|---|---|
| 4xx 错误（除 401/403） | ❌ 不切换，直接返回错误 |
| 401 / 403 认证错误 | ✅ 切换 |
| 5xx 服务端错误 | ✅ 切换 |
| 连接失败 / 超时（默认 30s） | ✅ 切换 |
| SSE 流已建立 | ❌ 不切换（连接已建立） |

## 📡 管理 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 获取整体配置 |
| GET | `/api/groups` | 获取所有配置组 |
| POST | `/api/groups` | 新增配置组 |
| PUT | `/api/groups/:id` | 更新配置组（名称 / 链） |
| DELETE | `/api/groups/:id` | 删除配置组 |
| GET | `/api/models` | 获取所有模型 |
| POST | `/api/models` | 新增模型 |
| PUT | `/api/models/:id` | 更新模型 |
| DELETE | `/api/models/:id` | 删除模型 |
| POST | `/api/models/test` | 测试模型端点连通性 |
| GET | `/api/circuit-breaker` | 获取熔断器状态 |
| PUT | `/api/config/port` | 修改监听端口 |
| POST | `/api/restart` | 重启服务 |

## 📁 项目结构

```
├── client/            # Vue 3 + Vite 前端（节点画布管理面板）
│   └── src/
│       ├── App.vue
│       └── components/
│           ├── NodeCanvas.vue        # 节点画布（拖拽编排）
│           ├── ModelLibrary.vue      # 模型库
│           ├── GroupList.vue         # 配置组列表
│           ├── ModelEditor.vue       # 模型编辑
│           ├── ApiReference.vue      # 接入说明 / API 文档
│           └── ModelEditorModal.vue  # 编辑弹窗
├── server/            # Node.js + Express 服务端
│   ├── index.js       # 入口
│   ├── app.js         # 路由与代理中间件
│   ├── config-manager.js  # 配置读写（JSON 实时存储）
│   └── circuit-breaker.js  # 熔断器
├── proxy_config.json  # 运行时配置（含 API Key，不入库）
└── package.json       # pnpm workspace 根
```

## 🛠 技术栈

- **前端**：Vue 3、Vite
- **后端**：Node.js、Express
- **包管理**：pnpm workspace
- **存储**：JSON 文件实时落盘