#!/bin/sh
# Resolve secrets from Google Secret Manager, then exec the service.
#
# The instance's attached service account IS the credential (ADR 0030): the
# metadata server hands out short-lived tokens, so there is no key file, no
# bootstrap token, and nothing secret at rest on the box. Values live in this
# process's environment and nowhere else — there is no file to leak and none
# to clean up.
#
# MYCEL_SECRETS maps environment variable names to GSM secret ids:
#
#   MYCEL_SECRETS="MYCEL_DATABASE_URL=mycel-database-url,OPENROUTER_API_KEY=mycel-openrouter-api-key"
#
# It holds only names, so it is not itself a secret and lives in the compose
# file in plain sight. Unset it and this is a no-op, which is what keeps local
# development working with a plain `docker run -e MYCEL_DATABASE_URL=...`.
set -eu

if [ -n "${MYCEL_SECRETS:-}" ]; then
  METADATA="http://metadata.google.internal/computeMetadata/v1"
  FLAVOR="Metadata-Flavor: Google"

  PROJECT="${GOOGLE_CLOUD_PROJECT:-$(curl -sf -H "$FLAVOR" "$METADATA/project/project-id")}"

  # node rather than jq: node is already in this image because the service runs
  # on it, and jq would be one more package on the box holding the ledger.
  TOKEN=$(curl -sf -H "$FLAVOR" "$METADATA/instance/service-accounts/default/token" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).access_token))')

  OLDIFS=$IFS
  IFS=','
  for pair in $MYCEL_SECRETS; do
    IFS=$OLDIFS
    name=${pair%%=*}
    id=${pair#*=}

    # -K - reads the request from stdin so the access token never appears in
    # argv, where any other process in this namespace could read it off `ps`.
    payload=$(printf 'header = "Authorization: Bearer %s"\nurl = "%s"\n' \
      "$TOKEN" \
      "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$id/versions/latest:access" |
      curl -sf -K -)

    # A missing or unreadable secret must stop the boot. Starting without one
    # gets you a service that answers, takes traffic, and cannot meter it.
    value=$(printf '%s' "$payload" |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).payload;if(!p||!p.data)process.exit(1);process.stdout.write(p.data)})' |
      base64 -d)

    export "$name=$value"
    IFS=','
  done
  IFS=$OLDIFS
fi

exec "$@"
