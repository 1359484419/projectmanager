"""MCP prompts：把 skill/SKILL.md 的三个模板搬进 server，没装 skill 的客户端（Cursor 等）也拿得到。

只产出文字模板与调用步骤，不做任何请求；参数只有 project_key / notes。
"""

DAILY_TEMPLATE = """## 日报 · {YYYY-MM-DD} · {姓名}

**今日完成**
- {XX-0} {标题}（{天数}天）

**进行中**
- {XX-0} {标题} — {一句话进展}

**待办 / 明日计划**
- {XX-0} {标题}

**风险 / 阻塞**
- {无则写"无"}"""

WEEKLY_TEMPLATE = """## 周报 · {YYYY-Www} · {姓名}

**本周完成**（合计 {N} 天）
- {XX-0} {标题}（{天数}天）

**进行中 / 结转下周**
- {XX-0} {标题} — {进展与预计完成时间}

**下周计划**
- {计划项}

**问题与需要的支持**
- {无则写"无"}"""


# 「今日完成」的唯一判定规则（skill/SKILL.md 流程 2 与这里逐字一致，tests/test_docs_sync.py 比对）：
# 后端 TaskView.statusChangedAt 只在状态变更时推进（改标题/描述不动它），比 updatedAt 准；doneAt 只在进入 DONE 时写，不够用。
DONE_TODAY_RULE = "status 为 COMPLETED 或 DONE 且 statusChangedAt 是今天 → 今日完成"


def _pk(project_key: str | None) -> str:
    return f', project_key="{project_key}"' if project_key else ""


def daily_report(project_key: str | None = None) -> str:
    return (
        "请帮我写今天的日报。步骤：\n"
        f'1. 调 list_my_work(scope="current"{_pk(project_key)}) 取我在当前迭代的任务（进行中 / 今日完成从这里来，'
        f'每行带 statusChangedAt）；再调 list_my_work(scope="current"{_pk(project_key)}, '
        'status_changed_since="今天的日期") 只拿今天状态变过的，作「今日完成」候选；'
        f'待办池另调 list_my_work(scope="backlog"{_pk(project_key)})。'
        '不要用 scope="all"：它会遍历全部已关闭迭代，迭代越多请求越多，只有要补更早迭代的任务时才用。\n'
        f"2. 归组：{DONE_TODAY_RULE}；迭代里早先就已 COMPLETED/DONE 的不算今天；IN_PROGRESS → 进行中"
        "（进展用 description 摘要、子任务进度 subtaskDone/subtaskTotal，需要更多细节再 get_task 看评论）；"
        "TODO → 待办 / 明日计划。\n"
        "3. 按下面模板只输出文字，不要创建或修改任何任务：\n\n" + DAILY_TEMPLATE
    )


def weekly_report(project_key: str | None = None) -> str:
    return (
        "请帮我写周报。步骤：\n"
        f'1. 调 list_my_work(scope="current"{_pk(project_key)}, status_changed_since="本周一的日期") 与 '
        f'list_my_work(scope="previous"{_pk(project_key)}, status_changed_since="本周一的日期") 拉出本周状态变过的任务；'
        f'进行中 / 结转的再看 list_my_work(scope="current"{_pk(project_key)}) 全量。\n'
        "2. 「本周完成」= status 为 COMPLETED 或 DONE 且 statusChangedAt 在本周，天数小计 = 这些任务 points 之和；"
        "进行中的写进展与预计完成时间。\n"
        "3. 按下面模板只输出文字，不要创建或修改任何任务：\n\n" + WEEKLY_TEMPLATE
    )


def plan_from_notes(notes: str) -> str:
    return (
        "把下面的工作记录整理成任务并创建。步骤：\n"
        "1. 每条整理成 {type: STORY/BUG/TASK, title: 动宾短语一句话, description?, points?}；天数不确定就留空，不要编造。\n"
        "2. 需要挂长期计划或指定负责人时，先 get_project_overview / list_members 核对名称。\n"
        '3. 先调 create_tasks(dry_run=true, sprint="current|next|backlog", tasks=[...]) 拿预览，'
        "把清单（标题/类型/天数/负责人/长期计划/迭代）表格展示给我确认。\n"
        "4. 我确认后再去掉 dry_run 正式创建（单次 ≤20 条，更多分批），把返回的展示号回显给我；failed 逐条说明原因。\n\n"
        "<notes>\n" + notes.strip() + "\n</notes>"
    )
