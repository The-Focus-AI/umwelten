# Wrapping a Habitat in an Electron App

A detailed plan for an Electron desktop shell around a single umwelten habitat. Modeled on `packages/desktop-electron` from the opencode repo. **Not a port** — the analogues are different (umwelten's "habitat container server" plays the role of opencode's embedded `Server`), and several decisions need to be made up front.

## What we're building

A native desktop app that, on launch:

1. Starts an umwelten habitat in-process (or as a child process — see §1.3).
2. Exposes the habitat's `container-server` — `/api/chat`, `/api/sessions`, `/api/habitat`, `/files/*`, `/mcp`, etc. — on `127.0.0.1:<random-port>` with Bearer auth.
3. Loads a chat UI in a `BrowserWindow` that talks to that server over HTTP/SSE.
4. Adds OS-level affordances the browser can't do alone: file pickers, deep links, native menus, notifications, auto-update, multiple terminal panes (optional, see §6).
5. Tears the server down on quit.

The whole point of the architecture: **the renderer is a normal web app, the main process owns the lifecycle of the habitat**. Anything that's already a habitat HTTP route stays a route — Electron is only there to host the window and the OS bridge.

---

## 0. Decisions to make before coding

These shape everything downstream. Settle them first.

### 0.1 Server topology — three options

| Option | What runs in Electron main | Pros | Cons |
|---|---|---|---|
| **A. In-process** | `import { startContainerServer } from 'umwelten/dist/habitat/container-server.js'` | One process. Simplest debugging. Direct access to the `Habitat` object for native menu commands. | Electron's main process is single-threaded; long-running tool calls (LLM, ripgrep, claude-sdk) compete with the UI and IPC. Native modules (`better-sqlite3`) need to be rebuilt against Electron's Node ABI. |
| **B. Sidecar Node process** | Spawn `node dist/cli/entry.js habitat serve --port N --api-key X` as a child | Isolation — UI never blocks. Reuses the existing CLI verbatim. Crash recovery is just respawn. Same ABI as `node`, no native rebuilds. | Two processes to ship and version-pin together. IPC for "current habitat" actions has to go over HTTP, not direct calls. |
| **C. Docker container** | Drive an existing Gaia container via the Docker manager | Production-equivalent isolation; matches `habitat gaia` flow exactly. Secrets vault stays untouched. | Requires Docker installed on every user's machine. Adds startup latency. Probably too heavy for a desktop app. |

**Recommendation: B (sidecar)**. Opencode picks between them on a per-shell basis — Tauri uses sidecar, Electron uses in-process — and the Electron main process is the more constrained of the two for a CPU-bound LLM workload. A sidecar also matches umwelten's "habitat is a container" mental model and keeps `better-sqlite3` running against plain Node. Path A is reasonable for a v0 if you want to skip the IPC complication, with the explicit understanding that you'll move to B later.

The rest of this plan assumes **B**, calling out where A would diverge.

### 0.2 Which UI ships in the renderer

You have three:

- `src/habitat/container-ui/index.html` — the standalone single-habitat chat UI (✅ already wired to `/api/chat` SSE, `/api/sessions`, `/api/artifacts`).
- `src/habitat/gaia/ui/index.html` — Gaia dashboard (multi-habitat — overkill for a single-habitat app).
- A new SolidJS/React app — too much work for v0.

**Recommendation: ship `container-ui/index.html` as-is in v0.** It's already a complete chat client. The Electron renderer's job is to load it and inject a `Platform` object (see §4) that overrides specific behaviors — file pickers, external links, etc. — with native versions.

### 0.3 Single habitat vs habitat picker

Three meaningful flavors:

