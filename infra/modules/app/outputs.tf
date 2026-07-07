output "alb_dns_name" { value = aws_lb.app.dns_name }
output "ecs_cluster" { value = aws_ecs_cluster.app.name }
output "ecs_service" { value = aws_ecs_service.app.name }
output "task_family" { value = aws_ecs_task_definition.app.family }
output "task_security_group_id" { value = aws_security_group.task.id }
output "task_subnet_ids_csv" { value = join(",", module.vpc.public_subnets) }

# The 4 Route53 nameservers to paste at the registrar (Freeola) to delegate the zone.
# Empty when HTTPS is not enabled (no domain set).
output "route53_nameservers" {
  value = local.create_zone ? aws_route53_zone.primary[0].name_servers : []
}
