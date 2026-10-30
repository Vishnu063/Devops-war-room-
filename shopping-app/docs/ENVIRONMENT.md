# Environment and secret bindings

Use a new private directory outside Git, mode0700, or an approved secret manager. `.local-preview/` is ignored. Compose file secrets are bind mounts, not an encrypted secret manager. Docker administrators can access them. Individual fixture files are readable across the specific mounted container UIDs; their enclosing host directory is private. Do not print a populated Compose configuration, environment or credentials.

| Name/input | Purpose |
| --- | --- |
| `APP_ORIGIN` | Canonical HTTPS browser origin, including preview port |
| `PREVIEW_HTTPS_PORT` | Unprivileged loopback HTTPS publication; default8443 |
| `PREVIEW_HOST` | Same canonical host:port for internal monitor Host validation |
| `SECRETS_DIRECTORY` | Absolute protected input directory |
| `APP_IMAGE`, `OPERATIONS_IMAGE`, `DATABASE_IMAGE`, `NGINX_PROXY_IMAGE` | Reviewed tags for development; immutable digests for release |
| `NODE_IMAGE`, `POSTGRES_IMAGE`, `NGINX_IMAGE` | Committed digest-pinned base defaults; review updates explicitly |
| `app_url`, `migrator_url`, `backup_url` | Separate private PostgreSQL URLs, mounted only where required |
| `admin_password`, `app_password`, `migrator_password`, `backup_password` | Initialization passwords for a new database volume |
| `data_key` | Private32-byte hex application encryption key; preserve/rotate through reviewed re-encryption |
| `backup_key` | Separate private32-byte hex backup key; escrow off-server independently |
| `backup_token` | Owner-approved encrypted-object upload/readback bearer token |
| `tls/cert.pem`, `tls/key.pem` | TLS chain/private key; fixture certificate is local-only and expires in3 days |
| `preview_auth`, `preview_password`, `monitor_login` | Hashed Nginx auth and private local reviewer/monitor credentials |
| `BACKUP_UPLOAD_BASE_URL` | Approved HTTPS object endpoint; PUT then GET of generated encrypted filename |
| `ALERT_WEBHOOK_URL` | Optional approved HTTPS notification endpoint, no default outbound messaging |

The app supports explicit `_FILE` bindings for listed credentials via `backend/runtime-env.mjs`; it refuses competing direct/file values. Secret values do not appear in image layers or source. Compose fixes NODE_ENV=production and RELEASE_MODE=preview, disables live/preview order acceptance, COD, live payments and indexing. No gateway account is selected or activated by this configuration.

Actual EC2/Ubuntu compatibility, available memory/disk, other applications, firewalls and ports must be inspected on the owner-selected host. Working here on Debian does not verify an Ubuntu26.04 server. Repeated builds with Docker's VFS driver need substantial extra disk beyond image-size totals; preflight disk before building. Container limits are development caps, not a capacity guarantee.

## Owner-selected EC2 preview

The owner selected the existing EC2 server, with SSH user ubuntu only if confirmed by AMI/configuration. Prefer a verified owned domain's novacart subdomain; otherwise an access-restricted temporary Cloudflare Tunnel address. Stop before changing public routing, DNS/firewall rules or incurring charges. No public URL is known or verified.

Observed current task: the authorized connection manifest has zero entries; runtime metadata has zero outbound identities and zero secrets. AWS_PROFILE-related variable names alone do not establish a connection. No EC2 host/IP, OS, capacity, AMI/default user, containers, Nginx or ports could be inspected. This managed Debian workspace is not the EC2 server. No credentials were read from files or requested in chat.

Attach the AWS identity through environment settings, then wait for current ready observations and select its AWS profile/config file from the connection manifest. Start with STS identity, EC2 Describe and owned-domain listing permissions. SSH/SSM access and any TCP grants must be explicitly configured for the actual discovered instance; HTTP allowlisting is not SSH access. Never guess an IP or use metadata credentials from an unrelated host.

After discovery, perform read-only host checks and retain a sanitized summary only:

```bash
$ cat /etc/os-release
$ uname -m
$ free -h
$ df -h
$ nproc
$ docker ps
$ docker compose version
$ sudo -n ss -ltnp
$ sudo -n ufw status verbose
```

Inspect existing Nginx locally without publishing raw configurations that may contain credentials. Confirm available loopback ports and resource limits. A new private Compose project must not replace existing applications. A temporary tunnel must keep preview authentication, canonical HTTPS origin and certificate verification; do not use TLS-bypass flags. Actual endpoint, certificate/renewal, smoke and access-denial checks remain required before reporting a working URL.

## Authorized AWS discovery commands

After a ready AWS connection appears in the managed manifest, select only its actual alias/config path as described by the runtime skill. With that command-scoped profile, start read-only discovery (do not substitute guessed region, instance or IP):

```bash
$ aws sts get-caller-identity
$ aws ec2 describe-regions --query 'Regions[].RegionName' --output json
$ aws ec2 describe-instances --region "$APPROVED_AWS_REGION" --filters Name=instance-state-name,Values=running --query 'Reservations[].Instances[].{Id:InstanceId,Image:ImageId,Type:InstanceType,PublicIP:PublicIpAddress,PublicDNS:PublicDnsName,Tags:Tags}' --output json
$ aws route53 list-hosted-zones --query 'HostedZones[].{Id:Id,Name:Name}' --output json
```

Use only the authorized region/account and discovered instance; if multiple candidates cannot be resolved from tags and existing configuration, ask for that instance choice. Inspect its AMI and attached access configuration before selecting ubuntu. Configure SSH/SSM and destination grants through authorized environment settings; never retrieve, print or request private keys in chat. After the host checks above, use DEPLOYMENT.md for the dedicated private Compose setup. Do not alter an existing website's routing or public access rules without approval.
