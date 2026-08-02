# Claude Agent SDK internally invokes the Claude Code CLI (Node.js),
# so we add Node.js on top of a Python base image.
#
# IMPORTANT: task_agent.py imports task_repository (taskmanager's shared
# DynamoDB CRUD module, layer/python/task_repository.py), but this
# image's build context is task-agent/ itself, which cannot COPY files
# from outside it. Before building/deploying (docker build / agentcore
# launch), copy the shared module in first:
#   Copy-Item ..\layer\python\task_repository.py . -Force
# task_repository.py is git-ignored inside task-agent/ (see .gitignore)
# because it is a build artifact, not an independently maintained copy.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Dependencies required by the Claude Code CLI (curl, git, Node.js/npm)
RUN apt-get update && apt-get install -y \
    curl \
    git \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install the Claude Code CLI itself
RUN npm install -g @anthropic-ai/claude-code

# Route model calls through Amazon Bedrock.
ENV CLAUDE_CODE_USE_BEDROCK=1 \
    AWS_REGION=ap-northeast-1 \
    ANTHROPIC_MODEL=global.anthropic.claude-sonnet-4-6

# Python dependencies
COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

# Application code (task_agent.py, task_repository.py, plus everything
# under .claude/skills/)
COPY . .

# The receipt-ocr-filelist skill's scripts/ use openpyxl and Pillow;
# both are already declared in requirements.txt and installed above.

EXPOSE 8080

CMD ["opentelemetry-instrument", "python", "task_agent.py"]
