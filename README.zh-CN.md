# StableOps MCP Server

[![npm version](https://img.shields.io/npm/v/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![npm downloads](https://img.shields.io/npm/dm/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![License](https://img.shields.io/npm/l/@stableops/mcp-server)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org) [![Node](https://img.shields.io/badge/Node-%3E%3D18-339933)](https://nodejs.org)

[View English README](./README.md)

本服务是一个 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) stdio 服务，让 AI Agent（Claude Desktop、Cursor、VS Code 等）通过受控的工具接口访问 StableOps 支付单、地址、Webhook、收银台、Agent 审计和商户订阅操作。

所有操作都受工作区策略管控。只读工具通常自动放行，写工具需要经过 StableOps Dashboard 的人工审批或显式白名单配置。

## 功能

- **支付单工具**：列出、查询、创建和取消支付单。
- **地址工具**：查询地址池、列出地址、导入地址、更新地址元数据和移除地址。
- **Webhook 工具**：管理端点、轮换密钥、查询投递、重放投递或死信。
- **收银台工具**：创建托管收银台 Session。
- **商户订阅工具**：管理套餐、订阅、账单、订阅设置和 Portal 会话。
- **Agent 审计工具**：列出会话、查询策略、查询动作，以及登记自定义审批请求。
- **策略执行**：每次工具调用在执行前都会经过工作区 action policy 检查。
- **幂等写操作**：支付单和收银台 Session 创建使用 action ID 作为幂等键，防止重复。
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
export STABLEOPS_ENVIRONMENT=sandbox
export STABLEOPS_AGENT_SESSION_ID=session_123

npx stableops-mcp
```

### Claude Code

将以下配置添加到 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "stableops": {
      "command": "stableops-mcp",
      "env": {
        "STABLEOPS_API_KEY": "sk_...",
        "STABLEOPS_ENVIRONMENT": "sandbox",
        "STABLEOPS_AGENT_SESSION_ID": "session_123"
      }
    }
  }
}
```

### Codex CLI

将以下配置添加到 `~/.codex/config.json`：

```json
{
  "mcpServers": {
    "stableops": {
      "command": "stableops-mcp",
      "env": {
        "STABLEOPS_API_KEY": "sk_...",
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
  agentSessionId: 'session_123',
})
// 通过 MCP SDK 连接传输层（stdio、SSE 等）
```

## 可用工具

工具按资源族分组。所有工具都会先调用 `/v1/agent/actions`；只读工具通常自动放行，写工具受 `allowed_tools` 和 `require_approval` 控制。

| 资源族 | 工具 |
| ------ | ---- |
| Payment Orders | `list_payment_orders`, `get_order`, `create_payment_order`, `cancel_payment_order` |
| Addresses | `get_address_pools`, `list_addresses`, `import_addresses`, `update_address`, `remove_address` |
| Webhooks | `list_webhook_endpoints`, `create_webhook_endpoint`, `update_webhook_endpoint`, `rotate_webhook_secret`, `list_webhook_deliveries`, `replay_webhook_delivery`, `replay_webhook_dead_letters` |
| Checkout Sessions | `create_checkout_session` |
| Agents | `list_agent_sessions`, `get_agent_policy`, `list_agent_actions`, `request_action_approval` |
| Merchant Subscriptions | `list_merchant_plans`, `create_merchant_plan`, `update_merchant_plan`, `delete_merchant_plan`, `create_merchant_subscription`, `list_merchant_subscriptions`, `get_merchant_subscription`, `get_merchant_subscription_by_user`, `change_merchant_subscription_plan`, `cancel_merchant_subscription`, `resume_merchant_subscription`, `list_merchant_invoices`, `get_merchant_invoice`, `pay_merchant_invoice`, `get_merchant_invoice_payment_status`, `get_merchant_subscription_settings`, `update_merchant_subscription_settings`, `create_merchant_portal_session`, `revoke_merchant_portal_session` |

`request_action_approval` 是兜底审批/审计登记工具。它会把自定义动作放入人工审批流，但本身不会执行 StableOps API 操作。Agents 资源族刻意不暴露策略更新、动作批准/拒绝、Session 吊销等自提权操作。

## 环境变量

| 变量                         | 必填 | 说明                                            |
| ---------------------------- | ---- | ----------------------------------------------- |
| `STABLEOPS_API_KEY`          | 是   | StableOps API 密钥                              |
| `STABLEOPS_AGENT_SESSION_ID` | 是   | 唯一会话标识（从 Dashboard 获取）               |
| `STABLEOPS_API_URL`          | 否   | 自定义 API 地址（默认 `http://localhost:3001`） |
| `STABLEOPS_ENVIRONMENT`      | 否   | `sandbox` 或 `live`（默认 `sandbox`）           |

## 官方文档

完整接入指南、API Reference 和策略配置说明，请查看官方文档：

- 中文文档：https://stableops.dev/zh/docs
- English docs：https://stableops.dev/en/docs

## License

Apache-2.0
