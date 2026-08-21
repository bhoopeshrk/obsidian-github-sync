# RK's Obsidian GitHub Sync

Sync your Obsidian vault across all your devices — desktop, iOS, and Android — using GitHub's REST API. No local Git installation required.

---

## Features

- **Automatic and manual sync** via ribbon icon or command palette
- **Three-way conflict resolution** modal when the same file is edited on two devices simultaneously
- **Offline-aware** — background sync is skipped silently when offline; manual sync shows a clear error
- **Secure token storage** — Personal Access Token is stored in browser `localStorage`, never written to `data.json` inside your vault
- **Cross-platform line-ending normalization** — CRLF on Windows is normalized to LF before hashing and uploading, preventing infinite sync loops
- **Smart delta hashing** — unmodified files are skipped using metadata timestamps, keeping sync fast even in large vaults
- **Large file protection** — files exceeding 25 MB are automatically skipped to prevent memory crashes on mobile
- **Concurrent edit retries** — if two devices commit at the same moment, the plugin automatically retries up to 3 times
- **Remote tree truncation guard** — sync is safely aborted if the GitHub tree payload is truncated (>100k files)
- **Self-healing cache** — if the local sync state is wiped (e.g. fresh install), the plugin reconstructs it from the GitHub tree without re-downloading everything
- **Dynamic status bar** — real-time sync state shown at the bottom of Obsidian (☁️ Synced / 🔄 Syncing... / 💤 Offline / ⚠️ Sync Error)
- **GitHub Enterprise support** — configure a custom API base URL for self-hosted GitHub instances

---

## Requirements

- A GitHub account with a Personal Access Token (Classic or Fine-Grained)
- Internet access for sync operations

---

## Installation

### From the Obsidian Community Plugin Store
*(Coming soon — pending store submission)*

### Manual Install
1. Download `main.js` and `manifest.json` from the [Releases](../../releases) page.
2. Copy them to `<Vault>/.obsidian/plugins/obsidian-github-sync/`.
3. Restart Obsidian and enable the plugin under **Settings → Community plugins**.

---

## Setup

1. Open **Settings → RK's Obsidian GitHub Sync**.
2. Select your **Setup mode**:
   - **Automatic (Classic PAT)**: The plugin creates and manages a private GitHub repository automatically. Enter your Classic Personal Access Token.
   - **Manual (Fine-Grained PAT)**: Specify an existing repository name and enter a Fine-Grained PAT scoped to that repository.
3. Enter your **GitHub username** (derived automatically from the token in auto mode).
4. Paste your **Personal access token** — it is stored securely in browser `localStorage` and never written to disk inside your vault.
5. Optionally configure a **custom repository name**, **device hostname** (used in commit messages), and **sync frequency**.
6. Click the ribbon icon (☁️) or run the **Sync now** command to trigger a manual sync.

---

## Network Use Disclosure

> **This plugin makes network requests to external services.** As required by [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies):

| Service | URL | Purpose |
| :--- | :--- | :--- |
| **GitHub REST API** | `https://api.github.com` (default) or your custom hostname | Upload, download, and commit vault files to a private GitHub repository |

No analytics, telemetry, or tracking data is collected or transmitted. Vault contents are only transmitted to GitHub as part of the explicit sync operation you control.

---

## Privacy & Security

- Your **Personal Access Token** is stored only in browser `localStorage` — it is never written into your vault folder or committed to any repository.
- **Vault file contents** are only ever uploaded to the GitHub repository you configure. They are never sent to any third-party service.
- The plugin operates entirely offline when no sync is triggered.

---

## License

MIT © Bhoopesh R K
