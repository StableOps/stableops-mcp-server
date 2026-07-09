import { z } from 'zod'

export const ChainIdSchema = z.enum([
  'ethereum',
  'base',
  'base-sepolia',
  'arbitrum',
  'polygon',
  'optimism',
  'bsc',
  'tron',
  'solana',
  'ethereum-sepolia',
  'arbitrum-sepolia',
  'polygon-amoy',
  'optimism-sepolia',
  'bsc-testnet',
  'solana-devnet',
  'tron-nile',
])

export const AssetSchema = z.enum(['USDC', 'USDT'])

export const COMMON_LIST_INPUT = {
  limit: z.number().int().min(1).max(200).optional(),
}

// outputSchema 用 SDK fromWire 后的字段形态。支付订单为 camelCase；agent 资源为 snake_case。
// 枚举使用 z.string()，避免后端新增值时 host 端结构化校验把成功调用变成错误。
export const PAYMENT_ORDER_OUTPUT = {
  id: z.string(),
  merchantOrderId: z.string(),
  amount: z.string(),
  requestedAmount: z.string(),
  settlementAsset: z.string().optional(),
  status: z.string(),
  expiresAt: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
  acceptedAssets: z.array(z.object({ chain: z.string(), asset: z.string() })).optional(),
  paymentInstructions: z.array(
    z.object({ chain: z.string(), asset: z.string(), address: z.string() }),
  ),
}

export const TIMELINE_ENTRY_OUTPUT = z.object({
  from: z.string().nullable(),
  to: z.string(),
  reason: z.string().nullable(),
  at: z.string(),
})

export const WEBHOOK_DELIVERY_OUTPUT = z.object({
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
  payload: z.record(z.string(), z.unknown()),
})

export const AGENT_POLICY_OUTPUT = {
  id: z.string(),
  allowed_tools: z.array(z.string()),
  require_approval: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}

export const AGENT_ACTION_OUTPUT = z.object({
  id: z.string(),
  agent_session_id: z.string(),
  tool: z.string(),
  input: z.unknown(),
  status: z.string(),
  approver_id: z.string().nullable(),
  decided_at: z.string().nullable(),
  executed_at: z.string().nullable(),
  result: z.unknown(),
  error_message: z.string().nullable(),
  created_at: z.string(),
})
