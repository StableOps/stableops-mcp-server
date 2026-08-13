# StableOps MCP Server

[![npm version](https://img.shields.io/npm/v/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![npm downloads](https://img.shields.io/npm/dm/@stableops/mcp-server)](https://www.npmjs.com/package/@stableops/mcp-server) [![License](https://img.shields.io/npm/l/@stableops/mcp-server)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org) [![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org)

[中文文档](./README.zh-CN.md)

A stdio [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI agents (Claude Desktop, Cursor, VS Code, etc.) policy-scoped access to StableOps payment, address, webhook, checkout, agent-audit, and merchant-subscription operations. Every tool call is gated by the workspace action policy.

## Installation

```bash
npm install @stableops/mcp-server
```

Requires Node.js 20 or newer.

## Quick Start

Set the two required environment variables and start the stdio server:

```bash
export STABLEOPS_API_KEY=sk_...
export STABLEOPS_AGENT_SESSION_ID=session_123

npx stableops-mcp
```

`STABLEOPS_API_KEY` and `STABLEOPS_AGENT_SESSION_ID` are the only required settings. The environment (sandbox / live) is determined by the API key itself.

## Documentation

The full tool reference, MCP host setup (Claude Desktop, Claude Code, Codex CLI, and more), policy configuration, and programmatic usage live in the docs:

**Read the full documentation → https://stableops.dev/en/docs/agents/mcp-server**

## Reliability and idempotency

Agent policy and audit requests time out after 30 seconds by default. Audit-result writes retry network errors, timeouts, HTTP 429, and HTTP 5xx responses with exponential backoff; deterministic HTTP 4xx responses fail immediately. Programmatic users can override these defaults with the API SDK `timeoutMs` and `retry` client options.

If an operation finishes but its audit result cannot be confirmed, the MCP server keeps the result in memory and retries only the audit write when the same tool input is submitted again. This compensation state does not survive a process restart. Always use a stable, unique business identifier such as `merchant_order_id` for create operations, and reconcile an uncertain result before retrying after a restart. StableOps enforces `merchant_order_id` uniqueness within an organization and environment.

## License

Apache-2.0
