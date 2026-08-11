"""
AgentCore Runtime entrypoint.

Wraps Claude Agent SDK (query) with BedrockAgentCoreApp, and exposes
Google Drive access as an in-process (SDK) MCP server backed by a
Google service account. This avoids the AgentCore Identity 3LO
(user-federation) OAuth flow entirely, which has a known unresolved
bug (see awslabs/agentcore-samples#801) where the callback never
receives authorizationCode/state.

Also exposes taskmanager's client master (TaskClients) as an in-process
MCP tool, backed by task_repository (the same DynamoDB CRUD module used
by taskmanager-mcp/taskmanager-api/taskmanager-agent-job-processor).
Unlike the old receipt-agent, which lived in a separate repository and
had to reach the client master over HTTP via taskmanager's own MCP
Function URL, task-agent lives in the taskmanager repo itself: the build
step copies layer/python/task_repository.py into this directory (see
the Dockerfile) so it can be imported directly, avoiding an extra
network hop and a separate Bearer token just to read one table.

The Google service account/user key is fetched from AWS Secrets Manager
at runtime; it is never baked into the container image or committed to
the repository.

Local run:
    export CLAUDE_CODE_USE_BEDROCK=1
    export ANTHROPIC_MODEL=global.anthropic.claude-sonnet-4-6
    export AWS_REGION=ap-northeast-1
    export GOOGLE_SA_SECRET_NAME=receipt-agent/google-drive-sa
    export TASKS_TABLE=Tasks CLIENTS_TABLE=TaskClients SERIES_TABLE=TaskSeries \
           FRAMES_TABLE=TaskFrames HISTORY_TABLE=TaskHistory AGENT_JOBS_TABLE=TaskAgentJobs \
           CLASSIFICATION_RULES_TABLE=TaskClassificationRules
    python task_agent.py

Deploy:
    agentcore configure --entrypoint task_agent.py --region ap-northeast-1
    agentcore launch
"""
import json
import logging
import os

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    create_sdk_mcp_server,
    query,
    tool,
)
from google.oauth2.credentials import Credentials as UserCredentials
from googleapiclient.discovery import build as build_drive_service
from googleapiclient.http import MediaIoBaseDownload

import task_repository as repo

app = BedrockAgentCoreApp()
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
GOOGLE_USER_TOKEN_SECRET_NAME = os.environ.get(
    "GOOGLE_USER_TOKEN_SECRET_NAME", "task-agent/google-drive-user-token"
)
# Gmail scopes must be present in the stored refresh token (see
# get_refresh_token.py's SCOPES). gmail.readonly for reading messages,
# gmail.modify for label management (read/create/apply labels) -- neither
# scope permits sending or deleting mail.
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]

_drive_service = None  # cached per-container
_gmail_service = None  # cached per-container
_google_token_info = None  # cached per-container (shared secret for both services)


def _get_google_token_info() -> dict:
    global _google_token_info
    if _google_token_info is not None:
        return _google_token_info
    secrets_client = boto3.client("secretsmanager", region_name=AWS_REGION)
    secret_value = secrets_client.get_secret_value(SecretId=GOOGLE_USER_TOKEN_SECRET_NAME)
    _google_token_info = json.loads(secret_value["SecretString"])
    return _google_token_info


def _get_drive_service():
    """Build (and cache) a Google Drive v3 client using a real user's
    OAuth refresh token (stored in Secrets Manager), instead of a service
    account. Files created this way are owned by the actual Google
    account and therefore have normal storage quota -- service accounts
    do not, which is why the earlier service-account approach failed with
    "Service Accounts do not have storage quota" on upload."""
    global _drive_service
    if _drive_service is not None:
        return _drive_service

    token_info = _get_google_token_info()
    credentials = UserCredentials(
        token=None,  # force a refresh on first use
        refresh_token=token_info["refresh_token"],
        client_id=token_info["client_id"],
        client_secret=token_info["client_secret"],
        token_uri=token_info["token_uri"],
        scopes=token_info.get("scopes", DRIVE_SCOPES),
    )
    _drive_service = build_drive_service(
        "drive", "v3", credentials=credentials, cache_discovery=False
    )
    return _drive_service


