import { App, PluginSettingTab, Setting, TextComponent, ButtonComponent, setIcon } from "obsidian";
import type GitHubSyncPlugin from "./main";
import { GitHubApiClient } from "./github-api";

export class GitHubSyncSettingTab extends PluginSettingTab {
	private ignorePatterns: string[] = [];
	private ignoreLoaded = false;
	private contentEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: GitHubSyncPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Remove previous wrapper — destroys all child DOM and their listeners
		if (this.contentEl) {
			this.contentEl.remove();
			this.contentEl = null;
		}

		this.contentEl = containerEl.createDiv({ cls: "ghs-settings-content" });
		this.ignoreLoaded = false;

		this.renderAuthentication(this.contentEl);
		this.renderSyncSchedule(this.contentEl);
		this.renderAdvanced(this.contentEl);
	}

	// ─── Authentication ───────────────────────────────────────

	private renderAuthentication(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Authentication").setHeading();

		new Setting(containerEl)
			.setName("Setup mode")
			.setDesc("Choose how you want to manage repository creation and token security.")
			.addDropdown((d) =>
				d
					.addOption("auto_classic", "Automatic (recommended)")
					.addOption("manual_fine_grained", "Manual / high-security")
					.setValue(this.plugin.settings.authMode)
					.onChange(async (v: string) => {
						this.plugin.settings.authMode = v as "auto_classic" | "manual_fine_grained";
						await this.plugin.saveSettings(true);
						this.plugin.reinitEngine();
						this.display();
					}),
			);

		if (this.plugin.settings.authMode === "auto_classic") {
			this.renderClassicSection(containerEl);
		} else {
			this.renderFineGrainedSection(containerEl);
		}
	}

	private renderClassicSection(containerEl: HTMLElement): void {
		const callout = containerEl.createDiv({ cls: "ghs-auth-callout" });
		const titleEl = callout.createDiv({ cls: "ghs-auth-callout-title" });
		const iconSpan = titleEl.createSpan({ cls: "ghs-auth-callout-icon" });
		setIcon(iconSpan, "info");
		titleEl.createEl("strong", { text: " Automatic multi-vault mode:" });
		const list = callout.createEl("ul");
		list.createEl("li", { text: "Creates a private repo matching your vault name automatically." });
		const tokenLi = list.createEl("li");
		tokenLi.appendText("Requires a ");
		tokenLi.createEl("strong", { text: "classic PAT" });
		tokenLi.appendText(" with the ");
		tokenLi.createEl("code", { text: "repo" });
		tokenLi.appendText(" scope.");
		const linkLi = list.createEl("li");
		linkLi.createEl("a", {
			text: "Generate a pre-configured classic token",
			attr: { href: "https://github.com/settings/tokens/new?scopes=repo&description=Obsidian%20Sync%20Auto", target: "_blank" },
		});

		new Setting(containerEl)
			.setName("GitHub username")
			.addText((t: TextComponent) => {
				t.setPlaceholder("octocat")
					.setValue(this.plugin.settings.githubUsername)
					.onChange(async (v: string) => {
						const val = v.trim();
						if (val !== v || v.includes(" ")) {
							t.inputEl.addClass("ghs-input-invalid");
						} else {
							t.inputEl.removeClass("ghs-input-invalid");
						}
						this.plugin.settings.githubUsername = val;
						await this.plugin.saveSettings(true);
						this.plugin.reinitEngine();
					});
				const initialVal = this.plugin.settings.githubUsername;
				if (initialVal.includes(" ")) t.inputEl.addClass("ghs-input-invalid");
			});

		this.addTokenSetting(containerEl, "classic");

		new Setting(containerEl)
			.setName("Custom repository name (optional)")
			.setDesc("Leave blank to auto-derive from vault name, or specify an existing repo to connect to.")
			.addText((text: TextComponent) => {
				text.setPlaceholder(`obsidian-${this.app.vault.getName().toLowerCase()}`)
					.setValue(this.plugin.settings.customRepoName || "")
					.onChange(async (val: string) => {
						const trimmed = val.trim();
						if (trimmed !== val || val.includes(" ")) {
							text.inputEl.addClass("ghs-input-invalid");
						} else {
							text.inputEl.removeClass("ghs-input-invalid");
						}
						this.plugin.settings.customRepoName = trimmed;
						await this.plugin.saveSettings(true);
					});
				const initialVal = this.plugin.settings.customRepoName || "";
				if (initialVal.includes(" ")) text.inputEl.addClass("ghs-input-invalid");
			});

		this.addTestConnectionSetting(containerEl);
	}

	private renderFineGrainedSection(containerEl: HTMLElement): void {
		const callout = containerEl.createDiv({ cls: "ghs-auth-callout" });
		const titleEl = callout.createDiv({ cls: "ghs-auth-callout-title" });
		const iconSpan = titleEl.createSpan({ cls: "ghs-auth-callout-icon" });
		setIcon(iconSpan, "shield");
		titleEl.createEl("strong", { text: " Scoped security mode:" });
		const list = callout.createEl("ul");
		const step1 = list.createEl("li");
		step1.createEl("a", {
			text: "Create an empty private repository",
			attr: { href: "https://github.com/new", target: "_blank" },
		});
		step1.appendText(" on GitHub first.");
		const step2 = list.createEl("li");
		step2.createEl("a", {
			text: "Generate a fine-grained token",
			attr: { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank" },
		});
		step2.appendText(" scoped only to that repo with ");
		step2.createEl("strong", { text: "Contents: Read & Write" });
		step2.appendText(" permissions.");

		new Setting(containerEl)
			.setName("GitHub username")
			.addText((t: TextComponent) => {
				t.setPlaceholder("octocat")
					.setValue(this.plugin.settings.githubUsername)
					.onChange(async (v: string) => {
						const val = v.trim();
						if (val !== v || v.includes(" ")) {
							t.inputEl.addClass("ghs-input-invalid");
						} else {
							t.inputEl.removeClass("ghs-input-invalid");
						}
						this.plugin.settings.githubUsername = val;
						await this.plugin.saveSettings(true);
						this.plugin.reinitEngine();
					});
				const initialVal = this.plugin.settings.githubUsername;
				if (initialVal.includes(" ")) t.inputEl.addClass("ghs-input-invalid");
			});

		new Setting(containerEl)
			.setName("Target repository name")
			.setDesc("The exact name of the existing GitHub repository.")
			.addText((t: TextComponent) => {
				t.setPlaceholder("my-obsidian-vault")
					.setValue(this.plugin.settings.customRepoName || "")
					.onChange(async (v: string) => {
						const val = v.trim();
						if (val !== v || v.includes(" ")) {
							t.inputEl.addClass("ghs-input-invalid");
						} else {
							t.inputEl.removeClass("ghs-input-invalid");
						}
						this.plugin.settings.customRepoName = val;
						await this.plugin.saveSettings(true);
					});
				const initialVal = this.plugin.settings.customRepoName || "";
				if (initialVal.includes(" ")) t.inputEl.addClass("ghs-input-invalid");
			});

		this.addTokenSetting(containerEl, "fine-grained");
		this.addTestConnectionSetting(containerEl);
	}

	private addTokenSetting(containerEl: HTMLElement, mode: "classic" | "fine-grained"): void {
		const label = mode === "classic" ? "Personal access token (classic)" : "Personal access token (fine-grained)";
		const placeholder = mode === "classic" ? "ghp_xxxxxxxxxxxx" : "github_pat_xxxxxxxxxxxx";
		const desc = mode === "classic" ? "Begins with ghp_..." : "Begins with github_pat_...";

		const setting = new Setting(containerEl)
			.setName(label)
			.setDesc(desc);
		setting.settingEl.addClass("ghs-token-setting");

		const securedBadge = setting.nameEl.createSpan({ cls: "ghs-secured-badge" });
		setIcon(securedBadge, "lock");
		securedBadge.createSpan({ text: " LocalStorage" });

		setting.addText((t: TextComponent) => {
			t.inputEl.type = "password";
			t.inputEl.addClass("ghs-token-input");
			t.setPlaceholder(placeholder)
				.setValue(this.plugin.settings.personalAccessToken)
				.onChange(async (v: string) => {
					const val = v.trim();
					if (val !== v || v.includes(" ")) {
						t.inputEl.addClass("ghs-input-invalid");
					} else {
						t.inputEl.removeClass("ghs-input-invalid");
					}
					this.plugin.settings.personalAccessToken = val;
					await this.plugin.saveSettings(true);
					this.plugin.reinitEngine();
				});
			const initialVal = this.plugin.settings.personalAccessToken || "";
			if (initialVal.includes(" ")) t.inputEl.addClass("ghs-input-invalid");
		});

		let showToken = false;

		setting.addButton((b: ButtonComponent) => {
			b.setIcon("eye-off")
				.setTooltip("Show token")
				.onClick(() => {
					showToken = !showToken;
					const textInput = setting.settingEl.querySelector(".ghs-token-input");
					if (textInput instanceof HTMLInputElement) {
						textInput.type = showToken ? "text" : "password";
					}
					b.setIcon(showToken ? "eye" : "eye-off");
					b.setTooltip(showToken ? "Hide token" : "Show token");
				});
		});
	}

	// ─── Sync Schedule ────────────────────────────────────────

	private renderSyncSchedule(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Sync schedule").setHeading();

		new Setting(containerEl)
			.setName("Auto pull on startup")
			.setDesc("Pull remote changes when Obsidian starts.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoPullOnStartup)
					.onChange(async (v: boolean) => {
						this.plugin.settings.autoPullOnStartup = v;
						await this.plugin.saveSettings(true);
					}),
			);

		new Setting(containerEl)
			.setName("Auto sync enabled")
			.setDesc("Periodically commit and push local changes on a schedule.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoSyncEnabled)
					.onChange(async (v: boolean) => {
						this.plugin.settings.autoSyncEnabled = v;
						await this.plugin.saveSettings(true);
					}),
			);

		new Setting(containerEl)
			.setName("Sync frequency")
			.setDesc("How often to sync in the background.")
			.addDropdown((d) => {
				const current = this.plugin.settings.syncFrequencyMinutes;
				const options: Record<string, string> = {
					"0": "Disabled",
					"1": "Every 1 minute",
					"5": "Every 5 minutes",
					"15": "Every 15 minutes",
					"30": "Every 30 minutes",
					"60": "Every 1 hour",
					"720": "Every 12 hours",
					"1440": "Every 24 hours"
				};
				if (current !== undefined && !(String(current) in options)) {
					options[String(current)] = `Every ${current} minutes`;
				}
				for (const [val, label] of Object.entries(options)) {
					d.addOption(val, label);
				}
				d.setValue(String(current))
					.onChange(async (v: string) => {
						const num = parseInt(v, 10);
						this.plugin.settings.syncFrequencyMinutes = isNaN(num) ? 0 : num;
						await this.plugin.saveSettings(true);
						this.plugin.restartScheduler();
					});
			});
	}

	// ─── Advanced ─────────────────────────────────────────────

	private renderAdvanced(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Device hostname")
			.setDesc("Identifies this machine in commit logs (e.g. MacBook-Pro, Work-iPad).")
			.addText((t: TextComponent) =>
				t
					.setPlaceholder("Desktop")
					.setValue(this.plugin.settings.hostname)
					.onChange(async (v: string) => {
						this.plugin.settings.hostname = v.trim();
						await this.plugin.saveSettings(true);
					}),
			);

		new Setting(containerEl)
			.setName("GitHub API URL")
			.setDesc("Default is https://api.github.com. Set a custom URL for self-hosted GitHub Enterprise.")
			.addText((t: TextComponent) =>
				t
					.setPlaceholder("https://api.github.com")
					.setValue(this.plugin.settings.githubApiUrl)
					.onChange(async (v: string) => {
						this.plugin.settings.githubApiUrl = v.trim();
						await this.plugin.saveSettings(true);
					}),
			);

		new Setting(containerEl).setName("Ignored patterns").setHeading();
		containerEl.createEl("p", {
			text: "Files matching these patterns won't be synced.",
			cls: "setting-item-description",
		});
		this.renderIgnorePatterns(containerEl);
	}

	// ─── Ignore Patterns ──────────────────────────────────────

	private async loadIgnorePatterns(): Promise<void> {
		const ignoreFile = `${this.app.vault.configDir}/.obsidian-sync-ignore`;
		try {
			const content = await this.app.vault.adapter.read(ignoreFile);
			this.ignorePatterns = content
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0);
		} catch {
			this.ignorePatterns = [];
		}
		this.ignoreLoaded = true;
	}

	private async saveIgnorePatterns(): Promise<void> {
		const ignoreFile = `${this.app.vault.configDir}/.obsidian-sync-ignore`;
		await this.app.vault.adapter.write(ignoreFile, this.ignorePatterns.join("\n"));
	}

	private renderIgnorePatterns(containerEl: HTMLElement): void {
		if (!this.ignoreLoaded) {
			void this.loadIgnorePatterns().then(() => this.renderIgnorePatterns(containerEl));
			return;
		}

		const patterns = this.ignorePatterns.filter((p) => !p.startsWith("#") && p.length > 0);

		const listDiv = containerEl.createDiv({ cls: "ghs-tag-container" });

		if (patterns.length === 0) {
			listDiv.createDiv({ text: "No ignore patterns configured.", cls: "ghs-ignore-empty" });
		} else {
			for (const pattern of patterns) {
				const tag = listDiv.createDiv({ cls: "ghs-tag" });
				tag.createSpan({ text: pattern, cls: "ghs-tag-label" });
				const removeBtn = tag.createSpan({ cls: "ghs-tag-remove" });
				setIcon(removeBtn, "x");
				removeBtn.addEventListener("click", (e) => {
					e.preventDefault();
					void (async () => {
						const idx = this.ignorePatterns.indexOf(pattern);
						if (idx !== -1) this.ignorePatterns.splice(idx, 1);
						await this.saveIgnorePatterns();
						listDiv.remove();
						addDiv.remove();
						this.renderIgnorePatterns(containerEl);
					})();
				});
			}
		}

		const addDiv = containerEl.createDiv({ cls: "ghs-ignore-input-row" });
		const addInput = addDiv.createEl("input", {
			type: "text",
			cls: "ghs-ignore-input",
			attr: { placeholder: "New pattern (e.g. *.log)" },
		});
		const addBtn = addDiv.createEl("button", { cls: "mod-cta" });
		setIcon(addBtn, "plus");
		addBtn.createSpan({ text: " Add" });
		addBtn.addEventListener("click", () => {
			void (async () => {
				const val = addInput.value.trim();
				if (val.length > 0 && !this.ignorePatterns.includes(val)) {
					this.ignorePatterns.push(val);
					await this.saveIgnorePatterns();
					listDiv.remove();
					addDiv.remove();
					this.renderIgnorePatterns(containerEl);
				}
			})();
		});
	}

	private addTestConnectionSetting(containerEl: HTMLElement): void {
		const testSetting = new Setting(containerEl)
			.setName("Connection test")
			.setDesc("Verify credentials and connection with GitHub API.");
		
		let statusSpan: HTMLSpanElement | null = null;
		
		testSetting.addButton((b) => {
			b.setButtonText("Test connection")
				.onClick(async () => {
					b.setDisabled(true);
					if (statusSpan) {
						statusSpan.remove();
					}
					statusSpan = testSetting.settingEl.createSpan({ cls: "ghs-test-status ghs-test-status-loading" });
					setIcon(statusSpan, "refresh-cw");
					statusSpan.createSpan({ text: " Testing..." });
					
					// Resolve target repo name
					const repoName = this.plugin.settings.customRepoName || 
						(this.plugin.settings.authMode === 'auto_classic' 
							? `obsidian-${this.app.vault.getName().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}` 
							: '');

					const api = new GitHubApiClient(
						this.plugin.settings.personalAccessToken,
						this.plugin.settings.githubUsername,
						this.plugin.settings.githubApiUrl || 'https://api.github.com'
					);
					
					const result = await api.testConnection(repoName);
					
					statusSpan.remove();
					if (result.success) {
						statusSpan = testSetting.settingEl.createSpan({ cls: "ghs-test-status ghs-test-status-success" });
						setIcon(statusSpan, "check-circle");
						statusSpan.createSpan({ text: ` ${result.message}` });
					} else {
						statusSpan = testSetting.settingEl.createSpan({ cls: "ghs-test-status ghs-test-status-error" });
						setIcon(statusSpan, "alert-triangle");
						statusSpan.createSpan({ text: ` Failed: ${result.message}` });
					}
					b.setDisabled(false);
				});
		});
	}
}
