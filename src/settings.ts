import { App, PluginSettingTab, Setting } from "obsidian";
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

		new Setting(containerEl).setName("GitHub sync setup").setHeading();

		new Setting(containerEl)
			.setName("Setup mode")
			.setDesc("Choose how you want to manage repository creation and token security.")
			.addDropdown((d) =>
				d
					.addOption("auto_classic", "Automatic (auto-create private repos per vault)")
					.addOption("manual_fine_grained", "Manual / high-security (scoped to specific repo)")
					.setValue(this.plugin.settings.authMode)
					.onChange(async (v) => {
						this.plugin.settings.authMode = v as "auto_classic" | "manual_fine_grained";
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.authMode === "auto_classic") {
			this.renderClassicSection(containerEl);
		} else {
			this.renderFineGrainedSection(containerEl);
		}

		this.renderGeneralSettings(containerEl);
	}

	private renderClassicSection(containerEl: HTMLElement): void {
		const callout = containerEl.createDiv({ cls: "setting-item-description" });
		const strong = callout.createEl("strong");
		strong.textContent = "Automatic multi-vault mode:";
		callout.createEl("br");
		callout.createEl("br");
		callout.appendText("\u2022 Creates a private repo matching your vault name automatically.");
		callout.createEl("br");
		callout.appendText("\u2022 Requires a ");
		const patStrong = callout.createEl("strong");
		patStrong.textContent = "classic PAT";
		callout.appendText(" with the ");
		const code = callout.createEl("code");
		code.textContent = "repo";
		callout.appendText(" scope.");
		callout.createEl("br");
		callout.createEl("a", {
			text: "Click here to generate a pre-configured classic token",
			attr: { href: "https://github.com/settings/tokens/new?scopes=repo&description=Obsidian%20Sync%20Auto", target: "_blank" },
		});

		new Setting(containerEl)
			.setName("GitHub username")
			.addText((t) =>
				t
					.setPlaceholder("octocat")
					.setValue(this.plugin.settings.githubUsername)
					.onChange(async (v) => {
						this.plugin.settings.githubUsername = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Personal access token (classic)")
			.setDesc("Begins with ghp_...")
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder("ghp_xxxxxxxxxxxx")
					.setValue(this.plugin.settings.personalAccessToken)
					.onChange(async (v) => {
						this.plugin.settings.personalAccessToken = v.trim();
						await this.plugin.saveSettings();
					});
			});

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

	private renderFineGrainedSection(containerEl: HTMLElement): void {
		const callout = containerEl.createDiv({ cls: "setting-item-description" });
		const strong = callout.createEl("strong");
		strong.textContent = "Scoped security mode:";
		callout.createEl("br");
		callout.createEl("br");
		callout.appendText("1. ");
		callout.createEl("a", {
			text: "Create an empty private repository",
			attr: { href: "https://github.com/new", target: "_blank" },
		});
		callout.appendText(" on GitHub first.");
		callout.createEl("br");
		callout.appendText("2. ");
		callout.createEl("a", {
			text: "Generate a fine-grained token",
			attr: { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank" },
		});
		callout.appendText(" scoped only to that repo with ");
		const permStrong = callout.createEl("strong");
		permStrong.textContent = "Contents: Read & Write";
		callout.appendText(" permissions.");

		new Setting(containerEl)
			.setName("GitHub username")
			.addText((t) =>
				t
					.setPlaceholder("octocat")
					.setValue(this.plugin.settings.githubUsername)
					.onChange(async (v) => {
						this.plugin.settings.githubUsername = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Target repository name")
			.setDesc("The exact name of the existing GitHub repository.")
			.addText((t) =>
				t
					.setPlaceholder("my-obsidian-vault")
					.setValue(this.plugin.settings.customRepoName || "")
					.onChange(async (v) => {
						this.plugin.settings.customRepoName = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Personal access token (fine-grained)")
			.setDesc("Begins with github_pat_...")
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder("github_pat_xxxxxxxxxxxx")
					.setValue(this.plugin.settings.personalAccessToken)
					.onChange(async (v) => {
						this.plugin.settings.personalAccessToken = v.trim();
						await this.plugin.saveSettings();
					});
			});
	}

	private renderGeneralSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Sync rules and scheduling").setHeading();

		new Setting(containerEl)
			.setName("Device hostname")
			.setDesc("Identifies this machine in commit logs (e.g. MacBook-Pro, Work-iPad).")
			.addText((t) =>
				t
					.setPlaceholder("Desktop")
					.setValue(this.plugin.settings.hostname)
					.onChange(async (v) => {
						this.plugin.settings.hostname = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync frequency (minutes)")
			.setDesc("Set to 0 to disable periodic background sync.")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.syncFrequencyMinutes))
					.onChange(async (val) => {
						this.plugin.settings.syncFrequencyMinutes = Number(val) || 0;
						await this.plugin.saveSettings();
						this.plugin.setupScheduler();
					}),
			);

		new Setting(containerEl)
			.setName("Auto pull on startup")
			.setDesc("Pull remote changes when Obsidian starts.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoPullOnStartup)
					.onChange(async (v) => {
						this.plugin.settings.autoPullOnStartup = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto sync enabled")
			.setDesc("Periodically commit and push local changes on a schedule.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoSyncEnabled)
					.onChange(async (v) => {
						this.plugin.settings.autoSyncEnabled = v;
						await this.plugin.saveSettings();
						this.plugin.setupScheduler();
					}),
			);

		new Setting(containerEl)
			.setName("GitHub API URL")
			.setDesc("Default is https://api.github.com. Set a custom URL for self-hosted GitHub Enterprise.")
			.addText((text) =>
				text
					.setPlaceholder("https://api.github.com")
					.setValue(this.plugin.settings.githubApiUrl || "https://api.github.com")
					.onChange(async (val) => {
						this.plugin.settings.githubApiUrl = val.trim() || "https://api.github.com";
						await this.plugin.saveSettings();
					}),
			);
	}
}
