#!/usr/bin/env bash
# Create or update the one unproxied Cloudflare wildcard used by project previews.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${GAIA_ENV_FILE:-$SCRIPT_DIR/.env}"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${GAIA_PREVIEW_DOMAIN:?GAIA_PREVIEW_DOMAIN must be set in $ENV_FILE}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set in $ENV_FILE}"

ZONE="${GAIA_PREVIEW_DOMAIN#preview.}"
RECORD="*.${GAIA_PREVIEW_DOMAIN}"
PUBLIC_IP="${GAIA_PUBLIC_IP:-$(curl -fsS --max-time 5 \
  -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)}"
API=https://api.cloudflare.com/client/v4
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json')

json_id() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["success"] and len(data["result"]) == 1; print(data["result"][0]["id"])'
}

zone_response="$(curl -fsS --get "${AUTH[@]}" --data-urlencode "name=$ZONE" "$API/zones")"
zone_id="$(json_id <<<"$zone_response")"
record_response="$(curl -fsS --get "${AUTH[@]}" \
  --data-urlencode 'type=A' --data-urlencode "name=$RECORD" \
  "$API/zones/$zone_id/dns_records")"
record_count="$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)["result"]))' <<<"$record_response")"
payload="$(python3 -c 'import json,sys; print(json.dumps({"type":"A","name":sys.argv[1],"content":sys.argv[2],"ttl":300,"proxied":False}))' "$RECORD" "$PUBLIC_IP")"

if [[ "$record_count" == 0 ]]; then
  result="$(curl -fsS -X POST "${AUTH[@]}" --data "$payload" "$API/zones/$zone_id/dns_records")"
  action=created
elif [[ "$record_count" == 1 ]]; then
  record_id="$(json_id <<<"$record_response")"
  result="$(curl -fsS -X PUT "${AUTH[@]}" --data "$payload" "$API/zones/$zone_id/dns_records/$record_id")"
  action=updated
else
  echo "error: multiple A records named $RECORD; refusing to guess" >&2
  exit 1
fi

python3 -c 'import json,sys; assert json.load(sys.stdin)["success"]' <<<"$result"
echo "[preview-dns] $action $RECORD -> $PUBLIC_IP (DNS only)"
