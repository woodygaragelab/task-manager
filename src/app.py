"""
task-mcp-server
================
DynamoDB(Tasks / TaskCases / TaskCounters)を操作する MCP サーバー。
AWS Lambda 上で FastMCP (Streamable HTTP, stateless) として動作する。

CRUDロジック本体は共通モジュール task_repository(Lambda Layer)に分離してあり、
task-api(Web API用Lambda)と共有する。

重要: StreamableHTTPSessionManager.run() はインスタンスごとに1回しか呼べない制約があるため、
FastMCP インスタンス(と Starlette app)はモジュールレベルで1つだけ作らず、
Lambda の呼び出し(invocation)ごとに build_app() で新規作成する。
stateless_http=True 構成はこの使い方を前提にしている。
"""

import os
from ipaddress import ip_address, ip_network

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mangum import Mangum
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

import task_repository as repo

MCP_AUTH_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")

TOOL_FUNCTIONS = [
    repo.create_task,
    repo.get_task,
    repo.update_task,
    repo.list_tasks_by_customer,
    repo.search_customer_names,
    repo.link_email,
]


# ----------------------------------------------------------------------
# アクセス制御ミドルウェア。以下のいずれかを満たせば許可する:
#   1) Authorization: Bearer <MCP_AUTH_TOKEN> が一致する
#      (Claude Desktop + mcp-remote 経由。woody PCのネットワークから直接アクセス)
#   2) 送信元IPがAnthropicの公開アウトバウンドIPレンジ内
#      (claude.ai / モバイルアプリのカスタムコネクタ経由。Anthropicのクラウドから接続)
# 参照: https://platform.claude.com/docs/en/api/ip-addresses
# ----------------------------------------------------------------------
ANTHROPIC_OUTBOUND_RANGES = [
    ip_network("160.79.104.0/21"),
]


def _is_anthropic_ip(client_host: str | None) -> bool:
    if not client_host:
        return False
    try:
        addr = ip_address(client_host)
    except ValueError:
        return False
    return any(addr in net for net in ANTHROPIC_OUTBOUND_RANGES)


class AccessControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        auth_header = request.headers.get("authorization", "")
        token_ok = bool(MCP_AUTH_TOKEN) and auth_header == f"Bearer {MCP_AUTH_TOKEN}"
        client_host = request.client.host if request.client else None
        ip_ok = _is_anthropic_ip(client_host)
        if not (token_ok or ip_ok):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


# ----------------------------------------------------------------------
# Lambda 呼び出しごとに FastMCP インスタンス(と Starlette app)を新規作成する
# ----------------------------------------------------------------------
def build_app():
    mcp = FastMCP(
        "task-manager",
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False
        ),
    )
    for fn in TOOL_FUNCTIONS:
        mcp.add_tool(fn)

    app = mcp.streamable_http_app()
    app.add_middleware(AccessControlMiddleware)
    return app


# ----------------------------------------------------------------------
# Lambda エントリポイント(Streamable HTTP, Function URL経由)
# ----------------------------------------------------------------------
def handler(event, context):
    app = build_app()
    asgi_handler = Mangum(app, lifespan="auto")
    return asgi_handler(event, context)
