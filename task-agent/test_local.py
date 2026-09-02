# test_local.py
import asyncio
from task_agent import agent_invocation

async def main():
    result = await agent_invocation(
        {"prompt": "IKKの受領フォルダに新しい領収書があるか確認して"},
        context=None,
    )
    print(result)

asyncio.run(main())
