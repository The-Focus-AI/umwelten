# Mycel — the Exchange.
#
# One stage. The image is a bundled JavaScript file plus curl — no node_modules,
# no pnpm, no source tree.
#
# The bundle is built before this runs, by deploy.sh:
#   pnpm --filter @umwelten/mycel build   →  packages/mycel/dist/mycel.js
#
# Build (from monorepo root):
#   docker build -t mycel -f packages/mycel/Dockerfile .

FROM node:22-slim
ENV NODE_ENV=production

# curl for the healthcheck below and for reading Secret Manager through the
# instance metadata server (ADR 0030). ca-certificates is NOT implied: on Debian
# it arrives through curl's Recommends, which --no-install-recommends drops, and
# without it the metadata call still works (plain HTTP) while every HTTPS call
# fails with curl exit 77, CURLE_SSL_CACERT_BADFILE.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Not root. Mycel writes nothing to disk, so there is no reason for it to be
# able to.
RUN useradd --system --uid 10001 mycel

WORKDIR /app
COPY --chown=mycel:mycel packages/mycel/dist/mycel.js ./mycel.js
COPY deploy/mycel/entrypoint.sh /usr/local/bin/mycel-entrypoint
RUN chmod 0755 /usr/local/bin/mycel-entrypoint

USER mycel

ENV MYCEL_PORT=7438
EXPOSE 7438

# Reports whether the store is reachable, not merely whether the process is up:
# a service that answers while its database is gone is worse than one that does
# not answer, because Dispatch keeps sending it traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7438/health || exit 1

# Secrets are resolved into this process's environment and nowhere else. With
# MYCEL_SECRETS unset the entrypoint is a passthrough, so `docker run -e ...`
# still works off a GCE instance.
ENTRYPOINT ["/usr/local/bin/mycel-entrypoint"]
CMD ["node", "/app/mycel.js", "serve"]
