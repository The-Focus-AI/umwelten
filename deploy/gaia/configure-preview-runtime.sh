#!/usr/bin/env bash
# Initialize the non-DNS project-preview settings in Gaia's canonical env file.
# Values are generated on the host and never printed. Existing non-empty values
# are preserved so rerunning this script does not rotate shared preview links or
# capabilities.
set -euo pipefail

ENV_FILE="${GAIA_ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env}"
DOMAIN="${GAIA_PREVIEW_DOMAIN:-preview.crepusculardiphthong.com}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  exit 1
fi

upsert_if_empty() {
  local key="$1" value="$2" tmp
  if grep -Eq "^${key}=.+" "$ENV_FILE"; then
    echo "[preview-config] $key already configured"
    return
  fi

  tmp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  export PREVIEW_CONFIG_KEY="$key" PREVIEW_CONFIG_VALUE="$value"
  awk '
    BEGIN { replaced = 0 }
    $0 ~ "^" ENVIRON["PREVIEW_CONFIG_KEY"] "=" {
      if (!replaced) print ENVIRON["PREVIEW_CONFIG_KEY"] "=" ENVIRON["PREVIEW_CONFIG_VALUE"]
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print ENVIRON["PREVIEW_CONFIG_KEY"] "=" ENVIRON["PREVIEW_CONFIG_VALUE"]
    }
  ' "$ENV_FILE" > "$tmp"
  chmod --reference="$ENV_FILE" "$tmp"
  mv "$tmp" "$ENV_FILE"
  unset PREVIEW_CONFIG_KEY PREVIEW_CONFIG_VALUE
  echo "[preview-config] configured $key"
}

backup="${ENV_FILE}.before-preview-$(date -u +%Y%m%dT%H%M%SZ)"
cp --preserve=mode "$ENV_FILE" "$backup"
echo "[preview-config] backup written to $backup"

upsert_if_empty GAIA_PREVIEW_DOMAIN "$DOMAIN"
upsert_if_empty GAIA_PREVIEW_WAKE_KEY "$(openssl rand -hex 32)"
upsert_if_empty GAIA_PREVIEW_ACTIVITY_KEY "$(openssl rand -hex 32)"

echo "[preview-config] runtime configuration ready; DNS credential unchanged"
