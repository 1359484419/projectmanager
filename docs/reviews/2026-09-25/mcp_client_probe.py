import asyncio, json, sys, os, time
for k in list(os.environ):
    if k.lower().endswith('_proxy'): os.environ.pop(k)
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client, create_mcp_http_client

URL = "http://localhost:8081/mcp"
PAT = open("pat.txt").read().strip()
LOG = []

def show(tag, res):
    err = getattr(res, "is_error", None)
    texts = [c.text for c in res.content if getattr(c, "type", "") == "text"]
    body = texts[0] if texts else str(res.content)
    if len(body) > 700: body = body[:700] + "...<truncated>"
    print(f"[{tag}] isError={err} structured={res.structured_content is not None}\n  {body}")
    LOG.append({"tag": tag, "isError": err, "body": body})

async def main():
    headers = {"Authorization": f"Bearer {PAT}"}
    async with streamable_http_client(URL, http_client=create_mcp_http_client(headers=headers)) as streams:
        r, w = streams[0], streams[1]; get_sid = (lambda: streams[2]()) if len(streams) > 2 else (lambda: None)
        async with ClientSession(r, w) as s:
            init = await s.initialize()
            print("server:", init.server_info, "proto:", init.protocol_version, "caps:", init.capabilities, "instructions:", init.instructions)
            print("session id:", get_sid())
            tools = await s.list_tools()
            print(f"\n=== tools/list: {len(tools.tools)} tools")
            for t in tools.tools:
                print(f"- {t.name}: title={t.title!r} annotations={t.annotations} outputSchema={t.output_schema is not None}")
                print("  desc:", t.description)
                print("  schema:", json.dumps(t.input_schema, ensure_ascii=False))
            async def call(tag, name, args):
                t0=time.time()
                try:
                    res = await s.call_tool(name, args)
                    show(f"{tag} {int((time.time()-t0)*1000)}ms", res)
                    return res
                except Exception as e:
                    print(f"[{tag}] EXCEPTION {type(e).__name__}: {e}")
                    LOG.append({"tag": tag, "exception": str(e)})
            print("\n=== 读工具")
            await call("list_projects", "list_projects", {})
            await call("list_sprints", "list_sprints", {"projectKey": "KB"})
            await call("list_sprints lower", "list_sprints", {"projectKey": "kb"})
            await call("list_epics", "list_epics", {"projectKey": "KB"})
            await call("list_my_tasks empty", "list_my_tasks", {"projectKey": "KB"})
            print("\n=== 写：把今天做的事建成任务挂 sprint")
            await call("create_tasks 3", "create_tasks", {"projectKey": "KB", "target": "current_sprint", "tasks": [
                {"type": "TASK", "title": "修复助手面板 SSE 断流", "points": 1, "description": "线上反馈：长回复时断开"},
                {"type": "STORY", "title": "助手支持语音输入", "points": 1.5, "epicId": 2},
                {"type": "BUG", "title": "看板拖拽偶发闪回"},
            ]})
            print("\n=== 推进状态")
            await call("status KB-1 IN_PROGRESS", "update_task_status", {"taskSeq": "KB-1", "status": "IN_PROGRESS"})
            await call("status KB-2 COMPLETED", "update_task_status", {"taskSeq": "KB-2", "status": "COMPLETED"})
            await call("status kb-3 lower done", "update_task_status", {"taskSeq": "kb-3", "status": "done"})
            await call("status KB-3 DONE", "update_task_status", {"taskSeq": "KB-3", "status": "DONE"})
            print("\n=== 日报：list_my_tasks current/previous")
            await call("list_my_tasks current", "list_my_tasks", {"projectKey": "KB", "sprint": "current"})
            await call("list_my_tasks previous", "list_my_tasks", {"projectKey": "KB", "sprint": "previous"})
            await call("list_my_tasks next(invalid)", "list_my_tasks", {"projectKey": "KB", "sprint": "next"})
            print("\n=== next_sprint 自动预建 + backlog")
            await call("create_tasks next_sprint", "create_tasks", {"projectKey": "KB", "target": "next_sprint", "tasks": [{"type": "TASK", "title": "下个迭代：整理 MCP 评审"}]})
            await call("create_tasks backlog", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": "待办：补 MCP 测试"}]})
            await call("list_sprints after", "list_sprints", {"projectKey": "KB"})
            print("\n=== 错误可读性")
            await call("bad project", "list_sprints", {"projectKey": "NOPE"})
            await call("missing projectKey", "list_sprints", {})
            await call("bad points 0.3", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": "x", "points": 0.3}]})
            await call("points as string", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": "points 字符串", "points": "2"}]})
            await call("unknown field assignee", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": "带 assignee", "assignee": "me"}]})
            await call("type RECORD", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "RECORD", "title": "记录"}]})
            await call("type lowercase", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "task", "title": "小写 type"}]})
            await call("bad target", "create_tasks", {"projectKey": "KB", "target": "sprint", "tasks": [{"type": "TASK", "title": "x"}]})
            await call("epicId 9999", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": "epic 不存在", "epicId": 9999}]})
            await call("21 tasks", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": f"t{i}"} for i in range(21)]})
            await call("empty title", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": ""}]})
            await call("title with quote/newline", "create_tasks", {"projectKey": "KB", "target": "backlog", "tasks": [{"type": "TASK", "title": 'a"b\nc'}]})
            await call("seq no dash", "update_task_status", {"taskSeq": "42", "status": "DONE"})
            await call("seq missing", "update_task_status", {"taskSeq": "KB-999", "status": "DONE"})
            await call("seq other project", "update_task_status", {"taskSeq": "PM-1", "status": "DONE"})
            await call("bad status", "update_task_status", {"taskSeq": "KB-1", "status": "CLOSED"})
            await call("unknown tool", "get_task", {"taskKey": "KB-1"})
            await call("wrong arg name", "update_task_status", {"task_key": "KB-1", "status": "DONE"})
    json.dump(LOG, open("calls.json", "w"), ensure_ascii=False, indent=1)

asyncio.run(main())
