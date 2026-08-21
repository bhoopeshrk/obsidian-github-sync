# Usage guide

This document covers detailed setup, authentication modes, commands, settings, and troubleshooting for RK's Obsidian GitHub Sync.

---

## Authentication modes

The plugin supports two authentication modes. Choose the one that fits your security requirements.

### Automatic (Classic PAT) — recommended

The plugin creates and manages a private GitHub repository automatically.

1. Go to **Settings → RK's Obsidian GitHub Sync**.
2. Select **Automatic (recommended)** as the Setup mode.
3. Enter your **GitHub username**.
4. Click the link to generate a pre-configured classic token with the `repo` scope, or create one manually at [GitHub Settings → Tokens](https://github.com/settings/tokens/new?scopes=repo&description=Obsidian%20Sync%20Auto).
5. Paste the token into the **Personal access token (classic)** field.

The plugin will automatically create a private repository named `obsidian-<vault-name>` on first sync.

### Manual (Fine-Grained PAT) — high security

You create the repository and token yourself, scoped to a single repo.

1. Create an empty private repository on GitHub: [github.com/new](https://github.com/new).
2. Generate a fine-grained token: [GitHub Settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).
   - Scope it to the repository you just created.
   - Grant **Contents: Read & Write** permission.
3. In plugin settings, select **Manual / high-security** as the Setup mode.
4. Enter your **GitHub username** and the **Target repository name** (exact name of the repo).
5. Paste the token into the **Personal access token (fine-grained)** field.

---

## Token visibility

Click the eye icon next to any token field to toggle visibility. Tokens are stored in Obsidian's `localStorage` (device-local) and are never written to `data.json` inside your vault.

---

## Settings

### Authentication

| Setting | Description |
| :--- | :--- |
| **Setup mode** | Automatic (Classic PAT) or Manual (Fine-Grained PAT) |
| **GitHub username** | Your GitHub username |
| **Personal access token** | Classic or Fine-Grained PAT |
| **Custom repository name** | Override the auto-generated repo name (auto mode) or specify an existing repo (manual mode) |

### Sync schedule

| Setting | Description |
| :--- | :--- |
| **Auto pull on startup** | Pull remote changes when Obsidian starts |
| **Auto sync enabled** | Periodically commit and push local changes |
| **Sync frequency (minutes)** | How often to auto-sync (0 = disabled, max 1440) |

### Advanced

| Setting | Description |
| :--- | :--- |
| **Device hostname** | Identifies this machine in commit messages |
| **GitHub API URL** | Custom API URL for GitHub Enterprise instances |
| **Ignored patterns** | Files matching these patterns are not synced |

---

## Ignore patterns

Create a `.obsidian-sync-ignore` file in your vault's `.obsidian` directory. List one pattern per line:

```
.trash/
.obsidian/workspace.json
*.log
```

The plugin auto-creates this file with sensible defaults on first load.

---

## Commands

Open the command palette (`Ctrl/Cmd + P`) and search for "GitHub sync":

| Command | Description |
| :--- | :--- |
| **Sync now** | Run a full sync (pull then push) |
| **Force sync** | Sync ignoring local cache — rebuilds state from remote |
| **View sync log** | Display the last 50 sync entries |
| **Clear sync log** | Remove all sync log entries |

---

## Sync log

Every sync (manual or automatic) is logged with:
- Timestamp and device hostname
- Mode (auto or manual)
- Files uploaded/downloaded
- Conflicts resolved
- Duration

Access the log via the **View sync log** command. Logs are capped at 50 entries and persisted in `data.json`.

---

## Status bar

The status bar at the bottom of Obsidian shows the current sync state:

| Icon | Meaning |
| :--- | :--- |
| ⚡ GitHub sync | Not configured — click to open settings |
| ☁️ synced | Up to date |
| 🔄 Syncing... | Sync in progress |
| 💤 Offline | Device is offline, sync suspended |
| ⚠️ sync error | Last sync failed (hover for error details) |

---

## Conflict resolution

When the same file is modified on two devices between syncs, a conflict modal appears showing:
- File path
- Local vs remote file size and line count
- Modification timestamps

Choose **Keep local**, **Keep remote**, or **Keep both** (renames local copy with a conflict suffix).

---

## Troubleshooting

### Plugin doesn't appear after install
- Ensure `main.js` and `manifest.json` are at the top level of the plugin folder: `<Vault>/.obsidian/plugins/obsidian-github-sync/`.
- Reload Obsidian and check **Settings → Community plugins**.

### "Please configure your token and username"
- Open **Settings → RK's Obsidian GitHub Sync** and verify your credentials.
- The status bar shows ⚡ when not configured.

### Sync shows "Sync error"
- Hover over the status bar for error details.
- Common causes: invalid token, repository not found, rate limiting.
- For rate limits, wait a few minutes and try again.

### Files not syncing
- Check the **Ignored patterns** in settings.
- Ensure files are under 25 MB.
- Verify the file is not matched by `.obsidian-sync-ignore`.

### Two devices show conflicting changes
- The conflict modal appears when both devices modified the same file.
- Choose an option to resolve. "Keep both" creates a local copy with a conflict suffix.

### Auto-sync not running
- Verify **Auto sync enabled** is on in settings.
- Check that **Sync frequency** is set to a value greater than 0.
- Auto-sync is skipped when the device is offline.
