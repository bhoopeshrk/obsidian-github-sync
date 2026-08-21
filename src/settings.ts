import { App, PluginSettingTab, Setting, Platform, requestUrl, Notice } from "obsidian";
import type GitHubSyncPlugin from "./main";

export class GitHubSyncSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GitHubSyncPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Setup mode").addDropdown((d) =>
      d
        .addOption("auto_classic", "Automatic (Classic PAT)")
        .addOption("manual_fine_grained", "Manual (Fine-Grained PAT)")
        .setValue(this.plugin.settings.authMode)
        .onChange(async (v) => {
          this.plugin.settings.authMode = v as any;
          await this.plugin.saveSettings();
          this.display();
        }),
    );

    if (this.plugin.settings.authMode === "auto_classic") {
      new Setting(containerEl)
        .setName("Custom repository name (optional)")
        .setDesc(
          "Leave blank to auto-derive from vault name, or specify an existing repo to connect to.",
        )
        .addText((text) =>
          text
            .setPlaceholder(`obsidian-${this.app.vault.getName().toLowerCase()}`)
            .setValue(this.plugin.settings.customRepoName || "")
            .onChange(async (val) => {
              this.plugin.settings.customRepoName = val.trim();
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName("Personal access token")
      .setDesc("Token is stored securely in this vault.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.personalAccessToken).onChange(
          async (v) => {
            this.plugin.settings.personalAccessToken = v.trim();
            await this.plugin.saveSettings();
          },
        );
      });

    if (this.plugin.settings.authMode === "manual_fine_grained") {
      new Setting(containerEl)
        .setName("Target repository name")
        .setDesc("Existing GitHub repo name (e.g. my-vault)")
        .addText((t) =>
          t
            .setValue(this.plugin.settings.customRepoName)
            .onChange(async (v) => {
              this.plugin.settings.customRepoName = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    }

    containerEl.createEl("h3", { text: "Preferences" });

    new Setting(containerEl)
      .setName("Device hostname")
      .setDesc("Used in commit logs.")
      .addText((t) =>
        t.setValue(this.plugin.settings.hostname).onChange(async (v) => {
          this.plugin.settings.hostname = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("GitHub API URL")
      .setDesc("Default is https://api.github.com. Set custom URL for self-hosted GitHub Enterprise.")
      .addText((text) =>
        text
          .setPlaceholder("https://api.github.com")
          .setValue(this.plugin.settings.githubApiUrl || "https://api.github.com")
          .onChange(async (val) => {
            const trimmed = val.trim();
            if (trimmed !== "" && !trimmed.startsWith("https://")) {
              new Notice("Secure HTTPS protocol is required for custom hostnames.");
              return;
            }
            const testUrl = trimmed || "https://api.github.com";
            try {
              const res = await requestUrl({ url: testUrl, method: "HEAD" });
              if (trimmed !== "") {
                const hasSignature = res.headers["x-github-request-id"] || res.headers["server"]?.toLowerCase().includes("github");
                if (!hasSignature) {
                  new Notice("Warning: Custom server did not return official GitHub headers.");
                }
              }
            } catch (err) {
              new Notice("Warning: Failed to connect to the custom GitHub API URL.");
            }
            this.plugin.settings.githubApiUrl = trimmed || "https://api.github.com";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync frequency (minutes)")
      .setDesc("0 to disable auto-sync.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.syncFrequencyMinutes))
          .onChange(async (val) => {
            this.plugin.settings.syncFrequencyMinutes = Number(val) || 0;
            await this.plugin.saveSettings();
            this.plugin.setupScheduler();
          }),
      );
  }
}
