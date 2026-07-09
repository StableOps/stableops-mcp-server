import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StableOps } from '@stableops/api-sdk'
import { z } from 'zod'

import { AssetSchema, ChainIdSchema, PAYMENT_ORDER_OUTPUT } from './schemas'
import { AgentToolName } from './tool-names'
import type { AgentToolkitOptions } from './toolkit'
import { withPolicyGate } from './toolkit'

const MERCHANT_PLAN_OUTPUT = {
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  groupKey: z.string(),
  amount: z.string(),
  interval: z.string(),
  intervalCount: z.number(),
  trialDays: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean(),
  isTemplate: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}

const SUBSCRIPTION_OUTPUT = {
  id: z.string(),
  merchantUserId: z.string(),
  planId: z.string(),
  status: z.string(),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  pendingPlanId: z.string().nullable(),
  pendingPlanChangeAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}

const INVOICE_OUTPUT = {
  id: z.string(),
  subscriptionId: z.string(),
  merchantUserId: z.string(),
  kind: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  amount: z.string(),
  asset: z.string().nullable(),
  status: z.string(),
  paymentOrderId: z.string().nullable(),
  targetPlanId: z.string().nullable(),
  dueAt: z.string(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}

const CREATE_RESULT_OUTPUT = {
  subscription: z.object(SUBSCRIPTION_OUTPUT),
  invoice: z.object(INVOICE_OUTPUT).nullable(),
}

const SETTINGS_OUTPUT = {
  payWindowDays: z.number(),
  renewalLeadDays: z.number(),
  graceDays: z.number(),
}

const PORTAL_SESSION_OUTPUT = {
  id: z.string(),
  portalToken: z.string(),
  expiresAt: z.string(),
}

const ACCEPTED_ASSET_INPUT = z.object({ chain: ChainIdSchema, asset: AssetSchema })

const PLAN_INPUT = {
  code: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  group_key: z.string().min(1).max(128),
  amount: z.string(),
  interval: z.enum(['month', 'year', 'week', 'custom_days']),
  interval_count: z.number().int().positive(),
  trial_days: z.number().int().min(0).max(365).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  is_template: z.boolean().optional(),
}

export function registerMerchantSubscriptionTools(
  server: McpServer,
  client: StableOps,
  options: AgentToolkitOptions,
) {
  const merchant = client.merchantSubscriptions

  server.registerTool(
    AgentToolName.LIST_MERCHANT_PLANS,
    {
      title: 'List merchant plans',
      description: 'Read merchant subscription plans.',
      inputSchema: { group_key: z.string().optional(), include_inactive: z.boolean().optional() },
      outputSchema: { items: z.array(z.object(MERCHANT_PLAN_OUTPUT)) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_MERCHANT_PLANS, args, async () => ({
        items: await merchant.plans.list({
          groupKey: args.group_key,
          includeInactive: args.include_inactive,
        }),
      })),
  )

  server.registerTool(
    AgentToolName.CREATE_MERCHANT_PLAN,
    {
      title: 'Create merchant plan',
      description: 'Create a merchant subscription plan.',
      inputSchema: PLAN_INPUT,
      outputSchema: MERCHANT_PLAN_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CREATE_MERCHANT_PLAN, args, async (actionId) =>
        merchant.plans.create(
          toPlanInput(args),
          { idempotencyKey: actionId },
        ),
      ),
  )

  server.registerTool(
    AgentToolName.UPDATE_MERCHANT_PLAN,
    {
      title: 'Update merchant plan',
      description: 'Update a merchant subscription plan.',
      inputSchema: { id: z.string().min(1), ...partialPlanInput() },
      outputSchema: MERCHANT_PLAN_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.UPDATE_MERCHANT_PLAN, args, async (actionId) =>
        merchant.plans.update(args.id, toPlanInput(args), { idempotencyKey: actionId }),
      ),
  )

  server.registerTool(
    AgentToolName.DELETE_MERCHANT_PLAN,
    {
      title: 'Delete merchant plan',
      description: 'Deactivate a merchant subscription plan.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: { success: z.boolean() },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.DELETE_MERCHANT_PLAN, args, async (actionId) => {
        await merchant.plans.delete(args.id, { idempotencyKey: actionId })
        return { success: true }
      }),
  )

  server.registerTool(
    AgentToolName.CREATE_MERCHANT_SUBSCRIPTION,
    {
      title: 'Create merchant subscription',
      description: 'Create an end-user subscription.',
      inputSchema: {
        plan_id: z.string().min(1),
        merchant_user_id: z.string().min(1),
        trial_days: z.number().int().min(0).max(365).optional(),
      },
      outputSchema: CREATE_RESULT_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CREATE_MERCHANT_SUBSCRIPTION, args, async (actionId) =>
        merchant.subscriptions.create(
          { planId: args.plan_id, merchantUserId: args.merchant_user_id, trialDays: args.trial_days },
          { idempotencyKey: actionId },
        ),
      ),
  )

  server.registerTool(
    AgentToolName.LIST_MERCHANT_SUBSCRIPTIONS,
    {
      title: 'List merchant subscriptions',
      description: 'Read end-user subscriptions.',
      inputSchema: { status: z.string().optional(), merchant_user_id: z.string().optional() },
      outputSchema: { items: z.array(z.object(SUBSCRIPTION_OUTPUT)) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_MERCHANT_SUBSCRIPTIONS, args, async () => ({
        items: await merchant.subscriptions.list({
          status: args.status as never,
          merchantUserId: args.merchant_user_id,
        }),
      })),
  )

  server.registerTool(
    AgentToolName.GET_MERCHANT_SUBSCRIPTION,
    {
      title: 'Get merchant subscription',
      description: 'Read a subscription by id.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: SUBSCRIPTION_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_MERCHANT_SUBSCRIPTION, args, async () =>
        merchant.subscriptions.get(args.id),
      ),
  )

  server.registerTool(
    AgentToolName.GET_MERCHANT_SUBSCRIPTION_BY_USER,
    {
      title: 'Get merchant subscription by user',
      description: 'Read a subscription by merchant user id.',
      inputSchema: { merchant_user_id: z.string().min(1) },
      outputSchema: SUBSCRIPTION_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_MERCHANT_SUBSCRIPTION_BY_USER, args, async () =>
        merchant.subscriptions.getByMerchantUserId(args.merchant_user_id),
      ),
  )

  server.registerTool(
    AgentToolName.CHANGE_MERCHANT_SUBSCRIPTION_PLAN,
    {
      title: 'Change merchant subscription plan',
      description: 'Change an end-user subscription plan.',
      inputSchema: { id: z.string().min(1), plan_id: z.string().min(1) },
      outputSchema: { ...CREATE_RESULT_OUTPUT, pending: z.boolean() },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CHANGE_MERCHANT_SUBSCRIPTION_PLAN, args, async (actionId) =>
        merchant.subscriptions.changePlan(args.id, { planId: args.plan_id }, { idempotencyKey: actionId }),
      ),
  )

  server.registerTool(
    AgentToolName.CANCEL_MERCHANT_SUBSCRIPTION,
    {
      title: 'Cancel merchant subscription',
      description: 'Cancel an end-user subscription.',
      inputSchema: { id: z.string().min(1), immediate: z.boolean().optional() },
      outputSchema: SUBSCRIPTION_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CANCEL_MERCHANT_SUBSCRIPTION, args, async (actionId) =>
        merchant.subscriptions.cancel(args.id, { immediate: args.immediate }, { idempotencyKey: actionId }),
      ),
  )

  server.registerTool(
    AgentToolName.RESUME_MERCHANT_SUBSCRIPTION,
    {
      title: 'Resume merchant subscription',
      description: 'Resume a canceled-at-period-end subscription.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: SUBSCRIPTION_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.RESUME_MERCHANT_SUBSCRIPTION, args, async (actionId) =>
        merchant.subscriptions.resume(args.id, { idempotencyKey: actionId }),
      ),
  )

  server.registerTool(
    AgentToolName.LIST_MERCHANT_INVOICES,
    {
      title: 'List merchant invoices',
      description: 'Read merchant subscription invoices.',
      inputSchema: {
        status: z.string().optional(),
        merchant_user_id: z.string().optional(),
        subscription_id: z.string().optional(),
      },
      outputSchema: { items: z.array(z.object(INVOICE_OUTPUT)) },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.LIST_MERCHANT_INVOICES, args, async () => ({
        items: await merchant.invoices.list({
          status: args.status as never,
          merchantUserId: args.merchant_user_id,
          subscriptionId: args.subscription_id,
        }),
      })),
  )

  server.registerTool(
    AgentToolName.GET_MERCHANT_INVOICE,
    {
      title: 'Get merchant invoice',
      description: 'Read a merchant invoice by id.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: INVOICE_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_MERCHANT_INVOICE, args, async () =>
        merchant.invoices.get(args.id),
      ),
  )

  server.registerTool(
    AgentToolName.PAY_MERCHANT_INVOICE,
    {
      title: 'Pay merchant invoice',
      description: 'Create or reuse a payment order for a merchant invoice.',
      inputSchema: {
        id: z.string().min(1),
        amount_mode: z.enum(['exact', 'auto']).optional(),
        accepted_assets: z.array(ACCEPTED_ASSET_INPUT).min(1),
      },
      outputSchema: {
        invoiceId: z.string(),
        paymentOrderId: z.string(),
        status: z.string(),
        paymentOrder: z.object(PAYMENT_ORDER_OUTPUT),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.PAY_MERCHANT_INVOICE, args, async (actionId) =>
        merchant.invoices.pay(
          args.id,
          { amountMode: args.amount_mode, acceptedAssets: args.accepted_assets },
          { idempotencyKey: actionId },
        ),
      ),
  )

  server.registerTool(
    AgentToolName.GET_MERCHANT_INVOICE_PAYMENT_STATUS,
    {
      title: 'Get merchant invoice payment status',
      description: 'Read the payment status for a merchant invoice.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: {
        invoiceId: z.string(),
        status: z.string(),
        paymentOrder: z.object(PAYMENT_ORDER_OUTPUT).nullable(),
      },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_MERCHANT_INVOICE_PAYMENT_STATUS, args, async () =>
        merchant.invoices.paymentStatus(args.id),
      ),
  )

  server.registerTool(
    AgentToolName.GET_MERCHANT_SUBSCRIPTION_SETTINGS,
    {
      title: 'Get merchant subscription settings',
      description: 'Read merchant subscription billing settings.',
      inputSchema: {},
      outputSchema: SETTINGS_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.GET_MERCHANT_SUBSCRIPTION_SETTINGS, args, async () =>
        merchant.settings.get(),
      ),
  )

  server.registerTool(
    AgentToolName.UPDATE_MERCHANT_SUBSCRIPTION_SETTINGS,
    {
      title: 'Update merchant subscription settings',
      description: 'Update merchant subscription billing settings.',
      inputSchema: {
        pay_window_days: z.number().int().min(1).optional(),
        renewal_lead_days: z.number().int().min(0).optional(),
        grace_days: z.number().int().min(0).optional(),
      },
      outputSchema: SETTINGS_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.UPDATE_MERCHANT_SUBSCRIPTION_SETTINGS, args, async (actionId) =>
        merchant.settings.update(
          {
            payWindowDays: args.pay_window_days,
            renewalLeadDays: args.renewal_lead_days,
            graceDays: args.grace_days,
          },
          { idempotencyKey: actionId },
        ),
      ),
  )

  server.registerTool(
    AgentToolName.CREATE_MERCHANT_PORTAL_SESSION,
    {
      title: 'Create merchant portal session',
      description: 'Create an end-user portal session.',
      inputSchema: { merchant_user_id: z.string().min(1), expires_at: z.string().optional() },
      outputSchema: PORTAL_SESSION_OUTPUT,
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.CREATE_MERCHANT_PORTAL_SESSION, args, async (actionId) =>
        merchant.portalSessions.create(
          { merchantUserId: args.merchant_user_id, expiresAt: args.expires_at },
          { idempotencyKey: actionId },
        ),
      ),
  )

  server.registerTool(
    AgentToolName.REVOKE_MERCHANT_PORTAL_SESSION,
    {
      title: 'Revoke merchant portal session',
      description: 'Revoke an end-user portal session.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: { success: z.boolean() },
    },
    async (args) =>
      withPolicyGate(options, AgentToolName.REVOKE_MERCHANT_PORTAL_SESSION, args, async (actionId) => {
        await merchant.portalSessions.revoke(args.id, { idempotencyKey: actionId })
        return { success: true }
      }),
  )
}

function toPlanInput(args: {
  code?: string
  name?: string
  description?: string | null
  group_key?: string
  amount?: string
  interval?: 'month' | 'year' | 'week' | 'custom_days'
  interval_count?: number
  trial_days?: number | null
  metadata?: Record<string, unknown> | null
  is_template?: boolean
}) {
  return {
    code: args.code,
    name: args.name,
    description: args.description,
    groupKey: args.group_key,
    amount: args.amount,
    interval: args.interval,
    intervalCount: args.interval_count,
    trialDays: args.trial_days,
    metadata: args.metadata,
    isTemplate: args.is_template,
  } as never
}

function partialPlanInput() {
  return {
    code: PLAN_INPUT.code.optional(),
    name: PLAN_INPUT.name.optional(),
    description: PLAN_INPUT.description,
    group_key: PLAN_INPUT.group_key.optional(),
    amount: PLAN_INPUT.amount.optional(),
    interval: PLAN_INPUT.interval.optional(),
    interval_count: PLAN_INPUT.interval_count.optional(),
    trial_days: PLAN_INPUT.trial_days,
    metadata: PLAN_INPUT.metadata,
    is_template: PLAN_INPUT.is_template,
  }
}
