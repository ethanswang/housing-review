resource "aws_ecr_repository" "api" {
  name                 = var.name
  image_tag_mutability = "MUTABLE"

  # Every deploy pushes :latest, so the repository is never empty by the time
  # anyone tries to tear the stack down — and deleting a non-empty repository
  # fails. The same reasoning as recovery_window_in_days = 0 on the secret:
  # this stack has to destroy and recreate cleanly.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Untagged layers accumulate with every push. The free tier covers 500MB, so
# this is what keeps the registry inside it without anyone remembering to prune.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the ten most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