def _get_gmail_service():
    """Build (and cache) a Gmail v1 client, reusing the same stored refresh
    token as Drive (the token must include GMAIL_SCOPES -- see
    get_refresh_token.py). If the token was issued before Gmail scopes were
    added, re-run get_refresh_token.py and update the secret, or this will
    fail with insufficient-scope errors on first call."""
    global _gmail_service
    if _gmail_service is not None:
        return _gmail_service

    token_info = _get_google_token_info()
    credentials = UserCredentials(
        token=None,
        refresh_token=token_info["refresh_token"],
        client_id=token_info["client_id"],
        client_secret=token_info["client_secret"],
        token_uri=token_info["token_uri"],
        scopes=token_info.get("scopes", GMAIL_SCOPES),
    )
    _gmail_service = build_drive_service(
        "gmail", "v1", credentials=credentials, cache_discovery=False
    )
    return _gmail_service


# ---------------------------------------------------------------------------
# Custom Google Drive tools.
# Names intentionally match what the receipt-ocr-filelist SKILL.md already
# expects (search_files / download_file_content / create_file / trash_file /
# get_file_metadata), so the skill itself needs no changes.
# ---------------------------------------------------------------------------


@tool(
    "search_files",
    "Search Google Drive for files/folders. `query` uses Drive API v3 query "
    "syntax, e.g. \"'PARENT_ID' in parents and trashed=false\".",
    {"query": str},
)
async def search_files(args: dict) -> dict:
    service = _get_drive_service()
    files, page_token = [], None
    while True:
        resp = (
            service.files()
            .list(
                q=args["query"],
                fields="nextPageToken, files(id, name, mimeType, parents)",
                pageSize=200,
                pageToken=page_token,
            )
            .execute()
        )
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    logger.info(
        "search_files query=%r -> %d result(s): %s",
        args["query"], len(files), [(f["id"], f["name"]) for f in files],
    )
    return {"content": [{"type": "text", "text": json.dumps(files, ensure_ascii=False)}]}


@tool(
    "get_file_metadata",
    "Get metadata (name, mimeType, parents, etc.) for a Drive file.",
    {"file_id": str},
)
async def get_file_metadata(args: dict) -> dict:
    service = _get_drive_service()
    meta = (
        service.files()
        .get(fileId=args["file_id"], fields="id, name, mimeType, parents, createdTime, modifiedTime")
        .execute()
    )
    return {"content": [{"type": "text", "text": json.dumps(meta, ensure_ascii=False)}]}


@tool(
    "download_file_content",
    "Download a Drive file directly to a local path inside the container "
    "(e.g. /tmp/IKK/receipt/foo.jpg). Does NOT return the file content "
    "itself, to avoid exceeding the MCP message size limit for large "
    "images/PDFs — read the saved file afterwards with the Read tool.",
    {"file_id": str, "save_path": str},
)
async def download_file_content(args: dict) -> dict:
    import io
    import os as _os

    service = _get_drive_service()
    request = service.files().get_media(fileId=args["file_id"])
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    save_path = args["save_path"]
    _os.makedirs(_os.path.dirname(save_path), exist_ok=True)
    with open(save_path, "wb") as f:
        f.write(buffer.getvalue())

    logger.info(
        "download_file_content file_id=%s -> %s (%d bytes)",
        args["file_id"], save_path, buffer.tell(),
    )
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {"saved_path": save_path, "size_bytes": buffer.tell()},
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "create_file",
    "Upload a file already saved on local disk (e.g. under /tmp/...) to "
    "Drive under a parent folder. Reads the file from `local_path` "
    "directly, so large images/PDFs never pass through the MCP message "
    "channel.",
    {"local_path": str, "name": str, "parent_id": str, "mime_type": str},
)
async def create_file(args: dict) -> dict:
    from googleapiclient.http import MediaFileUpload

    service = _get_drive_service()
    logger.info(
        "create_file BEGIN name=%r parent_id=%s local_path=%s",
        args["name"], args["parent_id"], args["local_path"],
    )
    media = MediaFileUpload(args["local_path"], mimetype=args["mime_type"], resumable=False)
    file_metadata = {"name": args["name"], "parents": [args["parent_id"]]}
    created = service.files().create(body=file_metadata, media_body=media, fields="id, name").execute()
    logger.info("create_file END name=%r -> file_id=%s", args["name"], created.get("id"))
    return {"content": [{"type": "text", "text": json.dumps(created, ensure_ascii=False)}]}


