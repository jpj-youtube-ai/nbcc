#!/usr/bin/env bash
# Run a one-off command inside the production app container, and show its output.
#
# Why this exists: the ECS console's "Run task" form is unusable for this (it needs a VPC, subnets,
# a security group and a command override typed in by hand, and the form does not reliably accept
# programmatic input). Everything below is derivable from the RUNNING service, so this needs no
# Terraform state, no local AWS credentials and no copied-out ids. Paste it into AWS CloudShell.
#
#   ./run-oneoff.sh "npm run import:unrecorded"            # the dry run - writes nothing
#   ./run-oneoff.sh "npm run import:unrecorded -- --commit" # the real thing
#   ./run-oneoff.sh "npm run reconcile:stripe"             # read-only reconciliation report
#
# It waits for the task to stop, prints the container's log output, and exits with the container's
# own exit code - so a failure here fails loudly rather than looking like a quiet success.

set -euo pipefail

CMD="${1:?usage: run-oneoff.sh \"<command to run in the container>\"}"
REGION="${AWS_REGION:-eu-west-2}"
CLUSTER="${CLUSTER:-charity-site-production}"
SERVICE="${SERVICE:-charity-site-production}"

echo "Region:  $REGION"
echo "Cluster: $CLUSTER"
echo "Command: $CMD"
echo

# Take the task definition and the exact network placement from the service that is already running.
# Using the service's own settings means this task lands in the same subnets, with the same security
# group, as the live app - so it can reach the database on the same terms the app does.
read -r TASK_DEF SUBNETS SGS <<EOF
$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" \
   --query 'services[0].[taskDefinition,
                          join(`,`, networkConfiguration.awsvpcConfiguration.subnets),
                          join(`,`, networkConfiguration.awsvpcConfiguration.securityGroups)]' \
   --output text)
EOF

if [ -z "${TASK_DEF:-}" ] || [ "$TASK_DEF" = "None" ]; then
  echo "Could not read the running service. Check the cluster/service name and the region." >&2
  exit 1
fi

echo "Task definition: $TASK_DEF"

# The container name the task definition actually uses, rather than assuming "app".
CONTAINER=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" --region "$REGION" \
              --query 'taskDefinition.containerDefinitions[0].name' --output text)

# Where that container logs to, so the output can be fetched afterwards.
LOG_GROUP=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" --region "$REGION" \
              --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' \
              --output text)
LOG_PREFIX=$(aws ecs describe-task-definition --task-definition "$TASK_DEF" --region "$REGION" \
               --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-stream-prefix"' \
               --output text)

# sh -c so the command can carry arguments and -- flags exactly as written above.
OVERRIDES=$(CONTAINER="$CONTAINER" CMD="$CMD" python3 -c '
import json, os
print(json.dumps({"containerOverrides": [
    {"name": os.environ["CONTAINER"], "command": ["sh", "-c", os.environ["CMD"]]}
]}))')

TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$TASK_DEF" --region "$REGION" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SGS],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "The task did not start." >&2
  exit 1
fi

TASK_ID="${TASK_ARN##*/}"
echo "Started task $TASK_ID - waiting for it to finish (a cold start is usually under a minute)..."
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION"

echo
echo "===================== output ====================="
# The stream is <prefix>/<container>/<task-id>. Retry briefly: the task can stop a moment before
# CloudWatch has the last lines, and printing nothing would look like the command produced nothing.
for _ in 1 2 3 4 5 6; do
  if aws logs get-log-events --log-group-name "$LOG_GROUP" \
       --log-stream-name "$LOG_PREFIX/$CONTAINER/$TASK_ID" --region "$REGION" \
       --start-from-head --query 'events[].message' --output text 2>/dev/null | grep -q .; then
    aws logs get-log-events --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LOG_PREFIX/$CONTAINER/$TASK_ID" --region "$REGION" \
      --start-from-head --query 'events[].message' --output text
    break
  fi
  sleep 5
done
echo "=================================================="
echo

EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION" \
              --query 'tasks[0].containers[0].exitCode' --output text)
REASON=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION" \
           --query 'tasks[0].stoppedReason' --output text)

echo "exit code: $EXIT_CODE"
[ "$REASON" = "None" ] || echo "stopped because: $REASON"

# A task that was killed before the container ran reports no exit code at all. Treat that as a
# failure rather than letting an empty value read as success.
[ "$EXIT_CODE" = "0" ] || exit 1
