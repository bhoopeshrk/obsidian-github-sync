# SyncGit

Sync your Obsidian vault across all your devices — desktop, iOS, and Android — using GitHub's REST API. No local Git installation required.

---

## What is this?

SyncGit is a community plugin that keeps your Obsidian vault synchronized across multiple devices using a private GitHub repository as the bridge. It handles three-way conflict resolution, offline detection, and cross-platform line-ending normalization automatically — so you can focus on your notes, not sync logistics.

---

## Features

- **Automatic and manual sync** via ribbon icon or command palette
- **Three-way conflict resolution** with context (file sizes, line counts, timestamps)
- **Offline-aware** — background sync is skipped silently when offline
- **Secure token storage** — Personal Access Token stored in browser `localStorage`, never written to `data.json`
- **Smart delta hashing** — unmodified files are skipped using metadata timestamps
- **Large file protection** — files exceeding 25 MB are automatically skipped
- **Concurrent edit retries** — automatic retry up to 3 times on race conditions
- **Dynamic status bar** — real-time sync state at the bottom of Obsidian
- **Sync log** — view recent sync history with the "View sync log" command
- **GitHub Enterprise support** — configure a custom API base URL

---

## Install

### From the Obsidian Community Plugin Store
*(Coming soon — pending store submission)*

### Manual Install
1. Download `main.js` and `manifest.json` from the [Releases](../../releases) page.
2. Copy them to `<Vault>/.obsidian/plugins/sync-git/`.
3. Restart Obsidian and enable the plugin under **Settings → Community plugins**.

---

## Quick start

1. Open **Settings → SyncGit**.
2. Select your **Setup mode** and enter your credentials.
3. Click the ribbon icon (☁️) or run the **Sync now** command.

For detailed setup instructions, authentication modes, commands, and troubleshooting, see **[USAGE.md](USAGE.md)**.

---

## Network disclosure

> **This plugin makes network requests to external services.** As required by [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies):

| Service | URL | Purpose |
| :--- | :--- | :--- |
| **GitHub REST API** | `https://api.github.com` (default) or your custom hostname | Upload, download, and commit vault files to a private GitHub repository |

No analytics, telemetry, or tracking data is collected or transmitted. Vault contents are only transmitted to GitHub as part of the explicit sync operation you control.

---

## Privacy and security

- Your **Personal Access Token** is stored only in browser `localStorage` — it is never written into your vault folder or committed to any repository.
- **Vault file contents** are only ever uploaded to the GitHub repository you configure. They are never sent to any third-party service.
- The plugin operates entirely offline when no sync is triggered.

---

## License

MIT © Bhoopesh R K
