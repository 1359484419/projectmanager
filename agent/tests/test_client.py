import httpx, pytest, respx
from app.harness.auth import RequestCtx, set_ctx, reset_ctx
from app.tools._client import PmClient, PmApiError, client

CTX = RequestCtx(jwt="jwt1", tenant="acme", user_id=7, project_key="PM", page=None)

@respx.mock
async def test_headers_and_path():
    route = respx.get("http://pm/api/t/acme/projects").mock(return_value=httpx.Response(200, json=[{"key": "PM"}]))
    c = PmClient(CTX, base_url="http://pm")
    assert await c.get("/projects") == [{"key": "PM"}]
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Bearer jwt1"
    assert req.headers["X-PM-Source"] == "AGENT"

@respx.mock
async def test_bearer_prefix_not_doubled():
    route = respx.get("http://pm/api/t/acme/projects").mock(return_value=httpx.Response(200, json=[]))
    ctx = RequestCtx(jwt="Bearer jwt2", tenant="acme", user_id=7, project_key=None, page=None)
    await PmClient(ctx, base_url="http://pm").get("/projects")
    assert route.calls.last.request.headers["Authorization"] == "Bearer jwt2"

@respx.mock
async def test_query_params():
    route = respx.get("http://pm/api/t/acme/tasks/search").mock(return_value=httpx.Response(200, json=[]))
    await PmClient(CTX, base_url="http://pm").get("/tasks/search", params={"q": "登录"})
    assert route.calls.last.request.url.params["q"] == "登录"

@respx.mock
async def test_error_mapping():
    respx.patch("http://pm/api/t/acme/tasks/1").mock(return_value=httpx.Response(409, json={"code": "CONFLICT", "message": "x"}))
    with pytest.raises(PmApiError) as e:
        await PmClient(CTX, base_url="http://pm").patch("/tasks/1", json={"status": "DONE"})
    assert (e.value.status, e.value.code) == (409, "CONFLICT")

@respx.mock
async def test_error_mapping_non_json_body():
    respx.get("http://pm/api/t/acme/projects").mock(return_value=httpx.Response(404, text="<html>nope</html>"))
    with pytest.raises(PmApiError) as e:
        await PmClient(CTX, base_url="http://pm").get("/projects")
    assert (e.value.status, e.value.code) == (404, "HTTP_404")

@respx.mock
async def test_get_retries_on_5xx_but_write_does_not():
    g = respx.get("http://pm/api/t/acme/members").mock(side_effect=[httpx.Response(502), httpx.Response(200, json=[])])
    assert await PmClient(CTX, base_url="http://pm").get("/members") == []
    assert g.call_count == 2
    p = respx.post("http://pm/api/t/acme/projects/PM/tasks").mock(return_value=httpx.Response(502))
    with pytest.raises(PmApiError):
        await PmClient(CTX, base_url="http://pm").post("/projects/PM/tasks", json={})
    assert p.call_count == 1

@respx.mock
async def test_get_retry_exhausted():
    g = respx.get("http://pm/api/t/acme/members").mock(return_value=httpx.Response(503))
    with pytest.raises(PmApiError) as e:
        await PmClient(CTX, base_url="http://pm").get("/members")
    assert e.value.status == 503
    assert g.call_count == 3  # 1 + get_max_retries(2)

@respx.mock
async def test_get_retries_on_connect_error_write_does_not():
    g = respx.get("http://pm/api/t/acme/members").mock(side_effect=[httpx.ConnectError("boom"), httpx.Response(200, json=[])])
    assert await PmClient(CTX, base_url="http://pm").get("/members") == []
    assert g.call_count == 2
    d = respx.delete("http://pm/api/t/acme/tasks/1").mock(side_effect=httpx.ConnectError("boom"))
    with pytest.raises(PmApiError) as e:
        await PmClient(CTX, base_url="http://pm").delete("/tasks/1")
    assert d.call_count == 1
    assert e.value.code == "CONNECTION_ERROR"

@respx.mock
async def test_empty_body_returns_none():
    respx.delete("http://pm/api/t/acme/tasks/1").mock(return_value=httpx.Response(204))
    assert await PmClient(CTX, base_url="http://pm").delete("/tasks/1") is None

@respx.mock
async def test_put_sends_json():
    route = respx.put("http://pm/api/t/acme/sprints/3/capacity/7").mock(return_value=httpx.Response(200, json={"capacity": 5}))
    assert await PmClient(CTX, base_url="http://pm").put("/sprints/3/capacity/7", json={"capacity": 5}) == {"capacity": 5}
    assert route.calls.last.request.headers["Content-Type"].startswith("application/json")

@respx.mock
async def test_client_factory_uses_context_and_settings():
    route = respx.get("http://pm/api/t/acme/projects").mock(return_value=httpx.Response(200, json=[]))
    token = set_ctx(CTX)
    try:
        assert await client().get("/projects") == []
    finally:
        reset_ctx(token)
    assert route.calls.last.request.headers["Authorization"] == "Bearer jwt1"
    with pytest.raises(RuntimeError):
        client()
