# StableOps MCP Server

[![npm version](https://img.shields.io/npm/v/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![npm downloads](https://img.shields.io/npm/dm/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![License](https://img.shields.io/npm/l/@stableops/mcp-server)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org) [![Node](https://img.shields.io/badge/Node-%3E%3D18-339933)](https://nodejs.org)

[View English README](./README.md)

一个基于 stdio 的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 服务，让 AI Agent（Claude Desktop、Cursor、VS Code 等）通过受控的工具接口访问 StableOps 支付单、地址、Webhook、收银台、Agent 审计和商户订阅操作。每次工具调用都会经过工作区 action policy 检查。

## 安装

```bash
npm install @stableops/mcp-server
```

需要 Node.js 18 或更高版本。

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

## License

Apache-2.0
