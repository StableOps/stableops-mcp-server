import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'

import packageJson from '../package.json'
import { AgentToolName, createAgentToolkitServer } from './index'

type FakeRequest = {
  method: string
  path: string
  headers: Headers
  body: unknown
}

type FakeRouteHandler = (request: FakeRequest) => unknown

type FakeRoute = FakeRouteHandler | unknown

// 路由式假 fetch：MCP server 自身的 /v1/agent/* 与 SDK HttpClient 的资源请求都走它。
// 资源端点须返回 SDK 期望的 wire（snake_case）形态，SDK fromWire 成 camelCase 后回传给工具，
// 工具再放进 structuredContent —— 这条链路正是 outputSchema 校验要守住的。
function fakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : (input as URL).toString()
    const url = new URL(raw)
    const method = init?.method ?? 'GET'
    const key = `${method} ${url.pathname}`
    const found = key in routes
    const request: FakeRequest = {
      method,
      path: url.pathname,
      headers: new Headers(init?.headers),
      body:
        typeof init?.body === 'string' && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined,
    }
    const route = routes[key]
    const body = found
      ? typeof route === 'function'
        ? (route as FakeRouteHandler)(request)
        : route
      : { code: 'route_not_found', message: key }
    return new Response(JSON.stringify(body), {
      status: found ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    })
  }
}

