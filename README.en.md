<img src="icons/128x128.png" width="96" alt="DSH Butler">

# DSH Butler

[简体中文](README.md) ｜ [English](README.en.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-302%20passed-brightgreen.svg)](src)
[![Deno](https://img.shields.io/badge/Deno-2.x-black.svg)](https://deno.com)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey.svg)](https://dsh.huilinsh.cn)
[![Release](https://img.shields.io/badge/release-v2.0.0--rc.1-orange.svg)](https://dsh.huilinsh.cn)

> **Keeping DSH always usable.** A local desktop console that folds install, repair, plugin management and data safety into one window.

A single executable that **binds to loopback only**, writes no registry keys and installs no service. Every write operation **shows a plan and waits for your confirmation**, and most leave a rollback point behind.

## Features

| Capability | Description |
| --- | --- |
| One-click DSH bootstrap | Probe → plan → install/repair, rollback on failure; read-only diagnostics support `--json` |
| Plugin marketplace | 2000+ plugins with categories, stars, downloads and summaries; one-click install, batch update, offline tgz, dependency and lockfile repair |
| Health check and one-click fix | Every finding explains why it matters, what it affects and what to do |
| Rollback timeline | Each write leaves a restore point; reverting previews impact first |
| Data migration | Export, verify and restore migration bundles (config / with skills / full) |
| Scheduled care | Periodic health checks, backups and update checks surfaced as reminders |
| Diagnostic bundle | Health, environment, dependencies and log errors redacted into one folder, re-read and re-scanned afterwards |
| Write audit | Reverse-chronological log of every write, exportable as Markdown and CSV |
| Git snapshots | Local Git snapshots of the skills directory with diff and restore (auto-stash) |
| Profiles and mirrors | Profile manager, npm registry picker with latency test, offline scenarios |
| Coexistence | Degrades to service-only mode when the official desktop app is running |

## Quick start

**Download and run (recommended)**: get `DSH-Butler-v2.0.0-rc.1-win-x64.zip` (~32 MB) from <https://dsh.huilinsh.cn>, unzip and run `dsh-butler.exe`.

Verify the download (SHA256 is published in <https://dsh.huilinsh.cn/butler/version.json>):

```powershell
Get-FileHash .\DSH-Butler-v2.0.0-rc.1-win-x64.zip -Algorithm SHA256
```

**Build from source** (Deno 2.x, Windows 10/11 with WebView2):

```bash
deno task dev       # development mode with HMR
deno task headless  # service only, handy for scripts and diagnostics
deno task test      # full test suite
deno task lint      # static checks
deno task build     # emits dist/dsh-butler/dsh-butler.exe
```

## Architecture

```
src/
├─ main.ts        entry: window, tray, dock, crash recovery, scheduler
├─ jobs/          job engine: action registry, step pipeline, progress, history
├─ api/           local HTTP API (settings, jobs, market, notices, help)
├─ web/           embedded UI plus page guard tests
├─ host/          platform layer: processes, ports, windows, tray, filesystem
├─ util/          paths, result model, error translation (21 rules with fixes)
└─ domains/       11 domains, 49 actions: bootstrap / core / plugin / runtime /
                  backup / data / net / diag / env / profile / state
```

## Action reference (49)

| Domain | Actions |
| --- | --- |
| Bootstrap | `bootstrap.plan` `bootstrap.apply` `bootstrap.verify` `bootstrap.discard` |
| Core | `core.status` `core.update` `core.finishUpdate` `core.verify` `core.rollback` |
| Plugins | `plugin.scan` `plugin.install` `plugin.uninstall` `plugin.repair` `plugin.diagnose` `plugin.batchUpdate` `plugin.installOffline` `plugin.deps` `plugin.syncLock` `plugin.cleanResidue` `plugin.cleanBackups` |
| Runtime | `runtime.status` `runtime.logs` `runtime.diagnose` `runtime.start` `runtime.stop` `runtime.restart` `runtime.repair` |
| Restore points | `backup.create` `backup.list` `backup.verify` `backup.preview` `backup.apply` `backup.delete` |
| Data | `data.export` `data.inspect` `data.restore` `data.backup` `data.backups` `data.diagnose` `data.audit` `data.auditExport` `data.snapshot` `data.snapshots` `data.snapshotRestore` |
| Network | `network.testSources` `network.setRegistry` |
| Environment | `env.probe` |
| Profiles | `profile.list` `profile.switch` |

## Principles

1. **Plan before write** — write actions implement `preflight()` and lay out why, what it affects and how to proceed.
2. **Rollback first** — writes create restore points where possible and preview impact; a cross-process lock prevents races.
3. **Redact and re-check** — outgoing files are deep-redacted, then re-read and re-scanned; leftovers fail the export.

## Security and privacy

- **Loopback only**: binds to `127.0.0.1` with a per-run token; no port is exposed.
- **Reversible by design**: restore points, impact previews and a cross-process write lock.
- **Nothing leaves the machine**: no telemetry; shareable files are deep-redacted and re-scanned.

## Quality

- **302 tests passing** across 66 test files, including guards for injected-script syntax, unreachable UI paths and reproductions of past defects.
- Every feature is verified on a real Windows machine (batch update with restart and health check, offline install, measured mirror latency and more).

## Documentation

| Document | Contents |
| --- | --- |
| [User guide](docs/使用帮助.md) | Getting started and day-to-day care (same source as the in-app Help page) |
| [Update strategy](docs/UPDATE-STRATEGY.md) | Version manifest, verification and self-update flow |
| [UI design system](docs/UI-DESIGN-SYSTEM.md) | Colour, type, spacing and component rules |
| [Roadmap](docs/FEATURE-ROADMAP-2026-09-25.md) | Shipped and planned capabilities |

## Releases

- Releases are **portable zip archives**, not installers: unzip and run, data stays in your user profile.
- Version manifest: <https://dsh.huilinsh.cn/butler/version.json> (`version` / `url` / `sha256` / `sizeBytes` / `changelog`).
- Marketplace catalog source: <https://dsh.huilinsh.cn/plugins.json>.

## License

[MIT](LICENSE) © 2026 Frank-NF.
