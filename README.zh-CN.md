# StableOps MCP Server

将 StableOps SDK 作为策略管控的 AI Agent 工具集暴露的 stdio MCP 服务。

[View English README](./README.md)

本服务是一个 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) stdio 服务，让 AI Agent（Claude Desktop、Cursor、VS Code 等）通过受控的工具接口访问 StableOps 支付操作。

所有操作都受工作区策略管控——只读工具（查询订单、事件、Webhook 投递）通常自动放行，写工具（创建付款单）需要经过 StableOps Dashboard 的人工审批。

## 功能

- **只读工具**：`get_order`、`list_events`、`list_webhook_deliveries`——查询 StableOps 数据，没有副作用。
- **写工具**：`create_payment_order`——受策略控制，根据工作区配置可能需要人工审批。
- **审批工具**：`request_action_approval`——在审批队列注册自定义操作，等待人工确认。
- **策略执行**：每次工具调用在执行前都会经过工作区 action policy 检查。
- **幂等写操作**：付款单创建使用 action ID 作为幂等键，防止重复。
- **审计日志**：所有工具执行记录都会写入工作区审计日志。

## 环境要求

- Node.js 18 或更高版本。
- StableOps API Key。
- Agent Session ID（由 StableOps Dashboard 或 API 生成）。

## 安装

```bash
pnpm add @stableops/mcp-server
```

```bash
npm install @stableops/mcp-server
```

```bash
yarn add @stableops/mcp-server
```

## 快速开始

### 独立运行

```bash
export STABLEOPS_API_KEY=sk_...
export STABLEOPS_ORG_SLUG=demo
export STABLEOPS_ENVIRONMENT=sandbox
export STABLEOPS_AGENT_SESSION_ID=session_123

npx stableops-mcp
```

### Claude Desktop

将以下配置添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "stableops": {
      "command": "stableops-mcp",
      "env": {
        "STABLEOPS_API_KEY": "sk_...",
        "STABLEOPS_ORG_SLUG": "demo",
        "STABLEOPS_ENVIRONMENT": "sandbox",
        "STABLEOPS_AGENT_SESSION_ID": "session_123"
      }
    }
  }
}
```

### 编程使用

```ts
import { createAgentToolkitServer } from '@stableops/mcp-server'

const server = createAgentToolkitServer({
  apiKey: process.env.STABLEOPS_API_KEY!,
  organizationSlug: 'demo',
  environment: 'sandbox',
  agentSessionId: 'session_123',
})
// 通过 MCP SDK 连接传输层（stdio、SSE 等）
```

## 可用工具

| 工具 | 描述 | 权限 |
|---|---|---|
| `get_order` | 按 ID 查询单个付款单 | 只读（自动放行） |
| `list_events` | 查询标准化的链上转账事件 | 只读（自动放行） |
| `list_webhook_deliveries` | 查看最近的 Webhook 投递记录 | 只读（自动放行） |
| `create_payment_order` | 创建新的付款单 | 策略控制（可能需要审批） |
| `request_action_approval` | 注册自定义操作等待人工确认 | 始终需要审批 |

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `STABLEOPS_API_KEY` | 是 | StableOps API 密钥 |
| `STABLEOPS_AGENT_SESSION_ID` | 是 | 唯一会话标识（从 Dashboard 获取） |
| `STABLEOPS_API_URL` | 否 | 自定义 API 地址（默认 `http://localhost:3001`） |
| `STABLEOPS_ORG_SLUG` | 否 | 组织标识（默认 `demo`） |
| `STABLEOPS_ENVIRONMENT` | 否 | `sandbox` 或 `live`（默认 `sandbox`） |

## 官方文档

完整接入指南、API Reference 和策略配置说明，请查看官方文档：

- 中文文档：https://stableops.dev/zh/docs
- English docs：https://stableops.dev/en/docs

## License

Apache-2.0
