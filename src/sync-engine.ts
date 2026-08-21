import { App, Notice, moment } from "obsidian";
import { GitHubApiClient } from "./github-api";
import { GitHubSyncSettings } from "./types";
import {
  calculateGitSha,
  arrayBufferToBase64,
  generateCommitMessage,
  isTextFile,
  normalizeTextBuffer,
} from "./utils";
import { ConflictModal } from "./conflict-modal";

export class SyncEngine {
  constructor(
    private app: App,
    private settings: GitHubSyncSettings,
    private api: GitHubApiClient,
  ) {}

  private async getRepoName(): Promise<string> {
    // 1. If user explicitly provided a custom repo name, always use it first
    if (
      this.settings.customRepoName &&
      this.settings.customRepoName.trim() !== ""
    ) {
      const customRepo = this.settings.customRepoName.trim();
      if (this.settings.authMode === "auto_classic") {
        await this.api.ensureRepoExists(customRepo);
      }
      return customRepo;
    }

    // 2. Fallback for Auto Mode: Derive from Vault Name
    if (this.settings.authMode === "auto_classic") {
      const sanitized = this.app.vault
        .getName()
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .replace(/-+/g, "-");
      const defaultRepo = `obsidian-${sanitized}`;
      await this.api.ensureRepoExists(defaultRepo);
      return defaultRepo;
    }

    throw new Error(
      "Repository name is missing. Please specify one in settings.",
    );
  }

  private isIgnored(path: string): boolean {
    return path.startsWith(".obsidian/") || path.includes(".trash");
  }

