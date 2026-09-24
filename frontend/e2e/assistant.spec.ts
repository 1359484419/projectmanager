// 助手面板全链路 e2e（plan Task 10 Step 3）：真模型 + Java 反代 + Python 服务都要在跑。
// 注册（API）+ 登录（UI）→ API 造数：项目 + 启动的 Sprint + 3 个冒烟任务
// → 看板打开助手 → 「把冒烟任务一改成进行中」→ 确认卡 → 「确认执行」→ 看板「进行中」列出现该任务
// → 「删除冒烟任务三」→ 红卡（L3）→ 「取消」→ 看板仍有 3 张卡、API 里任务仍在。
// 选择器对齐 AssistantPanel / ConfirmCard 的 role/aria-label；断言只看语义与副作用，不绑模型文案。
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
const slug = `ast-${runId}`.slice(0, 32)
const email = `ast-${runId}@example.com`
const password = 'secret123'
const PROJECT_KEY = 'AST'
const TASKS = ['冒烟任务一', '冒烟任务二', '冒烟任务三']
// 真模型一次往返（含工具调用）通常 5-20s，留足余量
const LLM_TIMEOUT = 90_000

async function apiJson<T = Record<string, unknown>>(
  request: APIRequestContext,
  method: 'get' | 'post',
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await request[method](path, {
    headers: { Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { data: body }),
  })
  expect(res.ok(), `${method.toUpperCase()} ${path} -> ${res.status()}`).toBeTruthy()
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** 看板某一列（Board.tsx 的 Column 容器带 data-column=状态） */
function column(page: Page, status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'DONE') {
  return page.locator(`[data-column="${status}"]`)
}

async function say(page: Page, text: string) {
  const panel = page.getByRole('dialog', { name: '助手' })
  await panel.getByRole('textbox', { name: '助手' }).fill(text)
  await panel.getByRole('button', { name: '发送' }).click()
}

test.describe.configure({ timeout: 300_000 })

test('助手：确认卡改状态 → 看板列变化；删除红卡取消 → 任务仍在', async ({ page, request }) => {
  test.skip(process.env.PM_ASSISTANT_E2E === '0', '显式关闭助手 e2e（PM_ASSISTANT_E2E=0）')

  // ---------- 1. 注册（API）+ UI 登录（拿到 localStorage token，与真实用户一致） ----------
  const registerRes = await request.post('/api/auth/register', {
    data: { email, password, displayName: '助手冒烟用户', tenantName: '助手冒烟租户', tenantSlug: slug },
  })
  expect(registerRes.ok(), `register -> ${registerRes.status()}`).toBeTruthy()
  const token = (await registerRes.json()).accessToken as string
  await page.goto('/login')
  await page.getByPlaceholder('you@acme.io').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/tenants')

  // ---------- 2. API 造数：项目 + 启动的 Sprint + 3 任务 ----------
  await apiJson(request, 'post', `/api/t/${slug}/projects`, token, { key: PROJECT_KEY, name: '助手冒烟项目' })
  const sprint = await apiJson<{ id: number }>(request, 'post', `/api/t/${slug}/projects/${PROJECT_KEY}/sprints`, token, {})
  await apiJson(request, 'post', `/api/t/${slug}/sprints/${sprint.id}/start`, token)
  const created: { id: number; displayKey: string }[] = []
  for (const title of TASKS) {
    created.push(await apiJson(request, 'post', `/api/t/${slug}/projects/${PROJECT_KEY}/tasks`, token, {
      type: 'TASK',
      title,
      points: 1,
      sprintId: sprint.id,
    }))
  }

  // 助手服务健康（经 Java 反代不可达时 503 → 前端错误卡；这里先快速失败给出明确原因）
  const threadRes = await request.post(`/api/t/${slug}/assistant/threads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  })
  expect(threadRes.status(), '助手服务应可达（PM_ASSISTANT_URL → uvicorn :8090）').toBe(200)

  // ---------- 3. 看板打开助手 ----------
  await page.goto(`/t/${slug}/board?project=${PROJECT_KEY}`)
  await expect(column(page, 'TODO').getByText('冒烟任务一')).toBeVisible()
  await page.getByRole('button', { name: '助手', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '助手' })
  await expect(panel).toBeVisible()

  // ---------- 4. 「把冒烟任务一改成进行中」→ 确认卡 → 确认执行 ----------
  await say(page, '把冒烟任务一改成进行中')
  const card = panel.getByRole('group', { name: /^需要你确认：/ })
  await expect(card).toBeVisible({ timeout: LLM_TIMEOUT })
  await expect(card).toHaveAttribute('data-risk', 'L2')
  await expect(card).toContainText('冒烟任务一')
  await expect(card).toContainText('进行中')

  const resumeDone = page.waitForResponse(
    (res) => res.url().includes('/assistant/threads/') && res.url().includes('/resume') && res.ok(),
    { timeout: LLM_TIMEOUT },
  )
  await card.getByRole('button', { name: '确认执行' }).click()
  await resumeDone
  await expect(card.getByText('已执行')).toBeVisible({ timeout: LLM_TIMEOUT })   // 执行成功（tool_result ok）后的卡片态，不是提交即成功

  // 看板「进行中」列出现该任务（写入成功后前端失效 [slug] 查询缓存）
  await expect(column(page, 'IN_PROGRESS').getByText('冒烟任务一')).toBeVisible({ timeout: LLM_TIMEOUT })
  const changed = await apiJson<{ status: string }>(request, 'get', `/api/t/${slug}/tasks/${created[0].id}`, token)
  expect(changed.status).toBe('IN_PROGRESS')

  // ---------- 5. 「删除冒烟任务三」→ 红卡（L3）→ 取消 ----------
  await say(page, '删除冒烟任务三')
  const redCard = panel.getByRole('group', { name: /^需要你确认：删除任务/ })
  await expect(redCard).toBeVisible({ timeout: LLM_TIMEOUT })
  await expect(redCard).toHaveAttribute('data-risk', 'L3')
  await expect(redCard.getByRole('button', { name: '确认删除' })).toBeVisible()

  const rejectDone = page.waitForResponse(
    (res) => res.url().includes('/assistant/threads/') && res.url().includes('/resume') && res.ok(),
    { timeout: LLM_TIMEOUT },
  )
  await redCard.getByRole('button', { name: '取消', exact: true }).click()
  await rejectDone
  await expect(redCard.getByText('已取消')).toBeVisible({ timeout: LLM_TIMEOUT })

  // 任务仍在：看板 3 张卡都在，API 能取到任务三
  for (const title of TASKS) await expect(page.locator('[data-column]').getByText(title)).toBeVisible()
  const still = await apiJson<{ status: string; title: string }>(request, 'get', `/api/t/${slug}/tasks/${created[2].id}`, token)
  expect(still.title).toBe('冒烟任务三')
  const board = await apiJson<{ columns: Record<string, unknown[]> }>(request, 'get', `/api/t/${slug}/sprints/${sprint.id}/board`, token)
  expect(Object.values(board.columns).flat()).toHaveLength(3)
})
