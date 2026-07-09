import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import { AGENT_ACTION_OUTPUT, AGENT_POLICY_OUTPUT } from './schemas'
import { AgentToolName } from './tool-names'
import type { AgentToolkitOptions } from './toolkit'
import { withPolicyGate } from './toolkit'

const AGENT_SESSION_OUTPUT = z.object({
  id: z.string(),
  label: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
})

export function registerAgentTools(
  server: McpServer,
  client: StableOps,
  options: AgentToolkitOptions,
) {
  server.registerTool(
    AgentToolName.LIST_AGENT_SESSIONS,
    {
      title: 'List agent sessions',
      description: 'Read agent sessions for the workspace.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: { items: z.array(AGENT_SESSION_OUTPUT), has_more: z.boolean() },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_AGENT_SESSIONS, args, async () =>
        client.agents.listSessions({ limit: args.limit, offset: args.offset }),
      ),
  )

  server.registerTool(
    AgentToolName.GET_AGENT_POLICY,
    {
      title: 'Get agent policy',
      description: 'Read the workspace agent policy (read-only).',
      inputSchema: {},
      outputSchema: AGENT_POLICY_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_AGENT_POLICY, args, async () =>
        client.agents.getPolicy(),
      ),
  )

  server.registerTool(
    AgentToolName.LIST_AGENT_ACTIONS,
    {
      title: 'List agent actions',
      description: 'Read agent action audit records (read-only).',
      inputSchema: {
        session_id: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: {
        items: z.array(AGENT_ACTION_OUTPUT),
        has_more: z.boolean(),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_AGENT_ACTIONS, args, async () =>
        client.agents.listActions({
          sessionId: args.session_id,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  )
}