@tool(
    "trash_file",
    "Move a Drive file to trash (reversible; never permanently deletes).",
    {"file_id": str},
)
async def trash_file(args: dict) -> dict:
    service = _get_drive_service()
    logger.info("trash_file BEGIN file_id=%s", args["file_id"])
    service.files().update(fileId=args["file_id"], body={"trashed": True}).execute()
    logger.info("trash_file END file_id=%s", args["file_id"])
    return {"content": [{"type": "text", "text": f"trashed:{args['file_id']}"}]}


google_drive_server = create_sdk_mcp_server(
    name="google-drive",
    version="1.0.0",
    tools=[
        search_files,
        get_file_metadata,
        download_file_content,
        create_file,
        trash_file,
    ],
)


# ---------------------------------------------------------------------------
# Custom Gmail tools (email-summary skill).
# Read-only + label management scopes only (gmail.readonly, gmail.modify);
# these tools cannot send or permanently delete mail. Reuses the same
# stored refresh token as Drive -- see _get_gmail_service()'s docstring for
# the scope caveat.
# ---------------------------------------------------------------------------


@tool(
    "list_labels",
    "List all Gmail labels for the authenticated account (id, name, type).",
    {},
)
async def list_labels(args: dict) -> dict:
    service = _get_gmail_service()
    resp = service.users().labels().list(userId="me").execute()
    labels = resp.get("labels", [])
    return {"content": [{"type": "text", "text": json.dumps(labels, ensure_ascii=False)}]}


@tool(
    "create_label",
    "Create a new Gmail label. Fails if a label with the same name already "
    "exists -- call list_labels first and skip creation if it's already there.",
    {"name": str},
)
async def create_label(args: dict) -> dict:
    service = _get_gmail_service()
    created = (
        service.users()
        .labels()
        .create(userId="me", body={"name": args["name"]})
        .execute()
    )
    return {"content": [{"type": "text", "text": json.dumps(created, ensure_ascii=False)}]}


@tool(
    "search_threads",
    "Search Gmail using Gmail search syntax, e.g. \"label:inbox "
    "-label:処理済み\". Returns thread/message ids only -- call get_message "
    "for each id to read subject/sender/body/attachments.",
    {"query": str},
)
async def search_threads(args: dict) -> dict:
    service = _get_gmail_service()
    messages, page_token = [], None
    while True:
        resp = (
            service.users()
            .messages()
            .list(userId="me", q=args["query"], pageToken=page_token, maxResults=100)
            .execute()
        )
        messages.extend(resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    logger.info("search_threads query=%r -> %d message(s)", args["query"], len(messages))
    return {"content": [{"type": "text", "text": json.dumps(messages, ensure_ascii=False)}]}


def _extract_header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _walk_parts(part: dict, out: dict) -> None:
    """Collect plain-text body and attachment metadata from a (possibly
    nested multipart) message payload."""
    mime_type = part.get("mimeType", "")
    filename = part.get("filename") or ""
    body = part.get("body", {})
    if filename and body.get("attachmentId"):
        out["attachments"].append(
            {
                "filename": filename,
                "mimeType": mime_type,
                "attachmentId": body["attachmentId"],
                "sizeBytes": body.get("size", 0),
            }
        )
    elif mime_type == "text/plain" and body.get("data") and not out["bodyText"]:
        import base64

        out["bodyText"] = base64.urlsafe_b64decode(body["data"]).decode("utf-8", errors="replace")
    for sub in part.get("parts", []) or []:
        _walk_parts(sub, out)


@tool(
    "get_message",
    "Get one Gmail message's headers (From/To/Cc/Subject/Date), plain-text "
    "body, and attachment list (filename/attachmentId/size, no binary "
    "data). Use get_attachment to actually download an attachment.",
    {"message_id": str},
)
async def get_message(args: dict) -> dict:
    service = _get_gmail_service()
    msg = (
        service.users()
        .messages()
        .get(userId="me", id=args["message_id"], format="full")
        .execute()
    )
    headers = msg.get("payload", {}).get("headers", [])
    out = {
        "id": msg["id"],
        "threadId": msg["threadId"],
        "labelIds": msg.get("labelIds", []),
        "from": _extract_header(headers, "From"),
        "to": _extract_header(headers, "To"),
        "cc": _extract_header(headers, "Cc"),
        "subject": _extract_header(headers, "Subject"),
        "date": _extract_header(headers, "Date"),
        "bodyText": "",
        "attachments": [],
    }
    _walk_parts(msg.get("payload", {}), out)
    return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]}


