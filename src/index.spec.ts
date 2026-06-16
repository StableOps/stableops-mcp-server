import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentToolName, createAgentToolkitServer } from './index'

// 路由式假 fetch：MCP server 自身的 /v1/agent/* 与 SDK HttpClient 的资源请求都走它。
// 资源端点须返回 SDK 期望的 wire（snake_case）形态，SDK fromWire 成 camelCase 后回传给工具，
// 工具再放进 structuredContent —— 这条链路正是 outputSchema 校验要守住的。
function fakeFetch(routes: Record<string, () => unknown>): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : (input as URL).toString()
    const key = `${init?.method ?? 'GET'} ${new URL(raw).pathname}`
    const found = key in routes
    const body = found ? routes[key]() : { code: 'route_not_found', message: key }
    return new Response(JSON.stringify(body), {
      status: found ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    })
  }
}

async function connect(routes: Record<string, () => unknown>) {
  const server = createAgentToolkitServer({
    agentSessionId: 'sess-1',
    baseUrl: 'http://api.test.local',
    organizationSlug: 'demo',
    environment: 'sandbox',
    fetch: fakeFetch(routes),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

// (org, env) 作用域的授权放行 + 执行回执存根。
const AUTO_ALLOW: Record<string, () => unknown> = {
  'POST /v1/agent/actions': () => ({ decision: 'auto_allowed', actionId: 'act-1' }),
  'POST /v1/agent/actions/act-1/executed': () => ({}),
}

const WIRE_ORDER = {
  id: 'ord-1',
  merchant_order_id: 'm-1',
  amount: '100.00',
  settlement_asset: 'USDC',
  status: 'created',
  expires_at: null,
  metadata: { note: 'hi' },
  created_at: '2026-05-31T00:00:00.000Z',
  accepted_assets: [{ chain: 'base', asset: 'USDC' }],
  payment_instructions: [{ chain: 'base', asset: 'USDC', address: '0xabc' }],
}

const WIRE_ORDER_DETAIL = {
  ...WIRE_ORDER,
  timeline: [{ from: null, to: 'created', reason: null, at: '2026-05-31T00:00:00.000Z' }],
}

const WIRE_EVENT = {
  id: 'ne-1',
  chain: 'base',
  asset: 'USDC',
  from_address: '0xfrom',
  to_address: '0xto',
  amount: '100.00',
  tx_hash: '0xhash',
  log_index: 0,
  block_number: '1234',
  payment_order_id: 'ord-1',
  confirmations: 3,
  detected_at: '2026-05-31T00:00:00.000Z',
}

describe('agent toolkit — outputSchema / structuredContent', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('get_order：返回 structuredContent 且通过 outputSchema 校验', async () => {
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'GET /v1/payment-orders/ord-1': () => WIRE_ORDER_DETAIL,
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({ name: AgentToolName.GET_ORDER, arguments: { id: 'ord-1' } })
    expect(res.isError).toBeFalsy()
    const structured = res.structuredContent as Record<string, unknown>
    expect(structured).toMatchObject({ id: 'ord-1', status: 'created', settlementAsset: 'USDC' })
    expect(Array.isArray(structured.timeline)).toBe(true)
  })

  it('list_events：返回 { items: [...] } 结构化（camelCase）', async () => {
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'GET /v1/events': () => ({ items: [WIRE_EVENT] }),
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({ name: AgentToolName.LIST_EVENTS, arguments: {} })
    expect(res.isError).toBeFalsy()
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items[0]).toMatchObject({ id: 'ne-1', toAddress: '0xto', confirmations: 3 })
  })

  it('create_payment_order：自动放行时返回结构化订单', async () => {
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'POST /v1/payment-orders': () => WIRE_ORDER,
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.CREATE_PAYMENT_ORDER,
      arguments: {
        merchant_order_id: 'm-1',
        amount: '100.00',
        accepted_assets: [{ chain: 'base', asset: 'USDC' }],
      },
    })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ id: 'ord-1', merchantOrderId: 'm-1' })
  })

  it('pending_approval：写操作被挡下，返回 isError 且无 structuredContent', async () => {
    const { client, server } = await connect({
      'POST /v1/agent/actions': () => ({ decision: 'pending_approval', actionId: 'act-2' }),
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.CREATE_PAYMENT_ORDER,
      arguments: {
        merchant_order_id: 'm-2',
        amount: '1',
        accepted_assets: [{ chain: 'base', asset: 'USDC' }],
      },
    })
    expect(res.isError).toBe(true)
    expect(res.structuredContent).toBeUndefined()
  })

  it('request_action_approval：返回 action_id/decision/instructions', async () => {
    const { client, server } = await connect({
      'POST /v1/agent/actions': () => ({ decision: 'pending_approval', actionId: 'act-3' }),
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.REQUEST_ACTION_APPROVAL,
      arguments: { summary: 'wire 5000 USDC to treasury' },
    })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ action_id: 'act-3', decision: 'pending_approval' })
  })

  it('list_webhook_deliveries：经 SDK 返回 camelCase 字段', async () => {
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'GET /v1/webhook-deliveries': () => ({
        items: [
          {
            id: 'wd-1',
            webhook_endpoint_id: 'whe-1',
            event_id: 'evt-1',
            event_type: 'payment.confirmed',
            payment_order_id: 'ord-1',
            status: 'succeeded',
            attempts: 1,
            response_status: 200,
            response_duration_ms: 42,
            error_message: null,
            next_retry_at: null,
            last_attempt_at: '2026-05-31T00:00:00.000Z',
            succeeded_at: '2026-05-31T00:00:00.000Z',
            dead_lettered_at: null,
            created_at: '2026-05-31T00:00:00.000Z',
          },
        ],
      }),
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.LIST_WEBHOOK_DELIVERIES,
      arguments: {},
    })
    expect(res.isError).toBeFalsy()
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items[0]).toMatchObject({
      id: 'wd-1',
      webhookEndpointId: 'whe-1',
      eventType: 'payment.confirmed',
      status: 'succeeded',
    })
  })

  it('create_payment_order：solana 链通过 ChainIdSchema 校验', async () => {
    const SOLANA_ORDER = {
      ...WIRE_ORDER,
      accepted_assets: [{ chain: 'solana', asset: 'USDC' }],
      payment_instructions: [{ chain: 'solana', asset: 'USDC', address: 'Hxxxxx' }],
    }
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'POST /v1/payment-orders': () => SOLANA_ORDER,
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.CREATE_PAYMENT_ORDER,
      arguments: {
        merchant_order_id: 'm-sol',
        amount: '1',
        accepted_assets: [{ chain: 'solana', asset: 'USDC' }],
      },
    })
    expect(res.isError).toBeFalsy()
    const structured = res.structuredContent as { acceptedAssets?: { chain: string }[] }
    expect(structured.acceptedAssets?.[0]?.chain).toBe('solana')
  })
})
