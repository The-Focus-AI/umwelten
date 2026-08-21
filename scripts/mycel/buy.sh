#!/usr/bin/env bash
# Buy tokens through Mycel — the end-to-end proof from the buyer's side.
#
# Shows the catalogue with prices, sends one streaming completion, and tells
# you what to look at if it fails. Refuses placeholder credentials, because a
# pasted "sk-mycel-…" has already cost a real debugging session.
#
# Usage, from anywhere with curl and python3:
#   ./scripts/mycel/buy.sh                 # picks the first model for sale
#   ./scripts/mycel/buy.sh MODEL_ID        # buys from a specific model
#
# Environment:
#   APP_CREDENTIAL   Application credential (or an interactive prompt).
#   MYCEL_URL        Default: https://mycel.thefocus.ai
#   END_USER         X-Mycel-End-User attribution. Default: your username.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

refuse_placeholder() {
  local name="$1" value="$2"
  case "$value" in
    *…* | *PASTE* | *YOUR_* | *example.com* | *"<"*">"*)
      die "$name looks like a placeholder: \"$value\" — paste the real value" ;;
  esac
}

MYCEL_URL="${MYCEL_URL:-https://mycel.thefocus.ai}"
END_USER="${END_USER:-$(id -un)}"
MODEL="${1:-}"
refuse_placeholder "MYCEL_URL" "$MYCEL_URL"

if [ -z "${APP_CREDENTIAL:-}" ]; then
  printf 'Application credential (from `mycel application create/rotate`): ' >&2
  read -rs APP_CREDENTIAL
  echo >&2
fi
[ -n "$APP_CREDENTIAL" ] || die "no credential given"
refuse_placeholder "APP_CREDENTIAL" "$APP_CREDENTIAL"

echo "Exchange: $MYCEL_URL"
curl -sf -m 10 "$MYCEL_URL/health" | grep -q '"ok"' ||
  die "the Exchange is not healthy at $MYCEL_URL/health"

echo "for sale:"
catalogue=$(curl -sf -m 10 "$MYCEL_URL/v1/models") || die "could not list models"
echo "$catalogue" | python3 -c '
import json, sys
data = json.load(sys.stdin).get("data", [])
if not data:
    print("  (nothing — no Offers are live; is the machine connected and synced?)")
for m in data:
    p = m.get("pricing") or {}
    print("  %s  ($%s/M in, $%s/M out)" % (m["id"], p.get("prompt", "?"), p.get("completion", "?")))
'

if [ -z "$MODEL" ]; then
  MODEL=$(echo "$catalogue" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d[0]["id"] if d else "")')
  [ -n "$MODEL" ] || die "nothing is for sale, so nothing to buy"
  echo "no model named — buying from the first: $MODEL"
fi

echo
echo "asking $MODEL to say hi (streaming) …"
echo "────────────────────────────────────"
http_code=$(curl -s -m 120 -o /tmp/mycel-buy-response.$$ -w '%{http_code}' \
  "$MYCEL_URL/v1/chat/completions" \
  -H "Authorization: Bearer $APP_CREDENTIAL" \
  -H "X-Mycel-End-User: $END_USER" \
  -H "content-type: application/json" \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one short sentence.\"}]}")
cat /tmp/mycel-buy-response.$$; rm -f /tmp/mycel-buy-response.$$
echo
echo "────────────────────────────────────"

case "$http_code" in
  200) echo "HTTP 200 — served, metered, and charged. \`mycel balance <client>\` shows the debit." ;;
  401) die "HTTP 401 — the credential (or the X-Mycel-End-User header) was refused" ;;
  402) die "HTTP 402 insufficient_balance — fund it: \`mycel grant <client> 50000000\` (\$50)" ;;
  503) die "HTTP 503 no_eligible_offer — the body above lists every Offer considered and
  why each was rejected. supplier-disconnected: start the machine's dial.
  offer-stale: a vendor's sync stopped. missing-*: nothing carries what you required." ;;
  *)   die "HTTP $http_code — body above" ;;
esac
