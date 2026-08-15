#!/usr/bin/env python3
import aws_cdk as cdk
from scout_schedule.scout_schedule_stack import ScoutScheduleStack

app = cdk.App()
ScoutScheduleStack(
    app,
    "ScoutScheduleStack",
    env=cdk.Environment(region="ap-northeast-1"),
)
app.synth()