@tool(
    "get_attachment",
    "Download one Gmail attachment (by message_id + attachmentId from "
    "get_message) directly to a local path inside the container (e.g. "
    "/tmp/IKK/mail/foo.pdf). Does NOT return the file content itself -- "
    "read the saved file afterwards, or upload it with "
    "mcp__google-drive__create_file.",
    {"message_id": str, "attachment_id": str, "save_path": str},
)
async def get_attachment(args: dict) -> dict:
    import base64
    import os as _os

    service = _get_gmail_service()
    att = (
        service.users()
        .messages()
        .attachments()
        .get(userId="me", messageId=args["message_id"], id=args["attachment_id"])
        .execute()
    )
    data = base64.urlsafe_b64decode(att["data"])
    save_path = args["save_path"]
    _os.makedirs(_os.path.dirname(save_path), exist_ok=True)
    with open(save_path, "wb") as f:
        f.write(data)
    logger.info(
        "get_attachment message_id=%s attachment_id=%s -> %s (%d bytes)",
        args["message_id"], args["attachment_id"], save_path, len(data),
    )
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {"saved_path": save_path, "size_bytes": len(data)}, ensure_ascii=False
                ),
            }
        ]
    }


@tool(
    "label_message",
    "Add a Gmail label to one message (e.g. mark it as 処理済み after "
    "successfully recording it in taskmanager history).",
    {"message_id": str, "label_id": str},
)
async def label_message(args: dict) -> dict:
    service = _get_gmail_service()
    updated = (
        service.users()
        .messages()
        .modify(
            userId="me",
            id=args["message_id"],
            body={"addLabelIds": [args["label_id"]]},
        )
        .execute()
    )
    return {"content": [{"type": "text", "text": json.dumps(updated, ensure_ascii=False)}]}


gmail_server = create_sdk_mcp_server(
    name="gmail",
    version="1.0.0",
    tools=[
        list_labels,
        create_label,
        search_threads,
        get_message,
        get_attachment,
        label_message,
    ],
)


# ---------------------------------------------------------------------------
# taskmanager client master tool, backed directly by task_repository
# (no network hop / no separate MCP auth token needed now that this code
# lives in the same repository and container image).
# ---------------------------------------------------------------------------


@tool(
    "list_clients",
    "List all registered taskmanager clients (clientCode, clientName, "
    "receiptFolderId, renamedFolderId, senderEmails, uketoriFolderId).",
    {},
)
async def list_clients(args: dict) -> dict:
    clients = repo.list_clients()
    return {"content": [{"type": "text", "text": json.dumps(clients, ensure_ascii=False)}]}


@tool(
    "list_history",
    "List history entries for a taskmanager client (historyId, date, "
    "category, assignee, status, content), sorted by category then date.",
    {"client_code": str},
)
async def list_history(args: dict) -> dict:
    entries = repo.list_history(args["client_code"])
    return {"content": [{"type": "text", "text": json.dumps(entries, ensure_ascii=False)}]}


