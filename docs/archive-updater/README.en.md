# DSH Plugin Updater

> A standalone DSH plugin management tool that does not depend on the Agent core. Scan, update, enable, disable and uninstall plugins, with a built-in official plugin marketplace and automatic update detection.

**[简体中文](README.md) · English**

## Download

- Official site (recommended): **https://dsh.huilinsh.cn/download** — latest `v1.18.15`, SHA256 checksum provided
- In-app self-update: the tool checks for new versions automatically on startup (Ed25519 signature + SHA256 verified)
- Full feature guide: [User Manual](https://dsh.huilinsh.cn/docs)

## Features

- **Standalone** — pure desktop tool, does not depend on the DSH Agent process
- **Smart Scan** — auto-detects installed plugins and the Agent core in plugin directories
- **Plugin Marketplace** — built-in official catalog (2189+ plugins) with category filters, keyword search, Star/downloads/latest sorting and one-click install
- **One-Click Updates** — checks the latest versions via npm registry, fast downloads
- **Read the changelog before updating** — clicking "Update" shows what changed: the release notes, or the newest section of the repo's `CHANGELOG.md`, or an explicit **"No changelog found"** notice
- **Self-healing core update** — "Finish update" quarantines leftover non-HEAD files in the source tree first, then runs the official full rebuild, so a broken build can be fixed in one click
- **Industry bundles** — plugins + MCP templates + skills installed together, with conflict pre-check and transaction rollback
- **MCP service management** — central config for local MCP servers, secrets stored in the OS credential store (never in plaintext)
- **Enable/Disable** — toggle plugins on/off without deleting files
- **Safe Uninstall** — automatic backup before uninstall, restore anytime
- **Folder Access** — one click to open the plugin folder
- **Repair Center** — DSH environment check + bilingual repair guide for common errors
- **Bilingual UI** — Chinese/English switch, remembers your choice
- **Cross-Platform** — Windows and Linux, single-file runtime

## Project Structure

```
DSH-PluginUpdater/
├── src-tauri/              # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs         # App entry, Tauri command registration
│   │   ├── error.rs        # Error types and data structures
│   │   ├── manifest.rs     # Plugin manifest read/write
│   │   ├── plugin_scan.rs  # Plugin directory scanning
│   │   ├── github_proxy.rs # GitHub request client
│   │   └── file_ops.rs     # File operations (update/uninstall/backup)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── src-vue/                # Vue3 frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── stores/         # Pinia state management
│   │   ├── api/            # Tauri invocation wrappers
│   │   ├── types/          # TypeScript type definitions
│   │   ├── styles/         # Global styles
│   │   ├── App.vue
│   │   └── main.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── index.html
├── website/                # Nuxt3 official website
│   ├── pages/              # Pages (home/marketplace/download/docs)
│   ├── components/         # Website components
│   ├── assets/css/         # Website styles
│   ├── nuxt.config.ts
│   └── package.json
├── docs/                   # Project documentation
└── README.md
```

## Tech Stack

### Desktop Client
- **Tauri 2.0** — desktop app framework, Rust backend + Web frontend
- **Vue 3** — frontend framework, Composition API
- **TypeScript** — type safety
- **WeUI 2.6 + in-house W\* components** — no heavy UI library
- **GSAP** — animation engine
- **Pinia** — state management
- **Rust** — backend core logic
  - `reqwest`: HTTP client
  - `semver`: semantic version parsing
  - `zip`: archive extraction
  - `serde`: serialization/deserialization
  - `walkdir`: directory traversal
  - `ed25519-dalek`: Ed25519 signature verification

### Official Website
- **Nuxt 3** — SSR framework
- **Vue 3** — frontend framework
- **SQLite + jsonwebtoken + bcryptjs** — auth and permissions

## Security & Privacy

- **Ed25519 signature chain** — catalog and self-update payloads are signed; the client embeds the public key at compile time and rejects anything that fails verification (fail-closed)
- **Mandatory checksums** — a self-update without a SHA256 value is rejected, not silently skipped
- **HTTPS only** — all external traffic is https; a custom registry over plaintext `http://` is allowed only for loopback (`127.0.0.1` / `localhost`)
- **Client CSP** — `tauri.conf.json` ships a Content-Security-Policy that only allows local and official resources
- **Server defaults are empty** — every "server sync" field (host, port, user, key, remote dir, update command) defaults to empty. No server address is pre-filled, bundled, uploaded or logged; whatever you enter stays in the local config file
- **Website hardening** — JWT fail-fast in production, httpOnly/Secure cookies, rate limits, admin-only signing endpoint, owner-only creator ledger, parameterized SQL, and security response headers

## Quick Start

### 1. Clone

```bash
git clone https://github.com/Frank-NF/DSH-PluginUpdater.git
cd DSH-PluginUpdater
```

### 2. Develop the Desktop Client

```bash
# Install frontend dependencies
cd src-vue
npm install

# Install Rust dependencies (automatic)
cd ../src-tauri
cargo build

# Start development mode
cd ..
npm run tauri dev
```

### 3. Build Production

```bash
cd src-tauri
cargo tauri build
```

Build artifacts are in `src-tauri/target/release/bundle/`.

### 4. Run the Official Website

```bash
cd website
npm install
npm run dev
```

## Plugin Manifest Specification

Each plugin directory must contain a `plugin.manifest.json` file:

```json
{
  "id": "dsh-plugin-example",
  "name": "Example Plugin",
  "description": "Plugin description",
  "github_repo": "owner/repo",
  "current_version": "1.0.0",
  "enabled": true,
  "type": "plugin",
  "author": "Author Name",
  "homepage": "https://example.com"
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Unique plugin identifier |
| name | string | Yes | Display name |
| description | string | No | Description |
| github_repo | string | No | GitHub repository (owner/repo) |
| current_version | string | No | Current version |
| enabled | boolean | No | Enabled by default true |
| type | string | No | plugin or agent-core |
| author | string | No | Author |
| homepage | string | No | Homepage URL |

## Configuration

Configurable in the app "Settings":

- **Proxy URL** — direct connection by default, empty is valid; when set, all GitHub requests go through the proxy
- **Install Registry (npm)** — official or mirror registry; custom URLs must start with http(s)://
- **Default Plugin Directory** — directory scanned at startup
- **Auto-check Updates After Scan** — on by default
- **Backup Before Update** — on by default

## FAQ

### Q: "Update check failed"?
A: Check your network connection. Update checks use the npm registry and need no extra configuration.

### Q: "File in use" when updating?
A: Close the DSH Agent core first, then retry the update.

### Q: How to restore accidentally deleted plugins?
A: The tool auto-backs up before uninstall and update; restore from the backup manager.

## License

MIT License

## Contact

- Website: https://dsh.huilinsh.cn
- GitHub: https://github.com/Frank-NF/DSH-PluginUpdater
