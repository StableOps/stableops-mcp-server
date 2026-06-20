import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  StableOps,
  StableOpsError,
  type ClientOptions,
} from '@stableops/api-sdk'
import { z } from 'zod'

// 工具名 / 链 / 资产枚举内联在此，避免对内部 workspace 包 @stableops/shared 的依赖
// （mcp-server 是对外发布产物，必须独立可装）。如果上游枚举扩充，请同步更新这里。
export const AgentToolName = {
  GET_ORDER: 'get_order',
  LIST_EVENTS: 'list_events',
  LIST_WEBHOOK_DELIVERIES: 'list_webhook_deliveries',
  CREATE_PAYMENT_ORDER: 'create_payment_order',
  REQUEST_ACTION_APPROVAL: 'request_action_approval',
} as const

export type AgentToolName = (typeof AgentToolName)[keyof typeof AgentToolName]

const ChainIdSchema = z.enum([
  'ethereum',
  'base',
  'base-sepolia',
  'arbitrum',
  'polygon',
  'tron',
  'solana',
  'ethereum-sepolia',
  'arbitrum-sepolia',
  'polygon-amoy',
  'solana-devnet',
  'tron-nile',
])

const AssetSchema = z.enum(['USDC', 'USDT'])

// 把 SDK 的资源 API 暴露成 MCP 工具。规则：
//   - 只读工具（get_order / list_events / list_webhook_deliveries）默认可用。
//   - 写工具（create_payment_order）调用前先打 /v1/agent/actions 请求授权；
//     若 policy 要求人工审批，则返回 pending_approval，agent 必须等待。
//   - request_action_approval 也走同一接口，提供给 agent 主动登记敏感动作。
//
// 这种模式让 agent 自身既无法绕过 policy，也无法直接发送链上付款——
// 即使受到 prompt injection，最多落到 dashboard 的待审队列。

export type AgentToolkitOptions = ClientOptions & {
  agentSessionId: string
  // 单元测试便于注入 fetch。
  fetch?: typeof fetch
}

const COMMON_LIST_INPUT = {
  limit: z.number().int().min(1).max(200).optional(),
}

// --- 输出 schema（MCP outputSchema 用 raw shape；字段名为 SDK fromWire 后的 camelCase，
//     即 ok() 序列化进 structuredContent 的形态）。枚举一律用 z.string() 而非 z.enum，
//     避免后端新增枚举值时 host 端结构化校验抛错、把本来成功的工具调用变成错误。---
const PAYMENT_ORDER_OUTPUT = {
  id: z.string(),
  merchantOrderId: z.string(),
  amount: z.string(),
  settlementAsset: z.string().optional(),
  status: z.string(),
  expiresAt: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
  acceptedAssets: z
    .array(z.object({ chain: z.string(), asset: z.string() }))
    .optional(),
  paymentInstructions: z.array(
    z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  ),
}

const TIMELINE_ENTRY_OUTPUT = z.object({
  from: z.string().nullable(),
  to: z.string(),
  reason: z.string().nullable(),
  at: z.string(),
})

const NORMALIZED_EVENT_OUTPUT = z.object({
  id: z.string(),
  chain: z.string(),
  asset: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  amount: z.string(),
  txHash: z.string(),
  logIndex: z.number(),
  blockNumber: z.string(),
  paymentOrderId: z.string().nullable(),
  confirmations: z.number(),
  detectedAt: z.string(),
})

const WEBHOOK_DELIVERY_OUTPUT = z.object({
  id: z.string(),
  webhookEndpointId: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  paymentOrderId: z.string().nullable(),
  status: z.string(),
  attempts: z.number(),
  responseStatus: z.number().nullable(),
  responseDurationMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  succeededAt: z.string().nullable(),
  deadLetteredAt: z.string().nullable(),
  createdAt: z.string(),
})

