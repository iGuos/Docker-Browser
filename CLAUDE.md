# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # start Vite dev server + Electron (hot-reload)
pnpm build            # tsc + vite build (renderer + main + preload)
pnpm typecheck        # type-check only, no emit
pnpm test             # run vitest (auto-runs pretest build first)
pnpm test:watch       # vitest watch mode
pnpm dist             # production installer (build → icon → rebuild native → electron-builder)
pnpm dist:dir         # same but outputs unpacked directory (faster, no installer)
pnpm clean            # delete dist, dist-electron, release build artifacts
```

Tests cover `shared/**/*.test.ts` and `electron/**/*.test.ts` — not renderer code.

## Architecture

This is an **Electron desktop app** with three separate JS contexts:

```
electron/main/      — Node.js main process (Docker API, IPC handlers, windows)
electron/preload/   — contextBridge bridge (index.ts only)
src/                — React renderer (never imports from electron/ directly)
shared/             — types and IPC channel names shared across all three
```

### IPC contract

All cross-process communication is typed through `shared/`:

- `shared/dockerIpcChannels.ts` — `DockerIpc` const object, single source of truth for all channel strings
- `shared/appIpcChannels.ts` — `AppIpc` channels for app-level operations
- `shared/ipc.ts` — `IpcResult<T>` = `{ ok: true; data: T } | { ok: false; error: string }`

Every IPC handler in `electron/main/` returns `IpcResult<T>` (via `ipcOk` / `ipcErr`). The preload exposes them on `window.dockerDesktop`. Renderer code calls them and uses `unwrapIpc()` (`src/lib/ipc.ts`) to throw on errors.

Adding a new IPC channel requires touching three places: `shared/dockerIpcChannels.ts` → `electron/main/ipcDocker.ts` (or main index) → `electron/preload/index.ts`.

### Main process modules (`electron/main/`)

| File | Responsibility |
|---|---|
| `index.ts` | App lifecycle, window creation, host-metrics IPC, Docker engine start/stop |
| `ipcDocker.ts` | ~70 Docker IPC handlers (containers, images, networks, volumes, logs, events, stats, file ops) |
| `dockerExecPty.ts` | Interactive PTY via `node-pty` — `execPtyStart/Stop/Write/Resize/Data/Exit` |
| `containerFs.ts` | Container filesystem browse/read/write via `dockerode` getArchive/putArchive + `tar-stream` |
| `dockerCliCreate.ts` | Wraps `docker run`, `docker build`, `docker compose up` as child processes with streaming progress |
| `dockerClient.ts` | `dockerode` singleton (`getDocker()`) |
| `dockerCliPath.ts` | `resolveDockerBin()` + `envWithDockerCliInPath()` — fixes short PATH in macOS GUI apps |
| `dockerLogDemux.ts` | Parses Docker's 8-byte multiplexed log stream header |
| `appMenu.ts` | Native menu, theme/language items |
| `updater.ts` | `electron-updater` integration |

### Streaming subscriptions

Logs, events, and PTY all use a subscription pattern:
1. Caller invokes `*Start` → returns `{ subscriptionId: string }`
2. Main process pushes chunks via `webContents.send(channel, { subscriptionId, ... })`
3. Caller invokes `*Stop(subscriptionId)` to tear down

The preload exposes `onLogsChunk`, `onEventsChunk`, `onExecPtyData`, `onExecPtyExit` as listener registrations that return an unsubscribe function.

### Multi-window

Three auxiliary window types are opened by main via IPC (`app:open-container-logs-window`, `app:open-container-exec-window`, `app:open-container-files-window`). Each has its own React entrypoint (`src/ContainerLogsWindowApp.tsx`, etc.) loaded via a hash route.

### Frontend (`src/`)

- **Path aliases**: `@` → `src/`, `@shared` → `shared/`
- **State**: Zustand store at `src/stores/dockerStore.ts` — manages tab selection, container/image/network/volume lists, connection state
- **i18n**: `react-i18next`, translations in `src/i18n/`
- All Docker calls go through `window.dockerDesktop.*` (typed by the contextBridge)

### macOS PATH issue

GUI apps launched from Dock/Finder inherit a short `PATH`. `envWithDockerCliInPath()` prepends known Docker/Homebrew bin dirs before any `child_process.spawn` call. `resolveDockerBin()` returns absolute paths for `node-pty`'s `pty.spawn` which uses `posix_spawnp` and may ignore `env.PATH`.
