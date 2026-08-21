# Setting up Mycel

Three people, three jobs. Find yours and do only that section.

| You are | You want | Go to |
| --- | --- | --- |
| **The operator** | Run the Exchange | [1. Run the Exchange](#1-run-the-exchange) |
| **A supplier** | Sell your GPU's tokens | [2. Sell a GPU](#2-sell-a-gpu) |
| **A buyer** | Use models through it | [3. Buy tokens](#3-buy-tokens) |

Each section is copy-paste top to bottom. Anything you must supply yourself is
an `UPPERCASE_PASTE_MARKER` — and the scripts in `scripts/mycel/` refuse to run
with a placeholder still in place, so a missed paste fails in one line instead
of as a mystery.

> **Money is integer micro-dollars.** `$1.00` is `1000000`. Never a float — a
> Balance is a sum of these, and an amount that cannot be represented exactly is
> an amount somebody eventually argues about.

---

## 1. Run the Exchange

The operator's job, done once. If someone else runs Mycel for you, skip this.

> **The Focus AI deployment.** This guide's placeholders resolve to real values
> for the deployed Exchange, and section 1 is already done — these matter only
> when touching Secret Manager again (rotating a value, adding a new key):
>
> ```bash
> export PROJECT=habitats-502314
> export SA=mycel-sa@habitats-502314.iam.gserviceaccount.com
> ```
>
> The hostname used throughout this guide, `mycel.thefocus.ai`, is the deployed
> Exchange; the instance is `mycel-host` in `us-east4-a`. Ops details:
> `docs/guide/operating-production.md`.

### 1.1 Secrets, in Google Secret Manager

No secret is ever written to the host. The container reads them at start through
the instance's attached service account, so a compromise of that disk yields no
credential — there is none on it.

```bash
export PROJECT=YOUR_GCP_PROJECT
export SA=mycel-sa@$PROJECT.iam.gserviceaccount.com

gcloud iam service-accounts create mycel-sa --project "$PROJECT"

# Without logWriter the container never starts — the gcplogs driver blocks it.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/logging.logWriter
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/monitoring.metricWriter

for s in mycel-database-url mycel-openrouter-api-key; do
  gcloud secrets create "$s" --project "$PROJECT" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT" \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
done
```

Create a Postgres database at [neon.tech](https://neon.tech), then put its
connection string in. Values arrive on stdin, never in argv:

```bash
printf '%s' 'PASTE_THE_NEON_CONNECTION_STRING' | \
  gcloud secrets versions add mycel-database-url --project "$PROJECT" --data-file=-

printf '%s' 'PASTE_THE_OPENROUTER_KEY' | \
  gcloud secrets versions add mycel-openrouter-api-key --project "$PROJECT" --data-file=-
```

**Every id listed in `MYCEL_SECRETS` must exist and be readable.** A missing one
stops the boot rather than starting an Exchange that cannot meter.

### 1.2 The host

```bash
gcloud compute instances create mycel-host --project "$PROJECT" \
  --zone us-east4-a --machine-type e2-small \
  --service-account "$SA" --scopes cloud-platform \
  --metadata-from-file startup-script=deploy/gcp/mycel-host-startup.sh
```

Point an A record at that instance's IP — `mycel.thefocus.ai`, not a wildcard
subdomain shared with anything else. Caddy issues the certificate from it.

### 1.3 Deploy

```bash
gcloud compute ssh mycel-host --project "$PROJECT" --zone us-east4-a

git clone https://github.com/The-Focus-AI/umwelten.git /opt/umwelten
cd /opt/umwelten
cp deploy/mycel/.env.example deploy/mycel/.env    # hostname + port, nothing secret
./deploy/mycel/deploy.sh
```

`deploy.sh` prints the revision it is deploying, runs the bundle before building
an image around it, waits for `/health` to report the **store** reachable, and
rolls itself back if it never gets there.

```bash
curl https://mycel.thefocus.ai/health     # {"status":"ok"}
```

### 1.4 The operator command

`/etc/profile.d/mycel.sh` defines a `mycel` function on this host, so every shell
has it. To check:

```bash
mycel supplier connections
```

> **If you see `No database` and you typed an alias by hand**, it is missing
> `/usr/local/bin/mycel-entrypoint`. `docker exec` skips the image ENTRYPOINT, so
> nothing resolves the secrets. Use the function, not an alias.

### 1.5 Sell somebody else's models too (optional)

A vendor is dialled out to, because a public API is reachable by definition:

```bash
mycel supplier register openrouter \
  --display-name "OpenRouter" \
  --base-url https://openrouter.ai/api/v1 \
  --credential-env OPENROUTER_API_KEY

mycel offers sync openrouter \
  --models anthropic/claude-sonnet-5 \
  --watch 5
```

> **`--watch` is the heartbeat, and it must keep running.** A vendor runs no
> agent, so if that process dies its Offers expire and requests fail with
> `offer-stale`. Run it as a systemd unit, not in a terminal. Machines do not
> need this — see section 2.

`--credential-env` is the **name** of an environment variable, never the key.
A database compromise yields nothing that can spend.

---

## 2. Sell a GPU

You have a machine serving an OpenAI-compatible endpoint and you want the
Exchange to sell its tokens.

**Nothing listens on your machine.** It opens one outbound connection and holds
it. No tunnel, no port forward, no firewall rule, no DNS, no static IP. It works
from behind NAT and from a coffee shop.

### 2.1 The operator registers you

Ask whoever runs the Exchange to run this. It is the only step you cannot do
yourself, because it grants eligibility they are liable for:

```bash
mycel supplier register YOUR_ID \
  --display-name "Your machine" \
  --kind agent \
  --guarantees on-premise
```

`--kind agent` is what makes it dial in. **No `--base-url`** — an agent has no
address, which is the entire point, and passing one is refused.

It prints a credential **once**. Only its hash is stored; lose it and the
operator runs `mycel supplier rotate YOUR_ID`.

### 2.2 Install on your machine

```bash
git clone https://github.com/The-Focus-AI/umwelten.git ~/mycel
cd ~/mycel
mise use node@22
pnpm install
```

### 2.3 Dial in

One script. It prompts for the credential (so a stale or placeholder export can
never be presented), checks the runtime and the Exchange are actually
answering before anything long-lived starts, and refuses values that look like
placeholders:

```bash
./scripts/mycel/sell.sh --runtime http://localhost:4000/v1
```

```
Supplier credential (from `mycel supplier register/rotate`, starts sk-mycel-): 
checking runtime at http://localhost:4000/v1 …
  serving: unsloth/Qwen3.8-27B-NVFP4, RedHatAI/gemma-4-26B-A4B-it-NVFP4
checking Exchange at https://mycel.thefocus.ai …
starting the dial — Ctrl-C hangs up and the Exchange sees it immediately
connected — this machine is now dispatchable
```

You are now serving. By default the script skips the probe battery
(`--no-probe`) and leaves whatever Offers the Exchange already has — pair it
with the operator-declared catalogue in §2.4, or pass `--probe` to measure the
machine first. Add `--runtime-key KEY` if your runtime wants one, and
`--model SUBSTRING` to limit a probe to matching models.

> **`--runtime` is what makes you a Supplier.** It must be the
> OpenAI-compatible base — the `/v1`, not the bare port — and the script
> refuses to start until that endpoint actually lists models.

Your runtime key never leaves your machine. The Exchange pushes a request down
the connection and this agent adds the key locally.

Keep it running. To survive reboots:

```ini
# /etc/systemd/system/mycel-supplier.service
[Unit]
Description=Sell this machine's tokens through Mycel
After=network-online.target

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/mycel
Environment=SUPPLIER_CREDENTIAL=PASTE_THE_REAL_CREDENTIAL
ExecStart=/home/YOUR_USER/mycel/scripts/mycel/sell.sh --runtime http://localhost:4000/v1
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 2.4 The catalogue: probed or declared

With `--probe`, the script measures the machine before connecting. The probe
**runs each model and watches what happens** — it does not read a
list of names. Recognised runtimes: **ollama, LM Studio, LlamaBarn, llama-swap,
vLLM**. Each model is tested for chat, streaming, tool calling, structured
output and reasoning by actually being asked to do them, then measured for
throughput at two concurrency levels.

A capability that fails to demonstrate produces **no Offer**, not an Offer
missing that capability — "we did not establish this" is not "this machine
cannot do it".

That catalogue travels **with the connection**, in the same frame that says
hello, so the Exchange never has you connected without knowing what you serve.
It re-probes only when the machine's fingerprint changes, so reconnecting costs
no measurement.

To see what it would find without dialling or publishing:

```bash
pnpm run cli -- supplier probe
```

> **Headroom caveat.** Sampling runs at concurrency 1 and 4, calibrated for
> llama.cpp-class runtimes. A vLLM box comfortably serving 32–64 is sampled
> entirely below its knee, so its measured throughput understates it.

**Without `--probe`** — the default, and the right call while a router or
runtime is misbehaving under the battery — the operator declares the catalogue
instead. Find the exact model id it answers to, because
the buyer's request reaches you unmodified:

```bash
curl -s http://localhost:8000/v1/models | jq -r '.data[].id'
```

```bash
mycel offers sync YOUR_ID \
  --models THAT_MODEL_ID \
  --capabilities chat,streaming,tool-calling \
  --managed --context 128000 --quantization NVFP4
```

### 2.5 The operator prices it

Always the operator, whether the catalogue was probed or declared:

```bash
mycel price YOUR_ID THAT_MODEL_ID \
  --wholesale-prompt 0 --wholesale-completion 0 \
  --retail-prompt 200000 --retail-completion 600000
```

Micro-dollars per million tokens, so that is $0.20 in and $0.60 out.

- **Suppliers never set prices.** A catalogue carrying one is refused rather
  than trimmed, so a machine cannot quietly take away the Exchange's routing
  lever.
- **Guarantees are the operator's grant, not your claim.** Claiming one you were
  not granted refuses the connection outright — no silent downgrade.
- **`--managed`** says the operator controls this runtime, which is what allows
  committing to a context size or a quantization at all.
- **Wholesale zero** is correct for hardware you own. Nothing is owed per token,
  and it still charges the buyer; that gap is the point.
- **No `--watch`, ever, for a machine.** Its connection *is* its availability, so
  its Offers never expire at any age and it drops out the instant it
  disconnects. Prices the operator set survive every disconnect.

### 2.6 Check it

From the Exchange host:

```bash
mycel supplier connections YOUR_ID
```

Each row says `connected` or `disconnected` with a reason: `closed` (you stopped
it), `transport-error` (the link broke), `displaced` (you dialled again and the
stale connection was replaced), `shutdown` (the Exchange stopped).

Stop your agent and the Exchange knows immediately — requests fail with
`supplier-disconnected` rather than waiting out a timeout. Start it again and
they succeed, with no operator action.

---

## 3. Buy tokens

### 3.1 Get a credential

From whoever runs the Exchange:

```bash
mycel client create YOUR_ORG --name "Your Org"
mycel application create YOUR_APP --client YOUR_ORG
mycel grant YOUR_ORG 50000000        # $50
```

`application create` prints the credential **once**. Only its hash is stored;
`mycel application rotate YOUR_APP` issues a new one rather than recovering it.

Three layers, and they are distinct on purpose:

- **Client** — who gets invoiced.
- **Application** — the product. It holds the credential.
- **End User** — the person behind a request, named in a header. Attributed for
  metering, not authenticated.

### 3.2 See what is for sale

```bash
curl -s https://mycel.thefocus.ai/v1/models | jq .
```

### 3.3 Make a request

With a umwelten checkout, one script shows the catalogue with prices, buys from
it, and explains any failure:

```bash
./scripts/mycel/buy.sh                  # first model for sale
./scripts/mycel/buy.sh MODEL_ID         # a specific one
```

It prompts for the Application credential and refuses placeholder values.

Without the checkout, it is an OpenAI-shaped endpoint — any OpenAI client works
by pointing `base_url` at `https://mycel.thefocus.ai/v1`:

```bash
export APP_CREDENTIAL='PASTE_THE_REAL_CREDENTIAL'

curl -s https://mycel.thefocus.ai/v1/chat/completions \
  -H "Authorization: Bearer $APP_CREDENTIAL" \
  -H "X-Mycel-End-User: alice" \
  -H "content-type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "stream": true,
    "messages": [{"role": "user", "content": "say hi"}]
  }'
```

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://mycel.thefocus.ai/v1",
    api_key=APP_CREDENTIAL,
    default_headers={"X-Mycel-End-User": "alice"},
)
```

### 3.4 Insist on something

Requirements are filters, and a request that cannot be satisfied **fails** rather
than quietly downgrading:

```bash
curl -s https://mycel.thefocus.ai/v1/chat/completions \
  -H "Authorization: Bearer $APP_CREDENTIAL" \
  -H "X-Mycel-End-User: alice" \
  -H "x-exchange-require-guarantee: on-premise" \
  -H "content-type: application/json" \
  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"hi"}]}'
