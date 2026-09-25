# Copy to terraform.tfvars and fill in. terraform.tfvars is gitignored.

# Supabase project URL. The API derives the JWKS URL and the expected token
# issuer from it and holds no Supabase secret, so this is not sensitive.
supabase_url = "https://your-project-ref.supabase.co"

# Optional. Leave unset to keep port 22 closed entirely; Session Manager gives
# a shell through IAM without it.
# ssh_ingress_cidr = "203.0.113.4/32"

# CloudWatch alarms are emailed here. AWS sends a confirmation link after the
# first apply; nothing is delivered until it is clicked.
alarm_email = "you@example.com"
