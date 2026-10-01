locals {
  # Where the RDS certificate bundle is mounted inside the container.
  rds_ca_path = "/etc/ssl/rds/bundle.pem"

  # The login infra/provision-api-role.sh creates for the API.
  api_db_username = "housing_api"
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "database" {
  name        = "${var.name}-db"
  description = "Postgres, reachable only from the API instance"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name}-db" }
}

# Referenced by security group rather than by address: the instance can be
# replaced, and its private IP with it, without this rule needing to change.
resource "aws_vpc_security_group_ingress_rule" "database_from_api" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from the API instance only"
}

resource "random_password" "database" {
  length = 32
  # RDS rejects '/', '@', '"' and spaces in a master password.
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "database" {
  name                    = "${var.name}/database"
  description             = "Master credentials and connection string for the API database"
  recovery_window_in_days = 0 # A student project should be able to destroy and recreate cleanly.
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id

  # The connection string is assembled here so the instance never has to build
  # one, and so the password exists in exactly one place.
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.database.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
    # sslmode=verify-full with Amazon's regional root bundle, not sslmode=require.
    # node-postgres turns any `sslmode` into `ssl = {}` and never passes the
    # libpq-compat flag that would relax verification, so the connection is
    # checked against Node's Mozilla CA store — which does not contain the
    # Amazon RDS roots. `require` would therefore fail every query with
    # SELF_SIGNED_CERT_IN_CHAIN while looking like it asked for less security.
    # The bundle is fetched onto the instance and mounted at this path.
    database_url = "postgres://${var.db_username}:${urlencode(random_password.database.result)}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}?sslmode=verify-full&sslrootcert=${local.rds_ca_path}"
  })
}

# The login the running API uses: a member of api_access (server/migrations),
# which holds only the API's runtime grants. Created in the database by
# infra/provision-api-role.sh, which reads this password from the secret below.
resource "random_password" "api_db" {
  length = 32
  # Kept URL-safe: it is embedded in a connection string.
  override_special = "-_~"
}

# Shared with the frontend, which will name each visitor's address when it calls
# the API on their behalf (docs/API.md). Alphanumeric because it travels in a
# header.
resource "random_password" "frontend_secret" {
  length  = 48
  special = false
}

# The only secret the API instance can read. The master credentials live in
# the separate secret above, readable by operators but not by the instance, so
# even a compromised instance never holds them.
resource "aws_secretsmanager_secret" "api" {
  name                    = "${var.name}/api"
  description             = "The API's restricted database login and its shared frontend secret"
  recovery_window_in_days = 0 # Same reasoning as the database secret.
}

resource "aws_secretsmanager_secret_version" "api" {
  secret_id = aws_secretsmanager_secret.api.id

  secret_string = jsonencode({
    db_username     = local.api_db_username
    db_password     = random_password.api_db.result
    database_url    = "postgres://${local.api_db_username}:${urlencode(random_password.api_db.result)}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}?sslmode=verify-full&sslrootcert=${local.rds_ca_path}"
    frontend_secret = random_password.frontend_secret.result
  })
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.name}-pg17"
  family = "postgres17"

  # The planner default of 4.0 models a spinning disk. On gp3 storage it
  # refuses the trigram indexes behind property search: measured locally at
  # 50k properties, 23ms sequential scan against 1.5ms using the index. See
  # docs/DATABASE.md.
  parameter {
    name  = "random_page_cost"
    value = "1.1"
  }

  # Refuse any connection that is not TLS.
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "main" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.database.result

  # 20GB of gp3 is the free-tier allowance.
  allocated_storage     = 20
  max_allocated_storage = 50
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  # Private subnets with no internet route; this makes that explicit rather
  # than incidental.
  publicly_accessible = false

  # Single AZ: free tier does not cover a standby, and this is a student
  # project where an hour of downtime during a failover is acceptable.
  multi_az = false

  backup_retention_period = var.backup_retention_days
  backup_window           = "07:00-08:00"
  maintenance_window      = "Mon:08:00-Mon:09:00"

  auto_minor_version_upgrade = true

  # This holds the only copy of every review. A `tofu destroy`, or a change
  # that forces replacement, would otherwise delete it outright with backups
  # of a day at most. Tearing the stack down now takes a deliberate edit here
  # first, and still leaves a snapshot behind.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  # Postgres logs into CloudWatch, which is where production debugging starts.
  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = { Name = var.name }
}
