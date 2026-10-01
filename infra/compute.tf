# Amazon Linux 2023 for arm64, resolved at plan time so the stack is not pinned
# to an AMI id that goes stale.
data "aws_ssm_parameter" "al2023" {
  # The published public parameter path. /aws/service/ami-al2023/... does not
  # exist, and tofu validate cannot catch that — only a plan reaches the API.
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "API instance"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name}-api" }
}

resource "aws_vpc_security_group_ingress_rule" "api_http" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = var.api_ingress_cidr
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  # AWS restricts rule descriptions to a-zA-Z0-9 and a short punctuation set
  # that excludes the apostrophe, so this wording avoids one deliberately.
  description = "API traffic. Vercel egress addresses are not fixed, so the frontend cannot be allow-listed by address."
}

# Optional and off by default. Session Manager gives a shell through IAM with
# no inbound port at all, which is strictly better than an open 22.
resource "aws_vpc_security_group_ingress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = var.api_ingress_cidr
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS. Port 80 stays open alongside it because the ACME challenge is served there and Caddy redirects it."
}

resource "aws_vpc_security_group_ingress_rule" "api_ssh" {
  count = var.ssh_ingress_cidr == "" ? 0 : 1

  security_group_id = aws_security_group.api.id
  cidr_ipv4         = var.ssh_ingress_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
  description       = "SSH, restricted to one address"
}

resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound: the database, ECR, Secrets Manager, CloudWatch, and the Supabase public keys"
}

resource "aws_iam_role" "api" {
  name = "${var.name}-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# A shell through IAM, audited in CloudTrail, with no inbound port open.
resource "aws_iam_role_policy_attachment" "session_manager" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Scoped to the one secret and the one log group this instance actually uses,
# rather than the managed policies that would grant every secret in the account.
resource "aws_iam_role_policy" "api" {
  name = "${var.name}-api"
  role = aws_iam_role.api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.api.arn
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
        ]
        Resource = aws_ecr_repository.api.arn
      },
      {
        # Exchanging credentials for a registry token is account-wide by
        # definition; it grants nothing on its own.
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.api.arn}:*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "api" {
  name = "${var.name}-api"
  role = aws_iam_role.api.name
}

resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    region       = var.region
    secret_arn   = aws_secretsmanager_secret.api.arn
    image        = "${aws_ecr_repository.api.repository_url}:latest"
    log_group    = aws_cloudwatch_log_group.api.name
    supabase_url = var.supabase_url
    region_ca    = local.rds_ca_path
    api_domain   = var.api_domain
    acme_email   = var.acme_email
  })

  # Replaces the instance when the startup script changes, so a change to how
  # the service runs is applied rather than sitting in state until the next
  # manual reboot.
  user_data_replace_on_change = true

  lifecycle {
    # The AMI is looked up as "latest" on every plan, so without this any
    # apply after Amazon publishes a new image — an alarm tweak, say — would
    # replace the instance and take the API down while it rebuilds. Moving to
    # a new image is a deliberate step instead:
    #   tofu apply -replace=aws_instance.api
    ignore_changes = [ami]
  }

  root_block_device {
    volume_size = 20 # GB; the API image and its logs need a fraction of it
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    # IMDSv2 only: v1 is what makes a server-side request forgery bug in the
    # application enough to read the instance's credentials.
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  tags = { Name = "${var.name}-api" }

  # user-data runs exactly once. If the instance boots before the subnet has
  # its internet route, or before the egress rule exists — creating a security
  # group drops the AWS-provided allow-all egress — then `dnf update` fails,
  # `set -e` aborts the whole script, and the instance is permanently dead
  # while OpenTofu reports success.
  depends_on = [
    aws_secretsmanager_secret_version.api,
    aws_route_table_association.public,
    aws_vpc_security_group_egress_rule.api_all,
  ]
}

# A fixed address, so redeploying the instance does not change where the
# frontend points.
resource "aws_eip" "api" {
  instance = aws_instance.api.id
  domain   = "vpc"
  tags     = { Name = "${var.name}-api" }

  # The provider documents this: an EIP in a VPC needs the gateway to exist.
  depends_on = [aws_internet_gateway.main]
}
