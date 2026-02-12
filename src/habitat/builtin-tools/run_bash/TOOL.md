---
name: run_bash
description: "Execute bash commands in Dagger containers with experience-based state management. Supports isolated experience directories that maintain state between commands."
---

# Run Bash (Dagger)

Execute bash commands inside Dagger containers. Uses experience-based state management
so that multiple commands in a workflow share the same workspace.

This is a factory tool — it requires habitat context (workDir, getAgent, getAllowedRoots).
