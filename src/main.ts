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

    // Manual Sync Commands
    this.addRibbonIcon('git-compare', 'GitHub Sync', () => this.triggerSync());
    this.addCommand({ id: 'sync-now', name: 'Sync Now', callback: () => this.triggerSync() });

    // Initialize Engine
    this.app.workspace.onLayoutReady(() => {
      this.initEngine();
      if (this.settings.autoPullOnStartup && this.canSync()) this.triggerSync(true);
      this.setupScheduler();
    });

    // Mobile Foreground Wakeup Handling
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      if (!this.settings.autoSyncEnabled || this.settings.syncFrequencyMinutes === 0) return;
      const elapsed = Date.now() - this.lastSyncTime;
      const threshold = this.settings.syncFrequencyMinutes * 60 * 1000;
      if (elapsed > threshold && this.canSync()) {
        this.triggerSync(true);
      }
    }));
  }

  initEngine() {
    const api = new GitHubApiClient(
      this.settings.personalAccessToken,
      this.settings.githubUsername,
      this.settings.githubApiUrl || 'https://api.github.com'
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
      if (!isAuto) new Notice('GitHub Sync: Please configure your token and username.');
      return;
    }
    this.updateStatusBar('syncing');
    try {
      if (!isAuto) new Notice('Syncing with GitHub...');
      await this.syncEngine.runSync(isAuto);
      this.lastSyncTime = Date.now();
      await this.saveSettings(); // Save updated hash baseline
      this.updateStatusBar('idle');
    } catch (error: any) {
      this.updateStatusBar('error', error.message);
    }
  }

  updateStatusBar(status: 'idle' | 'syncing' | 'error' | 'offline', detail = '') {
    if (!this.statusBarEl) return;
    const dateStr = this.lastSyncTime > 0 ? (moment as any)(this.lastSyncTime).format('HH:mm:ss') : 'Never';

    switch (status) {
      case 'idle':
        this.statusBarEl.setText('☁️ Synced');
        this.statusBarEl.title = `GitHub Sync: Up to date.\nLast Sync: ${dateStr}`;
        break;
      case 'syncing':
        this.statusBarEl.setText('🔄 Syncing...');
        this.statusBarEl.title = 'GitHub Sync: Sync in progress...';
        break;
      case 'offline':
        this.statusBarEl.setText('💤 Offline');
        this.statusBarEl.title = 'GitHub Sync: Device is offline. Sync suspended.';
        break;
      case 'error':
        this.statusBarEl.setText('⚠️ Sync Error');
        this.statusBarEl.title = `GitHub Sync: Sync failed.\nError: ${detail}`;
        break;
    }
  }

  setupScheduler() {
    if (this.syncIntervalId) window.clearInterval(this.syncIntervalId);
    if (this.settings.syncFrequencyMinutes > 0) {
      this.syncIntervalId = window.setInterval(
        () => this.triggerSync(true), 
        this.settings.syncFrequencyMinutes * 60 * 1000
      );
      this.registerInterval(this.syncIntervalId);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const tokenKey = 'obsidian-github-sync-token-' + this.app.vault.getName();
    // Retrieve token from localStorage, fallback to plaintext settings for migration
    const securedToken = localStorage.getItem(tokenKey);
    if (securedToken) {
      this.settings.personalAccessToken = securedToken;
    } else if (this.settings.personalAccessToken) {
      // Migrate existing token to localStorage
      localStorage.setItem(tokenKey, this.settings.personalAccessToken);
    }
  }

  async saveSettings() {
    const tokenKey = 'obsidian-github-sync-token-' + this.app.vault.getName();
    const token = this.settings.personalAccessToken;
    if (token) {
      localStorage.setItem(tokenKey, token);
    } else {
      localStorage.removeItem(tokenKey);
    }

    // Strip token from settings before serializing to data.json
    const settingsCopy = { ...this.settings };
    delete (settingsCopy as any).personalAccessToken;

    await this.saveData(settingsCopy);
    this.initEngine();
  }
}