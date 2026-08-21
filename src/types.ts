export type AuthMode = 'auto_classic' | 'manual_fine_grained';

export interface LocalHashCacheItem {
  mtime: number;
  size: number;
  sha: string;
}

export interface GitHubSyncSettings {
  authMode: AuthMode;
  githubUsername: string;
  personalAccessToken: string;
  customRepoName: string;
  hostname: string;
  dateTimeFormat: string;
  syncFrequencyMinutes: number;
  autoPullOnStartup: boolean;
  autoSyncEnabled: boolean;
  lastSyncState: Record<string, string>; // Maps filePath to last synced Git SHA
  localHashCache?: Record<string, LocalHashCacheItem>;
  githubApiUrl: string;
}

export const DEFAULT_SETTINGS: GitHubSyncSettings = {
  authMode: 'auto_classic',
  githubUsername: '',
  personalAccessToken: '',
  customRepoName: '',
  hostname: '',
  dateTimeFormat: 'YYYY-MM-DD HH:mm:ss',
  syncFrequencyMinutes: 15,
  autoPullOnStartup: true,
  autoSyncEnabled: true,
  lastSyncState: {},
  localHashCache: {},
  githubApiUrl: 'https://api.github.com',
};