- **Single fixed habitat** — `~/Library/Application Support/MyApp/habitat/` (analogous to opencode's `~/.local/share/opencode/`). Simplest. Pick one and bake the path in.
- **Habitat picker** — first-launch dialog asking for a work-dir, then remember it.
- **Multiple habitats** — switcher in the menu bar, like Slack workspaces.

**Recommendation for v0: fixed path under `app.getPath('userData')`**. Add a "Switch Habitat..." menu item in v1 that re-spawns the sidecar with a different `--work-dir`.

### 0.4 Auth model

The container-server already supports `HABITAT_API_KEY` Bearer auth (`container-server.ts` mounts `bearerAuth` if the env var is set). For a desktop app:

- Generate a random UUID at app startup. Pass it to the sidecar as `HABITAT_API_KEY=<uuid>`. Hand the same UUID to the renderer through the preload bridge so the chat UI can attach `Authorization: Bearer <uuid>` to every request.
- Bind the server to `127.0.0.1` only (never `0.0.0.0`) so nobody else on the network can hit it.

This mirrors opencode's per-launch UUID-as-basic-auth-password trick (`packages/desktop-electron/src/main/index.ts:148`).

### 0.5 Channel branding (dev / beta / prod)

Opencode has three channels with separate `userData` directories so dev installs don't clobber prod (`packages/desktop-electron/src/main/index.ts:21-34`). Worth copying — it lets you run a production app and a dev build side by side without nuking the prod habitat. Pick channel via `OPENCODE_CHANNEL` equivalent at vite-config time, then `app.setName()` and `app.setPath('userData', ...)` accordingly.

---

## 1. Repo layout

A new package under `umwelten/` (this is a separate publish target — desktop apps don't go on npm with the library):

```
umwelten/
  packages/                  # NEW — turn the existing src/ into a workspace?
    umwelten/                # the existing library (move src/ → here, OR keep flat)
    desktop/
      package.json
      electron.vite.config.ts
      electron-builder.config.ts
      icons/
      resources/
      scripts/
        predev.ts
        prebuild.ts
        copy-icons.ts
      src/
        main/
          index.ts           # entry — lifecycle, sidecar spawn, IPC handler registration
          sidecar.ts         # spawn + health-check the umwelten habitat process
          ipc.ts             # ipcMain.handle(...) for everything window.api exposes
          windows.ts         # main window + loading window factories
          menu.ts            # native app menu + dispatch to renderer
          shell-env.ts       # capture user shell env for child processes
          store.ts           # electron-store wrapper (default-server, prefs)
          logging.ts         # electron-log
          updater.ts         # electron-updater wrapper
          markdown.ts        # marked → HTML for renderer if you want server-side md
          deep-link.ts       # opencode://-style protocol handler
        preload/
          index.ts           # contextBridge.exposeInMainWorld('api', {...})
          types.ts           # ElectronAPI interface (shared with renderer)
        renderer/
          index.html         # bootstrap shim: imports container-ui, injects Platform
          loading.html       # shown during sqlite migration
          platform.ts        # the Platform object backed by window.api
```

You don't strictly need a workspace. Two simpler alternatives:

- Keep `desktop/` as a sibling git repo and depend on `umwelten` as a published npm tarball (`umwelten-0.4.12.tgz`). Slowest iteration loop.
- Keep `desktop/` inside `umwelten/desktop/` as a directory `pnpm` ignores via `pnpm-workspace.yaml` exclude. Build the library first, then the desktop app via a relative `file:` dep. Annoying but works.

**Recommendation: convert umwelten into a pnpm workspace**, with the existing library at `packages/umwelten` and the new shell at `packages/desktop`. One install, one lockfile.

---

## 2. Bootstrap flow (main process)

This is the heart of the app. Modeled on `packages/desktop-electron/src/main/index.ts:140`.

```
app.whenReady()
  ↓
ensureLoopbackNoProxy()                    // NO_PROXY += 127.0.0.1
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>')
  ↓
acquire single-instance lock              // app.requestSingleInstanceLock()
  ↓
register opencode://-style protocol       // app.setAsDefaultProtocolClient('umwelten')
  ↓
initialize()
  │
  ├── const port = await pickFreePort()                  // bind 127.0.0.1:0, read .port, close
  ├── const apiKey = randomUUID()
  ├── const workDir = app.getPath('userData') + '/habitat'
  ├── if (!sqliteDbExists(workDir))
  │     → show loading window after 1s
  │     → run habitat onboarding / sqlite init via sidecar OR direct import
  │
  ├── spawnSidecar({ port, apiKey, workDir })           // returns { proc, healthCheck }
  ├── await healthCheck (timeout 30s, polls /health)
  │
  ├── createMainWindow({ port, apiKey })                // loads renderer/index.html
  └── wireMenu(window)
  ↓
on app.before-quit / will-quit / SIGINT / SIGTERM:
  killSidecar()
```

### 2.1 Free-port picking

```ts
import { createServer } from 'node:net'
const port = await new Promise<number>((res, rej) => {
  const s = createServer()
  s.on('error', rej)
  s.listen(0, '127.0.0.1', () => {
    const a = s.address()
    if (typeof a !== 'object' || !a) return rej(new Error('no port'))
    s.close(() => res(a.port))
  })
})
```

Identical to opencode's `getSidecarPort()`. Optionally honor `UMWELTEN_PORT` env for development.

### 2.2 No-proxy guard

Corporate proxies that don't whitelist loopback will break the app: the Electron renderer goes out to `127.0.0.1:<port>` and reqwest/`fetch` will route via the proxy and fail. Mirror opencode's two-line fix:

```ts
process.env.NO_PROXY = appendIfMissing(process.env.NO_PROXY, '127.0.0.1,localhost,::1')
process.env.no_proxy = appendIfMissing(process.env.no_proxy, '127.0.0.1,localhost,::1')
app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>')
```

### 2.3 Sidecar spawn

```ts
// main/sidecar.ts
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { app } from 'electron'

export interface SidecarHandle {
  kill(): void
  health: { wait: Promise<void> }
  url: string
  apiKey: string
}

export function spawnSidecar(opts: {
  port: number
  apiKey: string
  workDir: string
}): SidecarHandle {
  const cliPath = app.isPackaged
    ? resolve(process.resourcesPath, 'umwelten/dist/cli/entry.js')
    : resolve(__dirname, '../../umwelten/dist/cli/entry.js')

  const env = {
    ...process.env,
    ...loadShellEnv(),                     // §2.4
    HABITAT_API_KEY: opts.apiKey,
    UMWELTEN_CLIENT: 'desktop',
  }

  const proc = spawn(process.execPath, [
    cliPath, 'habitat', 'serve',
    '--port', String(opts.port),
    '--host', '127.0.0.1',
    '--work-dir', opts.workDir,
  ], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  proc.stdout.on('data', (b) => logger.log('[sidecar]', b.toString()))
  proc.stderr.on('data', (b) => logger.log('[sidecar:err]', b.toString()))

  const wait = new Promise<void>((resolve, reject) => {
    const url = `http://127.0.0.1:${opts.port}/health`
    const tick = async () => {
      try {
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${opts.apiKey}` },
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) return resolve()
      } catch {}
      setTimeout(tick, 100)
    }
    tick()
    proc.on('exit', (code) => reject(new Error(`sidecar exited ${code}`)))
    setTimeout(() => reject(new Error('sidecar health timeout')), 30_000)
  })

  return {
    kill: () => proc.kill('SIGTERM'),
    health: { wait },
    url: `http://127.0.0.1:${opts.port}`,
    apiKey: opts.apiKey,
  }
}
```

`process.execPath` in a packaged Electron app is the Electron binary itself — but Electron supports `ELECTRON_RUN_AS_NODE=1` to behave as plain Node. Set that in `env` if you want to reuse the bundled binary. Otherwise ship `node` as a separate resource (electron-builder `extraResources`), which is simpler and avoids surprises.

**Important caveat:** `better-sqlite3` is in your dependency tree. If you spawn the sidecar with the system `node`, it has to find a prebuild matching that node version. If you use `ELECTRON_RUN_AS_NODE`, it has to find one matching Electron's ABI. The cleanest path is to bundle a known-good Node binary as an `extraResource` and target it explicitly. Opencode does the equivalent with their `opencode-cli` sidecar — it's a single-file bun-compiled binary, which sidesteps the entire issue. **Worth seriously considering: `bun build --compile dist/cli/entry.js` produces a self-contained binary you can ship as the sidecar.**

### 2.4 Shell environment capture

`packages/desktop-electron/src/main/shell-env.ts` exists for one reason: when the user double-clicks the app on macOS, `process.env` is the Finder's environment, not the user's shell. Things like `OPENROUTER_API_KEY` from `~/.zshrc` are missing. Opencode runs the user's login shell in interactive mode and reads its environment back:

```ts
// pseudo
const out = execSync(`${shell} -ilc 'env'`, { timeout: 5000 })
return parseEnv(out)
```

Do this on every launch (cache in memory for the session). Critical for any habitat that depends on env-var API keys.

### 2.5 SQLite migration / loading window

Umwelten uses `better-sqlite3` for `InteractionStore`. First launch needs to create tables. If migration takes > 1s, show a separate `BrowserWindow` (`loading.html`) with a progress indicator, then close it once the main window is ready. Opencode's `LoadingWindowComplete` event from renderer → main signals when the loading window can dismiss.

For umwelten the migration is fast (sqlite migrations are sync), so this might be a v1 feature. v0: just block on `health.wait` and show no window until it resolves.

### 2.6 Single-instance lock & deep links

```ts
if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}
app.on('second-instance', (_e, argv) => {
  const urls = argv.filter((a) => a.startsWith('umwelten://'))
  if (urls.length) sendDeepLinks(mainWindow, urls)
  mainWindow?.focus()
})
app.on('open-url', (e, url) => {                       // macOS
  e.preventDefault()
  sendDeepLinks(mainWindow, [url])
})
app.setAsDefaultProtocolClient('umwelten')
```

Use the protocol for things like sharable session URLs (`umwelten://session/abc123`) or onboarding tokens.

---

## 3. Preload & IPC surface

Mirror `packages/desktop-electron/src/preload/index.ts:71`. The preload registers a single `window.api` object via `contextBridge.exposeInMainWorld`, and every entry is a thin `ipcRenderer.invoke(...)` wrapper.

The only interesting state the renderer needs from the main process is **the server URL and API key**. Once it has those, all habitat communication is HTTP — no IPC needed. So the preload surface is small:

```ts
// preload/types.ts — shared with renderer
export interface ServerHandle {
  url: string
  apiKey: string
}

export interface ElectronAPI {
  // Lifecycle
  awaitInitialization(onStep: (step: InitStep) => void): Promise<ServerHandle>
  killSidecar(): Promise<void>
  relaunch(): void
  loadingWindowComplete(): void

  // Native dialogs & shell
  openDirectoryPicker(opts?: { title?: string; multiple?: boolean }): Promise<string[] | string | null>
  openFilePicker(opts?: { title?: string; extensions?: string[]; multiple?: boolean }): Promise<string[] | string | null>
  saveFilePicker(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  openLink(url: string): void
  openPath(path: string): Promise<void>
  showNotification(title: string, body: string): void
  readClipboardImage(): Promise<{ data: ArrayBuffer; width: number; height: number } | null>

  // Window
  setWindowFocus(): Promise<void>
  showWindow(): Promise<void>
  getWindowFocused(): Promise<boolean>
  setBackgroundColor(color: string): void
  setTitlebar(theme: 'light' | 'dark'): void
  getZoomFactor(): Promise<number>
  setZoomFactor(factor: number): Promise<void>

  // Updater
  checkUpdate(): Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate(): Promise<void>
  runUpdater(alertOnFail: boolean): Promise<void>

  // Settings (electron-store)
  getDefaultServerUrl(): Promise<string | null>
  setDefaultServerUrl(url: string | null): Promise<void>

  // OS bridges
  parseMarkdown(md: string): Promise<string>
  checkAppExists(name: string): Promise<boolean>
  resolveAppPath(name: string): Promise<string | null>

  // Events from main → renderer
  onMenuCommand(cb: (id: string) => void): () => void
  onDeepLink(cb: (urls: string[]) => void): () => void
}
```

Register the matching handlers in `main/ipc.ts`. **Do not put habitat-specific operations here** (chat, sessions, files) — those go through the HTTP server. The IPC channel is strictly OS-bridge stuff.

`awaitInitialization` is the one slightly clever method: it returns the `ServerHandle` once the sidecar is ready, AND fires periodic `InitStep` callbacks during startup so the renderer can show progress. Pattern from `packages/desktop-electron/src/main/index.ts:236-249`.

### 3.1 Renderer wiring

The renderer has a tiny bootstrap shim:

```ts
// renderer/index.html → renderer/main.ts
const { url, apiKey } = await window.api.awaitInitialization((step) => {
  document.querySelector('#status')!.textContent = step.phase
})

// Inject into the global so container-ui can pick it up.
window.__HABITAT__ = {
  url,
  authHeader: `Bearer ${apiKey}`,
  platform: createPlatform(),                        // §4
}

// Then load the existing container-ui as the actual app.
location.replace('/container-ui.html')
```

**Or** — and this is cleaner — modify `container-ui/index.html` to call `window.__HABITAT__` for its base URL/auth instead of hardcoding `/api/...` to same-origin. That way the same UI runs on the host (served by container-server) and inside the Electron shell (served from custom protocol, talking cross-origin to `127.0.0.1:N`).

### 3.2 Custom protocol for renderer

To avoid the cross-origin headache, opencode loads its renderer from a custom protocol (`oc://renderer`) rather than `file://` or `http://`. The container-server CORS-allows that exact origin:

```ts
// In umwelten/src/habitat/container-server.ts (already exists in opencode equivalent)
cors: ['umw://renderer'],
```

The Electron main process registers a protocol handler that serves files from `out/renderer/`:

```ts
import { protocol } from 'electron'
protocol.registerSchemesAsPrivileged([{
  scheme: 'umw',
  privileges: { secure: true, standard: true, supportFetchAPI: true },
}])
// after app.whenReady():
protocol.handle('umw', async (req) => {
  const url = new URL(req.url)
  if (url.host !== 'renderer') return new Response(null, { status: 404 })
  const file = url.pathname === '/' ? '/index.html' : url.pathname
  const content = await readFile(join(rendererDir, file))
  return new Response(content, { headers: { 'content-type': mime(file) } })
})
mainWindow.loadURL('umw://renderer/')
```

This gives you a stable origin string for CSP, OAuth callbacks, and CORS — none of which work cleanly with `file://`.

---

## 4. The `Platform` object

Opencode's web app accepts a `Platform` injected at the entry point — that's how the same SolidJS app can run as web, Tauri, and Electron. Umwelten's container-ui is plain HTML/JS without that abstraction yet, so this is **a refactor in the umwelten repo**, not just a feature in the desktop package.

### 4.1 What needs to be injectable

Look through `container-ui/index.html` for everything that's currently same-origin or browser-default:

| Behavior | Web default | Native override |
|---|---|---|
| `<a href="https://...">` clicks | Opens in tab | `shell.openExternal(url)` via `window.api.openLink` |
| File uploads (`<input type=file>`) | Browser dialog | `window.api.openFilePicker` for native dialog |
| "Save transcript" | `<a download>` | `window.api.saveFilePicker` + write |
| Notifications | `Notification` API | `window.api.showNotification` (respects OS DND, dock badge) |
| Storage (`localStorage`) | Per-origin | electron-store via IPC (durable across app reinstalls if userData survives) |
| Clipboard image paste | `navigator.clipboard.read()` | Same on Electron, but `window.api.readClipboardImage` for cases where it fails |
| External proc launch | n/a | `window.api.openPath('/path/to/repo', 'cursor')` |

### 4.2 Refactor target

Add `src/habitat/container-ui/platform.ts` exporting:

```ts
export interface HabitatPlatform {
  platform: 'web' | 'desktop'
  os?: 'macos' | 'windows' | 'linux'

  openLink(url: string): void
  openPath(path: string, app?: string): Promise<void>
  openFilePicker(opts?: { ... }): Promise<string | string[] | null>
  saveFilePicker(opts?: { ... }): Promise<string | null>
  notify(title: string, body?: string, href?: string): Promise<void>
  storage(name?: string): {
    getItem(k: string): Promise<string | null>
    setItem(k: string, v: string): Promise<void>
    removeItem(k: string): Promise<void>
  }
  // ... etc.
}
```

Provide a `webPlatform` (default) implementation in container-ui itself. The Electron renderer creates a `desktopPlatform` backed by `window.api` and assigns it to `window.__HABITAT__.platform` before container-ui mounts.

This makes the desktop app a thin overlay rather than a fork — exactly what opencode does in `packages/desktop/src/index.tsx:66-416`.

---

## 5. Native menu, deep links, auto-update

### 5.1 Menu

`main/menu.ts` builds the native app menu and dispatches selections to the renderer via `webContents.send('menu-command', id)`. The renderer's preload exposes `onMenuCommand(cb)` which the chat UI subscribes to.

Standard items for v0:

- **App / Edit / View / Window / Help** — boilerplate from `Menu.buildFromTemplate`
- **File → New Session** → renderer command `session.new`
- **File → Open Habitat...** → main triggers a folder picker, then prompts to relaunch
- **File → Switch Channel** (dev/beta/prod) — v1
- **Edit** — Cut/Copy/Paste/Undo (Electron defaults)
- **View → Reload** / **Toggle DevTools** — built in
- **View → Zoom In/Out/Reset** — `webContents.zoomFactor`
- **Window → Minimize/Maximize/Close**
- **Help → Documentation** → `shell.openExternal('https://umwelten.thefocus.ai')`
- **Help → Check for Updates** → triggers updater

### 5.2 Deep links

Pattern:

- `umwelten://session/<sessionId>` — open that session
- `umwelten://habitat/<workDir>` — switch habitats (asks confirmation)
- `umwelten://onboard?token=...` — finish onboarding flow from web

The main process buffers deep links received before the renderer is ready (`pendingDeepLinks` array) and flushes them on `awaitInitialization`. See `packages/desktop-electron/src/main/index.ts:62, 122, 251`.

### 5.3 Auto-update

`electron-updater` integrates with electron-builder's release artifacts. Wire as in `packages/desktop-electron/src/main/index.ts:324-438`:

- `autoUpdater.autoDownload = false` — show a dialog before downloading
- On `update-downloaded`, prompt the user; on confirm, `killSidecar()` then `autoUpdater.quitAndInstall()`
- Manual "Check for Updates" menu item → `autoUpdater.checkForUpdates()` with toast on no-update

Skip in v0 if you don't have a release pipeline yet — gate behind a `UPDATER_ENABLED` constant (set in `electron.vite.config.ts` per channel) so the code path is dormant in dev.

---

## 6. Optional: terminal panes (port of opencode's PTY)

Opencode's renderer has built-in xterm.js terminals backed by `node-pty` running in the server process. If you want the same in umwelten:

### 6.1 Server side

Add a `Pty` service to umwelten — small, freestanding, lives at `src/habitat/pty/`:

```
src/habitat/pty/
  service.ts        # PtySession registry, scrollback buffer, subscribers
  routes.ts         # GET/POST/DELETE /api/pty, GET /api/pty/:id/connect (WS)
```

Lift the design from `opencode/packages/opencode/src/pty/index.ts:117-360`:

- Per-session **2 MB ring buffer** with a monotonic byte cursor (`cursor`) and a buffer-start cursor (`bufferCursor` — what got dropped on overflow). Lets clients reconnect with `?cursor=N` and replay missed bytes.
- A small **WebSocket control frame**: `0x00 + JSON{cursor:N}` so the client can re-sync its cursor after replay.
- Each WebSocket subscriber gets every chunk as it's emitted; binary-safe.
- `proc.onExit` publishes a bus event and tears the session down.

### 6.2 Server side WS

Container-server is currently raw `node:http`. Add WebSocket via `ws`:

```ts
import { WebSocketServer } from 'ws'
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '', 'http://x')
  const m = url.pathname.match(/^\/api\/pty\/([^/]+)\/connect$/)
  if (!m) return socket.destroy()
  // auth: ?auth_token=base64(user:pass) OR Authorization header
  const token = url.searchParams.get('auth_token') ?? authHeaderFrom(req)
  if (!validateBearer(token)) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => connectPty(m[1], ws, url.searchParams.get('cursor')))
})
```

Auth note: browsers don't always attach the basic-auth header on WS upgrades cross-origin, so accept a query-param fallback. Opencode does both (`packages/app/src/components/terminal.tsx:512-521`).

### 6.3 PTY library

`@lydell/node-pty` is the maintained fork. Has prebuilds for darwin/linux/windows × arm64/x64. **The catch**: prebuild loading in Electron is dicey because the platform-specific package detection assumes plain Node. Opencode works around this in their vite config:

```ts
// electron.vite.config.ts:46
{
  name: 'opencode:node-pty-narrower',
  enforce: 'pre',
  resolveId(s) {
    if (s === '@lydell/node-pty') return `@lydell/node-pty-${process.platform}-${process.arch}`
  },
}
```

This rewrites every `import '@lydell/node-pty'` to the platform-specific package at build time, so the bundle only ships one prebuild per platform. Replicate exactly.

### 6.4 Renderer side

Use `xterm.js` (or `ghostty-web` if you want opencode's exact look). Package outline:

```ts
// renderer/terminal.ts
const term = new Terminal({ cursorBlink: true, fontFamily: 'JetBrains Mono', ... })
term.open(container)

const ws = new WebSocket(`${url.replace('http', 'ws')}/api/pty/${id}/connect?auth_token=${btoa(`x:${apiKey}`)}&cursor=${seek}`)
ws.binaryType = 'arraybuffer'
term.onData((data) => ws.send(data))
term.onResize(({ cols, rows }) => fetch(`${url}/api/pty/${id}`, { method: 'PUT', body: JSON.stringify({ size: { cols, rows } }) }))

ws.onmessage = (ev) => {
  if (ev.data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(ev.data)
    if (bytes[0] === 0) { /* control frame: parse JSON, update cursor */ return }
  }
  term.write(typeof ev.data === 'string' ? ev.data : '')
}
```

Reconnect on abnormal close with exponential backoff (`250 * 2^min(tries, 4)` capped at 4s). Before retrying, GET `/api/pty/:id` — if 404, the session is dead, give up.

**This is a big optional feature.** Drop it from v0 unless terminals are core to the umwelten desktop story. The chat-only UI gets you 80% of what opencode is and doesn't need any of §6.

---

## 7. Build & packaging

### 7.1 electron-vite config

Three entry roots: `main`, `preload`, `renderer`. Same shape as `opencode/packages/desktop-electron/electron.vite.config.ts:33-98`:

```ts
import { defineConfig } from 'electron-vite'
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: 'src/main/index.ts' } },
      // externalize native deps so they're not bundled
      externalizeDeps: { include: ['better-sqlite3', '@lydell/node-pty-darwin-arm64' /* etc */] },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts' },
        output: { format: 'cjs', entryFileNames: '[name].js' },  // preload must be CJS
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: 'src/renderer/index.html',
          loading: 'src/renderer/loading.html',
        },
      },
    },
  },
})
```

### 7.2 electron-builder config

Decisions:

- **`asar`**: yes, default. Exclude the sidecar binary (`asarUnpack`).
- **Sidecar**: ship `umwelten/dist/cli/` as `extraResources`. Or: ship a `bun build --compile` single-file binary per platform.
- **Icons**: prep at `icons/icon.icns`, `icon.ico`, `icon.png`. Use `scripts/copy-icons.ts` to swap dev/beta/prod icon sets per channel.
- **Code signing**: macOS needs a Developer ID; Windows needs an Authenticode cert. v0: ad-hoc sign for testing, ship unsigned for early users. v1: real signing.
- **Notarization** (macOS): `notarytool` via electron-builder's `afterSign` hook. Required for downloaded binaries on macOS 10.15+.

```ts
// electron-builder.config.ts
export default {
  appId: 'ai.thefocus.umwelten',
  productName: 'Umwelten',
  directories: { output: 'dist-installer' },
  files: ['out/**'],
  extraResources: [
    { from: '../umwelten/dist', to: 'umwelten/dist' },
    // OR: { from: 'resources/sidecar/${os}/umwelten-cli', to: 'umwelten-cli' }
  ],
  asar: true,
  asarUnpack: ['**/node_modules/{@lydell/node-pty-*,better-sqlite3}/**'],
  mac: {
    target: 'dmg',
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'resources/entitlements.plist',
    notarize: { teamId: '...' },
  },
  win: {
    target: 'nsis',
    sign: { cmd: 'powershell', args: ['-File', 'scripts/sign-windows.ps1', '%1'] },
  },
  linux: { target: ['AppImage', 'deb'], category: 'Development' },
  publish: { provider: 'github' },        // or 's3'
}
```

### 7.3 Native module rebuilds

`better-sqlite3` ships C++. With path **B** (sidecar runs in plain Node) you don't need an Electron rebuild. With path **A** (in-process), add `@electron/rebuild` as a postinstall step. Either way: pin Electron version because every minor version may bump the Node ABI.

---

## 8. Sequence diagram (cold start)

```
Time   Main process                  Sidecar                  Renderer
0ms    app.whenReady()
       single-instance lock
       register umwelten:// protocol
       loadShellEnv()
50ms   pickFreePort() → 51234
       randomUUID() → apiKey
       spawn node dist/cli/entry.js habitat serve
                                     ─→ Habitat.create()
                                        startContainerServer()
                                        listen 127.0.0.1:51234
800ms  health-check loop tick
       GET /health 200
       createMainWindow()
                                                              load umw://renderer/
850ms                                                         awaitInitialization()
                                                              ← {url,apiKey}
                                                              window.__HABITAT__ = {...}
                                                              location.replace('/container-ui.html')
                                                              fetch GET /api/habitat (Bearer)
                                                              fetch GET /api/sessions (Bearer)
                                     ←──────────────────────  GET /api/chat SSE stream
                                                              render messages...

         (user types)                                         POST /api/chat {messages}
                                     ←──────────────────────  (streaming response)
                                     ──→ Interaction.streamText()
                                        ──→ provider call
                                        ──→ deltas
                                                              term.write(delta)

(user closes)
       app.before-quit
       sidecar.kill('SIGTERM')
       proc exits
```

---

## 9. Phased delivery plan

A reasonable order to build this in. Each phase is shippable on its own.

### Phase 0 — Make the library work as a sidecar (1-2 days, in `umwelten/`)

- [ ] Confirm `umwelten habitat serve --port N --work-dir D --host 127.0.0.1` works end-to-end with `HABITAT_API_KEY` set.
- [ ] Add `cors: ['umw://renderer']` to `startContainerServer` defaults.
- [ ] Refactor `container-ui/index.html` to read base URL + auth header from `window.__HABITAT__` (with fallback to same-origin).
- [ ] Extract `HabitatPlatform` interface; provide a default `webPlatform`. Container-ui calls `platform.openLink(url)` for outbound `<a>` clicks.

This is independent value — even without the desktop app, it makes container-ui embeddable.

### Phase 1 — Skeleton Electron app (2-3 days)

- [ ] Workspace setup: `pnpm-workspace.yaml`, `packages/desktop/`.
- [ ] electron-vite config, basic main/preload/renderer entries.
- [ ] BrowserWindow loads a hardcoded "hello" page. App quits cleanly.
- [ ] Single-instance lock, app menu, dev tools toggle.

### Phase 2 — Sidecar lifecycle (3-5 days)

- [ ] `spawnSidecar()` with health check.
- [ ] `loadShellEnv()` for macOS env capture.
- [ ] `awaitInitialization` IPC. Renderer waits, then loads container-ui.
- [ ] No-proxy guard. Random port. Random API key. Bearer auth in fetches.
- [ ] Kill sidecar on quit.

End of this phase: working chat in an Electron window. Everything else is polish.

### Phase 3 — Native bridges (3-4 days)

- [ ] File/folder/save pickers via IPC.
- [ ] `shell.openExternal` for outbound links.
- [ ] Native notifications.
- [ ] electron-store for "default workspace" pref.
- [ ] Custom `umw://renderer` protocol; CSP locked down.
- [ ] Deep-link handler (`umwelten://`).
- [ ] Native menu wired to renderer commands.

### Phase 4 — Distribution (3-5 days)

- [ ] electron-builder config for mac/win/linux.
- [ ] Bundle umwelten dist + node binary as `extraResources` (or compile bun single-file).
- [ ] Code-sign on mac (Developer ID + notarize).
- [ ] electron-updater + GitHub releases as the update channel.
- [ ] Channel branding (dev/beta/prod) with separate userData paths.

### Phase 5 — Optional features

- [ ] Loading window for slow SQLite migrations.
- [ ] Workspace switcher menu item.
- [ ] PTY service + xterm.js terminals (§6) — biggest single feature.
- [ ] Crash reporting (`Sentry` or similar).

---

## 10. Risks & gotchas

**Native module ABI mismatches.** The single biggest source of pain. `better-sqlite3` and `@lydell/node-pty` need prebuilds matching whatever runs them. Three escapes: (a) ship a separate Node binary as `extraResource` and use it for the sidecar; (b) compile the sidecar as a single-file binary with `bun build --compile`; (c) accept Electron-rebuilds and pin the Electron version aggressively. Pick one and stick with it — flip-flopping is expensive.

**Code signing on macOS.** Notarization is mandatory for downloaded apps on 10.15+. Without it, users see "Apple cannot verify this app is free of malware" and have to right-click → Open. For internal builds this is fine; for public release it's not.

**Better-sqlite3 in the sidecar's working directory.** If the sidecar `chdir`s, opencode found that ripgrep behaves badly when launched from `/`. Their fix: `process.chdir(homedir())` in main before spawning anything (`packages/desktop-electron/src/main/index.ts:16`). Worth copying.

**Renderer reload races.** When the user reloads the renderer (Cmd-R or after auto-update install), the sidecar keeps running. Make sure `awaitInitialization` is idempotent and returns the existing handle, not a new one. Don't recreate the habitat on every renderer reload.

**`localStorage` per-protocol.** Switching from `file://` or `http://localhost:51234` to `umw://renderer/` changes the storage origin. Migrate any persisted data, or accept a one-time reset.

**Quitting cleanly.** Multiple paths: Cmd-Q, dock-quit, Cmd-W on last window, OS shutdown, crash. Wire `before-quit`, `will-quit`, `SIGINT`, `SIGTERM`, plus a `child_process.kill('SIGTERM')` followed by a 2s timeout then `SIGKILL`. Orphan sidecar processes are a dev nightmare — `ps aux | grep umwelten` should always be empty after `osascript -e 'quit app "Umwelten"'`.

**Updater wipes the sidecar.** When `autoUpdater.quitAndInstall()` runs, it kills the app and overwrites the bundle. Make sure `killSidecar()` runs first (it does in opencode — `index.ts:393` — but only because of `before-quit`).

**HTTP proxy environment.** Corporate users with `HTTPS_PROXY` set will route loopback traffic through the proxy by default. The §2.2 fix is mandatory — without it, the renderer can't reach its own sidecar.

---

## 11. What this won't give you

**Multi-window.** All chat happens in the main window. If you want a separate window per session (Slack-style), that's a significant rework — probably a `WindowManager` in main that creates additional `BrowserWindow`s, each with its own renderer state but sharing the same sidecar.

**Mobile.** Electron is desktop-only. Same architecture would port to Tauri (smaller binary), but not to React Native / Capacitor without a different transport story.

**Offline LLM.** This isn't an offline app — it's a desktop chrome around a network-bound habitat. If the habitat uses ollama / lmstudio / llamaswap, those still need to be running locally. The Electron app doesn't bundle a model.

**True isolation.** Path B (sidecar) gives process isolation but not security isolation — the sidecar can still read the user's filesystem. For real isolation you'd need Path C (Docker), which means shipping Docker dependencies.
