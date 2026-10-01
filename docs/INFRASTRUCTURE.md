# Infrastructure

The API runs on AWS. The frontend stays on Vercel. Everything here is OpenTofu/Terraform in
`infra/`, applied by hand — there is no automated deploy pipeline yet.

> **Status: applied and serving.** The stack is running in `us-east-2`: EC2 `t4g.micro` with
> the container, RDS PostgreSQL 17.9 (encrypted, private, one-day backups), and the schema
> migrated. `/healthz`, `/readyz`, `/api/properties` and `/api/companies` all answer, writes
> refuse unauthenticated callers, and logs reach CloudWatch.
>
> The database holds the schema and no rows. Seeding is deliberately not done here: the seed
> truncates every table, and `scripts/guard.mjs` refuses any non-local host for that reason.

## Shape

```
        browser
           │
           ▼
   Vercel (Next.js)  ── frontend, unchanged
           │
           │  HTTPS
           ▼
   ┌───────────────────────── VPC 10.20.0.0/16 ─────────────────────────┐
   │                                                                     │
   │  public subnet (a)                    public subnet (b)             │
   │  ┌──────────────────┐                                               │
   │  │ EC2 t4g.micro    │ ── internet gateway ──▶ Supabase JWKS, ECR    │
   │  │ docker: API :80  │                                               │
   │  └────────┬─────────┘                                               │
   │           │ 5432, security group to security group                  │
   │  private subnet (a)                   private subnet (b)            │
   │  ┌────────▼─────────┐                                               │
   │  │ RDS PostgreSQL 17│  no route to the internet, in either direction │
   │  └──────────────────┘                                               │
   └─────────────────────────────────────────────────────────────────────┘
```

## Why this shape

**No NAT gateway.** The API has to reach Supabase to fetch the public keys it verifies tokens
against, so it needs outbound internet. A NAT gateway provides that for about **$32 a month** —
more than everything else here combined. An instance in a public subnet reaches the internet
through the internet gateway for nothing, and the database stays unreachable because it sits in
private subnets with no internet route at all.

**EC2 rather than ECS or App Runner.** At this size a single small instance is the honest
answer, and the alternatives each add cost without adding safety: App Runner with a VPC
connector routes all egress through the VPC and so needs that NAT gateway, and ECS behind a
load balancer adds about $16 a month for the balancer alone. The tradeoff is real and worth
saying out loud: this is one instance, so a deploy is a short interruption and an instance
failure is an outage until it restarts. When that stops being acceptable, ECS behind a load
balancer is the next step, and the container does not change.

**The database is reached by security group, not by address.** The rule allows the API's
security group rather than its IP, so replacing the instance does not require touching it.

**No inbound SSH by default.** `ssh_ingress_cidr` is empty, so port 22 is closed. Session
Manager gives a shell through IAM, audited in CloudTrail, with nothing listening.

**The database connection verifies TLS against Amazon's roots.** The connection string uses
`sslmode=verify-full` with the regional RDS bundle, which the instance fetches on every start
and mounts into the container. The obvious-looking `sslmode=require` would have failed *every
query*: node-postgres turns any `sslmode` into an empty TLS config and never passes the
libpq-compatibility flag that would relax verification, so the certificate is checked against
Node's Mozilla trust store — which contains none of the three `Amazon RDS ... Root CA`
certificates. With `rds.force_ssl = 1` there is no fallback to plaintext either, so the symptom
would have been a container that starts, passes `/healthz`, and fails every request.

**TLS terminates at Caddy on the instance.** It obtains and renews a Let's Encrypt
certificate by itself, so nothing here has an expiry date a person has to remember, and it
costs nothing — a load balancer would be about $16 a month for the same job at this size.
Caddy is installed from the release tarball with its checksum verified rather than from a
third-party repository, so the supply chain for it is readable in one file.

The API container binds to `127.0.0.1` rather than `0.0.0.0`, so the only route in is through
Caddy and there is no plaintext port reachable from the internet even though the security
group would permit one. Port 80 stays open because the ACME challenge is served there and
Caddy redirects it to HTTPS.

**`api_domain` must resolve to the instance before the first apply.** Let's Encrypt validates
over HTTP against whatever the name points at, so pointing it elsewhere means the certificate
is never issued and the API answers nothing — the container is no longer listening publicly.

**IMDSv2 required.** Version 1 is what turns a request-forgery bug in the application into
credential theft.

## Cost

AWS changed its free tier on **15 July 2025**. Accounts created on or after that date get
credits ($100, up to $200 after onboarding tasks) lasting up to six months, *not* the old
12-month 750-hour allowance. Accounts created before then keep the classic tier for 12 months
from creation. **Check which one applies to your account before assuming any of this is free.**

At standard on-demand rates in `us-east-2`, roughly:

| Item | Approximate monthly |
| --- | --- |
| EC2 `t4g.micro` | $6 |
| Public IPv4 address | $4 |
| EBS 20GB gp3 | $2 |
| RDS `db.t4g.micro` | $12 |
| RDS 20GB gp3 storage | $2 |
| Secrets Manager (one secret) | $0.40 |
| CloudWatch logs, ECR | under $1 |
| **Total** | **roughly $25–30** |

These are estimates, not quotes. Use the AWS pricing calculator against your own region.

**If that is too much:** keep Supabase as the database and deploy only the API, which removes
about $14 a month. The application does not care — it takes a `DATABASE_URL`. Set
`aws_db_instance` aside and point the secret at Supabase's connection string.

