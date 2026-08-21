import { App, Modal, Setting } from 'obsidian';

export class ConflictModal extends Modal {
  constructor(
    app: App,
    private filePath: string,
    private resolve: (choice: 'local' | 'remote' | 'both') => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Sync Conflict Detected' });
    contentEl.createEl('p', { text: `Both you and GitHub modified: ${this.filePath}` });

    new Setting(contentEl)
      .addButton(b => b.setButtonText('Keep Local').onClick(() => { this.resolve('local'); this.close(); }))
      .addButton(b => b.setButtonText('Keep Remote').onClick(() => { this.resolve('remote'); this.close(); }))
      .addButton(b => b.setButtonText('Keep Both').setCta().onClick(() => { this.resolve('both'); this.close(); }));
  }

  onClose() {
    this.contentEl.empty();
  }
}