  async runSync(isAuto = false): Promise<void> {
    let retries = 3;
    while (retries > 0) {
      try {
        const skippedFiles: string[] = [];
        const repo = await this.getRepoName();
        const latestCommitSha = await this.api.getLatestCommitSha(repo);
        const remoteTree = await this.api.getTree(repo, latestCommitSha);

        if (remoteTree.truncated) {
          throw new Error("GitHub remote tree is truncated (exceeds 100k files). Exiting to prevent accidental data loss.");
        }

        const remoteFiles = new Map<string, string>();
        const remoteSizes = new Map<string, number>();
        remoteTree.tree.forEach((item: any) => {
          if (item.type === "blob") {
            remoteFiles.set(item.path, item.sha);
            remoteSizes.set(item.path, item.size || 0);
          }
        });

        const localFiles = this.app.vault
          .getFiles()
          .filter((f) => !this.isIgnored(f.path));
        const localHashes = new Map<string, string>();

        if (!this.settings.localHashCache) {
          this.settings.localHashCache = {};
        }

        for (const file of localFiles) {
          if (file.stat.size > 25 * 1024 * 1024) {
            skippedFiles.push(file.path);
            continue;
          }
          const cache = this.settings.localHashCache[file.path];
          const mtime = file.stat.mtime;
          const size = file.stat.size;

          if (cache && cache.mtime === mtime && cache.size === size) {
            localHashes.set(file.path, cache.sha);
          } else {
            let buffer = await this.app.vault.adapter.readBinary(file.path);
            if (isTextFile(file.path)) {
              buffer = normalizeTextBuffer(buffer);
            }
            const sha = await calculateGitSha(buffer);
            localHashes.set(file.path, sha);
            this.settings.localHashCache[file.path] = { mtime, size, sha };
          }
        }

        // Clean up cache entries for files that no longer exist locally
        const localFilePaths = new Set(localFiles.map((f) => f.path));
        for (const path of Object.keys(this.settings.localHashCache)) {
          if (!localFilePaths.has(path)) {
            delete this.settings.localHashCache[path];
          }
        }

        // Cache Self-Healing: Reconstruct baseline if cache is missing/wiped
        if (Object.keys(this.settings.lastSyncState).length === 0 && remoteFiles.size > 0) {
          console.log("Empty sync state detected with existing remote files. Reconstructing cache baseline...");
          for (const [path, remoteSha] of remoteFiles.entries()) {
            const localSha = localHashes.get(path);
            if (localSha === remoteSha) {
              this.settings.lastSyncState[path] = remoteSha;
            }
          }
        }

        const filesToDownload: string[] = [];
        const filesToUpload: string[] = [];
        const filesToDeleteLocally: string[] = [];
        const filesToDeleteRemotely: string[] = [];
        const changedFileNames: string[] = [];

        // Combine all known paths across Local, Remote, and Cache
        const allPaths = new Set([
          ...remoteFiles.keys(),
          ...localHashes.keys(),
          ...Object.keys(this.settings.lastSyncState),
        ]);

        const localFileMap = new Map(localFiles.map((f) => [f.path, f]));

        for (const path of allPaths) {
          const localFile = localFileMap.get(path);
          const remoteSize = remoteSizes.get(path) || 0;
          const isLocalTooLarge = localFile && localFile.stat.size > 25 * 1024 * 1024;
          const isRemoteTooLarge = remoteSize > 25 * 1024 * 1024;

          if (isLocalTooLarge || isRemoteTooLarge) {
            if (!skippedFiles.includes(path)) {
              skippedFiles.push(path);
            }
            continue;
          }

          const remoteSha = remoteFiles.get(path);
          const localSha = localHashes.get(path);
          const baseSha = this.settings.lastSyncState[path];

          if (localSha === remoteSha) continue; // Perfect sync

          // SCENARIO 1: Missing Locally (User deleted it, or it's new on GitHub)
          if (!localSha && remoteSha) {
            if (baseSha === remoteSha) {
              // It hasn't changed remotely, which means the user INTENTIONALLY deleted it locally.
              filesToDeleteRemotely.push(path);
            } else {
              // It's a new file from GitHub, or someone edited it remotely after it was deleted here.
              // Prioritize saving data -> Download it.
              filesToDownload.push(path);
            }
          }

          // SCENARIO 2: Missing Remotely (Deleted on another device, or new locally)
          else if (localSha && !remoteSha) {
            if (baseSha === localSha) {
              // It hasn't changed locally, which means it was INTENTIONALLY deleted on another device.
              filesToDeleteLocally.push(path);
            } else {
              // It's a brand new local note, or the user edited it while it was being deleted remotely.
              // Prioritize saving data -> Upload it.
              filesToUpload.push(path);
            }
          }

          // SCENARIO 3: Both Exist, but Differ (Standard Modification)
          else if (localSha && remoteSha) {
            if (baseSha === localSha && remoteSha !== localSha) {
              filesToDownload.push(path); // Remote changed
            } else if (baseSha === remoteSha && localSha !== remoteSha) {
              filesToUpload.push(path); // Local changed
            } else {
              // CONFLICT: Both changed simultaneously
              await this.promptConflictResolution(
                path,
                filesToUpload,
                filesToDownload,
              );
            }
          }
        }

        // Execute Local Deletions FIRST
        for (const path of filesToDeleteLocally) {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file) {
            // move to system trash (true) or obsidian trash (false)
            await this.app.vault.trash(file, true);
          }
          // Remove from the sync cache
          delete this.settings.lastSyncState[path];
        }

        // Execute Downloads
        for (const path of filesToDownload) {
          const buffer = await this.api.downloadBlob(
            repo,
            remoteFiles.get(path)!,
          );
          const existingFile = this.app.vault.getAbstractFileByPath(path);
          if (existingFile)
            await this.app.vault.adapter.writeBinary(path, buffer);
          else {
            const folders = path.split("/");
            folders.pop();
            if (folders.length > 0) {
              const dir = folders.join("/");
              if (!(await this.app.vault.adapter.exists(dir)))
                await this.app.vault.adapter.mkdir(dir);
            }
            await this.app.vault.adapter.writeBinary(path, buffer);
          }
          this.settings.lastSyncState[path] = remoteFiles.get(path)!; // Update base cache
        }

        // If there is anything to Upload OR Delete remotely, we must create a Commit
        if (filesToUpload.length > 0 || filesToDeleteRemotely.length > 0) {
          const treePayload = [];

          // 1. Process files to Upload
          for (const path of filesToUpload) {
            let buffer = await this.app.vault.adapter.readBinary(path);
            if (isTextFile(path)) {
              buffer = normalizeTextBuffer(buffer);
            }
            const base64 = arrayBufferToBase64(buffer);
            const newBlobSha = await this.api.uploadBlob(repo, base64);

            treePayload.push({
              path,
              mode: "100644",
              type: "blob",
              sha: newBlobSha,
            });
            this.settings.lastSyncState[path] = newBlobSha; // Update cache
            changedFileNames.push(path.split("/").pop()!);
          }

          // 2. Process files to Delete remotely
          for (const path of filesToDeleteRemotely) {
            treePayload.push({
              path,
              mode: "100644",
              type: "blob",
              sha: null, // <-- This deletes it on GitHub
            });
            delete this.settings.lastSyncState[path]; // Remove from cache
            changedFileNames.push(`Deleted: ${path.split("/").pop()}`);
          }

          // 3. Create the commit
          const commitMessage = generateCommitMessage(
            this.settings.hostname,
            this.settings.dateTimeFormat,
            changedFileNames,
          );

          await this.api.commit(
            repo,
            commitMessage,
            treePayload,
            remoteTree.sha,
            latestCommitSha,
          );
        }

        if (!isAuto || filesToDownload.length > 0 || filesToUpload.length > 0 || skippedFiles.length > 0) {
          let msg = `GitHub Sync Complete.\nUploaded: ${filesToUpload.length}\nDownloaded: ${filesToDownload.length}`;
          if (skippedFiles.length > 0) {
            msg += `\n⚠️ Skipped ${skippedFiles.length} file(s) exceeding 25MB limit.`;
          }
          new Notice(msg);
        }
        break;
      } catch (error: any) {
        if (error.message.includes("422") && retries > 1) {
          retries--;
          console.warn(`Optimistic concurrency collision detected. Retrying sync run (Attempt ${3 - retries}/3)...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        console.error(error);
        if (!isAuto) {
          new Notice(`GitHub Sync Error: ${error.message}`);
        }
        throw error;
      }
    }
  }

  private async promptConflictResolution(
    path: string,
    filesToUpload: string[],
    filesToDownload: string[],
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      new ConflictModal(this.app, path, async (choice) => {
        if (choice === "local") {
          filesToUpload.push(path);
        } else if (choice === "remote") {
          filesToDownload.push(path);
        } else if (choice === "both") {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file) {
            const extIndex = path.lastIndexOf(".");
            const base = extIndex !== -1 ? path.slice(0, extIndex) : path;
            const ext = extIndex !== -1 ? path.slice(extIndex) : "";
            const dateStr = (moment as any)().format("YYYY-MM-DD");
            const conflictPath = `${base} (Local Conflict ${dateStr})${ext}`;
            try {
              await this.app.vault.rename(file, conflictPath);
            } catch (err) {
              console.error(`Failed to rename conflict file: ${err}`);
              new Notice(`Failed to rename conflict file: ${path}`);
            }
          }
          filesToDownload.push(path);
        }
        resolve();
      }).open();
    });
  }
}

