import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import AcceptInvite from './pages/AcceptInvite'
import TenantSelect from './pages/TenantSelect'
import Dashboard from './pages/Dashboard'
import Backlog from './pages/Backlog'
import Board from './pages/Board'
import AllSprints from './pages/AllSprints'
import Planning from './pages/Planning'
import Reports from './pages/Reports'
import Roadmap from './pages/Roadmap'
import TenantAdmin from './pages/TenantAdmin'
import Settings from './pages/Settings'

const queryClient = new QueryClient()

// 租户内布局路由：Task 15 将替换为带侧边导航的 Layout 组件
function TenantLayout() {
  return <Outlet />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/tenants" element={<TenantSelect />} />
          <Route path="/t/:slug" element={<TenantLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="backlog" element={<Backlog />} />
            <Route path="board" element={<Board />} />
            <Route path="sprints" element={<AllSprints />} />
            <Route path="planning" element={<Planning />} />
            <Route path="reports" element={<Reports />} />
            <Route path="roadmap" element={<Roadmap />} />
            <Route path="admin" element={<TenantAdmin />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
