"""
Run this ONCE on your local PC to obtain a Google OAuth refresh token for
woodygaragelab@gmail.com with Drive access. The resulting JSON should be
stored in AWS Secrets Manager (see the printed instructions at the end).
This script never sends your credentials anywhere except Google's own
OAuth endpoints; it only prints the resulting token JSON to your terminal.

Usage:
    pip install google-auth-oauthlib
    export GOOGLE_OAUTH_CLIENT_SECRET=<client secret from Google Cloud Console>
    python get_refresh_token.py
"""
import json
import os

from google_auth_oauthlib.flow import InstalledAppFlow

# Values from the OAuth client created earlier in Google Cloud Console
# ("agentcore-receipt-agent"). client_secret is never hardcoded here
# (this repository is a real git repo, unlike the old receipt-agent
# checkout) -- it must be supplied via the GOOGLE_OAUTH_CLIENT_SECRET
# environment variable. Replace client_id below if you rotated the
# OAuth client itself.
CLIENT_CONFIG = {
    "installed": {
        "client_id": "1011354473098-od5n1po1v94lfv87qesep52i11rht3m3.apps.googleusercontent.com",
        "client_secret": os.environ["GOOGLE_OAUTH_CLIENT_SECRET"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost:8080/"],
    }
}

SCOPES = ["https://www.googleapis.com/auth/drive"]


def main() -> None:
    flow = InstalledAppFlow.from_client_config(CLIENT_CONFIG, SCOPES)
    # Opens your default browser; after you approve access, the flow
    # captures the authorization code on http://localhost:8080/ automatically.
    credentials = flow.run_local_server(port=8080, prompt="consent")

    token_json = {
        "refresh_token": credentials.refresh_token,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "token_uri": credentials.token_uri,
        "scopes": credentials.scopes,
    }

    print("\n=== Obtained token (store this in Secrets Manager) ===")
    print(json.dumps(token_json))
    print("========================================================")
    print(
        "\nNext step:\n"
        "  aws secretsmanager create-secret \\\n"
        "    --region ap-northeast-1 \\\n"
        "    --name \"task-agent/google-drive-user-token\" \\\n"
        "    --secret-string '<paste the JSON printed above>'\n"
    )


if __name__ == "__main__":
    main()
