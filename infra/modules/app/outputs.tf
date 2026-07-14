output "alb_dns_name" { value = aws_lb.app.dns_name }
output "ecs_cluster" { value = aws_ecs_cluster.app.name }
output "ecs_service" { value = aws_ecs_service.app.name }
output "task_family" { value = aws_ecs_task_definition.app.family }
# The FULL task-definition ARN (family:revision) of the Terraform-managed revision. Deploys read THIS
# (not the family's "latest") so they always layer the image onto Terraform's env-bearing revision,
# never a revision another deploy raced in — the fix for the TASK-215/216 embedded-key race (TASK-217).
output "task_definition_arn" { value = aws_ecs_task_definition.app.arn }
output "task_security_group_id" { value = aws_security_group.task.id }
output "task_subnet_ids_csv" { value = join(",", module.vpc.public_subnets) }

# The 4 Route53 nameservers to paste at the registrar (Freeola) to delegate the zone.
# Empty when HTTPS is not enabled (no domain set).
output "route53_nameservers" {
  value = local.create_zone ? aws_route53_zone.primary[0].name_servers : []
}

# The public base URL of the environment: the HTTPS domain when configured, else the
# plain-HTTP ALB. Deploy workflows smoke/BDD against this (an HTTPS env now redirects
# 80->443, so testing http://<alb> would just 301).
output "public_url" {
  value = local.https_enabled ? "https://${var.domain_name}" : "http://${aws_lb.app.dns_name}"
}
