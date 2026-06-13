import { defineConfig } from 'vitest/config'

// 经 InMemoryTransport 把 Client 与本包的 McpServer 连成一对，真实走 callTool；
// 注入路由式 fake fetch，不触网。无需 globals，测试显式从 vitest 导入。
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.spec.ts'],
  },
})
