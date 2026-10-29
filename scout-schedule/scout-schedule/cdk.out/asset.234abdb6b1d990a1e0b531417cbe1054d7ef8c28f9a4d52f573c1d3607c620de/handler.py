import json
import logging
import os

import boto3
from google.oauth2.credentials import Credentials as UserCredentials
from googleapiclient.discovery import build as build_drive_service
from googleapiclient.http import MediaFileUpload

import cost_report

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
GOOGLE_USER_TOKEN_SECRET_NAME = os.environ["GOOGLE_USER_TOKEN_SECRET_NAME"]
DRIVE_FOLDER_ID = os.environ["DRIVE_FOLDER_ID"]
REPORT_DAYS = int(os.environ.get("REPORT_DAYS", "120"))
REPORT_FILENAME = os.environ.get("REPORT_FILENAME", "task-agent_cost_report.xlsx")
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _get_drive_service():
    secret = boto3.client("secretsmanager", region_name=AWS_REGION).get_secret_value(
        SecretId=GOOGLE_USER_TOKEN_SECRET_NAME
    )
    token_info = json.loads(secret["SecretString"])
    credentials = UserCredentials(
        token=None,  # force a refresh on first use
        refresh_token=token_info["refresh_token"],
        client_id=token_info["client_id"],
        client_secret=token_info["client_secret"],
        token_uri=token_info["token_uri"],
        scopes=token_info.get("scopes", ["https://www.googleapis.com/auth/drive"]),
    )
    return build_drive_service("drive", "v3", credentials=credentials, cache_discovery=False)


def _upload_replacing(service, local_path: str) -> dict:
    """同名ファイルがあれば中身を更新(ファイルID・共有設定を維持)、無ければ新規作成する。"""
    existing = (
        service.files()
        .list(
            q=f"name = '{REPORT_FILENAME}' and '{DRIVE_FOLDER_ID}' in parents and trashed = false",
            fields="files(id)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
        .get("files", [])
    )
    media = MediaFileUpload(local_path, mimetype=XLSX_MIME)
    if existing:
        file = (
            service.files()
            .update(fileId=existing[0]["id"], media_body=media, fields="id,webViewLink", supportsAllDrives=True)
            .execute()
        )
        return {**file, "replaced": True}
    file = (
        service.files()
        .create(
            body={"name": REPORT_FILENAME, "parents": [DRIVE_FOLDER_ID]},
            media_body=media,
            fields="id,webViewLink",
            supportsAllDrives=True,
        )
        .execute()
    )
    return {**file, "replaced": False}


def handler(event, context):
    rows = cost_report.run_query(boto3.client("logs", region_name=AWS_REGION), REPORT_DAYS)
    daily = cost_report.aggregate_daily(rows)

    local_path = f"/tmp/{REPORT_FILENAME}"
    cost_report.write_excel(daily, local_path)
    uploaded = _upload_replacing(_get_drive_service(), local_path)

    logger.info(
        json.dumps(
            {
                "metric": "cost_report_success",
                "days": len(daily),
                "fileId": uploaded["id"],
                "replaced": uploaded["replaced"],
            }
        )
    )
    return {"days": len(daily), "fileId": uploaded["id"], "webViewLink": uploaded.get("webViewLink")}
