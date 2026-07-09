import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import { COMMON_LIST_INPUT, WEBHOOK_DELIVERY_OUTPUT } from './schemas'
import { AgentToolName } from './tool-names'
import type { AgentToolkitOptions } from './toolkit'
import { withPolicyGate } from './toolkit'

const WEBHOOK_ENDPOINT_OUTPUT = {
  id: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  enabledEvents: z.array(z.string()),
  redactMetadata: z.boolean(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
  secret: z.string().optional(),
}

const REPLAY_DELIVERY_OUTPUT = { deliveryId: z.string() }

export function registerWebhookTools(
  server: McpServer,
  client: StableOps,
  options: AgentToolkitOptions,
) {
  server.registerTool(
    AgentToolName.LIST_WEBHOOK_ENDPOINTS,
    {
      title: 'List webhook endpoints',
      description: 'Read configured webhook endpoints.',
      inputSchema: {},
      outputSchema: { items: z.array(z.object(WEBHOOK_ENDPOINT_OUTPUT)) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_WEBHOOK_ENDPOINTS, args, async () => ({
        items: await client.webhooks.listEndpoints(),
      })),
  )

  server.registerTool(
    AgentToolName.CREATE_WEBHOOK_ENDPOINT,
    {
      title: 'Create webhook endpoint',
      description: 'Create a webhook endpoint.',
      inputSchema: {
        url: z.string().url(),
        description: z.string().optional(),
        enabled_events: z.array(z.string()).optional(),
        redact_metadata: z.boolean().optional(),
      },
      outputSchema: WEBHOOK_ENDPOINT_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CREATE_WEBHOOK_ENDPOINT, args, async () =>
        client.webhooks.createEndpoint({
          url: args.url,
          description: args.description,
          enabledEvents: args.enabled_events as never,
          redactMetadata: args.redact_metadata,
        }),
      ),
  )

  server.registerTool(
    AgentToolName.UPDATE_WEBHOOK_ENDPOINT,
    {
      title: 'Update webhook endpoint',
      description: 'Update webhook endpoint settings.',
      inputSchema: {
        endpoint_id: z.string().min(1),
        description: z.string().nullable().optional(),
        enabled_events: z.array(z.string()).optional(),
        redact_metadata: z.boolean().optional(),
      },
      outputSchema: WEBHOOK_ENDPOINT_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.UPDATE_WEBHOOK_ENDPOINT, args, async () =>
        client.webhooks.updateEndpoint(args.endpoint_id, {
          description: args.description,
          enabledEvents: args.enabled_events as never,
          redactMetadata: args.redact_metadata,
        }),
      ),
  )

  server.registerTool(
    AgentToolName.ROTATE_WEBHOOK_SECRET,
    {
      title: 'Rotate webhook secret',
      description: 'Rotate the signing secret for a webhook endpoint.',
      inputSchema: { endpoint_id: z.string().min(1) },
      outputSchema: WEBHOOK_ENDPOINT_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.ROTATE_WEBHOOK_SECRET, args, async () =>
        client.webhooks.rotateSecret(args.endpoint_id),
      ),
  )

  server.registerTool(
    AgentToolName.LIST_WEBHOOK_DELIVERIES,
    {
      title: 'List webhook deliveries',
      description: 'Read the recent webhook deliveries (read-only).',
      inputSchema: {
        status: z.string().optional(),
        endpoint_id: z.string().optional(),
        payment_order_id: z.string().optional(),
        ...COMMON_LIST_INPUT,
      },
      outputSchema: { items: z.array(WEBHOOK_DELIVERY_OUTPUT) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_WEBHOOK_DELIVERIES, args, async () => ({
        items: await client.webhooks.listDeliveries({
          status: args.status as never,
          endpointId: args.endpoint_id,
          paymentOrderId: args.payment_order_id,
          limit: args.limit,
        }),
      })),
  )

  server.registerTool(
    AgentToolName.REPLAY_WEBHOOK_DELIVERY,
    {
      title: 'Replay webhook delivery',
      description: 'Replay a single webhook delivery.',
      inputSchema: { delivery_id: z.string().min(1) },
      outputSchema: REPLAY_DELIVERY_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.REPLAY_WEBHOOK_DELIVERY, args, async () =>
        client.webhooks.replayDelivery(args.delivery_id),
      ),
  )

  server.registerTool(
    AgentToolName.REPLAY_WEBHOOK_DEAD_LETTERS,
    {
      title: 'Replay dead-letter webhook deliveries',
      description: 'Replay webhook deliveries currently in the dead-letter queue.',
      inputSchema: { endpoint_id: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
      outputSchema: {
        replayed: z.number(),
        items: z.array(z.object({ originalId: z.string(), deliveryId: z.string() })),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.REPLAY_WEBHOOK_DEAD_LETTERS, args, async () =>
        client.webhooks.replayDeadLetters({ endpointId: args.endpoint_id, limit: args.limit }),
      ),
  )
}
