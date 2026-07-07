// 与后端 JSON 逐字段对齐的类型定义（真源：docs/superpowers/plans/2026-07-06-mini-jira.md）

// ---------- 枚举 ----------

export type Role = 'ADMIN' | 'MEMBER'
export type TaskType = 'STORY' | 'BUG' | 'TASK'
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'DONE'
export type SprintLength = 'WEEK_1' | 'WEEK_2' | 'MONTH_1'
export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED'
export type EpicStatus = 'OPEN' | 'DONE'
export type ActivitySource = 'WEB' | 'MCP'

// ---------- 认证 / 个人 ----------

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface MyTenant {
  slug: string
  name: string
  role: Role
}

// ---------- 项目 ----------

export interface Project {
  id: number
  key: string
  name: string
  defaultSprintLength: SprintLength
  autoRotate: boolean
}

export interface CreateProjectInput {
  key: string
  name: string
}

export interface UpdateProjectInput {
  name?: string
  defaultSprintLength?: SprintLength
  autoRotate?: boolean
}

// ---------- 任务 ----------

export interface Task {
  id: number
  projectId: number
  sprintId: number | null
  epicId: number | null
  type: TaskType
  seq: number
  title: string
  description: string | null
  points: number | null
  assigneeId: number | null
  assigneeName?: string | null
  status: TaskStatus
  rank: string
  createdAt: string
  doneAt: string | null
}

/** 列表/看板/分组场景的精简任务（dashboard groups、roadmap tasks、withTasks 等） */
export interface TaskBrief {
  id: number
  seq: number
  type: TaskType
  title: string
  status: TaskStatus
  points: number | null
  assigneeId?: number | null
  assigneeName?: string | null
  /** 描述摘要（后端截断到 200 字符，无描述为 null） */
  description?: string | null
}

/** 全租户关键词搜索命中（GET /api/t/{slug}/tasks/search?q=） */
export interface SearchHit extends TaskBrief {
  displayKey: string
  projectKey: string
}

export interface CreateTaskInput {
  type: TaskType
  title: string
  description?: string
  points?: number
  epicId?: number
  sprintId?: number
  assigneeId?: number
}

/** PATCH /api/t/{slug}/tasks/{id} 请求体（rank 传 after/before 由后端计算） */
export interface UpdateTaskInput {
  type?: TaskType
  status?: TaskStatus
  points?: number | null
  assigneeId?: number | null
  epicId?: number | null
  sprintId?: number | null
  title?: string
  description?: string | null
  rank?: { afterTaskId?: number; beforeTaskId?: number }
}

// ---------- Epic / 路线图 ----------

export interface Epic {
  id: number
  projectId?: number
  name: string
  description: string | null
  quarter: string | null
  color: string | null
  status: EpicStatus
}

export interface CreateEpicInput {
  name: string
  description?: string
  /** "2026-Q3" 格式 */
  quarter?: string
  color?: string
}

export interface UpdateEpicInput {
  name?: string
  description?: string | null
  quarter?: string | null
  color?: string | null
  status?: EpicStatus
}

export interface RoadmapEpic {
  id: number
  name: string
  color: string | null
  status: EpicStatus
  donePoints: number
  totalPoints: number
  tasks: TaskBrief[]
}

export interface RoadmapGroup {
  quarter: string | null
  epics: RoadmapEpic[]
}

export type Roadmap = RoadmapGroup[]

// ---------- Sprint ----------

export interface Sprint {
  id: number
  projectId?: number
  name: string
  length: SprintLength
  startDate: string
  endDate: string
  status: SprintStatus
}

export interface SprintWithTasks extends Sprint {
  tasks: TaskBrief[]
}

export interface CreateSprintInput {
  name?: string
  length?: SprintLength
  startDate?: string
}

export interface CloseSprintInput {
  unfinished: 'BACKLOG' | 'MOVE'
  targetSprintId?: number
}

// ---------- 容量 ----------

export interface CapacityEntry {
  userId: number
  displayName: string
  capacity: number
  assignedPoints: number
}

// ---------- 燃尽图 ----------

export interface BurndownDay {
  date: string
  remaining: number
  ideal: number
}

export interface Burndown {
  days: BurndownDay[]
}

// ---------- Dashboard ----------

export interface DashboardSprint {
  id: number
  name: string
  endDate: string
  daysLeft: number
}

export interface Dashboard {
  sprint: DashboardSprint | null
  counts: Record<TaskStatus, number>
  donePct: number
  groups: Record<TaskStatus, TaskBrief[]>
}

// ---------- 看板 ----------

export interface Board {
  sprint: Sprint | null
  columns: Record<TaskStatus, TaskBrief[]>
}

// ---------- 评论 / 变更历史 ----------

export interface Comment {
  id: number
  taskId?: number
  authorId: number
  authorName?: string
  body: string
  createdAt: string
}

export interface Activity {
  id: number
  taskId?: number
  actorId: number
  actorName?: string
  type: string
  oldValue: string | null
  newValue: string | null
  source?: ActivitySource
  at: string
}

// ---------- 邀请 / 成员 ----------

export interface CreateInviteInput {
  role: Role
}

export interface Invite {
  token: string
  url: string
  expiresAt: string
}

export interface Member {
  userId: number
  displayName: string
  email: string
  role: Role
}

// ---------- PAT ----------

export interface ApiToken {
  id: number
  name: string
  tenantSlug: string
  createdAt: string
  lastUsedAt: string | null
}

/** 创建响应：明文 token 只返回这一次 */
export interface CreatedApiToken extends ApiToken {
  token: string
}

export interface CreateTokenInput {
  name: string
  tenantSlug: string
}
