#!/usr/bin/env bash
# Create the Cloud Monitoring log-match alert for the Gaia Docker watchdog.
# Idempotent: exits successfully when the named policy already exists.
#
# Uses an existing enabled notification channel by default. Override with the
# full channel resource name when a specific destination is required:
#   NOTIFICATION_CHANNEL=projects/.../notificationChannels/... ./this-script
set -euo pipefail

PROJECT="${PROJECT:-habitats-502314}"
DISPLAY_NAME="Gaia container restart loop"

command -v gcloud >/dev/null 2>&1 || {
  echo "error: gcloud is required" >&2
  exit 1
}

if gcloud alpha monitoring policies list \
  --project "$PROJECT" \
  --filter "displayName=\"$DISPLAY_NAME\"" \
  --format 'value(name)' | grep -q .; then
  echo "Alert policy already exists: $DISPLAY_NAME"
  exit 0
fi

channel="${NOTIFICATION_CHANNEL:-}"
if [[ -z "$channel" ]]; then
  channel="$(gcloud alpha monitoring channels list \
    --project "$PROJECT" \
    --filter 'enabled=true' \
    --format 'value(name)' \
    --limit 1)"
fi
if [[ -z "$channel" ]]; then
  echo "error: no enabled notification channel found; set NOTIFICATION_CHANNEL" >&2
  exit 1
fi

policy="$(mktemp)"
trap 'rm -f "$policy"' EXIT
cat > "$policy" <<'EOF'
{
  "displayName": "Gaia container restart loop",
  "documentation": {
    "content": "Gaia restarted at least three times. Inspect docker logs gaia and the latest Deploy Gaia host workflow. The deploy script automatically rolls back candidate images when this occurs during a deployment.",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "Gaia emitted GAIA_RESTART_LOOP",
      "conditionMatchedLog": {
        "filter": "resource.type=\"gce_instance\" AND log_id(\"gcplogs-docker-driver\") AND \"GAIA_RESTART_LOOP\""
      }
    }
  ],
  "alertStrategy": {
    "notificationRateLimit": { "period": "300s" },
    "autoClose": "1800s"
  },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["CHANNEL_PLACEHOLDER"]
}
EOF
sed -i "s|CHANNEL_PLACEHOLDER|$channel|" "$policy"

gcloud alpha monitoring policies create \
  --project "$PROJECT" \
  --policy-from-file "$policy"
