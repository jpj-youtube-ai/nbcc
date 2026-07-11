# --- Security groups ----------------------------------------------------------
resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  # HTTPS from internet — only when a domain/cert is configured (see dns.tf).
  dynamic "ingress" {
    for_each = local.https_enabled ? [1] : []
    content {
      description = "HTTPS from internet"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "task" {
  name_prefix = "${local.name}-task-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "App port from the ALB only"
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    description = "Egress for external APIs + ECR + SSM"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from the tasks only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }
}

# --- Load balancer ------------------------------------------------------------
resource "aws_lb" "app" {
  name               = local.name
  load_balancer_type = "application"
  subnets            = module.vpc.public_subnets
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "app" {
  name        = local.name
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip" # required for Fargate

  # Drain quickly on deploy. The default is 300s, and `ecs wait services-stable`
  # blocks until the OLD task finishes deregistering — so the default alone adds
  # up to five minutes to every rolling deploy. `/health` and the pages serve
  # short-lived HTTP requests with no long connections to protect, so 5s of
  # connection draining is ample.
  deregistration_delay = 5

  # interval 10s x 2 healthy checks puts a new task in service ~20s after it
  # starts answering, vs ~30s at the old 15s interval. `/health` is cheap by
  # design (golden rule 6), so the extra poll rate costs nothing.
  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 10
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  # HTTP-only (no domain): forward :80 to the app. Staging stays on this branch.
  dynamic "default_action" {
    for_each = local.https_enabled ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.app.arn
    }
  }
  # HTTPS enabled: redirect :80 -> :443 so all traffic is TLS.
  dynamic "default_action" {
    for_each = local.https_enabled ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  # Only flip :80 to the 443-redirect AFTER the HTTPS listener exists. On a first
  # HTTPS bring-up the cert can sit in PENDING_VALIDATION for a while (ACM re-check
  # latency after delegation); without this ordering, :80 would redirect to a 443
  # port that has no listener yet — a real outage window. depends_on holds the
  # redirect until 443 is live, so :80 keeps forwarding (serving HTTP) until then.
  depends_on = [aws_lb_listener.https]
}

# TLS listener — only when a domain/cert is configured (see dns.tf). Uses the
# validated cert so it is attached only after ACM issues.
resource "aws_lb_listener" "https" {
  count             = local.https_enabled ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.app[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
