# Selling a local vLLM box through the Exchange

How to make a machine you own — `thor`, serving vLLM on port 4000 — a Supplier
that Mycel dispatches to. Written against the deployed stage 1 Exchange at
`mycel.thefocus.ai`.

> **Read this first: it deviates from two ADRs, deliberately and temporarily.**
>
> **ADR 0023 — machine Suppliers dial in.** The design is that Mycel never
> connects to a machine: the machine holds an outbound connection and receives
> work over it, so a box behind NAT accepts no inbound connections at all. That
> protocol is **not built**. Until it is, the only way for Mycel to serve from
> thor is to reach thor — which is exactly what ADR 0023 exists to stop doing.
> Everything below is interim, and every step that follows becomes unnecessary
> once dial-in lands.
>
> **ADR 0015 — Capabilities are probed through the serving path.** `umwelten
> supplier` cannot probe vLLM: `discoverRuntimes` knows ollama, lmstudio,
> llamabarn and llamaswap, and nothing in the codebase mentions vLLM. So thor's
> Offers are **declared by the operator**, like a vendor's, not measured. Claim
> narrowly — an over-claimed Capability routes a request somewhere that cannot
> serve it, which is the failure ADR 0015 exists to prevent.
>
> The practical consequence of both: **thor publishes no Headroom.** Dispatch
> will score it on price alone, and cannot know whether it batches or queues.

## 1. Reachability

Mycel runs on `mycel-host` in GCE. It has to open a TCP connection to thor's
vLLM. Pick one:

**Tailscale (recommended).** Both machines join the tailnet; Mycel uses thor's
tailnet address. No port forwarding, no public exposure of an unauthenticated
inference server, and it survives thor's IP changing.

```bash
# on thor, and again on mycel-host
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4        # note thor's address, e.g. 100.x.y.z
```

**Cloudflare Tunnel** if you would rather not put mycel-host on a tailnet.
Gives thor a hostname with no inbound firewall rule.

**Port forward + DNS** works and is the one to avoid. It puts an inference
server on the public internet, and vLLM's `--api-key` is the only thing between
a scanner and your GPU.

> Whatever you choose, **do not skip vLLM's `--api-key`**. Reachable-and-open
> means anyone who finds the port spends your electricity, and Mycel's metering
> will show none of it — the requests never went through the Exchange.

## 2. Start vLLM on thor

```bash
vllm serve <model-id> \
  --host 0.0.0.0 --port 4000 \
  --api-key "$VLLM_API_KEY" \
  --served-model-name thor-<short-name>
```

`--served-model-name` is the name buyers will ask for and the name the Offer
carries. Set it explicitly: the default is the full HuggingFace path, which is
awkward in a catalogue and pins the Offer to a repo layout.

Check it from **mycel-host**, not from thor — reachability is the thing being
tested:

```bash
curl -sS http://<thor-address>:4000/v1/models \
  -H "Authorization: Bearer $VLLM_API_KEY"
```

## 3. Put thor's key in Secret Manager

Mycel stores the *name* of an environment variable on the Supplier record, never
the key (`mycel-deployment.md` Part 2), so the value goes in GSM alongside the
others:

```bash
PROJECT=habitats-502314
SA=mycel-sa@$PROJECT.iam.gserviceaccount.com

gcloud secrets create mycel-thor-api-key --project "$PROJECT" \
  --replication-policy automatic
gcloud secrets add-iam-policy-binding mycel-thor-api-key --project "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor

printf '%s' "$VLLM_API_KEY" | \
  gcloud secrets versions add mycel-thor-api-key --project "$PROJECT" --data-file=-
```

Then add it to the mapping in `deploy/mycel/docker-compose.yml`:

```yaml
      MYCEL_SECRETS: >-
        MYCEL_DATABASE_URL=mycel-database-url,
        OPENROUTER_API_KEY=mycel-openrouter-api-key,
        THOR_API_KEY=mycel-thor-api-key
```

and restart. **Every id in that list must exist and be readable** — a missing
one stops the boot rather than starting an Exchange that cannot meter.

```bash
./deploy/mycel/deploy.sh
```

