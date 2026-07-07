// 全链路冒烟（plan Task 26）：
// 注册（随机 slug）→ 建项目 → Backlog 建 3 任务 → 建 Sprint 并启动 → 任务移入 Sprint
// → 看板拖到 DONE → Dashboard 计数正确 → 报表燃尽图 SVG 存在 → All Sprints 出现该 Sprint。
import { expect, test, type Page } from '@playwright/test'

const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
const slug = `smoke-${runId}`.slice(0, 32)
const email = `smoke-${runId}@example.com`
const password = 'secret123'
const PROJECT_KEY = 'SMK'

const TASKS = [
  { title: '冒烟任务一', points: '3' },
  { title: '冒烟任务二', points: '2' },
  { title: '冒烟任务三', points: '1' },
]

async function nav(page: Page, label: string) {
  await page.getByRole('link', { name: label, exact: true }).click()
}

test('注册到报表全链路冒烟', async ({ page }) => {
  // ---------- 1. 注册（随机 slug） ----------
  await page.goto('/login')
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await page.getByPlaceholder('邮箱').fill(email)
  await page.getByPlaceholder('密码').fill(password)
  await page.getByPlaceholder('显示名').fill('冒烟用户')
  await page.getByPlaceholder('租户名（团队/公司名）').fill('冒烟租户')
  await page.getByPlaceholder(/租户 slug/).fill(slug)
  await page.getByRole('button', { name: '注册并创建租户' }).click()
  await page.waitForURL(`**/t/${slug}/dashboard`)
  await expect(page.getByText('当前租户还没有项目')).toBeVisible()

  // ---------- 2. Admin 页建项目 ----------
  await nav(page, 'Admin')
  await page.getByLabel('项目 Key').fill(PROJECT_KEY)
  await page.getByLabel('项目名称').fill('冒烟项目')
  await page.getByRole('button', { name: '新建项目' }).click()
  await expect(page.getByRole('cell', { name: new RegExp(PROJECT_KEY) })).toBeVisible()

  // ---------- 3. Backlog 建 3 任务 ----------
  await nav(page, 'Backlog')
  for (const t of TASKS) {
    await page.getByLabel('任务标题').fill(t.title)
    await page.getByLabel('points').fill(t.points)
    await page.getByRole('button', { name: '创建', exact: true }).click()
    await expect(page.getByText(t.title)).toBeVisible()
  }

  // ---------- 4. All Sprints 建 Sprint 并启动 ----------
  await nav(page, 'All Sprints')
  await page.getByRole('button', { name: '新建 Sprint' }).click()
  await expect(page.getByText('Sprint 1')).toBeVisible()
  await page.getByRole('button', { name: '启动 Sprint 1', exact: true }).click()
  await expect(page.getByText('Active', { exact: true })).toBeVisible()

  // ---------- 5. Backlog 三任务移入当前 Sprint ----------
  await nav(page, 'Backlog')
  for (let i = 0; i < TASKS.length; i++) {
    // 每次移走一个后 backlog 重新渲染，始终操作第一行的「移入 Sprint」下拉
    const select = page.getByLabel(/^移入 Sprint（/).first()
    await expect(select).toBeVisible()
    await select.selectOption({ label: '当前：Sprint 1' })
    // 移入后该任务从 backlog 消失
    await expect(page.getByLabel(/^移入 Sprint（/)).toHaveCount(TASKS.length - 1 - i)
  }
  await expect(page.getByText('Backlog 是空的', { exact: false })).toBeVisible()

  // ---------- 6. 看板拖「冒烟任务一」到 DONE ----------
  await nav(page, 'Board')
  await expect(page.getByText('Sprint 1')).toBeVisible()
  const card = page.getByText('冒烟任务一')
  await expect(card).toBeVisible()
  const cardBox = (await card.boundingBox())!
  const doneHeader = page.getByText('Done', { exact: true })
  const doneBox = (await doneHeader.boundingBox())!

  const patchDone = page.waitForResponse(
    (res) => res.url().includes('/api/t/') && res.url().includes('/tasks/')
      && res.request().method() === 'PATCH' && res.ok(),
  )
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  // dnd-kit PointerSensor distance=4：分步移动触发拖拽
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 })
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + 100, { steps: 15 })
  await page.mouse.up()
  await patchDone

  // ---------- 7. Dashboard 计数正确 ----------
  await nav(page, 'Dashboard')
  await expect(page.getByText(/剩余/)).toBeVisible()
  // API 真值校验：TODO=2, DONE=1；donePct = 3/6 = 50%
  const dashboard = await page.evaluate(async (args) => {
    const res = await fetch(`/api/t/${args.slug}/projects/${args.key}/dashboard`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    })
    return res.json()
  }, { slug, key: PROJECT_KEY })
  expect(dashboard.counts.TODO).toBe(2)
  expect(dashboard.counts.IN_PROGRESS).toBe(0)
  expect(dashboard.counts.COMPLETED).toBe(0)
  expect(dashboard.counts.DONE).toBe(1)
  expect(dashboard.donePct).toBe(50)
  // UI：DONE 分组里能看到任务一
  const doneGroup = page.locator('section').filter({ has: page.getByText('Done', { exact: true }) })
  await expect(doneGroup.getByText('冒烟任务一')).toBeVisible()

  // ---------- 8. 报表燃尽图 SVG 存在 ----------
  await nav(page, 'Reports')
  await expect(page.locator('svg.recharts-surface').first()).toBeVisible({ timeout: 15_000 })

  // ---------- 9. All Sprints 出现该 Sprint（含任务） ----------
  await nav(page, 'All Sprints')
  await expect(page.getByText('Sprint 1')).toBeVisible()
  await expect(page.getByText('冒烟任务二')).toBeVisible()
})
