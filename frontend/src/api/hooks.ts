// 数据层：TanStack Query 封装。所有 URL 与 docs/superpowers/plans/2026-07-06-mini-jira.md 对齐。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, CONFLICT_TOAST, isConflictError } from './client'
import { useToast } from '../components/ui'
import type {
  ApiToken,
  Board,
  Burndown,
  CapacityEntry,
  CloseSprintInput,
  Comment,
  CreateEpicInput,
  CreateInviteInput,
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  CreateTokenInput,
  CreatedApiToken,
  Dashboard,
  Epic,
  Invite,
  Member,
  MyTenant,
  Project,
  Roadmap,
  Sprint,
  SprintWithTasks,
  Task,
  UpdateEpicInput,
  UpdateProjectInput,
  UpdateTaskInput,
  Activity,
} from './types'

// ---------- Query Keys ----------

export const qk = {
  myTenants: ['me', 'tenants'] as const,
  myTokens: ['me', 'tokens'] as const,
  projects: (slug: string) => [slug, 'projects'] as const,
  backlog: (slug: string, key: string) => [slug, 'projects', key, 'backlog'] as const,
  dashboard: (slug: string, key: string) => [slug, 'projects', key, 'dashboard'] as const,
  roadmap: (slug: string, key: string) => [slug, 'projects', key, 'roadmap'] as const,
  epics: (slug: string, key: string) => [slug, 'projects', key, 'epics'] as const,
  sprints: (slug: string, key: string, withTasks: boolean) =>
    [slug, 'projects', key, 'sprints', { withTasks }] as const,
  task: (slug: string, taskId: number) => [slug, 'tasks', taskId] as const,
  board: (slug: string, sprintId: number) => [slug, 'sprints', sprintId, 'board'] as const,
  capacity: (slug: string, sprintId: number) => [slug, 'sprints', sprintId, 'capacity'] as const,
  burndown: (slug: string, sprintId: number) => [slug, 'sprints', sprintId, 'burndown'] as const,
  comments: (slug: string, taskId: number) => [slug, 'tasks', taskId, 'comments'] as const,
  activities: (slug: string, taskId: number) => [slug, 'tasks', taskId, 'activities'] as const,
  members: (slug: string) => [slug, 'members'] as const,
  search: (slug: string, q: string) => [slug, 'search', q] as const,
}

const t = (slug: string) => `/api/t/${slug}`

// ---------- 个人 ----------

export function useMyTenants() {
  return useQuery({
    queryKey: qk.myTenants,
    queryFn: () => api<MyTenant[]>('/api/me/tenants'),
  })
}

// ---------- 项目 ----------

export function useProjects(slug: string) {
  return useQuery({
    queryKey: qk.projects(slug),
    queryFn: () => api<Project[]>(`${t(slug)}/projects`),
    enabled: !!slug,
  })
}

export function useCreateProject(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<Project>(`${t(slug)}/projects`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects(slug) }),
  })
}

/** 项目设置：默认周期 / auto_rotate / 改名（仅 ADMIN） */
export function useUpdateProject(slug: string, key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      api<Project>(`${t(slug)}/projects/${key}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects(slug) }),
  })
}

// ---------- 任务 ----------

export function useBacklog(slug: string, key: string) {
  return useQuery({
    queryKey: qk.backlog(slug, key),
    queryFn: () => api<Task[]>(`${t(slug)}/projects/${key}/backlog`),
    enabled: !!slug && !!key,
  })
}

export function useCreateTask(slug: string, key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      api<Task>(`${t(slug)}/projects/${key}/tasks`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // 任务归属可能影响 backlog/board/dashboard/sprints，统一失效租户下缓存
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

/** 全租户关键词搜索（标题/描述，跨项目跨负责人，后端限 20 条） */
export function useSearchTasks(slug: string, q: string) {
  return useQuery({
    queryKey: qk.search(slug, q),
    queryFn: () =>
      api<import('./types').SearchHit[]>(`${t(slug)}/tasks/search?q=${encodeURIComponent(q)}`),
    enabled: !!slug && q.trim().length >= 1,
    staleTime: 10_000,
  })
}

/** 任务详情（TaskDrawer 用）：GET /api/t/{slug}/tasks/{id} */
export function useTask(slug: string, taskId: number | null | undefined) {
  return useQuery({
    queryKey: qk.task(slug, taskId ?? -1),
    queryFn: () => api<Task>(`${t(slug)}/tasks/${taskId}`),
    enabled: !!slug && taskId != null,
  })
}

export function useUpdateTask(slug: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: number }) =>
      api<Task>(`${t(slug)}/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
    // 乐观锁 409（F9）：统一提示「重取后重试」，并失效租户缓存让打开中的表单回填最新值
    onError: (err) => {
      if (isConflictError(err)) {
        toast.show(CONFLICT_TOAST, 'info')
        qc.invalidateQueries({ queryKey: [slug] })
      }
    },
  })
}

// ---------- 看板 ----------

export function useBoard(slug: string, sprintId: number | null | undefined) {
  return useQuery({
    queryKey: qk.board(slug, sprintId ?? -1),
    queryFn: () => api<Board>(`${t(slug)}/sprints/${sprintId}/board`),
    enabled: !!slug && sprintId != null,
  })
}

