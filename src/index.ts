import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import { registerAgentTools } from './register-agents'
import { registerAddressTools } from './register-addresses'
import { registerCheckoutSessionTools } from './register-checkout-sessions'
import { registerMerchantSubscriptionTools } from './register-merchant-subscriptions'
import { registerPaymentOrderTools } from './register-payment-orders'
import { registerWebhookTools } from './register-webhooks'
import { AgentToolName } from './tool-names'
import {
  errorFromException,
  ok,
  requestAction,
  type AgentToolkitOptions,
} from './toolkit'

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8'),
) as { version: string }

export { AgentToolName } from './tool-names'
export type { AgentToolName as AgentToolNameValue } from './tool-names'
export type { AgentToolkitOptions } from './toolkit'

// 把 SDK 的资源 API 暴露成 MCP 工具。所有常规工具先登记 /v1/agent/actions：
// policy 自动放行则执行并写回 executed；需要人工审批则返回 pending_approval。
export function createAgentToolkitServer(options: AgentToolkitOptions): McpServer {
  const client = new StableOps({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  })

  const server = new McpServer({ name: 'stableops', version: packageJson.version })

  registerPaymentOrderTools(server, client, options)
  registerCheckoutSessionTools(server, client, options)
  registerAddressTools(server, client, options)
  registerWebhookTools(server, client, options)
  registerMerchantSubscriptionTools(server, client, options)
  registerAgentTools(server, client, options)

  server.registerTool(
    AgentToolName.REQUEST_ACTION_APPROVAL,
    {
      title: 'Request human approval',
      description:
        'Register a sensitive action with the workspace approval queue. Use whenever you want a human to sign off before executing something outside the toolkit.',
      inputSchema: {
        summary: z.string().min(1).max(512),
        payload: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: {
        action_id: z.string(),
        decision: z.string(),
        instructions: z.string(),
      },
    },
    async (args) => {
      try {
        const result = await requestAction(options, {
          tool: AgentToolName.REQUEST_ACTION_APPROVAL,
          input: args,
        })
        // 这一个 tool 总是返回 pending_approval（除非 policy 关闭了审批），让人类去处理。
        return ok({
          action_id: result.actionId,
          decision: result.decision,
          instructions:
            result.decision === 'pending_approval'
              ? 'Approval requested. Wait for operator decision before continuing.'
              : 'Approval auto-granted. The operator will see the action in audit logs.',
        })
      } catch (err) {
        return errorFromException(err)
      }
    },
  )

  return server
}

export async function runStdio(options: AgentToolkitOptions): Promise<void> {
  const server = createAgentToolkitServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