## 4. Register thor as a Supplier

On `mycel-host`, with the operator alias from `deploy/mycel/README.md`:

```bash
mycel supplier register thor \
  --display-name "thor (vLLM)" \
  --base-url http://<thor-address>:4000/v1 \
  --credential-env THOR_API_KEY \
  --guarantees on-premise
```

`--guarantees on-premise` is a claim **you** are liable for (ADR 0016, ADR 0029
— Mycel sells as principal). Grant it only if thor really is on premises and you
are willing to warrant that to a buyer.

## 5. Publish its catalogue

vLLM runs no supplier agent, so the operator publishes on its behalf — the same
path OpenRouter uses:

```bash
mycel offers sync thor \
  --models thor-<short-name> \
  --capabilities chat,streaming \
  --watch 5
```

Two things that will bite otherwise:

**`--watch` is the heartbeat.** Dispatch drops an Offer not republished inside
the staleness window (15 minutes). No agent is beating for thor, so if that
process dies the Offers expire and every request 503s with `offer-stale`. Run it
as a service, not in a terminal:

```bash
# /etc/systemd/system/mycel-thor-sync.service, on mycel-host
[Unit]
Description=Republish thor's offers to Mycel
After=docker.service

[Service]
ExecStart=/usr/bin/docker compose --project-directory /opt/umwelten/deploy/mycel \
  exec -T mycel /usr/local/bin/mycel-entrypoint node /app/mycel.js \
  offers sync thor --models thor-<short-name> --capabilities chat,streaming --watch 5
Restart=always

[Install]
WantedBy=multi-user.target
```

**Claim only what you have verified.** The default is `chat,streaming`. Add
`tool-calling` or `structured-output` only after testing them against this model
on this vLLM build — these are declared, not probed, and nothing checks them.

## 6. Price it

Hardware you own has no per-token wholesale cost. That is not a bug in the
model: Charge is independent of Cost (ADR 0013), and a Cost of 0 against a
non-zero Charge is exactly what owning the box should look like.

```bash
mycel price thor thor-<short-name> \
  --wholesale-prompt 0 --wholesale-completion 0 \
  --retail-prompt 200000 --retail-completion 600000
```

All four flags or none. Retail below wholesale is allowed — sometimes
deliberate — but never silent; the CLI says so when it happens.

## 7. Verify

```bash
curl https://mycel.thefocus.ai/v1/models        # thor's model should appear

curl https://mycel.thefocus.ai/v1/chat/completions \
  -H "Authorization: Bearer $APP_CREDENTIAL" \
  -H "X-Mycel-End-User: user-1" \
  -H "content-type: application/json" \
  -d '{"model":"thor-<short-name>","messages":[{"role":"user","content":"hi"}]}'

mycel balance the-focus-ai
```

To prove a buyer can *require* on-premise and be routed only to thor:

```bash
curl https://mycel.thefocus.ai/v1/chat/completions \
  -H "Authorization: Bearer $APP_CREDENTIAL" \
  -H "X-Mycel-End-User: user-1" \
  -H "x-exchange-require-guarantee: on-premise" \
  -H "content-type: application/json" \
  -d '{"model":"thor-<short-name>","messages":[{"role":"user","content":"hi"}]}'
```

A 503 comes back with a `considered` list naming every Offer weighed and why
each was rejected — `missing-guarantee` is a different problem from
`offer-stale`, and the body says which.

## What this does not give you

- **No Headroom.** Nothing measured thor's throughput, time-to-first-token, or
  behaviour under concurrency, so Dispatch cannot tell whether it batches or
  queues and scores it on price alone. A `queues` box that is cheap wins every
  request and makes the second customer wait.
- **No liveness.** "Offers republished recently" is a proxy for "thor is up".
  A dead vLLM with a live sync loop still looks dispatchable until a request
  fails. ADR 0023's held connection is what replaces this, and it deletes the
  whole staleness apparatus with it.
- **No probed Capabilities.** Everything in the Offer is your claim.

All three close when the dial-in protocol lands. Until then, this is a real
Supplier with a manual seam where the agent should be.
