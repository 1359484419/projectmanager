// 多用户链路 e2e（F12 增补）：
// admin API 注册租户/建项目/启动 Sprint/生成邀请 → member 走 accept 页 UI 加入
// → member API 建两个任务（一个指派 admin、一个指派自己）→ admin UI 登录：
// 看板默认「只看我的」能看到指派给自己的任务；成员筛选行点 member 头像后只剩 member 的任务
// → 租户管理页移出 member → 成员列表少一人。
// 造数尽量走 API（register/projects/sprints/invites/tasks），UI 只走需要回归的交互面。
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
const slug = `mu-${runId}`.slice(0, 32)
const password = 'secret123'
const adminEmail = `mu-admin-${runId}@example.com`
const memberEmail = `mu-member-${runId}@example.com`
const ADMIN_NAME = '多用户管理员'
const MEMBER_NAME = '多用户成员'
const PROJECT_KEY = 'MUL'
const TASK_FOR_ADMIN = '成员指派给管理员的任务'
const TASK_FOR_MEMBER = '成员留给自己的任务'
const EPIC_NAME = '成员可见的长期计划'
const EPIC_QUARTER = '2026-Q3'

/** 带 Bearer 的 API 调用（走 preview 4173 的 /api 代理），非 2xx 直接抛错让用例 fail fast */
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

async function nav(page: Page, label: string) {
  await page.getByRole('link', { name: new RegExp(`^${label}`) }).click()
}

