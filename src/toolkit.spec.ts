import { StableOpsError } from '@stableops/api-sdk'
import { describe, expect, it } from 'vitest'

import {
  fetchJson,
  markExecuted,
  withPolicyGate,
  type AgentToolkitOptions,
} from './toolkit'

function makeOptions(
  routes: Record<string, () => { status?: number; body?: unknown }>,
  calls: string[],
): AgentToolkitOptions {
  return {
    agentSessionId: 'sess-1',
    baseUrl: 'http://api.test.local',
    _sleep: async () => {},
    fetch: async (input, init) => {
      const raw = typeof input === 'string' ? input : (input as URL).toString()
      const key = `${init?.method ?? 'GET'} ${new URL(raw).pathname}`
      calls.push(key)
      const route = routes[key]
      const result = route?.() ?? {
        status: 404,
        body: { code: 'route_not_found', message: key },
      }
      return new Response(JSON.stringify(result.body ?? {}), {
        status: result.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

function readError(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function asToolResult(result: Awaited<ReturnType<typeof withPolicyGate>>) {
  return result as {
    isError?: boolean
    structuredContent?: Record<string, unknown>
    content: { text: string }[]
  }
}

describe('withPolicyGate', () => {
  it('pending approval 时不会调用资源 API', async () => {
    const calls: string[] = []
    let executeCalls = 0

    const result = await withPolicyGate(
      makeOptions(
        {
          'POST /v1/agent/actions': () => ({
            body: { decision: 'pending_approval', actionId: 'act-1' },
          }),
        },
        calls,
      ),
      'create_payment_order',
      { amount: '1' },
      async () => {
        executeCalls += 1
        return { id: 'ord-1' }
      },
    )

    expect(asToolResult(result).isError).toBe(true)
    expect(executeCalls).toBe(0)
    expect(calls).toEqual(['POST /v1/agent/actions'])
  })

  it('资源 API 返回 StableOpsError 时写入失败结果并映射错误内容', async () => {
    const calls: string[] = []

    const result = await withPolicyGate(
      makeOptions(
        {
          'POST /v1/agent/actions': () => ({
            body: { decision: 'auto_allowed', actionId: 'act-1' },
          }),
          'POST /v1/agent/actions/act-1/executed': () => ({ body: { status: 'executed' } }),
        },
        calls,
      ),
      'get_order',
      { id: 'ord-1' },
      async () => {
        throw new StableOpsError(403, 'forbidden', 'No access to this order', {
          code: 'forbidden',
        })
      },
    )

    expect(asToolResult(result).isError).toBe(true)
    expect(calls).toEqual([
      'POST /v1/agent/actions',
      'POST /v1/agent/actions/act-1/executed',
    ])
    expect(readError(result)).toMatchObject({
      code: 'forbidden',
      status: 403,
      message: 'No access to this order',
    })
  })

  it('/executed 连续写回失败时明确报告操作已成功但审计未确认', async () => {
    const calls: string[] = []

    const result = await withPolicyGate(
      makeOptions(
        {
          'POST /v1/agent/actions': () => ({
            body: { decision: 'auto_allowed', actionId: 'act-1' },
          }),
          'POST /v1/agent/actions/act-1/executed': () => ({
            status: 503,
            body: { code: 'temporary_unavailable', message: 'try again later' },
          }),
        },
        calls,
      ),
      'get_order',
      { id: 'ord-1' },
      async () => ({ id: 'ord-1', status: 'created' }),
    )

    expect(asToolResult(result).isError).toBe(true)
    expect(readError(result)).toMatchObject({
      code: 'agent_audit_write_failed',
      action_id: 'act-1',
      operation_succeeded: true,
    })
    expect(calls).toEqual([
      'POST /v1/agent/actions',
      'POST /v1/agent/actions/act-1/executed',
      'POST /v1/agent/actions/act-1/executed',
      'POST /v1/agent/actions/act-1/executed',
    ])
  })

  it('相同工具输入重试时先补写原 action 审计，不申请新 action 或重复资源操作', async () => {
    const calls: string[] = []
    let requestCalls = 0
    let auditCalls = 0
    let executeCalls = 0
    const options = makeOptions(
      {
        'POST /v1/agent/actions': () => {
          requestCalls += 1
          return {
            body: {
              decision: 'auto_allowed',
              actionId: requestCalls === 1 ? 'act-cache' : 'act-duplicate',
            },
          }
        },
        'POST /v1/agent/actions/act-cache/executed': () => {
          auditCalls += 1
          return auditCalls <= 3
            ? { status: 503, body: { message: 'try again' } }
            : { body: { status: 'executed' } }
        },
      },
      calls,
    )
    const execute = async () => {
      executeCalls += 1
      return { id: 'ord-cache' }
    }

    expect(
      asToolResult(
        await withPolicyGate(options, 'get_order', { id: 'ord-cache', expand: true }, execute),
      ).isError,
    ).toBe(true)
    expect(
      asToolResult(
        await withPolicyGate(options, 'get_order', { expand: true, id: 'ord-cache' }, execute),
      ).isError,
    ).toBeUndefined()
    expect(requestCalls).toBe(1)
    expect(executeCalls).toBe(1)
    expect(auditCalls).toBe(4)
  })
})

describe('agent 审计请求弹性', () => {
  it('fetchJson 在单次请求超时后中止挂起的 fetch', async () => {
    const options: AgentToolkitOptions = {
      agentSessionId: 'sess-timeout',
      baseUrl: 'http://api.test.local',
      timeoutMs: 5,
      fetch: ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        })) as typeof fetch,
    }

    await expect(fetchJson(options, { path: '/v1/agent/policy' })).rejects.toMatchObject({
      status: 0,
      code: 'timeout',
    })
  })

  it('markExecuted 对确定性 4xx 立即失败', async () => {
    const calls: string[] = []
    const options = makeOptions(
      {
        'POST /v1/agent/actions/act-4xx/executed': () => ({
          status: 409,
          body: { code: 'conflict', message: 'invalid action state' },
        }),
      },
      calls,
    )

    await expect(markExecuted(options, 'act-4xx', { result: { ok: true } })).rejects.toMatchObject(
      {
        status: 409,
        code: 'conflict',
      },
    )
    expect(calls).toEqual(['POST /v1/agent/actions/act-4xx/executed'])
  })

  it('markExecuted 对临时错误按指数退避重试', async () => {
    const calls: string[] = []
    const delays: number[] = []
    let attempts = 0
    const options = makeOptions(
      {
        'POST /v1/agent/actions/act-retry/executed': () => {
          attempts += 1
          return attempts < 3
            ? { status: 503, body: { code: 'temporary_unavailable' } }
            : { body: { status: 'executed' } }
        },
      },
      calls,
    )
    options.retry = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1_000 }
    options._random = () => 1
    options._sleep = async (ms) => {
      delays.push(ms)
    }

    await expect(markExecuted(options, 'act-retry', { result: { ok: true } })).resolves.toBeUndefined()
    expect(calls).toHaveLength(3)
    expect(delays).toEqual([100, 200])
  })
})
