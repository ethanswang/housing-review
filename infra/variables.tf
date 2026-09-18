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
  description = "db.t4g.micro is free-tier eligible for the first 12 months on a new account."
  type        = string
  default     = "db.t4g.micro"
}

variable "instance_type" {
  description = "t4g.micro is free-tier eligible for the first 12 months (750 hours a month)."
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
