import { Plugin, Platform, Notice, moment } from 'obsidian';
import { DEFAULT_SETTINGS, GitHubSyncSettings } from './types';
import { GitHubSyncSettingTab } from './settings';
import { GitHubApiClient } from './github-api';
import { SyncEngine } from './sync-engine';

export default class GitHubSyncPlugin extends Plugin {
	settings!: GitHubSyncSettings;
	syncEngine!: SyncEngine;
	statusBarEl!: HTMLElement;
	private syncIntervalId: number | null = null;
	private lastSyncTime: number = 0;

	async onload() {
		await this.loadSettings();
		if (!this.settings.hostname) {
			this.settings.hostname = Platform.isDesktop ? 'Desktop' : Platform.isIosApp ? 'iOS' : 'Android';
			await this.saveSettings();
		}

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar('offline');

		this.addSettingTab(new GitHubSyncSettingTab(this.app, this));

		this.addRibbonIcon('git-compare', 'GitHub sync', () => void this.triggerSync());
		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.triggerSync() });

		this.app.workspace.onLayoutReady(() => {
			this.initEngine();
			if (this.settings.autoPullOnStartup && this.canSync()) void this.triggerSync(true);
			this.setupScheduler();
		});

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			if (!this.settings.autoSyncEnabled || this.settings.syncFrequencyMinutes === 0) return;
			const elapsed = Date.now() - this.lastSyncTime;
			const threshold = this.settings.syncFrequencyMinutes * 60 * 1000;
			if (elapsed > threshold && this.canSync()) {
				void this.triggerSync(true);
			}
		}));
	}

	initEngine() {
		const api = new GitHubApiClient(
			this.settings.personalAccessToken,
			this.settings.githubUsername,
			this.settings.githubApiUrl || 'https://api.github.com',
		);
		this.syncEngine = new SyncEngine(this.app, this.settings, api);
	}

	canSync(): boolean {
		return Boolean(this.settings.personalAccessToken && this.settings.githubUsername);
	}

	async triggerSync(isAuto = false) {
		if (isAuto && typeof navigator !== 'undefined' && !navigator.onLine) {
			this.updateStatusBar('offline');
			return;
		}
		if (!this.canSync()) {
			if (!isAuto) new Notice('GitHub sync: Please configure your token and username.');
			return;
		}
		this.updateStatusBar('syncing');
		try {
			if (!isAuto) new Notice('Syncing with GitHub...');
			await this.syncEngine.runSync(isAuto);
			this.lastSyncTime = Date.now();
			await this.saveSettings();
			this.updateStatusBar('idle');
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.updateStatusBar('error', message);
		}
	}

	updateStatusBar(status: 'idle' | 'syncing' | 'error' | 'offline', detail = '') {
		if (!this.statusBarEl) return;
		const dateStr = this.lastSyncTime > 0 ? moment(this.lastSyncTime).format('HH:mm:ss') : 'Never';

		switch (status) {
			case 'idle':
				this.statusBarEl.setText('☁️ synced');
				this.statusBarEl.title = `GitHub sync: Up to date.\nLast sync: ${dateStr}`;
				break;
			case 'syncing':
				this.statusBarEl.setText('🔄 Syncing...');
				this.statusBarEl.title = 'GitHub sync: Sync in progress...';
				break;
			case 'offline':
				this.statusBarEl.setText('💤 Offline');
				this.statusBarEl.title = 'GitHub sync: Device is offline. Sync suspended.';
				break;
			case 'error':
				this.statusBarEl.setText('⚠️ sync error');
				this.statusBarEl.title = `GitHub sync: Sync failed.\nError: ${detail}`;
				break;
		}
	}

	setupScheduler() {
		if (this.syncIntervalId) window.clearInterval(this.syncIntervalId);
		if (this.settings.syncFrequencyMinutes > 0) {
			this.syncIntervalId = window.setInterval(
				() => void this.triggerSync(true),
				this.settings.syncFrequencyMinutes * 60 * 1000,
			);
		}
	}

	onunload() {
		if (this.syncIntervalId) window.clearInterval(this.syncIntervalId);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<GitHubSyncSettings>);
		const tokenKey = 'obsidian-github-sync-token-' + this.app.vault.getName();
		const securedToken = this.app.loadLocalStorage(tokenKey) as string | null;
		if (securedToken) {
			this.settings.personalAccessToken = securedToken;
		} else if (this.settings.personalAccessToken) {
			this.app.saveLocalStorage(tokenKey, this.settings.personalAccessToken);
		}
	}

	async saveSettings() {
		const tokenKey = 'obsidian-github-sync-token-' + this.app.vault.getName();
		const token = this.settings.personalAccessToken;
		if (token) {
			this.app.saveLocalStorage(tokenKey, token);
		} else {
			this.app.saveLocalStorage(tokenKey, null);
		}

		const settingsCopy = { ...this.settings };
		delete (settingsCopy as Record<string, unknown>).personalAccessToken;

		await this.saveData(settingsCopy);
		this.initEngine();
	}
}
