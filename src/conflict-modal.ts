import { App, Modal, Setting, moment } from "obsidian";
import { ConflictInfo } from "./types";

export class ConflictModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private info: ConflictInfo,
    private resolve: (choice: "local" | "remote" | "both") => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const info = this.info;

    contentEl.createEl("h3", { text: "Sync conflict detected" });
    contentEl.createEl("p", {
      text: `Both you and GitHub modified: ${info.filePath}`,
    });

    const table = contentEl.createEl("table", {
      cls: "conflict-context-table",
    });
    const headerRow = table.createEl("tr");
    headerRow.createEl("th");
    headerRow.createEl("th", { text: "Local" });
    headerRow.createEl("th", { text: "Remote" });

    const sizeRow = table.createEl("tr");
    sizeRow.createEl("td", { text: "Size" });
    sizeRow.createEl("td", { text: `${info.localSize} bytes` });
    sizeRow.createEl("td", { text: `${info.remoteSize} bytes` });

    const linesRow = table.createEl("tr");
    linesRow.createEl("td", { text: "Lines" });
    linesRow.createEl("td", { text: String(info.localLines) });
    linesRow.createEl("td", { text: String(info.remoteLines) });

    const timeRow = table.createEl("tr");
    timeRow.createEl("td", { text: "Modified" });
    timeRow.createEl("td", {
      text: info.localTimestamp > 0 ? moment(info.localTimestamp).format("YYYY-MM-DD HH:mm") : "unknown",
    });
    timeRow.createEl("td", {
      text: info.remoteTimestamp > 0 ? moment(info.remoteTimestamp).format("YYYY-MM-DD HH:mm") : "unknown",
    });

    contentEl.createEl("p", { text: "Which version do you want to keep?" });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Keep local")
          .setIcon("monitor")
          .onClick(() => {
            this.resolved = true;
            this.resolve("local");
            this.close();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText("Keep remote")
          .setIcon("cloud")
          .onClick(() => {
            this.resolved = true;
            this.resolve("remote");
            this.close();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText("Keep both")
          .setIcon("copy")
          .setCta()
          .onClick(() => {
            this.resolved = true;
            this.resolve("both");
            this.close();
          }),
      );
  }

  onClose() {
    if (!this.resolved) {
      this.resolve("both");
    }
    this.contentEl.empty();
  }
}
