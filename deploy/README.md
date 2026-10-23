# Kula monitoring stack (Docker + existing Caddy systemd service)

This directory deploys [Kula](https://github.com/c0m4r/kula) on a Linux VPS to monitor it continuously (including CPU steal).
The Docker container binds only `127.0.0.1:27960` using host networking; your **existing host-systemd Caddy** exposes an HTTPS subdomain with HTTP Basic Authentication. Caddy stays outside Docker.

It lives in its own directory and touches no upstream file, so syncing this fork with upstream stays conflict-free.

## Requirements

- Linux server with Docker Engine and `docker compose` plugin already working
- Caddy v2 running as a systemd service with default `/etc/caddy/Caddyfile` (or pass `CADDYFILE=/custom/path`)
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

The script uses `docker compose pull` and `docker compose up -d`, preserves the named `kula-monitor-data` volume, and leaves an existing Caddy site/password untouched. It does **not** install or upgrade Docker or Caddy. If the pull fails, the running container is left as it is.

By default the newest published image (`c0m4r/kula:latest`) is deployed, so re-running the script is what updates Kula; `git pull` only refreshes these deployment files. The repository's `VERSION` file is not used as the image tag because upstream bumps it to the next, still unpublished version during development.

To pin a release or roll back, pass a published tag from [Docker Hub](https://hub.docker.com/r/c0m4r/kula/tags):

```bash
sudo KULA_VERSION=0.21.0 bash deploy/setup.sh
```

The pin only applies to that run; the next plain run returns to `latest`. Old images can be removed with `docker image prune`.

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

- `KULA_MOUNTS_DETECTION=host` selects host mounts. The configuration follows the official Kula Docker recommendation of `pid: host`, `network_mode: host` and a read-only `/proc` mount. Kula is unprivileged in the official image.
- Docker container discovery may show raw cgroup/container IDs rather than convenient container names without the Docker socket. The Docker socket is intentionally **not** mounted because it grants elevated access to the host.
- Host CPU steal measurements do not prove dedicated core ownership. Cross-correlate spikes with Minecraft TPS/MSPT and active workload.
- On Caddy older than 2.8 the snippet uses the old directive name `basicauth`; after a Caddy upgrade it keeps working (with a deprecation warning). For custom Caddy setups that aren't managed via the standard Caddyfile, review `setup.sh` and integrate the site manually instead of running the Caddy setup blindly.
- The script refuses to run if something other than its own container already answers on port 27960 (e.g. a native Kula install).
- The installer doesn't automatically change firewall rules or DNS.

## Files installed / touched

- `deploy/compose.yaml`: Docker service definition in this repository
- `/etc/caddy/kula-monitor.caddy`: generated protected site (or next to your custom Caddyfile)
- `/etc/caddy/Caddyfile`: one `import` directive, only on first setup; backup kept as `Caddyfile.kula-backup-<timestamp>`
- Docker volume `kula-monitor-data`: measurement history

## References

- [Official Kula Docker documentation](../docs/user/02-installation.md#docker)
- [Kula reverse proxy notes](../docs/user/13-reverse-proxy.md)
- [Caddy basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
- [Caddy configuration validation/reload](https://caddyserver.com/docs/command-line)
