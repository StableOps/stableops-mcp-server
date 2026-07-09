import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import {
  AssetSchema,
  ChainIdSchema,
  PAYMENT_ORDER_OUTPUT,
  TIMELINE_ENTRY_OUTPUT,
} from './schemas'
import { AgentToolName } from './tool-names'
import type { AgentToolkitOptions } from './toolkit'
import { withPolicyGate } from './toolkit'

export function registerPaymentOrderTools(
  server: McpServer,
  client: StableOps,
  options: AgentToolkitOptions,
) {
  server.registerTool(
    AgentToolName.GET_ORDER,
    {
      title: 'Get payment order',
      description: 'Look up a single payment order by id (read-only).',
      inputSchema: { id: z.string().min(1) },
      outputSchema: {
        ...PAYMENT_ORDER_OUTPUT,
        timeline: z.array(TIMELINE_ENTRY_OUTPUT),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_ORDER, args, async () =>
        client.paymentOrders.retrieve(args.id),
      ),
  )

  server.registerTool(
    AgentToolName.LIST_PAYMENT_ORDERS,
    {
      title: 'List payment orders',
      description: 'Read recent payment orders.',
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      outputSchema: { items: z.array(z.object(PAYMENT_ORDER_OUTPUT)) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_PAYMENT_ORDERS, args, async () => ({
        items: await client.paymentOrders.list({
          status: args.status as never,
          limit: args.limit,
        }),
      })),
  )

  server.registerTool(
    AgentToolName.CREATE_PAYMENT_ORDER,
    {
      title: 'Create a payment order',
      description: 'Open a new payment order. Subject to approval gating in the workspace policy.',
      inputSchema: {
        merchant_order_id: z.string().min(1).max(128),
        amount: z.string(),
        amount_mode: z.enum(['exact', 'auto']).optional(),
        accepted_assets: z.array(z.object({ chain: ChainIdSchema, asset: AssetSchema })).min(1),
        expires_at: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: PAYMENT_ORDER_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CREATE_PAYMENT_ORDER, args, async (actionId) =>
        client.paymentOrders.create(
          {
            merchantOrderId: args.merchant_order_id,
            amount: args.amount,
            amountMode: args.amount_mode,
            acceptedAssets: args.accepted_assets,
            expiresAt: args.expires_at,
            metadata: args.metadata,
          },
          { idempotencyKey: actionId },
        ),
      ),
  )

  server.registerTool(
    AgentToolName.CANCEL_PAYMENT_ORDER,
    {
      title: 'Cancel payment order',
      description: 'Cancel an existing payment order.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: PAYMENT_ORDER_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CANCEL_PAYMENT_ORDER, args, async () =>
        client.paymentOrders.cancel(args.id),
      ),
  )
}