export function createAgentToolkitServer(
  options: AgentToolkitOptions,
): McpServer {
  const client = new StableOps({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  })

  const server = new McpServer({ name: 'stableops', version: '0.1.0' })

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
    async (args) => {
      const result = await requestAction(options, {
        tool: AgentToolName.GET_ORDER,
        input: args,
      })
      if (result.decision !== 'auto_allowed') return blockedResponse(result)
      try {
        const order = await client.paymentOrders.retrieve(args.id)
        await markExecuted(options, result.actionId, order)
        return ok(order)
      } catch (err) {
        return errorFromException(err)
      }
    },
  )

  server.registerTool(
    AgentToolName.LIST_EVENTS,
    {
      title: 'List on-chain events',
      description: 'Query the normalized event log (read-only).',
      inputSchema: {
        chain: ChainIdSchema.optional(),
        asset: AssetSchema.optional(),
        payment_order_id: z.string().optional(),
        ...COMMON_LIST_INPUT,
      },
      outputSchema: { items: z.array(NORMALIZED_EVENT_OUTPUT) },
    },
    async (args) => {
      const result = await requestAction(options, {
        tool: AgentToolName.LIST_EVENTS,
        input: args,
      })
      if (result.decision !== 'auto_allowed') return blockedResponse(result)
      try {
        const events = await client.events.list({
          chain: args.chain,
          asset: args.asset,
          paymentOrderId: args.payment_order_id,
          limit: args.limit,
        })
        await markExecuted(options, result.actionId, { count: events.length })
        return ok({ items: events })
      } catch (err) {
        return errorFromException(err)
      }
    },
  )

  server.registerTool(
    AgentToolName.LIST_WEBHOOK_DELIVERIES,
    {
      title: 'List webhook deliveries',
      description: 'Read the recent webhook deliveries (read-only).',
      inputSchema: { ...COMMON_LIST_INPUT },
      outputSchema: { items: z.array(WEBHOOK_DELIVERY_OUTPUT) },
    },
    async (args) => {
      const result = await requestAction(options, {
        tool: AgentToolName.LIST_WEBHOOK_DELIVERIES,
        input: args,
      })
      if (result.decision !== 'auto_allowed') return blockedResponse(result)
      try {
        const items = await client.webhookDeliveries.list({ limit: args.limit })
        await markExecuted(options, result.actionId, { count: items.length })
        return ok({ items })
      } catch (err) {
        return errorFromException(err)
      }
    },
  )

  server.registerTool(
    AgentToolName.CREATE_PAYMENT_ORDER,
    {
      title: 'Create a payment order',
      description:
        'Open a new payment order. Subject to per_action_limit / daily_limit / approval gating in the workspace policy.',
      inputSchema: {
        merchant_order_id: z.string().min(1).max(128),
        amount: z.string(),
        accepted_assets: z
          .array(
            z.object({ chain: ChainIdSchema, asset: AssetSchema }),
          )
          .min(1),
        expires_at: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: PAYMENT_ORDER_OUTPUT,
    },
    async (args) => {
      const result = await requestAction(options, {
        tool: AgentToolName.CREATE_PAYMENT_ORDER,
        input: args,
      })
      if (result.decision !== 'auto_allowed') return blockedResponse(result)
      try {
        const order = await client.paymentOrders.create(
          {
            merchantOrderId: args.merchant_order_id,
            amount: args.amount,
            acceptedAssets: args.accepted_assets,
            expiresAt: args.expires_at,
            metadata: args.metadata,
          },
          { idempotencyKey: result.actionId },
        )
        await markExecuted(options, result.actionId, order)
        return ok(order)
      } catch (err) {
        return errorFromException(err)
      }
    },
  )

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
    },
  )

  return server
}

// --- 内部 helpers ---

async function requestAction(
  options: AgentToolkitOptions,
  body: { tool: string; input: unknown },
): Promise<{
  decision: 'auto_allowed' | 'pending_approval'
  actionId: string
}> {
  return fetchJson(options, {
    method: 'POST',
    path: '/v1/agent/actions',
    body: {
      agent_session_id: options.agentSessionId,
      tool: body.tool,
      input: body.input,
    },
  })
}

async function markExecuted(
  options: AgentToolkitOptions,
  actionId: string,
  result: unknown,
) {
  try {
    await fetchJson(options, {
      method: 'POST',
      path: `/v1/agent/actions/${encodeURIComponent(actionId)}/executed`,
      body: { agent_session_id: options.agentSessionId, result },
    })
  } catch {
    // executed 写入失败不影响 caller 拿到结果。
  }
}

async function fetchJson<T>(
  options: AgentToolkitOptions,
  init: { method?: 'GET' | 'POST'; path: string; body?: unknown },
): Promise<T> {
  const baseUrl = (options.baseUrl ?? 'https://api.stableops.dev').replace(
    /\/+$/u,
    '',
  )
  const fetchImpl = options.fetch ?? fetch
  const res = await fetchImpl(`${baseUrl}${init.path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const parsed = text.length === 0 ? null : safeJson(text)
  if (!res.ok) {
    const body = parsed as Record<string, unknown> | null
    throw new StableOpsError(
      res.status,
      (body?.code as string) ?? `http_${res.status}`,
      (body?.message as string) ?? res.statusText,
      parsed,
    )
  }
  return parsed as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function ok(data: Record<string, unknown>) {
  // 成功结果同时给：structuredContent（供 host 程序化消费 / 按 outputSchema 渲染）
  // 与 text（向后兼容不支持结构化输出的 host）。声明了 outputSchema 的工具，非 isError
  // 结果必须带 structuredContent，否则 SDK 会抛错——故所有成功路径统一走这里。
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data,
  }
}

function blockedResponse(result: { decision: string; actionId: string }) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          blocked: true,
          decision: result.decision,
          action_id: result.actionId,
          message: 'Action requires human approval before it can be executed.',
        }),
      },
    ],
  }
}

function errorFromException(err: unknown) {
  if (err instanceof StableOpsError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            code: err.code,
            status: err.status,
            message: err.message,
          }),
        },
      ],
    }
  }
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: JSON.stringify({ message: String(err) }) },
    ],
  }
}

export async function runStdio(options: AgentToolkitOptions): Promise<void> {
  const server = createAgentToolkitServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
