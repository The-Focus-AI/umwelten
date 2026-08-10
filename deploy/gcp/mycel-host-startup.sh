#!/bin/bash
# Startup script for the Mycel host on GCE (habitats-502314, us-east4).
# Idempotent — runs on every boot; each step no-ops when already done.
# Provisioned by: gcloud compute instances create mycel-host ... \
#   --service-account mycel-sa@habitats-502314.iam.gserviceaccount.com \
#   --metadata-from-file startup-script=deploy/gcp/mycel-host-startup.sh
# See docs/adr/0030-mycel-runs-on-its-own-vm-with-its-own-identity.md.
#
# Deliberately shorter than gaia-host-startup.sh, and the differences are the
# decision rather than an oversight:
#
#   - No swap. Gaia needed it because a fleet of habitat containers turned
#     memory pressure into OOM kills (#229). This host runs one HTTP service
#     over a remote database; if it is swapping, something is wrong and the
#     right outcome is to find out, not to absorb it.
#   - No data dir. Mycel's state is in Neon and it writes nothing to disk —
#     which is also the cleanest statement of why it is not a habitat.
#   - No docker socket handed to anything but Caddy, read-only. Nothing here
#     spawns containers.

set -u

# ── Docker Engine + compose plugin ──────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# ── Docker daemon defaults: gcplogs → Cloud Logging, same as the Gaia host,
# so both services' runtime logs land in one place and R1 reads the same way.
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "gcplogs"
}
JSON
  systemctl restart docker
fi

# ── Ops Agent: host metrics (mem/disk/CPU), syslog → Cloud Monitoring ───
if [ ! -d /opt/google-cloud-ops-agent ] && ! systemctl is-active -q google-cloud-ops-agent; then
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  bash add-google-cloud-ops-agent-repo.sh --also-install
  rm -f add-google-cloud-ops-agent-repo.sh
fi

# ── Ingress network. External in the compose file so the literal name is
# pinned and no compose project prefix appears.
docker network inspect mycel-net >/dev/null 2>&1 || docker network create mycel-net

# Note what is NOT here: no secret is fetched, written, or templated on this
# host. The container resolves Secret Manager itself at start through this
# instance's attached service account, so a compromise of the disk yields no
# credential — there is none on it.
