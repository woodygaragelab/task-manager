from aws_cdk import (
    Stack,
    Duration,
    aws_lambda as _lambda,
    aws_iam as iam,
    aws_scheduler as scheduler,
    aws_logs as logs,
)
from constructs import Construct

# 対象のAgentCore Runtime ARN(メール要約/scoutスキルが動くtask-agent)
AGENT_RUNTIME_ARN = (
    "arn:aws:bedrock-agentcore:ap-northeast-1:155830630328:"
    "runtime/task_agent-lAAoax7UkB"
)


class ScoutScheduleStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # --- Lambda: AgentCore Runtimeを起動する薄いトリガー ---
        invoke_fn = _lambda.Function(
            self,
            "ScoutInvokeFunction",
            function_name="taskmanager-scout-email-summary-trigger",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(60),
            log_retention=logs.RetentionDays.ONE_MONTH,
            environment={
                "AGENT_RUNTIME_ARN": AGENT_RUNTIME_ARN,
            },
        )

        # AgentCore Runtime起動権限を対象ARNに限定して付与
        invoke_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock-agentcore:InvokeAgentRuntime"],
                resources=[
                    AGENT_RUNTIME_ARN,
                    f"{AGENT_RUNTIME_ARN}/runtime-endpoint/*",
                ],
            )
        )

        # --- EventBridge Scheduler用の実行ロール(Lambda呼び出し専用) ---
        scheduler_role = iam.Role(
            self,
            "ScoutSchedulerRole",
            assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
        )
        invoke_fn.grant_invoke(scheduler_role)

        # --- 平日9/13/17時(JST)に実行するスケジュール ---
        scheduler.CfnSchedule(
            self,
            "ScoutWeekdaySchedule",
            name="taskmanager-scout-email-summary-weekdays",
            description="平日6/12/18時にメール要約(scout)エージェントを起動",
            schedule_expression="cron(0 6,12,18 ? * MON-FRI *)",
            schedule_expression_timezone="Asia/Tokyo",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(
                mode="OFF"
            ),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=invoke_fn.function_arn,
                role_arn=scheduler_role.role_arn,
                retry_policy=scheduler.CfnSchedule.RetryPolicyProperty(
                    maximum_retry_attempts=2,
                    maximum_event_age_in_seconds=3600,
                ),
                input='{"skill": "email-summary"}',
            ),
        )
