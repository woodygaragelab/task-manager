from aws_cdk import (
    Stack,
    Duration,
    aws_lambda as _lambda,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
    aws_scheduler as scheduler,
    aws_logs as logs,
)
from constructs import Construct

# メインスタック(template.yaml)側のリソース名。実処理(AgentCore Runtime呼び出し)は
# taskmanager-agent-job-processorに委ね、このスタックはTaskAgentJobsへのジョブ登録と
# 非同期呼び出しのみを担う(Web版「エージェント」タブと同じ非同期ジョブの仕組みに乗せる)。
AGENT_JOBS_TABLE_NAME = "TaskAgentJobs"
AGENT_JOB_PROCESSOR_FUNCTION_NAME = "taskmanager-agent-job-processor"
# 関与先ごとにジョブを分割するため、TaskClients(layer/python/task_repository.pyの
# list_clientsと同じテーブル)を読み取り専用で参照する。
CLIENTS_TABLE_NAME = "TaskClients"


class ScoutScheduleStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        agent_jobs_table = dynamodb.Table.from_table_name(
            self, "AgentJobsTable", AGENT_JOBS_TABLE_NAME
        )
        agent_job_processor_fn = _lambda.Function.from_function_name(
            self, "AgentJobProcessorFunction", AGENT_JOB_PROCESSOR_FUNCTION_NAME
        )
        clients_table = dynamodb.Table.from_table_name(
            self, "ClientsTable", CLIENTS_TABLE_NAME
        )

        # --- Lambda: TaskAgentJobsにジョブを登録し、AgentCore呼び出しを担う
        #     taskmanager-agent-job-processorを非同期(Event)起動する薄いトリガー ---
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
                "AGENT_JOBS_TABLE": AGENT_JOBS_TABLE_NAME,
                "AGENT_JOB_PROCESSOR_FUNCTION_NAME": AGENT_JOB_PROCESSOR_FUNCTION_NAME,
                "CLIENTS_TABLE": CLIENTS_TABLE_NAME,
            },
        )

        agent_jobs_table.grant_write_data(invoke_fn)
        agent_job_processor_fn.grant_invoke(invoke_fn)
        clients_table.grant_read_data(invoke_fn)

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
                # handler.py側はプロンプト・関与先コードを定数で持つためevent入力は使わないが、
                # CfnSchedule.TargetPropertyはinputを省略できないため空オブジェクトを渡す。
                input="{}",
            ),
        )
