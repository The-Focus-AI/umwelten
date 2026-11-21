# Selling a local vLLM box through the Exchange

> **Start with [Setting up Mycel](./mycel-setup.md) instead.** Section 2 of that
> guide is the current, complete way to sell a machine's tokens: register as an
> agent, dial in, publish. It is shorter than this page and it is what is
> maintained.
>
> This page is kept for two things that guide does not cover: the vLLM-specific
> details below, and the **reverse tunnel** in section 1, which is the old
> transport and is only for a machine that cannot run the supplier agent.

Notes specific to vLLM:

- **`--served-model-name` is the id buyers ask for**, and it must match what the
  Offer carries, because the buyer's request is forwarded to your runtime
  unmodified. The default is the full HuggingFace path, which is awkward in a
  catalogue and pins the Offer to a repo layout. Set it explicitly.
- **`umwelten supplier probe` cannot see vLLM** (#377). `discoverRuntimes` knows
  ollama, lmstudio, llamabarn and llamaswap. So a vLLM box's Capabilities are
  declared by the operator rather than measured through the serving path, which
  ADR 0015 otherwise requires. Claim narrowly — an over-claimed Capability
  routes a request somewhere that cannot serve it.
- **No Headroom** for the same reason, so Dispatch scores the box on price alone
  and cannot tell whether it batches or queues.
- **Keep `--api-key` set** even though nothing inbound reaches the machine. It is
  what stops anything else on that host spending your GPU outside the Exchange,
  where it would be unmetered and invisible.

## 1. The old way — a reverse tunnel

> Only for a machine that cannot run the supplier agent. Section 2 of
> [Setting up Mycel](./mycel-setup.md) replaces all of this, and gives you real
> liveness on top.

vLLM is OpenAI-shaped on `:4000`, and Mycel already speaks that. The only real
question is who opens the TCP connection, and the answer is **thor**.

`ssh -R` makes thor's local port appear on `mycel-host`. Thor holds the
connection outbound; nothing reaches thor from the internet, no firewall rule,
no port forward, no address to register — the ADR 0023 property, with ssh doing
the work.

**On `mycel-host`**, let a forwarded port bind beyond loopback so the Mycel
container can reach it:

```bash
# /etc/ssh/sshd_config
GatewayPorts clientspecified
```
```bash
sudo systemctl reload ssh
```

**On thor**, hold the tunnel open. `autossh` rather than plain `ssh` so a
dropped link reconnects rather than silently ending your supply:

```bash
autossh -M 0 -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 0.0.0.0:4000:localhost:4000 \
  wschenk@mycel.thefocus.ai
```

As a unit so it survives a reboot:

```ini
# /etc/systemd/system/mycel-tunnel.service, on thor
[Unit]
Description=Reverse tunnel exposing vLLM to Mycel
After=network-online.target

[Service]
User=wschenk
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 0.0.0.0:4000:localhost:4000 wschenk@mycel.thefocus.ai
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Then let the container reach the host end of it.** Mycel runs in Docker, so
`localhost` inside it is not `mycel-host`. Add to the `mycel` service in
`deploy/mycel/docker-compose.yml`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

and the Supplier's base URL becomes `http://host.docker.internal:4000/v1`.

Verify from inside the container — that is the path Dispatch will take, and the
only one worth testing:

```bash
docker compose --project-directory deploy/mycel exec mycel \
  curl -sS http://host.docker.internal:4000/v1/models \
  -H "Authorization: Bearer $VLLM_API_KEY"
```

> **Keep vLLM's `--api-key` anyway.** The tunnel means nothing on the public
> internet reaches thor, but `0.0.0.0:4000` on mycel-host is reachable by
> anything else on that box. The key is what stops a second container spending
> your GPU without going through the Exchange — where it would be unmetered and
> invisible.

**Alternatives**, if a long-lived ssh session is not to taste: Tailscale puts
both machines on a tailnet and Mycel dials thor's tailnet address (still no
public inbound, but Mycel initiates); Cloudflare Tunnel is the same
thor-dials-out shape as above with a managed edge. Port-forwarding thor's :4000
to the internet is the one to avoid — it puts an inference server in front of
scanners with only `--api-key` between them and your GPU.

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

Confirm it serves locally first — this checks vLLM, not the path to it:

```bash
# on thor
curl -sS http://localhost:4000/v1/models -H "Authorization: Bearer $VLLM_API_KEY"
```

The check that matters is the one in section 1, run from inside the Mycel
container, because that is the path Dispatch actually takes.

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
  --base-url http://host.docker.internal:4000/v1 \
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
- **No probed Capabilities.** Everything in thor's Offer is your claim, because
  `probe` cannot reach vLLM (#377). Over-claim and Dispatch routes a request
  somewhere that cannot serve it.
- **No Headroom.** Nothing measured thor's throughput or its behaviour under
  concurrency, so Dispatch scores it on price alone and cannot tell whether it
  batches or queues. A cheap box that queues wins every request and makes the
  second customer wait.
- **The agent does not publish its own catalogue** (#379). The operator declares
  thor's Offers, which is why they can drift from what vLLM actually has loaded.

Both close when a vLLM runtime is added to the supplier agent (#377), which lets
`probe` reach thor through its serving path as ADR 0015 requires. Liveness is
done: the Connection is what Dispatch consults, and the staleness window no
longer applies to a machine at all.