test('多用户：邀请加入-指派筛选-移出成员全链路', async ({ page, request }) => {
  // ---------- 1. API 造数：admin 注册租户 ----------
  const registerRes = await request.post('/api/auth/register', {
    data: {
      email: adminEmail,
      password,
      displayName: ADMIN_NAME,
      tenantName: '多用户租户',
      tenantSlug: slug,
    },
  })
  expect(registerRes.ok()).toBeTruthy()
  const adminToken = (await registerRes.json()).accessToken as string

  // 项目 + Sprint（启动，供看板用）
  await apiJson(request, 'post', `/api/t/${slug}/projects`, adminToken, {
    key: PROJECT_KEY,
    name: '多用户项目',
  })
  const sprint = await apiJson<{ id: number }>(
    request,
    'post',
    `/api/t/${slug}/projects/${PROJECT_KEY}/sprints`,
    adminToken,
    {},
  )
  await apiJson(request, 'post', `/api/t/${slug}/sprints/${sprint.id}/start`, adminToken)

  // 邀请 token（MEMBER 角色）
  const invite = await apiJson<{ token: string }>(
    request,
    'post',
    `/api/t/${slug}/invites`,
    adminToken,
    { role: 'MEMBER' },
  )

  // ---------- 2. member 走 accept 页 UI 加入 ----------
  await page.goto(`/accept-invite?token=${invite.token}`)
  // 链接里已带令牌：令牌不再以可编辑输入框裸露（P2），直接填账号信息
  await expect(page.getByPlaceholder('粘贴邀请令牌')).toHaveCount(0)
  await page.getByPlaceholder('you@acme.io').fill(memberEmail)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByPlaceholder('张三').fill(MEMBER_NAME)
  await page.getByRole('button', { name: '加入团队' }).click()
  await page.waitForURL('**/tenants')

  // ---------- 3. member API 建任务：一个指派 admin、一个指派自己 ----------
  const memberToken = await page.evaluate(() => localStorage.getItem('accessToken'))
  expect(memberToken).toBeTruthy()
  const members = await apiJson<{ userId: number; displayName: string }[]>(
    request,
    'get',
    `/api/t/${slug}/members`,
    memberToken!,
  )
  expect(members).toHaveLength(2)
  const adminId = members.find((m) => m.displayName === ADMIN_NAME)!.userId
  const memberId = members.find((m) => m.displayName === MEMBER_NAME)!.userId

  for (const { title, assigneeId } of [
    { title: TASK_FOR_ADMIN, assigneeId: adminId },
    { title: TASK_FOR_MEMBER, assigneeId: memberId },
  ]) {
    await apiJson(request, 'post', `/api/t/${slug}/projects/${PROJECT_KEY}/tasks`, memberToken!, {
      type: 'TASK',
      title,
      points: 1,
      sprintId: sprint.id,
      assigneeId,
    })
  }

  // ---------- 3b. 成员视角（审查 2026-09-25 #3）：迭代 启动/关闭/删除 与 删除长期计划 对 MEMBER 不可见 ----------
  // 造一个长期计划（创建是全员权限），供路线图编辑弹窗断言
  await apiJson(request, 'post', `/api/t/${slug}/projects/${PROJECT_KEY}/epics`, memberToken!, {
    name: EPIC_NAME,
    quarter: EPIC_QUARTER,
  })
  await page.goto(`/t/${slug}/sprints`)
  await expect(page.getByText('进行中', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '启动', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '删除迭代' })).toHaveCount(0)
  await page.goto(`/t/${slug}/roadmap`)
  await page.getByRole('button', { name: EPIC_NAME, exact: true }).click()
  const memberEpicDialog = page.getByRole('dialog', { name: '编辑长期计划' })
  await expect(memberEpicDialog).toBeVisible()
  await expect(memberEpicDialog.getByRole('button', { name: '删除长期计划' })).toHaveCount(0)
  await expect(memberEpicDialog.getByRole('button', { name: '保存' })).toBeVisible()

  // ---------- 4. admin UI 登录（换账号） ----------
  await page.goto('/login')
  await page.getByPlaceholder('you@acme.io').fill(adminEmail)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/tenants')

  // ---------- 4b. 管理员视角正向对照：同样的控件对 ADMIN 可见（保证上面的 toHaveCount(0) 不是选择器失效） ----------
  await page.goto(`/t/${slug}/sprints`)
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveCount(1)
  await page.goto(`/t/${slug}/roadmap`)
  await page.getByRole('button', { name: EPIC_NAME, exact: true }).click()
  const adminEpicDialog = page.getByRole('dialog', { name: '编辑长期计划' })
  await expect(adminEpicDialog.getByRole('button', { name: '删除长期计划' })).toBeVisible()
  await adminEpicDialog.getByRole('button', { name: '取消' }).click()

  // ---------- 5. 看板默认「只看我的」：能看到指派给自己的任务，看不到 member 的 ----------
  await page.goto(`/t/${slug}/board`)
  await expect(page.getByText(TASK_FOR_ADMIN)).toBeVisible()
  await expect(page.getByText('只看我的（含未指派）')).toBeVisible()
  await expect(page.getByText(TASK_FOR_MEMBER)).toHaveCount(0)

  // ---------- 6. 成员筛选行点 member 头像：只剩 member 的任务 ----------
  await page.locator(`[role="button"][title="${MEMBER_NAME}"]`).click()
  await expect(page.getByText(TASK_FOR_MEMBER)).toBeVisible()
  await expect(page.getByText(TASK_FOR_ADMIN)).toHaveCount(0)

  // ---------- 7. 租户管理：移出 member，成员列表少一人 ----------
  await nav(page, '租户管理')
  // 侧栏底部也显示当前用户邮箱（P2 头像显示名），成员列表断言限定到主内容区
  await expect(page.getByRole('main').getByText(memberEmail)).toBeVisible()
  await expect(page.getByRole('main').getByText(adminEmail)).toBeVisible()
  await page.getByLabel(`移出租户（${MEMBER_NAME}）`).click()
  await page
    .getByRole('dialog', { name: `将 ${MEMBER_NAME} 移出租户？` })
    .getByRole('button', { name: '移出租户', exact: true })
    .click()
  await expect(page.getByText(`已将 ${MEMBER_NAME} 移出租户`)).toBeVisible()
  await expect(page.getByRole('main').getByText(memberEmail)).toHaveCount(0)
  await expect(page.getByRole('main').getByText(adminEmail)).toBeVisible()
  // API 真值兜底：成员列表只剩 admin 一人
  const after = await apiJson<{ userId: number }[]>(
    request,
    'get',
    `/api/t/${slug}/members`,
    adminToken,
  )
  expect(after).toHaveLength(1)
  expect(after[0].userId).toBe(adminId)
})
