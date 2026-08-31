# Mycel — the Exchange.
#
# The runtime image is a bundled JavaScript file plus curl and the standalone
# esbuild executable — no node_modules, no pnpm, no source tree. The binary is
# required because the Shell contract transpiles substrate TypeScript on demand.
#
# The bundle is built before this runs, by deploy.sh:
#   pnpm --filter @umwelten/mycel build   →  packages/mycel/dist/mycel.js
#
# Build (from monorepo root):
#   docker build -t mycel -f packages/mycel/Dockerfile .

FROM node:22-slim AS esbuild-binary
RUN npm install --prefix /opt/esbuild esbuild@0.28.1 \
    && cp /opt/esbuild/node_modules/esbuild/bin/esbuild /esbuild \
    && chmod 0755 /esbuild

FROM node:22-slim
ENV NODE_ENV=production
ENV ESBUILD_BINARY_PATH=/usr/local/bin/esbuild

# curl for the healthcheck below and for reading Secret Manager through the
# instance metadata server (ADR 0030). ca-certificates is NOT implied: on Debian
# it arrives through curl's Recommends, which --no-install-recommends drops, and
# without it the metadata call still works (plain HTTP) while every HTTPS call
# fails with curl exit 77, CURLE_SSL_CACERT_BADFILE.
# `apt-get install ca-certificates` alone was not enough: it completed, and
# /etc/ssl/certs/ca-certificates.crt still did not exist, so every HTTPS call
# failed at runtime with curl exit 77 while the image looked fine. Run the
# bundle generation explicitly, then assert the result — a missing CA store must
# fail the build, not the deploy an hour later.
# --reinstall is the load-bearing flag, and the reason took three attempts to
# find. node:22-slim already has ca-certificates marked installed in dpkg while
# the generated bundle is absent — slim images strip files, dpkg's state does
# not notice. So plain `apt-get install ca-certificates` is a no-op: it runs for
# 18s, reports success, re-runs no postinst, and produces no
# /etc/ssl/certs/ca-certificates.crt. Every HTTPS call then fails with curl exit
# 77 in an image that looks correct.
#
# --reinstall forces the postinst; --fresh rebuilds the bundle from scratch.
# The two assertions then refuse to let the layer succeed without a real CA
# store and a completed TLS handshake — this must fail the build, not the deploy.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --reinstall ca-certificates openssl \
    && apt-get install -y --no-install-recommends curl \
    && update-ca-certificates --fresh \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && curl -sS -o /dev/null https://secretmanager.googleapis.com/ \
    && rm -rf /var/lib/apt/lists/*

# Not root. Mycel writes nothing to disk, so there is no reason for it to be
# able to.
RUN useradd --system --uid 10001 mycel

WORKDIR /app
COPY --chown=mycel:mycel packages/mycel/dist/mycel.js ./mycel.js
COPY --from=esbuild-binary /esbuild /usr/local/bin/esbuild

# The bundled server still reads browser assets from disk at request time.
# Because every bundled import.meta.url resolves from /app/mycel.js, the
# substrate package root resolves to / (so its shell is /shell and its TS
# runtime is /src), while Mycel's own components resolve beside the bundle.
# Keep all three copies together: omitting /src leaves the HTML healthy but the
# browser stuck on "assembling…" when /shell/substrate/index.js returns 404.
COPY --chown=mycel:mycel packages/substrate/shell /shell
COPY --chown=mycel:mycel packages/substrate/src /src
COPY --chown=mycel:mycel packages/mycel/src/client-surface/components /app/components
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
