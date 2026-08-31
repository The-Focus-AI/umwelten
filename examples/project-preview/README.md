# Project preview example

This is the smallest project that exercises Habitat preview discovery. It has
no preview-specific manifest: `mise dev` is the contract, and the Habitat finds
the process-tree listener at runtime.

```bash
cd examples/project-preview
mise dev
```

In a Gaia-managed project Habitat, the preview supervisor starts that command
automatically. Ask the coding agent for `preview_status`; it hands over the
unguessable public URL only after the service is listening. `/stream` provides
a quick check that the standalone router forwards chunks without buffering.

Bind development servers to `0.0.0.0` or `::`. A loopback-only listener is
intentionally reported as an actionable preview failure because the router is
in another container.
