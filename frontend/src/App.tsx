import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import { ToastProvider } from './components/ui'
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

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/tenants" element={<TenantSelect />} />
          <Route path="/t/:slug" element={<Layout />}>
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
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
