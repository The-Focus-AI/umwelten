# The Shell serving contract

The Shell is host-agnostic: it binds to this contract and to nothing else.
Any host that serves these paths under one base URL — a habitat container,
Gaia, Mycel's client surface, a bare test server — hosts the same shell
unchanged. All paths are relative to the base (e.g. `/shell/` on a habitat).

| Path | What it serves |
| --- | --- |
| `./` | `index.html` — the shell page |
| `./shell.js` | the shell boot script (plain ESM) |
| `./substrate/*.js` | the `@umwelten/substrate` runtime as browser ESM (e.g. `./substrate/index.js`; internal relative imports resolve within this prefix) |
| `./manifest.json` | `{ "entries": [ { "id", "url", "config"?, "disabled"? } ] }` — the loader entries to realize; `url` is resolved against the base |
| `./components/*.js` | component modules: plain ESM whose default export is a `ComponentSpec` |

The host decides what the manifest lists (built-ins, work-dir components,
anything). The shell boots, imports the substrate, fetches the manifest, and
applies it with the Loader — activation, teardown, and hot replacement are
the substrate's semantics, not the host's.

## Services the shell provides

Components reach the page through Services, never through globals:

| Key | Value |
| --- | --- |
| `shell:region` | the `HTMLElement` components render into (append your element; return the inverse that removes it) |
| `shell:base` | the shell's base `URL`, for resolving host endpoints |

Service keys are matched by id string, so a component simply calls
`serviceKey("shell:region")` against the same substrate module the shell
imported.

## Rules

- **No build step in the loading path.** Component modules are served as
  plain ESM. A host may transpile *its own* sources on the way out (the
  habitat transpiles the substrate's TypeScript), but nothing a component
  author writes requires a bundler.
- **Auth follows the host's static-asset posture.** The shell and its
  assets are as open as the host's UI; anything a component *calls* is
  authenticated by the host's normal endpoint rules.