@tool(
    "update_history_entry",
    "Update one history entry's date/category/series_code/frame_codes/"
    "assignee/status/content. status must be exactly one of: 未着手, 依頼中, "
    "確認中, 進行中, 完了, -. Omit frame_codes to leave the existing target "
    "months unchanged.",
    {
        "type": "object",
        "properties": {
            "client_code": {"type": "string"},
            "history_id": {"type": "string"},
            "date": {"type": "string"},
            "category": {"type": "string"},
            "series_code": {"type": "string"},
            "frame_codes": {"type": "array", "items": {"type": "string"}},
            "assignee": {"type": "string"},
            "status": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": [
            "client_code",
            "history_id",
            "date",
            "category",
            "series_code",
            "assignee",
            "status",
            "content",
        ],
    },
)
async def update_history_entry(args: dict) -> dict:
    updated = repo.update_history_entry(
        client_code=args["client_code"],
        history_id=args["history_id"],
        date=args["date"],
        category=args["category"],
        series_code=args["series_code"],
        frame_codes=args.get("frame_codes"),
        assignee=args["assignee"],
        status=args["status"],
        content=args["content"],
    )
    return {"content": [{"type": "text", "text": json.dumps(updated, ensure_ascii=False)}]}


@tool(
    "create_history_entry",
    "Create one new history entry for a taskmanager client (date/category/"
    "series_code/frame_codes/assignee/status/content). status must be "
    "exactly one of: 未着手, 依頼中, 確認中, 進行中, 完了, -.",
    {
        "client_code": str,
        "date": str,
        "category": str,
        "series_code": str,
        "frame_codes": list[str],
        "assignee": str,
        "status": str,
        "content": str,
    },
)
async def create_history_entry(args: dict) -> dict:
    created = repo.create_history_entry(
        client_code=args["client_code"],
        date=args["date"],
        category=args["category"],
        series_code=args["series_code"],
        frame_codes=args["frame_codes"],
        assignee=args["assignee"],
        status=args["status"],
        content=args["content"],
    )
    return {"content": [{"type": "text", "text": json.dumps(created, ensure_ascii=False)}]}


@tool(
    "list_frames",
    "List all registered taskmanager frames (frameCode in YYYYMM format, "
    "frameName).",
    {},
)
async def list_frames(args: dict) -> dict:
    frames = repo.list_frames()
    return {"content": [{"type": "text", "text": json.dumps(frames, ensure_ascii=False)}]}


task_manager_server = create_sdk_mcp_server(
    name="task-manager",
    version="1.0.0",
    tools=[
        list_clients,
        list_history,
        update_history_entry,
        create_history_entry,
        list_frames,
    ],
)


def build_agent_options() -> ClaudeAgentOptions:
    """Single place where the agent's tool/skill configuration is defined."""
    return ClaudeAgentOptions(
        cwd=PROJECT_ROOT,
        allowed_tools=[
            "Read",
            "Write",
            "Bash",
            "Skill",
            "mcp__google-drive__search_files",
            "mcp__google-drive__get_file_metadata",
            "mcp__google-drive__download_file_content",
            "mcp__google-drive__create_file",
            "mcp__google-drive__trash_file",
            "mcp__gmail__list_labels",
            "mcp__gmail__create_label",
            "mcp__gmail__search_threads",
            "mcp__gmail__get_message",
            "mcp__gmail__get_attachment",
            "mcp__gmail__label_message",
            "mcp__task-manager__list_clients",
            "mcp__task-manager__list_history",
            "mcp__task-manager__update_history_entry",
            "mcp__task-manager__create_history_entry",
            "mcp__task-manager__list_frames",
        ],
        mcp_servers={
            "google-drive": google_drive_server,
            "gmail": gmail_server,
            "task-manager": task_manager_server,
        },
        system_prompt=(
            "You support tax-accounting BPO operations for Ikkoh K.K. "
            "For receipt-processing requests, always use the matching "
            "skill under .claude/skills/."
        ),
    )


@app.entrypoint
async def agent_invocation(payload: dict, context) -> dict:
    """AgentCore Runtime entrypoint.

    payload example:
        {"prompt": "IKKのreceiptフォルダに新しい領収書があるか確認して"}
    """
    prompt = payload.get("prompt", "")
    if not prompt:
        return {"result": "promptが空です。処理する内容を指定してください。"}

    logger.info("agent_invocation BEGIN prompt=%r", prompt)
    options = build_agent_options()

    result_text = []
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    result_text.append(block.text)

    logger.info("agent_invocation END prompt=%r", prompt)
    return {"result": "".join(result_text)}


if __name__ == "__main__":
    app.run()
