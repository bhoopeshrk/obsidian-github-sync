import { App, Notice, moment, normalizePath } from 'obsidian';
import { GitHubApiClient } from './github-api';
import { GitHubSyncSettings } from './types';
import {
	calculateGitSha,
	arrayBufferToBase64,
	generateCommitMessage,
	isTextFile,
	normalizeTextBuffer,
} from './utils';
import { ConflictModal } from './conflict-modal';

export interface SyncResult {
	stateChanged: boolean;
}

export class SyncEngine {
	private ignorePatterns: string[] = [];

	constructor(
		private app: App,
		private settings: GitHubSyncSettings,
		private api: GitHubApiClient,
	) {}

	private async getRepoName(): Promise<string> {
		if (
			this.settings.customRepoName &&
			this.settings.customRepoName.trim() !== ''
		) {
			const customRepo = this.settings.customRepoName.trim();
			if (this.settings.authMode === 'auto_classic') {
				await this.api.ensureRepoExists(customRepo);
			}
			return customRepo;
		}

		if (this.settings.authMode === 'auto_classic') {
			const sanitized = this.app.vault
				.getName()
				.toLowerCase()
				.replace(/[^a-z0-9-_]/g, '-')
				.replace(/-+/g, '-')
				.replace(/^-|-$/g, '');
			if (!sanitized || sanitized.length < 1) {
				throw new Error(
					'Vault name contains only special characters. Please set a custom repository name in settings.',
				);
			}
			const defaultRepo = `obsidian-${sanitized}`;
			await this.api.ensureRepoExists(defaultRepo);
			return defaultRepo;
		}

		throw new Error(
			'Repository name is missing. Please specify one in settings.',
		);
	}

	private isIgnored(path: string): boolean {
		const configDir = this.app.vault.configDir;
		if (path.startsWith(`${configDir}/`) || path.includes('.trash'))
			return true;

		for (const pattern of this.ignorePatterns) {
			if (pattern && path.includes(pattern)) return true;
		}
		return false;
	}

	private async loadIgnoreFile(): Promise<string[]> {
		const ignoreFile = `${this.app.vault.configDir}/.obsidian-sync-ignore`;
		try {
			const content = await this.app.vault.adapter.read(ignoreFile);
			return content
				.split('\n')
				.map((l) => l.trim())
				.filter((l) => l.length > 0 && !l.startsWith('#'));
		} catch {
			return [];
		}
	}

