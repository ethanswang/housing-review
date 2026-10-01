variable "region" {
  description = "AWS region. us-east-2 is among the cheapest and is close to Illinois."
  type        = string
  default     = "us-east-2"
}

variable "name" {
  description = "Prefix for every resource name, so they are identifiable in a shared account."
  type        = string
  default     = "uiuc-housing"
}

variable "vpc_cidr" {
  description = "Address space for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "db_name" {
  type    = string
  default = "housing"
}

variable "db_username" {
  description = "Master username. The password is generated and stored in Secrets Manager; it is never written to state by hand or committed."
  type        = string
  default     = "housing"
}

variable "db_instance_class" {
  description = "Smallest burstable class. See docs/INFRASTRUCTURE.md, Cost: whether any of it is free depends on the account's plan."
  type        = string
  default     = "db.t4g.micro"
}

variable "instance_type" {
  description = "Smallest burstable arm64 instance; the API image is built for arm64. See docs/INFRASTRUCTURE.md, Cost."
  type        = string
  default     = "t4g.micro"
}

variable "supabase_url" {
  description = "Supabase project URL. The API derives the JWKS URL and the expected token issuer from it; it holds no Supabase secret."
  type        = string
}

variable "ssh_ingress_cidr" {
  description = "Who may reach the instance on port 22. Empty disables SSH entirely; Session Manager works regardless and needs no open port."
  type        = string
  default     = ""
}

variable "api_ingress_cidr" {
  description = "Who may reach the API. Defaults to the internet because Vercel's IPs are not fixed, so the frontend cannot be allow-listed by address."
  type        = string
  default     = "0.0.0.0/0"
}

variable "backup_retention_days" {
  description = "Automated backup retention. The credit-based free plan caps this, and RDS rejects a larger value with FreeTierRestrictionError rather than clamping it. Raise it on a paid plan; 7 is a reasonable target."
  type        = number
  default     = 1
}

variable "api_domain" {
  description = "Hostname the API answers on, e.g. api.uiuchousing.com. An A record for it must point at the instance's elastic IP before the certificate can be issued: Let's Encrypt validates over HTTP on port 80, so a name that resolves elsewhere fails."
  type        = string
}

variable "alarm_email" {
  description = "Where CloudWatch alarms are sent. Required rather than optional: an alarm with no destination is how an outage goes unnoticed. AWS emails a confirmation link after apply, and nothing is delivered until it is clicked."
  type        = string
}

variable "acme_email" {
  description = "Address Let's Encrypt uses for expiry warnings. Optional, but without it there is nowhere to send the notice that renewal has been failing."
  type        = string
  default     = ""
}
