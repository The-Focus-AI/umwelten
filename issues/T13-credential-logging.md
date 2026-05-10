# T13: Credential Operation Logging

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Add timestamped logging for credential-related operations in Gaia. Every time an operator adds, removes, binds, unbinds, or verifies a credential, the operation is recorded with a timestamp, operation type, and the credential/habitat affected.

**Log format:**
A simple JSONL log file at `<data-dir>/credential-audit.jsonl`. Each line:

```json
{"timestamp": "2026-05-10T14:30:00Z", "operation": "bind_capability", "habitatId": "accounting-bot", "capability": "quickbooks:read", "credential": "accounting-bot-read-key"}
```

Operations logged: `add_credential`, `remove_credential`, `verify_credential`, `bind_capability`, `unbind_capability`.

**No user attribution yet:**
The current bearer token model does not distinguish between users, so operations are logged without a `userId` field. When per-user identity is added (out of scope), the `userId` field can be added retroactively to the log format.

**Exposure:**
The audit log is readable via a Gaia tool (`read_credential_audit_log`) and/or the `/api/audit` endpoint. Not displayed in the dashboard UI (deferred to a future audit tab).

## Acceptance criteria

- [ ] `credential-audit.jsonl` file in Gaia data dir, created on first log write
- [ ] `add_credential` writes a log entry
- [ ] `remove_credential` writes a log entry
- [ ] `verify_credential` writes a log entry
- [ ] `bind_capability` writes a log entry with habitatId, capability, credential
- [ ] `unbind_capability` writes a log entry
- [ ] Log entries are valid JSONL (one JSON object per line)
- [ ] `read_credential_audit_log` Gaia tool returns the most recent N entries (default: 50)
- [ ] Unit test: operations produce log entries, log file is append-only, read returns entries

## Blocked by

- T5 (capability binding tools must exist to log their operations)
