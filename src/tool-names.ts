// MCP server 是对外发布产物，工具名在本包内维护，避免依赖内部 workspace 包 @stableops/shared。
// 如果上游 AgentToolName 扩充，请同步更新这里。
export const AgentToolName = {
  GET_ORDER: 'get_order',
  LIST_PAYMENT_ORDERS: 'list_payment_orders',
  CREATE_PAYMENT_ORDER: 'create_payment_order',
  CANCEL_PAYMENT_ORDER: 'cancel_payment_order',

  GET_ADDRESS_POOLS: 'get_address_pools',
  LIST_ADDRESSES: 'list_addresses',
  IMPORT_ADDRESSES: 'import_addresses',
  UPDATE_ADDRESS: 'update_address',
  REMOVE_ADDRESS: 'remove_address',

  LIST_WEBHOOK_ENDPOINTS: 'list_webhook_endpoints',
  CREATE_WEBHOOK_ENDPOINT: 'create_webhook_endpoint',
  UPDATE_WEBHOOK_ENDPOINT: 'update_webhook_endpoint',
  ROTATE_WEBHOOK_SECRET: 'rotate_webhook_secret',
  LIST_WEBHOOK_DELIVERIES: 'list_webhook_deliveries',
  REPLAY_WEBHOOK_DELIVERY: 'replay_webhook_delivery',
  REPLAY_WEBHOOK_DEAD_LETTERS: 'replay_webhook_dead_letters',

  CREATE_CHECKOUT_SESSION: 'create_checkout_session',

  LIST_AGENT_SESSIONS: 'list_agent_sessions',
  GET_AGENT_POLICY: 'get_agent_policy',
  LIST_AGENT_ACTIONS: 'list_agent_actions',

  LIST_MERCHANT_PLANS: 'list_merchant_plans',
  CREATE_MERCHANT_PLAN: 'create_merchant_plan',
  UPDATE_MERCHANT_PLAN: 'update_merchant_plan',
  DELETE_MERCHANT_PLAN: 'delete_merchant_plan',
  CREATE_MERCHANT_SUBSCRIPTION: 'create_merchant_subscription',
  LIST_MERCHANT_SUBSCRIPTIONS: 'list_merchant_subscriptions',
  GET_MERCHANT_SUBSCRIPTION: 'get_merchant_subscription',
  GET_MERCHANT_SUBSCRIPTION_BY_USER: 'get_merchant_subscription_by_user',
  CHANGE_MERCHANT_SUBSCRIPTION_PLAN: 'change_merchant_subscription_plan',
  CANCEL_MERCHANT_SUBSCRIPTION: 'cancel_merchant_subscription',
  RESUME_MERCHANT_SUBSCRIPTION: 'resume_merchant_subscription',
  LIST_MERCHANT_INVOICES: 'list_merchant_invoices',
  GET_MERCHANT_INVOICE: 'get_merchant_invoice',
  PAY_MERCHANT_INVOICE: 'pay_merchant_invoice',
  GET_MERCHANT_INVOICE_PAYMENT_STATUS: 'get_merchant_invoice_payment_status',
  GET_MERCHANT_SUBSCRIPTION_SETTINGS: 'get_merchant_subscription_settings',
  UPDATE_MERCHANT_SUBSCRIPTION_SETTINGS: 'update_merchant_subscription_settings',
  CREATE_MERCHANT_PORTAL_SESSION: 'create_merchant_portal_session',
  REVOKE_MERCHANT_PORTAL_SESSION: 'revoke_merchant_portal_session',

  REQUEST_ACTION_APPROVAL: 'request_action_approval',
} as const

export type AgentToolName = (typeof AgentToolName)[keyof typeof AgentToolName]
