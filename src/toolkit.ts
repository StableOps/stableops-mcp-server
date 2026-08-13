import { StableOpsError, type ClientOptions } from '@stableops/api-sdk'

export type AgentToolkitOptions = ClientOptions & {
  agentSessionId: string
  // 单元测试便于注入 fetch。
  fetch?: typeof fetch
}

type ExecutionOutcome<T> =
  | { status: 'fulfilled'; data: T }
  | { status: 'rejected'; error: unknown }

type PendingAudit = {
  actionId: string
  outcome: ExecutionOutcome<Record<string, unknown>>
}

// 审计回写暂时失败时按「会话 + 工具 + 输入」保留执行结果。下一次相同调用会在申请
// 新 action 前补写旧记录，避免响应丢失后重复执行资金或配置写操作。
const pendingAudits = new Map<string, PendingAudit>()

export async function withPolicyGate<T extends Record<string, unknown>>(
  options: AgentToolkitOptions,
  tool: string,
  input: Record<string, unknown>,
  execute: (actionId: string) => Promise<T>,
) {
  try {
    const pendingKey = operationKey(options, tool, input)
    const pending = pendingAudits.get(pendingKey) as
      | { actionId: string; outcome: ExecutionOutcome<T> }
      | undefined
    if (pending) {
      try {
        await writeOutcome(options, pending.actionId, pending.outcome)
        pendingAudits.delete(pendingKey)
      } catch (auditError) {
        return auditWriteFailure(pending.actionId, pending.outcome, auditError)
      }
      return pending.outcome.status === 'fulfilled'
        ? ok(pending.outcome.data)
        : errorFromException(pending.outcome.error)
    }

    const result = await requestAction(options, { tool, input })
    if (result.decision !== 'auto_allowed') return blockedResponse(result)

    let outcome: ExecutionOutcome<T>
    try {
      outcome = { status: 'fulfilled', data: await execute(result.actionId) }
    } catch (error) {
      outcome = { status: 'rejected', error }
    }
    try {
      await writeOutcome(options, result.actionId, outcome)
    } catch (auditError) {
      pendingAudits.set(pendingKey, {
        actionId: result.actionId,
        outcome: outcome as ExecutionOutcome<Record<string, unknown>>,
      })
      return auditWriteFailure(result.actionId, outcome, auditError)
    }
    return outcome.status === 'fulfilled' ? ok(outcome.data) : errorFromException(outcome.error)
  } catch (err) {
    return errorFromException(err)
  }
}

async function writeOutcome<T>(
  options: AgentToolkitOptions,
  actionId: string,
  outcome: ExecutionOutcome<T>,
) {
  if (outcome.status === 'fulfilled') {
    await markExecuted(options, actionId, { result: outcome.data })
  } else {
    await markExecuted(options, actionId, {
      errorMessage: exceptionMessage(outcome.error).slice(0, 512),
    })
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
  outcome: { result?: unknown; errorMessage?: string },
) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fetchJson(options, {
        method: 'POST',
        path: `/v1/agent/actions/${encodeURIComponent(actionId)}/executed`,
        body: {
          agent_session_id: options.agentSessionId,
          ...(outcome.errorMessage === undefined
            ? { result: outcome.result }
            : { error_message: outcome.errorMessage }),
        },
      })
      return
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
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

function exceptionMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function operationKey(
  options: AgentToolkitOptions,
  tool: string,
  input: Record<string, unknown>,
): string {
  return JSON.stringify([
    options.baseUrl ?? 'https://api.stableops.dev',
    options.agentSessionId,
    tool,
    canonicalJson(input),
  ])
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  )
}

function auditWriteFailure<T>(
  actionId: string,
  outcome: ExecutionOutcome<T>,
  auditError: unknown,
) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          code: 'agent_audit_write_failed',
          action_id: actionId,
          operation_succeeded: outcome.status === 'fulfilled',
          operation_error:
            outcome.status === 'rejected' ? exceptionMessage(outcome.error) : undefined,
          audit_error: exceptionMessage(auditError),
          message:
            'The operation finished, but StableOps could not confirm the agent audit record. Retrying this tool will only retry the audit write in the current MCP process.',
        }),
      },
    ],
  }
}
