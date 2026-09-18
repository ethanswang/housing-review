output "api_url" {
  description = "Where the API answers. Point the frontend here."
  value       = "http://${aws_eip.api.public_ip}"
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
  description = "Connection string and credentials. Read with: aws secretsmanager get-secret-value --secret-id <this>"
  value       = aws_secretsmanager_secret.database.arn
}

output "database_endpoint" {
  description = "Reachable only from inside the VPC."
  value       = aws_db_instance.main.address
}

output "log_group" {
  description = "aws logs tail <this> --follow"
  value       = aws_cloudwatch_log_group.api.name
}
