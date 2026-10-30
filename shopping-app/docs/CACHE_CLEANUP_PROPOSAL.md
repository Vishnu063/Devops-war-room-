# Optional disposable-workspace cache cleanup proposal

The managed workspace uses Docker VFS on a32GiB filesystem. Source, images, logs and exported layers consume physical disk much faster than logical image-size totals suggest. Task-owned scanner cache and obsolete NovaCart artifacts were reclaimed, but full final-candidate verification still lacks free space.

Automatic approval rejected broader cache cleanup because generic app/dependency stage or npm-command matching could affect other projects' cached builds. Those caches were preserved. An alternative is a larger/free verification workspace. Existing EC2 capacity is unknown until AWS access is attached.

If the owner explicitly authorizes clearing unused build cache across this **disposable managed workspace**, the proposed command is:

```bash
$ docker --host=unix:///var/run/docker.sock buildx prune --all --force
```

This proposal targets unused BuildKit cache across projects. It can make later builds slower and require dependency/base downloads again. It does not request removal of images, running containers, volumes, source checkouts or databases. Do not execute it without explicit authorization; it was not run here. No production host is targeted.

After sufficient storage is available, rebuild/verify the final candidate, repeat all service scans, and preserve exact image IDs and sanitized evidence. A cache cleanup approval does not authorize EC2 deployment, DNS/firewall/routing changes or financial expenditure.
