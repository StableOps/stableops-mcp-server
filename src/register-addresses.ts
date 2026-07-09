import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import { ChainIdSchema } from './schemas'
import { AgentToolName } from './tool-names'
import type { AgentToolkitOptions } from './toolkit'
import { withPolicyGate } from './toolkit'

const ADDRESS_POOL_OUTPUT = z.object({
  chain: z.string(),
  available: z.number(),
  allocated: z.number(),
  total: z.number(),
  threshold: z.number(),
})

const ADDRESS_OUTPUT = z.object({
  id: z.string(),
  chain: z.string(),
  address: z.string(),
  label: z.string().nullable(),
  mode: z.string(),
  status: z.string(),
  created_at: z.string(),
})

export function registerAddressTools(
  server: McpServer,
  client: StableOps,
  options: AgentToolkitOptions,
) {
  server.registerTool(
    AgentToolName.GET_ADDRESS_POOLS,
    {
      title: 'Get address pools',
      description: 'Read address pool capacity by chain.',
      inputSchema: {},
      outputSchema: { pools: z.array(ADDRESS_POOL_OUTPUT) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_ADDRESS_POOLS, args, async () => ({
        pools: await client.addresses.getPools(),
      })),
  )

  server.registerTool(
    AgentToolName.LIST_ADDRESSES,
    {
      title: 'List addresses',
      description: 'Read imported addresses.',
      inputSchema: {
        chain: ChainIdSchema.optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: {
        items: z.array(ADDRESS_OUTPUT),
        has_more: z.boolean(),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_ADDRESSES, args, async () =>
        client.addresses.list({
          chain: args.chain,
          status: args.status as never,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  )

  server.registerTool(
    AgentToolName.IMPORT_ADDRESSES,
    {
      title: 'Import addresses',
      description: 'Import externally managed receiving addresses.',
      inputSchema: {
        chain: ChainIdSchema,
        addresses: z.array(z.string().min(1)).min(1),
        label: z.string().optional(),
        mode: z.enum(['single', 'shared']).optional(),
      },
      outputSchema: {
        imported: z.number(),
        addresses: z.array(ADDRESS_OUTPUT),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.IMPORT_ADDRESSES, args, async () =>
        client.addresses.import({
          chain: args.chain,
          addresses: args.addresses,
          label: args.label,
          mode: args.mode,
        }),
      ),
  )

  server.registerTool(
    AgentToolName.UPDATE_ADDRESS,
    {
      title: 'Update address',
      description: 'Update an imported address label, mode, or status.',
      inputSchema: {
        id: z.string().min(1),
        label: z.string().nullable().optional(),
        mode: z.enum(['single', 'shared']).optional(),
        status: z.enum(['available', 'reserved', 'disabled']).optional(),
      },
      outputSchema: ADDRESS_OUTPUT.shape,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.UPDATE_ADDRESS, args, async () =>
        client.addresses.update(args.id, {
          label: args.label,
          mode: args.mode,
          status: args.status,
        }),
      ),
  )

  server.registerTool(
    AgentToolName.REMOVE_ADDRESS,
    {
      title: 'Remove address',
      description: 'Remove an imported address.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: { success: z.boolean() },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.REMOVE_ADDRESS, args, async () =>
        client.addresses.remove(args.id),
      ),
  )
}