async function connect(routes: Record<string, FakeRoute>) {
  const server = createAgentToolkitServer({
    agentSessionId: 'sess-1',
    baseUrl: 'http://api.test.local',
    fetch: fakeFetch(routes),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

async function listToolSchema(client: Client, name: AgentToolName) {
  const res = await client.listTools()
  const tool = res.tools.find((item) => item.name === name)
  expect(tool).toBeDefined()
  return tool as {
    outputSchema?: {
      properties?: Record<string, unknown>
      required?: string[]
    }
  }
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
  requested_amount: '100.00',
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

describe('agent toolkit — outputSchema / structuredContent', { timeout: 15_000 }, () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('listTools：只注册只读 agent 工具，不注册自升级工具', async () => {
    const { client, server } = await connect({})
    close = async () => {
      await client.close()
      await server.close()
    }

    const res = await client.listTools()
    const names = res.tools.map((tool) => tool.name)

    expect(names).toContain('get_agent_policy')
    expect(names).toContain('list_agent_actions')
    expect(names).not.toContain('upsert_agent_policy')
    expect(names).not.toContain('approve_agent_action')
    expect(names).not.toContain('reject_agent_action')
    expect(names).not.toContain('revoke_agent_session')
  })

  it('initialize：serverInfo version 与 package.json version 保持一致', async () => {
    const { client, server } = await connect({})
    close = async () => {
      await client.close()
      await server.close()
    }

    expect(client.getServerVersion()).toMatchObject({
      name: 'stableops',
      version: packageJson.version,
    })
  })

  it('create_payment_order：outputSchema 将 requestedAmount 声明为必填', async () => {
    const { client, server } = await connect({})
    close = async () => {
      await client.close()
      await server.close()
    }

    const tool = await listToolSchema(client, AgentToolName.CREATE_PAYMENT_ORDER)
    expect(tool.outputSchema?.required).toContain('requestedAmount')
  })

  it('list_webhook_deliveries：outputSchema 声明 payload 字段', async () => {
    const { client, server } = await connect({})
    close = async () => {
      await client.close()
      await server.close()
    }

    const tool = await listToolSchema(client, AgentToolName.LIST_WEBHOOK_DELIVERIES)
    const itemsSchema = tool.outputSchema?.properties?.items as
      | { items?: { properties?: Record<string, unknown> } }
      | undefined
    expect(itemsSchema?.items?.properties).toHaveProperty('payload')
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
        expires_at: '2026-12-31T00:00:00.000Z',
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
        expires_at: '2026-12-31T00:00:00.000Z',
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
    expect(res.structuredContent).toMatchObject({
      action_id: 'act-3',
      decision: 'pending_approval',
    })
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
            payload: { type: 'payment.confirmed', data: { payment_order_id: 'ord-1' } },
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
        expires_at: '2026-12-31T00:00:00.000Z',
      },
    })
    expect(res.isError).toBeFalsy()
    const structured = res.structuredContent as { acceptedAssets?: { chain: string }[] }
    expect(structured.acceptedAssets?.[0]?.chain).toBe('solana')
  })

  it('create_payment_order：optimism 与 bsc 链通过 ChainIdSchema 校验', async () => {
    const MULTI_CHAIN_ORDER = {
      ...WIRE_ORDER,
      accepted_assets: [
        { chain: 'optimism', asset: 'USDC' },
        { chain: 'bsc', asset: 'USDT' },
      ],
      payment_instructions: [
        { chain: 'optimism', asset: 'USDC', address: '0xop' },
        { chain: 'bsc', asset: 'USDT', address: '0xbsc' },
      ],
    }
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'POST /v1/payment-orders': () => MULTI_CHAIN_ORDER,
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.CREATE_PAYMENT_ORDER,
      arguments: {
        merchant_order_id: 'm-multi',
        amount: '1',
        accepted_assets: [
          { chain: 'optimism', asset: 'USDC' },
          { chain: 'bsc', asset: 'USDT' },
        ],
        expires_at: '2026-12-31T00:00:00.000Z',
      },
    })
    expect(res.isError).toBeFalsy()
    const structured = res.structuredContent as { acceptedAssets?: { chain: string }[] }
    expect(structured.acceptedAssets?.map((item) => item.chain)).toEqual(['optimism', 'bsc'])
  })

  it('list_payment_orders：返回 items 且订单条目为 SDK camelCase 字段', async () => {
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'GET /v1/payment-orders': () => ({ items: [WIRE_ORDER] }),
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.LIST_PAYMENT_ORDERS,
      arguments: { status: 'created', limit: 10 },
    })
    expect(res.isError).toBeFalsy()
    const items = (res.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'ord-1', merchantOrderId: 'm-1' })
  })

  it('create_checkout_session：自动放行时返回 url/paymentOrder，并用 actionId 作 idempotency key', async () => {
    const checkoutRequests: FakeRequest[] = []
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'POST /v1/checkout-sessions': (request: FakeRequest) => {
        checkoutRequests.push(request)
        return {
          id: 'cs-1',
          client_secret: 'sec-1',
          status: 'open',
          title: 'Checkout',
          description: 'Pay invoice',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          walletconnect_project_id: 'wc-1',
          expires_at: '2026-12-31T00:00:00.000Z',
          created_at: '2026-05-31T00:00:00.000Z',
          payment_order: WIRE_ORDER,
        }
      },
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.CREATE_CHECKOUT_SESSION,
      arguments: {
        merchant_order_id: 'm-1',
        amount: '100.00',
        amount_mode: 'auto',
        accepted_assets: [{ chain: 'base', asset: 'USDC' }],
        expires_at: '2026-12-31T00:00:00.000Z',
        title: 'Checkout',
        description: 'Pay invoice',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        walletconnect_project_id: 'wc-1',
        metadata: { invoiceId: 'inv-1' },
      },
    })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({
      id: 'cs-1',
      url: 'https://pay.stableops.dev/c/cs-1?client_secret=sec-1',
      paymentOrder: { id: 'ord-1', merchantOrderId: 'm-1' },
    })
    expect(checkoutRequests).toHaveLength(1)
    expect(checkoutRequests[0]?.headers.get('idempotency-key')).toBe('act-1')
    expect(checkoutRequests[0]?.body).toMatchObject({
      merchant_order_id: 'm-1',
      amount: '100.00',
      amount_mode: 'auto',
      success_url: 'https://example.com/success',
      walletconnect_project_id: 'wc-1',
    })
  })

  it('import_addresses：pending approval 时不调用地址导入接口', async () => {
    const importRequests: FakeRequest[] = []
    const { client, server } = await connect({
      'POST /v1/agent/actions': () => ({ decision: 'pending_approval', actionId: 'act-4' }),
      'POST /v1/addresses/import': (request: FakeRequest) => {
        importRequests.push(request)
        return { imported: 1, addresses: [] }
      },
    })
    close = async () => {
      await client.close()
      await server.close()
    }
    const res = await client.callTool({
      name: AgentToolName.IMPORT_ADDRESSES,
      arguments: {
        chain: 'base',
        addresses: ['0xabc'],
        label: 'ops',
        mode: 'single',
      },
    })
    expect(res.isError).toBe(true)
    expect(res.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Action requires human approval'),
      }),
    ])
    expect(importRequests).toHaveLength(0)
  })

  it('create_webhook_endpoint：经 SDK 映射输入并返回 camelCase 字段', async () => {
    const webhookRequests: FakeRequest[] = []
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'POST /v1/webhook-endpoints': (request: FakeRequest) => {
        webhookRequests.push(request)
        return {
          id: 'we_1',
          url: 'https://merchant.test/webhooks',
          description: 'primary',
          enabled_events: ['payment.finalized'],
          redact_metadata: true,
          disabled_at: null,
          created_at: '2026-07-09T00:00:00.000Z',
          secret: 'whsec_1',
        }
      },
    })
    close = async () => {
      await client.close()
      await server.close()
    }

    const res = await client.callTool({
      name: AgentToolName.CREATE_WEBHOOK_ENDPOINT,
      arguments: {
        url: 'https://merchant.test/webhooks',
        description: 'primary',
        enabled_events: ['payment.finalized'],
        redact_metadata: true,
      },
    })

    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({
      id: 'we_1',
      redactMetadata: true,
      secret: 'whsec_1',
    })
    expect(webhookRequests[0]?.body).toEqual({
      url: 'https://merchant.test/webhooks',
      description: 'primary',
      enabled_events: ['payment.finalized'],
      redact_metadata: true,
    })
  })

  it('create_merchant_plan：返回 SDK camelCase 套餐字段', async () => {
    const planRequests: FakeRequest[] = []
    const plan = {
      id: 'plan_1',
      code: 'starter',
      name: 'Starter',
      description: null,
      group_key: 'demo',
      amount: '9.00',
      interval: 'month',
      interval_count: 1,
      trial_days: null,
      metadata: null,
      is_active: true,
      is_template: false,
      created_at: '2026-07-09T00:00:00.000Z',
      updated_at: '2026-07-09T00:00:00.000Z',
    }
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'POST /v1/merchant/plans': (request: FakeRequest) => {
        planRequests.push(request)
        return plan
      },
    })
    close = async () => {
      await client.close()
      await server.close()
    }

    const res = await client.callTool({
      name: AgentToolName.CREATE_MERCHANT_PLAN,
      arguments: {
        code: 'starter',
        name: 'Starter',
        group_key: 'demo',
        amount: '9.00',
        interval: 'month',
        interval_count: 1,
      },
    })

    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ id: 'plan_1', groupKey: 'demo' })
    expect(planRequests[0]?.headers.get('idempotency-key')).toBe('act-1')
    expect(planRequests[0]?.body).toMatchObject({
      code: 'starter',
      group_key: 'demo',
      interval_count: 1,
    })
  })

  it('get_agent_policy：读取策略且不暴露 policy mutation 工具', async () => {
    const { client, server } = await connect({
      ...AUTO_ALLOW,
      'GET /v1/agent/policy': () => ({
        id: 'default',
        allowed_tools: ['get_order'],
        require_approval: true,
        created_at: '1970-01-01T00:00:00.000Z',
        updated_at: '1970-01-01T00:00:00.000Z',
      }),
    })
    close = async () => {
      await client.close()
      await server.close()
    }

    const res = await client.callTool({ name: AgentToolName.GET_AGENT_POLICY, arguments: {} })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ allowed_tools: ['get_order'] })

    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name)
    expect(names).not.toContain('upsert_agent_policy')
    expect(names).not.toContain('approve_agent_action')
    expect(names).not.toContain('reject_agent_action')
    expect(names).not.toContain('revoke_agent_session')
  })
})