**This runs on free-plan credits, which end.** [LEAVING-AWS.md](LEAVING-AWS.md) has the
deadline, the export script, and the move to a free host with no code changes.

## Applying it

Requires the AWS CLI configured with credentials, and OpenTofu or Terraform.

```bash
cd infra
cp example.tfvars terraform.tfvars   # fill in supabase_url
tofu init
tofu plan                            # read this before applying
tofu apply
```

`terraform.tfvars` and all state files are gitignored. **State contains the generated database
password in plaintext**, so it must not be committed; a remote backend with encryption is the
right answer once more than one person deploys.

## The database cannot be destroyed by accident

`deletion_protection` is on and a final snapshot is taken on deletion, because the instance
holds the only copy of every review and automated backups are kept for a day at most. A
`tofu destroy`, or any change that forces the instance to be replaced, fails until
`deletion_protection` is set to `false` and applied on its own first — a deliberate,
reviewable step rather than a side effect of another change. Even then, deletion leaves the
`<name>-final` snapshot behind; delete it by hand if you really mean to lose the data.

## Deploying the API

The instance pulls `:latest` from ECR on start, so a deploy is: push an image, restart the
service.

```bash
REPO=$(tofu -chdir=infra output -raw ecr_repository_url)
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin "${REPO%%/*}"

# --platform is not optional. The instance is t4g, which is arm64; an image
# built on an x86 laptop or on x86 CI will not run there, and the failure looks
# like a container that exits immediately with no useful message.
# Braces are not optional in zsh: it reads `$REPO:l` as the lowercase modifier,
# so "$REPO:latest" expands to "<repo>atest" and the push fails against a
# repository that does not exist.
docker buildx build --platform linux/arm64 -t "${REPO}:latest" --push ./server

aws ssm send-command \
  --instance-ids "$(tofu -chdir=infra output -raw api_instance_id)" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl restart api"]'
```

### Migrations

```bash
infra/migrate-db.sh up --dry-run     # what would run; changes nothing
infra/migrate-db.sh                  # apply pending migrations
```

Run from your machine, not the instance. RDS has no public address, so the script opens a
Session Manager port forward through the instance and runs `node-pg-migrate` from your
`server/` checkout (run `npm ci` there first) in a `node:24` container, as the master user —
migrations create tables, roles and grants, which the API's own login cannot. The production
image stays free of migration tooling.

`infra/export-db.sh` and `infra/provision-api-role.sh` reach the database the same way; the
shared tunnel is `infra/lib/db-tunnel.sh`. TLS is verified in full, hostname included: through
a tunnel the server answers on `localhost`, which its certificate does not name, so the
container maps the real RDS hostname to the tunnel and connects by that name.

## Secrets

The database password is generated by OpenTofu and stored in Secrets Manager. It is never
written to a file, committed, or passed on a command line. The instance reads it at start time
through its instance profile, which is scoped to that one secret rather than to every secret in
the account.

The Supabase URL is *not* secret: the API only uses it to find public keys and to know which
issuer to expect. It holds no Supabase credential of any kind.

**Rotating the password is not a change in Secrets Manager.** RDS holds the master password
from `random_password.database`, and the secret is a copy assembled by OpenTofu. Editing the
secret leaves RDS on the old password, so the next restart makes the API authenticate with a
credential the database rejects — an outage caused by following the runbook — and the next
`tofu apply` silently reverts the edit anyway.

To rotate, change it at the source and let both move together:

```bash
tofu -chdir=infra taint random_password.database
tofu -chdir=infra apply          # updates RDS and the secret in one run
aws ssm send-command --instance-ids "$(tofu -chdir=infra output -raw api_instance_id)" \
  --document-name AWS-RunShellScript --parameters 'commands=["systemctl restart api"]'
```

For real rotation on a schedule, `manage_master_user_password` hands the whole cycle to RDS and
Secrets Manager, which is the right answer once anyone depends on this.

## When something is wrong

```bash
aws logs tail "$(tofu -chdir=infra output -raw log_group)" --follow
aws ssm start-session --target "$(tofu -chdir=infra output -raw api_instance_id)"
```

On the instance: `systemctl status api` and `journalctl -u api -f`.

`docker logs api` does **not** work here and never will: the container uses the `awslogs`
driver, which does not implement reading, so the command returns "configured logging driver
does not support reading" at precisely the moment it is reached for. Application logs are in
CloudWatch, via the `aws logs tail` above; `journalctl` covers everything before the container
starts, which is where startup failures live.

Two alarms exist. One fires when more than ten errors are logged in five minutes — the
container restarts on failure, so a crash loop is otherwise invisible. The other fires when the
database has under 2GiB of storage left. Both email `alarm_email` through an SNS topic, on
firing and again on recovery. AWS sends a confirmation link to that address after the first
apply, and **nothing is delivered until it is clicked** — check that the subscription shows
as confirmed in the SNS console rather than assuming it.

`/healthz` answers without touching the database, so it stays up during a database outage.
`/readyz` checks the database and is the one to look at when the API is running but failing.

## Not built yet

- **Continuous deployment.** Images are built and pushed by hand. The GitHub Actions workflow
  builds the image but does not push it; wiring that up needs an OIDC role in this account.
- **A remote state backend.** State is local, which is fine for one operator and wrong for two.
