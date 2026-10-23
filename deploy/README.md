# Kula monitoring stack (Docker + existing Caddy systemd service)

This directory deploys [Kula](https://github.com/c0m4r/kula) on a Linux VPS to monitor it continuously (including CPU steal).
The Docker container binds only `127.0.0.1:27960` using host networking; your **existing host-systemd Caddy** exposes an HTTPS subdomain with HTTP Basic Authentication. Caddy stays outside Docker.

It lives in its own directory and touches no upstream file, so syncing this fork with upstream stays conflict-free.

## Requirements

- Linux server with Docker Engine and `docker compose` plugin already working
- Caddy v2.8+ running as a systemd service with default `/etc/caddy/Caddyfile` (or pass `CADDYFILE=/custom/path`)
- `curl`, `bash`, `git`, standard shell utilities
- An available subdomain whose A/AAAA records resolve to the VPS, plus public ports 80/443 for automatic Caddy TLS
- Sudo/root access to install the one-time Caddy site snippet

## First installation

1. Clone the repository onto the VPS:

   ```bash
   git clone https://github.com/<you>/kula.git
   cd kula
   ```

2. Run:

   ```bash
   sudo bash deploy/setup.sh
   ```

3. On first run, enter the subdomain, dashboard username, and a strong password. The script validates the Caddy configuration before modifying it, refuses a domain that is already configured anywhere in Caddy (imports included), backs up the original Caddyfile, appends one `import` directive, validates again, then reloads Caddy. If anything fails or the run is interrupted after that point, the previous Caddyfile is restored and the snippet removed. It does *not* touch other Docker stacks or their volumes.
4. Open `https://monitor.example.com` and log in with the chosen credentials.

**Security**: Only Caddy is public; Kula listens on host loopback. Caddy is configured with a bcrypt password hash, not the plaintext password; the snippet is `0640 root:caddy` when the `caddy` group of the official packages exists. Do not publish the Caddy snippet/password hash unnecessarily. The UI exposes sensitive server metrics and API data; keep authentication active. TLS issuance depends on correct DNS and firewall configuration.

## Updates / reinstallation

```bash
git pull
sudo bash deploy/setup.sh
```

By default the script **builds the image from this checkout** (`addons/docker/Dockerfile`), so `git pull` plus the script deploys exactly what is on your branch, including this fork's own changes. Each build is tagged with its commit (`kula-monitor:<commit>`), and the summary at the end shows which one is running. It then runs `docker compose up -d`, preserves the named `kula-monitor-data` volume, and leaves an existing Caddy site/password untouched. It does **not** install or upgrade Docker or Caddy. If the build fails, the running container is left as it is.

The build runs on the server: it needs internet access for the Go and Alpine base images and the Go modules, takes a few minutes, and on small servers is worth watching for free disk space and memory. Old builds stay as tagged images; list them with `docker image ls kula-monitor` and remove the ones you no longer need with `docker image rm`. The Go build cache grows too and can be cleared with `docker builder prune`.

To roll back a build, either check out the older commit and rerun the script, or start an image that is still on the server:

```bash
git checkout <commit> && sudo bash deploy/setup.sh
sudo KULA_IMAGE=kula-monitor:<commit> docker compose -f deploy/compose.yaml up -d --no-build
```

Run updates through `setup.sh`. A manual `docker compose -f deploy/compose.yaml up -d` without `KULA_IMAGE` builds this checkout as `kula-monitor:local`; it never relabels a build as the upstream image.

To run the published upstream image instead (without this fork's changes), use the newest release or pin one from [Docker Hub](https://hub.docker.com/r/c0m4r/kula/tags):

```bash
sudo KULA_SOURCE=image bash deploy/setup.sh
sudo KULA_VERSION=0.21.0 bash deploy/setup.sh
```

`KULA_VERSION` implies `KULA_SOURCE=image`. If a pull fails, Compose may suggest `docker compose build`; in image mode that hint does not apply, check the tag and the network instead. The choice only applies to that run; the next plain run builds from the checkout again. Old images can be removed with `docker image prune`.

## Status, historical storage and logs

```bash
docker ps --filter name=kula-monitor
docker logs --tail=100 kula-monitor
docker exec kula-monitor /app/kula inspect
curl -fsS http://127.0.0.1:27960/health
```

Kula's bundled default storage config uses tiered ring buffers (~250 MB 1-second samples, ~150 MB 1-minute, ~50 MB 5-minute). Actual retention depends on metric cardinality; this is **not** a guaranteed number of months. Inspect actual retained history with `kula inspect`. The `kula-monitor-data` volume contains history and should be included in your backup strategy. Do not run `docker compose down -v` or prune the named volume if you want to keep measurements.

## Changing the password or domain

The script never rewrites an existing snippet. To change the password, generate a new hash and replace it in `/etc/caddy/kula-monitor.caddy`, then reload Caddy:

```bash
caddy hash-password
sudo systemctl reload caddy
```

To start the Caddy setup over (e.g. a new domain), delete `/etc/caddy/kula-monitor.caddy` **and** the `import /etc/caddy/kula-monitor.caddy` line (plus its comment) from the Caddyfile, then run `sudo bash deploy/setup.sh` again.

## Notes / limits

- `KULA_MOUNTS_DETECTION=host` selects host mounts. The configuration follows the official Kula Docker recommendation of `pid: host`, `network_mode: host` and a read-only `/proc` mount. Kula runs unprivileged in both the built and the official image.
- Docker container discovery may show raw cgroup/container IDs rather than convenient container names without the Docker socket. The Docker socket is intentionally **not** mounted because it grants elevated access to the host.
- Host CPU steal measurements do not prove dedicated core ownership. Cross-correlate spikes with Minecraft TPS/MSPT and active workload.
- Caddy `basic_auth` needs Caddy v2.8+. For custom Caddy setups that aren't managed via the standard Caddyfile, review `setup.sh` and integrate the site manually instead of running the Caddy setup blindly.
- The script refuses to run if something other than its own container already answers on port 27960 (e.g. a native Kula install).
- The installer doesn't automatically change firewall rules or DNS.

## Files installed / touched

- `deploy/compose.yaml`: Docker service definition in this repository (builds from `addons/docker/Dockerfile`)
- `/etc/caddy/kula-monitor.caddy`: generated protected site (or next to your custom Caddyfile)
- `/etc/caddy/Caddyfile`: one `import` directive, only on first setup; backup kept as `Caddyfile.kula-backup-<timestamp>`
- Docker volume `kula-monitor-data`: measurement history

## References

- [Official Kula Docker documentation](../docs/user/02-installation.md#docker)
- [Kula reverse proxy notes](../docs/user/13-reverse-proxy.md)
- [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
- [Caddy configuration validation/reload](https://caddyserver.com/docs/command-line)
