import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 字体在 index.css 顶部通过 @import 引入（@fontsource-variable 包无 TS 类型声明）
import './index.css'
import App from './App.tsx'
import { applyStoredTheme } from './components/Layout'

// 首帧前恢复主题（dark 默认，light 加 .light 类）
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
