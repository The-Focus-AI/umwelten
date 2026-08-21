#!/usr/bin/env bash
# Sell this machine's tokens through Mycel.
#
# Every failure this script guards against has happened on a real box:
# a placeholder credential pasted verbatim (401 at the upgrade), the wrong
# runtime port (probing one server while serving another), and an Exchange
# hostname that didn't resolve. So it checks everything cheap BEFORE starting
# the long-lived dial, prompts for what it needs instead of relying on
# copy-pasted exports, and refuses values that are obviously placeholders.
#
# Usage, on the GPU machine, from the repo root:
#   ./scripts/mycel/sell.sh --runtime http://localhost:4000/v1
#
# Options:
#   --runtime <url>      REQUIRED. The OpenAI-compatible base to serve from
#                        (the /v1, not the bare port).
#   --runtime-key <key>  Key that runtime expects, if any (or RUNTIME_API_KEY).
#   --mycel <url>        Exchange base URL (or MYCEL_URL).
#                        Default: https://mycel.thefocus.ai
#   --probe              Run the full probe battery before connecting.
#                        Default is --no-probe: connect and serve immediately,
#                        leaving whatever Offers the Exchange already has.
#   --model <substring>  With --probe: only probe Models matching this.
#
# The Supplier credential comes from $SUPPLIER_CREDENTIAL or an interactive
# prompt — pasting it at a prompt cannot leave a stale placeholder in a shell.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

# The placeholder patterns that have actually been pasted into production
# shells. A value matching one of these is never a real secret or URL.
refuse_placeholder() {
  local name="$1" value="$2"
  case "$value" in
    *…* | *PASTE* | *YOUR_* | *example.com* | *"<"*">"*)
      die "$name looks like a placeholder: \"$value\" — paste the real value" ;;
  esac
}

MYCEL_URL="${MYCEL_URL:-https://mycel.thefocus.ai}"
RUNTIME_URL=""
RUNTIME_KEY="${RUNTIME_API_KEY:-}"
PROBE_FLAG="--no-probe"
MODEL_FILTER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --runtime)      RUNTIME_URL="$2"; shift 2 ;;
    --runtime-key)  RUNTIME_KEY="$2"; shift 2 ;;
    --mycel)        MYCEL_URL="$2"; shift 2 ;;
    --probe)        PROBE_FLAG=""; shift ;;
    --model)        MODEL_FILTER="$2"; shift 2 ;;
    -h|--help)      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[ -n "$RUNTIME_URL" ] || die "--runtime is required — it is what makes this machine a Supplier.
  e.g. ./scripts/mycel/sell.sh --runtime http://localhost:4000/v1"
refuse_placeholder "--runtime" "$RUNTIME_URL"
refuse_placeholder "--mycel" "$MYCEL_URL"
case "$RUNTIME_URL" in
  */v1) ;;
  *) die "--runtime should end in /v1 (the OpenAI-compatible base), got: $RUNTIME_URL" ;;
esac

# ── The credential: env var, or a prompt that cannot be copy-pasted wrong ──
if [ -z "${SUPPLIER_CREDENTIAL:-}" ]; then
  printf 'Supplier credential (from `mycel supplier register/rotate`, starts sk-mycel-): ' >&2
  read -rs SUPPLIER_CREDENTIAL
  echo >&2
fi
[ -n "$SUPPLIER_CREDENTIAL" ] || die "no credential given"
refuse_placeholder "SUPPLIER_CREDENTIAL" "$SUPPLIER_CREDENTIAL"
case "$SUPPLIER_CREDENTIAL" in
  sk-mycel-*) ;;
  *) die "SUPPLIER_CREDENTIAL should start with sk-mycel- — is this the right value?" ;;
esac
export SUPPLIER_CREDENTIAL

# ── Preflight: every network hop, cheap, before anything long-lived ──
auth_header=()
[ -n "$RUNTIME_KEY" ] && auth_header=(-H "Authorization: Bearer $RUNTIME_KEY")

echo "checking runtime at $RUNTIME_URL …"
models_json=$(curl -sf -m 10 "${auth_header[@]}" "$RUNTIME_URL/models") ||
  die "runtime not answering at $RUNTIME_URL/models
  Is the server up? Is this the right port? (curl it yourself to check.)
  If it returned 401, pass its key with --runtime-key."
echo "$models_json" | grep -q '"data"' ||
  die "runtime answered but not with an OpenAI model list — wrong port?"
echo "  serving: $(echo "$models_json" | python3 -c 'import json,sys; print(", ".join(m["id"] for m in json.load(sys.stdin)["data"]))' 2>/dev/null || echo '(unparseable)')"

echo "checking Exchange at $MYCEL_URL …"
curl -sf -m 10 "$MYCEL_URL/health" | grep -q '"ok"' ||
  die "the Exchange at $MYCEL_URL is not healthy — check the URL, or the operator"

# ── Point discovery and serving at the same endpoint (ADR 0015) ──
export VLLM_BASE_URL="$RUNTIME_URL"
[ -n "$RUNTIME_KEY" ] && export VLLM_API_KEY="$RUNTIME_KEY"

cd "$(dirname "$0")/../.."
[ -f package.json ] || die "run this from a umwelten checkout"

echo "starting the dial — Ctrl-C hangs up and the Exchange sees it immediately"
exec pnpm run cli -- supplier dial \
  --mycel "$MYCEL_URL" \
  --runtime "$RUNTIME_URL" \
  ${RUNTIME_KEY:+--runtime-key "$RUNTIME_KEY"} \
  ${MODEL_FILTER:+--model "$MODEL_FILTER"} \
  $PROBE_FLAG
