from aws_cdk import (
    Stack,
    Duration,
    Tags,
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

        # コスト管理用タグ。EventBridge SchedulerのCfnScheduleはタグ非対応のため
        # Lambda/IAMロールにのみ付与される(スタックレベルのaspectとして適用)。
        Tags.of(self).add("Project", "taskmanager")

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
        Tags.of(invoke_fn).add("Component", "scout")

        # --- EventBridge Scheduler用の実行ロール(Lambda呼び出し専用) ---
        scheduler_role = iam.Role(
            self,
            "ScoutSchedulerRole",
            assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
        )
        invoke_fn.grant_invoke(scheduler_role)
        Tags.of(scheduler_role).add("Component", "scout")

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
                # maximum_retry_attempts=0: handler.py側はジョブ起動を都度新規UUIDで
                # 行うため冪等ではない。EventBridge Schedulerがリトライすると、既に
                # 成功した関与先分のジョブまで重複起動してしまう(Gmail添付やDrive
                # 保存ファイルが3件などに重複する不具合の原因だった)。handler.py側も
                # 部分失敗で例外を投げないよう修正済みだが、念のためリトライ自体も
                # 無効化しておく。失敗した関与先は次回のスケジュール実行で拾われる。
                retry_policy=scheduler.CfnSchedule.RetryPolicyProperty(
                    maximum_retry_attempts=0,
                    maximum_event_age_in_seconds=3600,
                ),
                # handler.py側はプロンプト・関与先コードを定数で持つためevent入力は使わないが、
                # CfnSchedule.TargetPropertyはinputを省略できないため空オブジェクトを渡す。
                input="{}",
            ),
        )

        # --- Lambda: receiptFolderId登録済みの関与先ごとにarchivist(receipt-ocr-filelist)
        #     ジョブを起動する薄いトリガー(ScoutInvokeFunctionのarchivist版) ---
        archivist_invoke_fn = _lambda.Function(
            self,
            "ArchivistInvokeFunction",
            function_name="taskmanager-archivist-receipt-ocr-trigger",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.handler",
            code=_lambda.Code.from_asset("lambda_archivist"),
            timeout=Duration.seconds(60),
            log_retention=logs.RetentionDays.ONE_MONTH,
            environment={
                "AGENT_JOBS_TABLE": AGENT_JOBS_TABLE_NAME,
                "AGENT_JOB_PROCESSOR_FUNCTION_NAME": AGENT_JOB_PROCESSOR_FUNCTION_NAME,
                "CLIENTS_TABLE": CLIENTS_TABLE_NAME,
            },
        )

        agent_jobs_table.grant_write_data(archivist_invoke_fn)
        agent_job_processor_fn.grant_invoke(archivist_invoke_fn)
        clients_table.grant_read_data(archivist_invoke_fn)
        Tags.of(archivist_invoke_fn).add("Component", "archivist-trigger")

        archivist_scheduler_role = iam.Role(
            self,
            "ArchivistSchedulerRole",
            assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"),
        )
        archivist_invoke_fn.grant_invoke(archivist_scheduler_role)
        Tags.of(archivist_scheduler_role).add("Component", "archivist-trigger")

        # --- ScoutWeekdayScheduleの10分後(平日6:10/12:10/18:10 JST)に実行するスケジュール ---
        # scoutが受領フォルダに保存した新着添付をarchivistが拾えるよう、scoutの後に
        # 実行する(ユーザー指定:「既存のscoutスケジュールの10分後」)。
        scheduler.CfnSchedule(
            self,
            "ArchivistWeekdaySchedule",
            name="taskmanager-archivist-receipt-ocr-weekdays",
            description="平日6:10/12:10/18:10時に領収書分類(archivist)エージェントを起動",
            schedule_expression="cron(10 6,12,18 ? * MON-FRI *)",
            schedule_expression_timezone="Asia/Tokyo",
            flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(
                mode="OFF"
            ),
            target=scheduler.CfnSchedule.TargetProperty(
                arn=archivist_invoke_fn.function_arn,
                role_arn=archivist_scheduler_role.role_arn,
                # maximum_retry_attempts=0: handler.py側はジョブ起動を都度新規UUIDで
                # 行うため冪等ではない。EventBridge Schedulerがリトライすると、既に
                # 成功した関与先分のジョブまで重複起動してしまう(Gmail添付やDrive
                # 保存ファイルが3件などに重複する不具合の原因だった)。handler.py側も
                # 部分失敗で例外を投げないよう修正済みだが、念のためリトライ自体も
                # 無効化しておく。失敗した関与先は次回のスケジュール実行で拾われる。
                retry_policy=scheduler.CfnSchedule.RetryPolicyProperty(
                    maximum_retry_attempts=0,
                    maximum_event_age_in_seconds=3600,
                ),
                input="{}",
            ),
        )
