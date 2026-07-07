import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端地址可用 PM_API_TARGET 覆盖（如本机 8080 被占用时的 e2e 场景）
const apiTarget = process.env.PM_API_TARGET || 'http://localhost:8080'
const proxy = {
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
