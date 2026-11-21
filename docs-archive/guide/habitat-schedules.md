# Scheduled Habitat Work

Habitats can run recurring work from their own `config.json`. The schedule
lives with the habitat, starts with its container, and needs no host cron.

## Configure a schedule

Add a `schedules` array to the habitat configuration:

```jsonc
{
  "schedules": [
    {
      "name": "feed-sync",
      "cron": "*/30 * * * *",
      "tool": "sync_feed",
      "args": { "limit": 100 },
      "timeoutMs": 120000
    },
    {
      "name": "daily-digest",
      "cron": "0 12 * * *",
      "prompt": "Generate the daily digest and publish it as an artifact."
    }
  ]
}
```

Each entry must set exactly one action:

- `tool` calls a registered habitat tool directly with `args`. This is the
  deterministic, token-free choice for routine synchronization.
- `prompt` starts an operator agent turn in the `schedule:<name>` channel.

Cron expressions have five fields—minute, hour, day of month, month, and day
of week—and are evaluated in UTC. They support `*`, numeric values, lists,
ranges, and steps such as `*/30`. Set `disabled: true` to retain an entry
without running it.

## Runtime behavior

- Runs use habitat-wide operator credentials, never a customer's per-user
  credentials.
- `timeoutMs` defaults to five minutes. A timeout aborts the action and records
  a failure.
- The same entry never overlaps itself. Different entries due in the same
  minute run independently.
- Startup waits until the next minute boundary and adds up to five seconds of
  jitter, avoiding a fleet-wide burst after a restart.
- Missed runs are not backfilled. Work resumes at the next matching minute.
- Invalid entries are logged and skipped without preventing valid entries from
  running or crashing the container.

## Observe runs

Every run emits a scheduler log line with its result and duration. The
authenticated `GET /api/status` response includes each schedule's action type,
next run, last run, last result, last error, and whether it is currently
running:

```json
{
  "schedules": [
    {
      "name": "feed-sync",
      "cron": "*/30 * * * *",
      "kind": "tool",
      "nextRunAt": "2026-09-02T17:30:00.000Z",
      "lastRunAt": "2026-09-02T17:00:03.214Z",
      "lastOk": true,
      "lastError": null,
      "running": false
    }
  ]
}
```

Gaia's existing container restart policy provides process supervision. A
schedule failure is isolated to that firing and does not restart the habitat.
