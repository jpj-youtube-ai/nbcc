variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.1.0/24", "10.20.2.0/24"]
}

variable "db_subnet_cidrs" {
  type    = list(string)
  default = ["10.20.101.0/24", "10.20.102.0/24"]
}

# Placeholder image used only for the FIRST apply. CI owns the running image
# after that (the service ignores task_definition changes), so this is never
# overridden and just lets the service resource be created.
variable "container_image" {
  type    = string
  default = "public.ecr.aws/nginx/nginx:stable"
}

variable "app_port" {
  type    = number
  default = 3000
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "external_api_base_url" {
  type    = string
  default = "https://sandbox.api-one.example"
}

# Per-environment toggles (staging vs prod).
variable "multi_az" {
  type    = bool
  default = false
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "skip_final_snapshot" {
  type    = bool
  default = true
}