	async runSync(
		isAuto = false,
		onProgress?: (text: string) => void,
	): Promise<SyncResult> {
		this.ignorePatterns = await this.loadIgnoreFile();
		let retries = 3;
		while (retries > 0) {
			try {
				const skippedFiles: string[] = [];
				const repo = await this.getRepoName();
				const latestCommitSha = await this.api.getLatestCommitSha(repo);
				const remoteTree = await this.api.getTree(
					repo,
					latestCommitSha,
				);

				if (remoteTree.truncated) {
					throw new Error(
						'GitHub remote tree is truncated (exceeds 100k files). Exiting to prevent accidental data loss.',
					);
				}

				const remoteFiles = new Map<string, string>();
				const remoteSizes = new Map<string, number>();
				remoteTree.tree.forEach((item) => {
					if (item.type === 'blob') {
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
						let buffer = await this.app.vault.adapter.readBinary(
							file.path,
						);
						if (isTextFile(file.path)) {
							buffer = normalizeTextBuffer(buffer);
						}
						const sha = await calculateGitSha(buffer);
						localHashes.set(file.path, sha);
						this.settings.localHashCache[file.path] = {
							mtime,
							size,
							sha,
						};
					}
				}

				const localFilePaths = new Set(localFiles.map((f) => f.path));
				for (const path of Object.keys(this.settings.localHashCache)) {
					if (!localFilePaths.has(path)) {
						delete this.settings.localHashCache[path];
					}
				}

				let stateChanged = false;
				const isFirstSync =
					Object.keys(this.settings.lastSyncState).length === 0 &&
					remoteFiles.size > 0;

				if (isFirstSync) {
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

				const allPaths = new Set([
					...remoteFiles.keys(),
					...localHashes.keys(),
					...Object.keys(this.settings.lastSyncState),
				]);

				const localFileMap = new Map(
					localFiles.map((f) => [f.path, f]),
				);

				for (const path of allPaths) {
					const localFile = localFileMap.get(path);
					const remoteSize = remoteSizes.get(path) || 0;
					const isLocalTooLarge =
						localFile && localFile.stat.size > 25 * 1024 * 1024;
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

					if (localSha === remoteSha) continue;

					if (!localSha && remoteSha) {
						if (baseSha === remoteSha) {
							filesToDeleteRemotely.push(path);
						} else {
							filesToDownload.push(path);
						}
					} else if (localSha && !remoteSha) {
						if (baseSha === localSha) {
							filesToDeleteLocally.push(path);
						} else {
							filesToUpload.push(path);
						}
					} else if (localSha && remoteSha) {
						if (baseSha === localSha && remoteSha !== localSha) {
							filesToDownload.push(path);
						} else if (
							baseSha === remoteSha &&
							localSha !== remoteSha
						) {
							filesToUpload.push(path);
						} else if (!baseSha) {
							filesToDownload.push(path);
						} else {
							await this.promptConflictResolution(
								path,
								filesToUpload,
								filesToDownload,
							);
						}
					}
				}

				for (const path of filesToDeleteLocally) {
					const file = this.app.vault.getAbstractFileByPath(
						normalizePath(path),
					);
					if (file) {
						await this.app.fileManager.trashFile(file);
					}
					delete this.settings.lastSyncState[path];
					stateChanged = true;
				}

				const totalDownloads = filesToDownload.length;
				for (let i = 0; i < totalDownloads; i++) {
					const path = filesToDownload[i]!;
					onProgress?.(`Syncing... ${i + 1}/${totalDownloads}`);
					const buffer = await this.api.downloadBlob(
						repo,
						remoteFiles.get(path)!,
					);
					const normalizedPath = normalizePath(path);
					const existingFile =
						this.app.vault.getAbstractFileByPath(normalizedPath);
					if (existingFile) {
						await this.app.vault.adapter.writeBinary(
							normalizedPath,
							buffer,
						);
					} else {
						const folders = normalizedPath.split('/');
						folders.pop();
						if (folders.length > 0) {
							const dir = normalizePath(folders.join('/'));
							if (!(await this.app.vault.adapter.exists(dir)))
								await this.app.vault.adapter.mkdir(dir);
						}
						await this.app.vault.adapter.writeBinary(
							normalizedPath,
							buffer,
						);
					}
					this.settings.lastSyncState[path] = remoteFiles.get(path)!;
					stateChanged = true;
				}

				if (
					filesToUpload.length > 0 ||
					filesToDeleteRemotely.length > 0
				) {
					const treePayload: {
						path: string;
						mode: string;
						type: string;
						sha: string | null;
					}[] = [];

					const totalUploads = filesToUpload.length;
					for (let i = 0; i < totalUploads; i++) {
						const path = filesToUpload[i]!;
						onProgress?.(`Syncing... ${i + 1}/${totalUploads}`);
						let buffer =
							await this.app.vault.adapter.readBinary(path);
						if (isTextFile(path)) {
							buffer = normalizeTextBuffer(buffer);
						}
						const base64 = arrayBufferToBase64(buffer);
						const newBlobSha = await this.api.uploadBlob(
							repo,
							base64,
						);

						treePayload.push({
							path,
							mode: '100644',
							type: 'blob',
							sha: newBlobSha,
						});
						this.settings.lastSyncState[path] = newBlobSha;
						changedFileNames.push(path.split('/').pop()!);
						stateChanged = true;
					}

					for (const path of filesToDeleteRemotely) {
						treePayload.push({
							path,
							mode: '100644',
							type: 'blob',
							sha: null,
						});
						delete this.settings.lastSyncState[path];
						changedFileNames.push(
							`Deleted: ${path.split('/').pop()}`,
						);
						stateChanged = true;
					}

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

				if (
					!isAuto ||
					filesToDownload.length > 0 ||
					filesToUpload.length > 0 ||
					skippedFiles.length > 0
				) {
					let msg = `GitHub sync complete.\nUploaded: ${filesToUpload.length}\nDownloaded: ${filesToDownload.length}`;
					if (skippedFiles.length > 0) {
						msg += `\n⚠️ Skipped ${skippedFiles.length} file(s) exceeding 25MB limit.`;
					}
					new Notice(msg);
				}

				if (isFirstSync && filesToDownload.length > 0) {
					new Notice(
						`First sync: Downloaded ${filesToDownload.length} file(s) from remote (no prior sync state).`,
					);
				}

				return { stateChanged };
			} catch (error: unknown) {
				const message =
					error instanceof Error ? error.message : String(error);
				if (message.includes('422') && retries > 1) {
					retries--;
					await new Promise((resolve) =>
						window.setTimeout(resolve, 2000),
					);
					continue;
				}
				if (!isAuto || message.includes('rate limit')) {
					new Notice(`GitHub sync error: ${message}`);
				}
				throw error;
			}
		}
		return { stateChanged: false };
	}

	private async promptConflictResolution(
		path: string,
		filesToUpload: string[],
		filesToDownload: string[],
	): Promise<void> {
		return new Promise<void>((resolve) => {
			new ConflictModal(this.app, path, (choice) => {
				if (choice === 'local') {
					filesToUpload.push(path);
					resolve();
				} else if (choice === 'remote') {
					filesToDownload.push(path);
					resolve();
				} else if (choice === 'both') {
					const file = this.app.vault.getAbstractFileByPath(
						normalizePath(path),
					);
					if (file) {
						const extIndex = path.lastIndexOf('.');
						const base =
							extIndex !== -1 ? path.slice(0, extIndex) : path;
						const ext = extIndex !== -1 ? path.slice(extIndex) : '';
						const dateStr = moment().format('YYYY-MM-DD');
						const conflictPath = normalizePath(
							`${base} (Local Conflict ${dateStr})${ext}`,
						);
						void this.app.vault
							.rename(file, conflictPath)
							.then(() => {
								filesToDownload.push(path);
								resolve();
							})
							.catch(() => {
								new Notice(
									`Failed to rename conflict file: ${path}. Skipping download to preserve local changes.`,
								);
								resolve();
							});
					} else {
						filesToDownload.push(path);
						resolve();
					}
				}
			}).open();
		});
	}
}
