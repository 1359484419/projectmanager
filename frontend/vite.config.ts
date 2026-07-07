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
  build: {
    rollupOptions: {
      output: {
        // code-split（F11）：把重依赖拆出主 chunk（目标主 chunk < 300KB）。
        // - recharts 目前源码未引用（燃尽图为手写 SVG），规则保留以防未来引入即自动拆分
        // - dnd-kit 仅看板/规划页用；react 全家桶单独 vendor（缓存友好，应用代码热更不失效）
        // Vite 8（Rolldown）的 manualChunks 仅支持函数形式。
        manualChunks(id: string) {
          if (
            id.includes('node_modules/recharts') ||
            id.includes('node_modules/victory-vendor') ||
            id.includes('node_modules/d3-')
          ) {
            return 'recharts'
          }
          if (id.includes('node_modules/@dnd-kit/')) return 'dndkit'
          if (
            id.includes('node_modules/react') || // react / react-dom / react-router*
            id.includes('node_modules/scheduler') ||
            id.includes('node_modules/@tanstack/')
          ) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
})
