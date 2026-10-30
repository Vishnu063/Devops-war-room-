# Optional disposable-workspace cache cleanup proposal

The managed workspace uses Docker VFS on a32GiB filesystem. Source, images, logs and exported layers consume physical disk much faster than logical image-size totals suggest. Task-owned scanner cache and obsolete NovaCart artifacts were reclaimed, but full final-candidate verification still lacks free space.

Automatic approval rejected broader cache cleanup because generic app/dependency stage or npm-command matching could affect other projects' cached builds. Those caches were preserved. An alternative is a larger/free verification workspace. Existing EC2 capacity is unknown until AWS access is attached.

If the owner explicitly authorizes clearing unused build cache across this **disposable managed workspace**, the proposed command is:

```bash
$ docker --host=unix:///var/run/docker.sock buildx prune --all --force
```

This proposal targets unused BuildKit cache across projects. It can make later builds slower and require dependency/base downloads again. It does not request removal of images, running containers, volumes, source checkouts or databases. The owner explicitly authorized this command in the subsequent deployment request. It was run on the managed local daemon, then repeated after the bounded image rebuilds. No images, volumes, databases, containers or EC2 resources were removed. No production host is targeted.

After sufficient storage is available, rebuild/verify the final candidate, repeat all service scans, and preserve exact image IDs and sanitized evidence. A cache cleanup approval does not authorize EC2 deployment, DNS/firewall/routing changes or financial expenditure.

## Execution outcome

Initial cleanup increased free space from about1.1GiB to8.6GiB (logical BuildKit total590.4MB; physical VFS savings were larger). Fresh candidate images were built in bounded batches with the normal proxy CA secret. A second authorized unused-cache cleanup left about4.5GiB before container acceptance. The full rebuild runner retains its conservative12GiB free-space preflight; at4.5GiB this needs at least7.5GiB additional free storage. Acceptance can explicitly reuse the exact freshly built images with3GiB required; that mode records image IDs and never claims a rebuild happened inside that invocation. No unsafe cleanup or other resource deletion was used.

During the subsequent website audit, exact superseded NovaCart-only app/operations images were removed after positively identifying their IDs/workdir and retaining the newer candidate for rollback. This was not a global image prune. Unrelated images, all volumes/databases/source and existing applications were preserved. The final website report records the current image identities and rollback pair.
