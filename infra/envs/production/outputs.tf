output "alb_dns_name" { value = module.app.alb_dns_name }
output "ecs_cluster" { value = module.app.ecs_cluster }
output "ecs_service" { value = module.app.ecs_service }
output "task_family" { value = module.app.task_family }
output "task_security_group_id" { value = module.app.task_security_group_id }
output "task_subnet_ids_csv" { value = module.app.task_subnet_ids_csv }
