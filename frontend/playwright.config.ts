import { defineConfig, devices } from '@playwright/test'

// 后端地址：默认 dev 8080，可用 PM_API_TARGET 覆盖（如 8080 被占用时起在 8081）
const apiTarget = process.env.PM_API_TARGET || 'http://localhost:8080'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // 先 npm run build 生成 dist，再由 preview 静态托管 + /api 代理到后端
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    env: { PM_API_TARGET: apiTarget },
  },
})
