import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type GitHubSyncPlugin from "./main";

export class GitHubSyncSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: GitHubSyncPlugin,
	) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings(true);
		this.update();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "GitHub sync setup",
				items: [
					{
						name: "Setup mode",
						desc: "Choose how you want to manage repository creation and token security.",
						control: {
							type: "dropdown",
							key: "authMode",
							options: {
								auto_classic: "Automatic (auto-create private repos per vault)",
								manual_fine_grained: "Manual / high-security (scoped to specific repo)",
							},
						},
					},
					{
						name: "Classic authentication",
						visible: () => this.plugin.settings.authMode === "auto_classic",
						render: (setting) => {
							setting.setName("").setDesc("");
							this.renderClassicSection(setting.settingEl);
						},
					},
					{
						name: "Fine-grained authentication",
						visible: () => this.plugin.settings.authMode === "manual_fine_grained",
						render: (setting) => {
							setting.setName("").setDesc("");
							this.renderFineGrainedSection(setting.settingEl);
						},
					},
				],
			},
			{
				type: "group",
				heading: "Sync rules and scheduling",
				items: [
					{
						name: "Device hostname",
						desc: "Identifies this machine in commit logs (e.g. MacBook-Pro, Work-iPad).",
						control: {
							type: "text",
							key: "hostname",
							placeholder: "Desktop",
						},
					},
					{
						name: "Sync frequency (minutes)",
						desc: "Set to 0 to disable periodic background sync.",
						control: {
							type: "number",
							key: "syncFrequencyMinutes",
							min: 0,
							max: 1440,
							step: 1,
							placeholder: "15",
						},
					},
					{
						name: "Auto pull on startup",
						desc: "Pull remote changes when Obsidian starts.",
						control: {
							type: "toggle",
							key: "autoPullOnStartup",
						},
					},
					{
						name: "Auto sync enabled",
						desc: "Periodically commit and push local changes on a schedule.",
						control: {
							type: "toggle",
							key: "autoSyncEnabled",
						},
					},
					{
						name: "GitHub API URL",
						desc: "Default is https://api.github.com. Set a custom URL for self-hosted GitHub Enterprise.",
						control: {
							type: "text",
							key: "githubApiUrl",
							placeholder: "https://api.github.com",
						},
					},
				],
			},
		];
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
						await this.plugin.saveSettings(true);
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
						await this.plugin.saveSettings(true);
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
						await this.plugin.saveSettings(true);
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
						await this.plugin.saveSettings(true);
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
						await this.plugin.saveSettings(true);
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
						await this.plugin.saveSettings(true);
					});
			});
	}
}
