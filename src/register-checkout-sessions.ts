import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import { AssetSchema, ChainIdSchema, PAYMENT_ORDER_OUTPUT } from './schemas'
import { AgentToolName } from './tool-names'
import type { AgentToolkitOptions } from './toolkit'
import { withPolicyGate } from './toolkit'

const CHECKOUT_SESSION_OUTPUT = {
  id: z.string(),
  clientSecret: z.string().optional(),
  url: z.string().optional(),
  status: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  successUrl: z.string().nullable(),
  cancelUrl: z.string().nullable(),
  walletConnectProjectId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  paymentOrder: z.object(PAYMENT_ORDER_OUTPUT),
}

export function registerCheckoutSessionTools(
  server: McpServer,
  client: StableOps,
  options: AgentToolkitOptions,
) {
  server.registerTool(
    AgentToolName.CREATE_CHECKOUT_SESSION,
    {
      title: 'Create checkout session',
      description:
        'Create a hosted checkout session and backing payment order. Subject to workspace policy gating.',
      inputSchema: {
        merchant_order_id: z.string().min(1).max(128),
        amount: z.string(),
        amount_mode: z.enum(['exact', 'auto']).optional(),
        accepted_assets: z.array(z.object({ chain: ChainIdSchema, asset: AssetSchema })).min(1),
        expires_at: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        success_url: z.string().optional(),
        cancel_url: z.string().optional(),
        walletconnect_project_id: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: CHECKOUT_SESSION_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CREATE_CHECKOUT_SESSION, args, async (actionId) =>
        client.checkoutSessions.create(
          {
            merchantOrderId: args.merchant_order_id,
            amount: args.amount,
            amountMode: args.amount_mode,
            acceptedAssets: args.accepted_assets,
            expiresAt: args.expires_at,
            title: args.title,
            description: args.description,
            successUrl: args.success_url,
            cancelUrl: args.cancel_url,
            walletConnectProjectId: args.walletconnect_project_id,
            metadata: args.metadata,
          },
          { idempotencyKey: actionId },
        ),
      ),
  )
}