```

To make it permanent for every request an Application sends, the operator sets it
once at creation: `mycel application create YOUR_APP --client YOUR_ORG
--guarantees on-premise`.

### 3.5 Read a failure

Every failure names itself. Do not lump them together:

| Status | Error | What happened |
| --- | --- | --- |
| **401** | — | Credential, or the `X-Mycel-End-User` header |
| **402** | `insufficient_balance` | Refused before anything was bought |
| **503** | `no_eligible_offer` | Nothing could serve it — see `considered` |

A 503 body carries a `considered` list naming every Offer weighed and why each
lost. The reason is the diagnosis:

| Reason | Meaning |
| --- | --- |
| `supplier-disconnected` | That machine is switched off. Start its agent. |
| `offer-stale` | Nobody republished a vendor's catalogue. Its `--watch` died. |
| `missing-guarantee` | Nothing eligible carries what you required. |
| `missing-capability` | Nothing eligible was verified to do that. |
| `insufficient-context` | Your `minContextTokens` exceeds what any Offer commits to. |
| `wrong-quantization` | Nothing eligible serves those weights that way. |

### 3.6 Check spending

```bash
mycel balance YOUR_ORG
```

A Balance is the sum of its entries and never a stored total, so this prints both
— which makes it the check as much as the report.

---

## What this does not do yet

- **Headroom sampling is mis-ranged for big serving runtimes.** It samples at
  concurrency 1 and 4, which is right for llama.cpp and well below the knee of a
  vLLM box doing 32–64. Such a box's measured throughput understates it, and
  dispatch scores it accordingly.
- **A runtime outside the recognised five is invisible to `probe`**, so its
  capabilities have to be declared by the operator, who is then liable for them
  with nothing checking.

## Where things are

| | |
| --- | --- |
| Deploy runbook | `deploy/mycel/README.md` |
| Design | `docs/architecture/mycel-deployment.md`, `docs/architecture/dial-in-protocol.md` |
| Vocabulary | `packages/mycel/CONTEXT.md` |
| Decisions | `docs/adr/` |