// ---------- Dashboard ----------

export function useDashboard(slug: string, key: string) {
  return useQuery({
    queryKey: qk.dashboard(slug, key),
    queryFn: () => api<Dashboard>(`${t(slug)}/projects/${key}/dashboard`),
    enabled: !!slug && !!key,
  })
}

// ---------- Sprint ----------

export function useSprints(slug: string, key: string, withTasks = false) {
  return useQuery({
    queryKey: qk.sprints(slug, key, withTasks),
    queryFn: () =>
      withTasks
        ? api<SprintWithTasks[]>(`${t(slug)}/projects/${key}/sprints?withTasks=true`)
        : api<Sprint[]>(`${t(slug)}/projects/${key}/sprints`),
    enabled: !!slug && !!key,
  })
}

export function useCreateSprint(slug: string, key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSprintInput) =>
      api<Sprint>(`${t(slug)}/projects/${key}/sprints`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

export function useStartSprint(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sprintId: number) =>
      api<Sprint>(`${t(slug)}/sprints/${sprintId}/start`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

export function useCloseSprint(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sprintId, ...input }: CloseSprintInput & { sprintId: number }) =>
      api<Sprint>(`${t(slug)}/sprints/${sprintId}/close`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

// ---------- 容量 ----------

export function useCapacity(slug: string, sprintId: number | null | undefined) {
  return useQuery({
    queryKey: qk.capacity(slug, sprintId ?? -1),
    queryFn: () => api<CapacityEntry[]>(`${t(slug)}/sprints/${sprintId}/capacity`),
    enabled: !!slug && sprintId != null,
  })
}

/** 容量 override upsert */
export function useSetCapacity(slug: string, sprintId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, capacity }: { userId: number; capacity: number }) =>
      api<void>(`${t(slug)}/sprints/${sprintId}/capacity/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ capacity }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.capacity(slug, sprintId) }),
  })
}

// ---------- 燃尽图 ----------

export function useBurndown(slug: string, sprintId: number | null | undefined) {
  return useQuery({
    queryKey: qk.burndown(slug, sprintId ?? -1),
    queryFn: () => api<Burndown>(`${t(slug)}/sprints/${sprintId}/burndown`),
    enabled: !!slug && sprintId != null,
  })
}

// ---------- Epic / 路线图 ----------

export function useRoadmap(slug: string, key: string) {
  return useQuery({
    queryKey: qk.roadmap(slug, key),
    queryFn: () => api<Roadmap>(`${t(slug)}/projects/${key}/roadmap`),
    enabled: !!slug && !!key,
  })
}

export function useEpics(slug: string, key: string) {
  return useQuery({
    queryKey: qk.epics(slug, key),
    queryFn: () => api<Epic[]>(`${t(slug)}/projects/${key}/epics`),
    enabled: !!slug && !!key,
  })
}

export function useCreateEpic(slug: string, key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEpicInput) =>
      api<Epic>(`${t(slug)}/projects/${key}/epics`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

export function useUpdateEpic(slug: string, key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateEpicInput & { id: number }) =>
      api<Epic>(`${t(slug)}/projects/${key}/epics/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

// ---------- 评论 / 变更历史 ----------

export function useComments(slug: string, taskId: number | null | undefined) {
  return useQuery({
    queryKey: qk.comments(slug, taskId ?? -1),
    queryFn: () => api<Comment[]>(`${t(slug)}/tasks/${taskId}/comments`),
    enabled: !!slug && taskId != null,
  })
}

export function useCreateComment(slug: string, taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      api<Comment>(`${t(slug)}/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.comments(slug, taskId) }),
  })
}

export function useActivities(slug: string, taskId: number | null | undefined) {
  return useQuery({
    queryKey: qk.activities(slug, taskId ?? -1),
    queryFn: () => api<Activity[]>(`${t(slug)}/tasks/${taskId}/activities`),
    enabled: !!slug && taskId != null,
  })
}

// ---------- 邀请 / 成员 ----------

export function useCreateInvite(slug: string) {
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      api<Invite>(`${t(slug)}/invites`, { method: 'POST', body: JSON.stringify(input) }),
  })
}

export function useMembers(slug: string) {
  return useQuery({
    queryKey: qk.members(slug),
    queryFn: () => api<Member[]>(`${t(slug)}/members`),
    enabled: !!slug,
  })
}

/** 移出租户成员（仅 ADMIN）：DELETE /api/t/{slug}/members/{userId}。
 *  409 code：CANNOT_REMOVE_SELF / LAST_ADMIN。被移出者未完成任务转未指派，故失效整租户缓存。 */
export function useRemoveMember(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => api<void>(`${t(slug)}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [slug] }),
  })
}

// ---------- PAT ----------

export function useTokens() {
  return useQuery({
    queryKey: qk.myTokens,
    queryFn: () => api<ApiToken[]>('/api/me/tokens'),
  })
}

export function useCreateToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTokenInput) =>
      api<CreatedApiToken>('/api/me/tokens', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.myTokens }),
  })
}

export function useRevokeToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.myTokens }),
  })
}
