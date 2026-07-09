import { StableOpsError, type ClientOptions } from '@stableops/api-sdk'

export type AgentToolkitOptions = ClientOptions & {
  agentSessionId: string
  // 单元测试便于注入 fetch。
  fetch?: typeof fetch
}

export async function withPolicyGate<T extends Record<string, unknown>>(
  options: AgentToolkitOptions,
  tool: string,
  input: Record<string, unknown>,
  execute: (actionId: string) => Promise<T>,
) {
  try {
    const result = await requestAction(options, { tool, input })
    if (result.decision !== 'auto_allowed') return blockedResponse(result)

    const data = await execute(result.actionId)
    await markExecuted(options, result.actionId, data)
    return ok(data)
  } catch (err) {
    return errorFromException(err)
  }
}

export async function requestAction(
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

export async function markExecuted(
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

export async function fetchJson<T>(
  options: AgentToolkitOptions,
  init: { method?: 'GET' | 'POST'; path: string; body?: unknown },
): Promise<T> {
  const baseUrl = (options.baseUrl ?? 'https://api.stableops.dev').replace(/\/+$/u, '')
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

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function ok(data: Record<string, unknown>) {
  // 成功结果同时给 structuredContent（供 host 程序化消费 / 按 outputSchema 渲染）
  // 与 text（向后兼容不支持结构化输出的 host）。
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data,
  }
}

export function blockedResponse(result: { decision: string; actionId: string }) {
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

export function errorFromException(err: unknown) {
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
    content: [{ type: 'text' as const, text: JSON.stringify({ message: String(err) }) }],
  }
}
