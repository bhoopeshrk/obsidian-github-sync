import { App, Notice, moment, normalizePath, TFile } from 'obsidian';
import { GitHubApiClient } from './github-api';
import { GitHubSyncSettings, ConflictInfo } from './types';
import {
	calculateGitSha,
	arrayBufferToBase64,
	generateCommitMessage,
	isTextFile,
	normalizeTextBuffer,
	globToRegex,
} from './utils';
import { ConflictModal } from './conflict-modal';

export interface SyncResult {
	stateChanged: boolean;
	uploaded: number;
	downloaded: number;
	conflicts: number;
	skipped: number;
	duration: number;
}

export class SyncEngine {
	private ignoreRegexes: RegExp[] = [];

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

		for (const regex of this.ignoreRegexes) {
			if (regex.test(path)) return true;
		}
		return false;
	}

	private async loadIgnoreFile(): Promise<RegExp[]> {
		const ignoreFile = `${this.app.vault.configDir}/.obsidian-sync-ignore`;
		try {
			const content = await this.app.vault.adapter.read(ignoreFile);
			return content
				.split('\n')
				.map((l) => l.trim())
				.filter((l) => l.length > 0 && !l.startsWith('#'))
				.map((pattern) => globToRegex(pattern));
		} catch {
			return [];
		}
	}

	async runSync(
		isAuto = false,
		onProgress?: (text: string) => void,
	): Promise<SyncResult> {
		this.ignoreRegexes = await this.loadIgnoreFile();
		const startTime = Date.now();
		let retries = 3;
		while (retries > 0) {
			try {
				const skippedFiles: string[] = [];
				let conflicts = 0;
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
						let buffer = await this.app.vault.readBinary(file);
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

					if (localSha === remoteSha) {
						if (remoteSha && this.settings.lastSyncState[path] !== remoteSha) {
							this.settings.lastSyncState[path] = remoteSha;
							stateChanged = true;
						}
						continue;
					}

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
						} else {
							if (isAuto) {
								conflicts++;
								continue;
							}
							if (localFile) {
								const localContent = await this.app.vault.readBinary(localFile);
								const localLines = new TextDecoder().decode(localContent).split('\n').length;
								const conflictInfo: ConflictInfo = {
									filePath: path,
									localSize: localContent.byteLength,
									localLines,
									remoteSize,
									remoteLines: 0,
									localTimestamp: localFile.stat.mtime,
									remoteTimestamp: 0,
								};
								await this.promptConflictResolution(
									conflictInfo,
									filesToUpload,
									filesToDownload,
								);
								conflicts++;
							}
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
					if (existingFile instanceof TFile) {
						await this.app.vault.modifyBinary(
							existingFile,
							buffer,
						);
					} else {
						const folders = normalizedPath.split('/');
						folders.pop();
						if (folders.length > 0) {
							await this.ensureDirectoryExists(folders.join('/'));
						}
						await this.app.vault.createBinary(
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
						const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
						if (!(file instanceof TFile)) continue;
						let buffer = await this.app.vault.readBinary(file);
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
					const duration = ((Date.now() - startTime) / 1000).toFixed(1);
					const totalChanged = filesToDownload.length + filesToUpload.length;
					let msg = '';

					if (totalChanged <= 5 && totalChanged > 0) {
						msg = 'GitHub sync complete.\n';
						for (const p of filesToDownload) {
							msg += `\u2190 ${p.split('/').pop()}\n`;
						}
						for (const p of filesToUpload) {
							msg += `\u2192 ${p.split('/').pop()}\n`;
						}
						msg = msg.trimEnd();
					} else if (totalChanged > 5) {
						const noteCount = filesToDownload.concat(filesToUpload).filter((p) => p.endsWith('.md')).length;
						const imageCount = filesToDownload.concat(filesToUpload).filter((p) => /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(p)).length;
						const otherCount = totalChanged - noteCount - imageCount;
						const parts: string[] = [];
						if (noteCount > 0) parts.push(`${noteCount} note${noteCount > 1 ? 's' : ''}`);
						if (imageCount > 0) parts.push(`${imageCount} image${imageCount > 1 ? 's' : ''}`);
						if (otherCount > 0) parts.push(`${otherCount} other file${otherCount > 1 ? 's' : ''}`);
						msg = `GitHub sync complete. ${parts.join(', ')}`;
					} else {
						msg = 'GitHub sync complete. No changes.';
					}

					if (conflicts > 0) {
						msg += `\n\u26a0\ufe0f ${conflicts} conflict${conflicts > 1 ? 's' : ''} resolved.`;
					}
					if (skippedFiles.length > 0) {
						msg += `\n\u26a0\ufe0f Skipped ${skippedFiles.length} file(s) exceeding 25MB limit.`;
					}
					msg += `\n(in ${duration}s)`;
					new Notice(msg);
				}

				if (isFirstSync && filesToDownload.length > 0) {
					new Notice(
						`First sync: Downloaded ${filesToDownload.length} file(s) from remote (no prior sync state).`,
					);
				}

				return {
					stateChanged,
					uploaded: filesToUpload.length,
					downloaded: filesToDownload.length,
					conflicts,
					skipped: skippedFiles.length,
					duration: Date.now() - startTime,
				};
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
		return {
			stateChanged: false,
			uploaded: 0,
			downloaded: 0,
			conflicts: 0,
			skipped: 0,
			duration: Date.now() - startTime,
		};
	}

	private async promptConflictResolution(
		info: ConflictInfo,
		filesToUpload: string[],
		filesToDownload: string[],
	): Promise<void> {
		return new Promise<void>((resolve) => {
			new ConflictModal(this.app, info, (choice) => {
				if (choice === 'local') {
					filesToUpload.push(info.filePath);
					resolve();
				} else if (choice === 'remote') {
					filesToDownload.push(info.filePath);
					resolve();
				} else if (choice === 'both') {
					const file = this.app.vault.getAbstractFileByPath(
						normalizePath(info.filePath),
					);
					if (file) {
						const extIndex = info.filePath.lastIndexOf('.');
						const base =
							extIndex !== -1 ? info.filePath.slice(0, extIndex) : info.filePath;
						const ext = extIndex !== -1 ? info.filePath.slice(extIndex) : '';
						const dateStr = moment().format('YYYY-MM-DD');
						const conflictPath = normalizePath(
							`${base} (Local Conflict ${dateStr})${ext}`,
						);
						void this.app.vault
							.rename(file, conflictPath)
							.then(() => {
								filesToDownload.push(info.filePath);
								resolve();
							})
							.catch(() => {
								new Notice(
									`Failed to rename conflict file: ${info.filePath}. Skipping download to preserve local changes.`,
								);
								resolve();
							});
					} else {
						filesToDownload.push(info.filePath);
						resolve();
					}
				}
			}).open();
		});
	}

	private async ensureDirectoryExists(path: string): Promise<void> {
		const folders = path.split('/');
		let currentPath = '';
		for (const folder of folders) {
			if (currentPath) {
				currentPath = currentPath + '/' + folder;
			} else {
				currentPath = folder;
			}
			const normalized = normalizePath(currentPath);
			const abstractFile = this.app.vault.getAbstractFileByPath(normalized);
			if (!abstractFile) {
				try {
					await this.app.vault.createFolder(normalized);
				} catch {
					// Ignore error if it was created concurrently
				}
			}
		}
	}
}
