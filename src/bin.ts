#!/usr/bin/env node
import { runStdio } from './index'

// stdio MCP server 主入口。配置从 env 读取：
//   STABLEOPS_API_URL, STABLEOPS_API_KEY, STABLEOPS_ORG_SLUG,
//   STABLEOPS_ENVIRONMENT, STABLEOPS_AGENT_SESSION_ID
//
// 与 Claude Desktop 或其它 MCP host 集成时：
//   { "command": "stableops-mcp", "env": { ... } }

const sessionId = process.env.STABLEOPS_AGENT_SESSION_ID
if (!sessionId) {
  process.stderr.write('STABLEOPS_AGENT_SESSION_ID is required\n')
  process.exit(2)
}

runStdio({
  apiKey: process.env.STABLEOPS_API_KEY,
  baseUrl: process.env.STABLEOPS_API_URL,
  organizationSlug: process.env.STABLEOPS_ORG_SLUG,
  environment:
    (process.env.STABLEOPS_ENVIRONMENT as 'sandbox' | 'live' | undefined) ?? 'sandbox',
  agentSessionId: sessionId,
}).catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`)
  process.exit(1)
})
