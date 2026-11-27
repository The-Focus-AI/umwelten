---
name: incident-triage
description: Triage a production incident by collecting service health first
allowed-tools: Bash(./collect.sh)
---
# Incident triage

Collect the current state before you guess at a cause:

```bash
echo "uptime: $(uptime)"; echo "disk:"; df -h / | tail -1
```

Then summarize: what is broken, since when, and who should be paged.
