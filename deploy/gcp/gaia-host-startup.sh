#!/bin/bash
# Startup script for the Gaia host on GCE (habitats-502314, us-east4).
# Idempotent — runs on every boot; each step no-ops when already done.
# Provisioned by: gcloud compute instances create gaia-host ... \
#   --metadata-from-file startup-script=deploy/gcp/gaia-host-startup.sh
# See docs/architecture/migration-plan-2026-07.md Phase 3.

set -u

# ── Swap (4G) — the old host's no-swap config turned memory pressure into
# kernel OOM kills (#229); swap buys the fleet headroom to degrade gracefully.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon -a

# ── Docker Engine + compose plugin ──────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# ── Docker daemon defaults: gcplogs → Cloud Logging for every container.
# Dual logging (Docker ≥ 20.10) keeps `docker logs` working locally, so
# Gaia's agent_logs / dashboard tail is unaffected. Runtime logs only —
# Source Sessions live on volumes and never ship to Cloud Logging.
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

# ── Gaia prerequisites: data dir (identity bind-mount target) + ingress
# network (DockerManager expects it to exist; compose marks it external).
mkdir -p /opt/gaia-data
docker network inspect gaia-net >/dev/null 2>&1 || docker network create gaia-net
