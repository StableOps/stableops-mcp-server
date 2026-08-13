# StableOps MCP Server

[![npm version](https://img.shields.io/npm/v/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![npm downloads](https://img.shields.io/npm/dm/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![License](https://img.shields.io/npm/l/@stableops/mcp-server)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org) [![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org)

[View English README](./README.md)

一个基于 stdio 的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务，让 AI Agent（Claude Desktop、Cursor、VS Code 等）通过受控的工具接口访问 StableOps 支付单、地址、Webhook、收银台、Agent 审计和商户订阅操作。每次工具调用都会经过工作区 action policy 检查。

## 安装

```bash
npm install @stableops/mcp-server
```

需要 Node.js 20 或更高版本。

## 快速开始

设置两个必需的环境变量，启动 stdio 服务：

```bash
export STABLEOPS_API_KEY=sk_...
export STABLEOPS_AGENT_SESSION_ID=session_123

npx stableops-mcp
```

`STABLEOPS_API_KEY` 和 `STABLEOPS_AGENT_SESSION_ID` 是仅有的两个必填项。环境（sandbox / live）由 API Key 自身决定。

## 官方文档

完整的工具清单、MCP host 接入（Claude Desktop、Claude Code、Codex CLI 等）、策略配置和编程用法，请查看官方文档：

**查看完整文档 → https://stableops.dev/zh/docs/agents/mcp-server**

## 可靠性与幂等

Agent 策略和审计请求默认在 30 秒后超时。审计结果写入遇到网络错误、超时、HTTP 429 或 HTTP 5xx 响应时会按指数退避重试；确定性的 HTTP 4xx 响应会立即失败。以编程方式使用时，可以通过 API SDK 的 `timeoutMs` 和 `retry` 客户端选项调整这些默认值。

如果业务操作已经完成，但审计结果暂时无法确认，MCP 服务会在内存中保留结果；再次提交相同工具输入时，只会重试审计写入。这份补偿状态不会在进程重启后保留。创建资源时必须使用稳定且唯一的业务标识，例如 `merchant_order_id`；进程重启后遇到结果不确定的调用，应先核对原操作结果再重试。StableOps 会保证同一组织和环境中的 `merchant_order_id` 唯一。

## License

Apache-2.0
