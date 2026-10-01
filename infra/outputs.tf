output "api_url" {
  description = "Where the API answers. Point the frontend here. Requires an A record for api_domain pointing at api_ip."
  value       = "https://${var.api_domain}"
}

output "api_ip" {
  description = "The address api_domain must resolve to."
  value       = aws_eip.api.public_ip
}

output "api_instance_id" {
  description = "For a shell: aws ssm start-session --target <this>"
  value       = aws_instance.api.id
}

output "ecr_repository_url" {
  description = "Push the API image here; the instance pulls :latest from it."
  value       = aws_ecr_repository.api.repository_url
}

output "database_secret_arn" {
  description = "Master credentials, for operators and the infra/*.sh scripts. The instance cannot read this one."
  value       = aws_secretsmanager_secret.database.arn
}

output "api_secret_arn" {
  description = "The API's database login and frontend secret. infra/provision-api-role.sh reads it."
  value       = aws_secretsmanager_secret.api.arn
}

output "database_endpoint" {
  description = "Reachable only from inside the VPC."
  value       = aws_db_instance.main.address
}

output "log_group" {
  description = "aws logs tail <this> --follow"
  value       = aws_cloudwatch_log_group.api.name
}
