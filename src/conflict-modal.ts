import { App, Modal, Setting } from 'obsidian';

export class ConflictModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private filePath: string,
    private resolve: (choice: 'local' | 'remote' | 'both') => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Sync conflict detected' });
    contentEl.createEl('p', { text: `Both you and GitHub modified: ${this.filePath}` });

    new Setting(contentEl)
      .addButton(b => b.setButtonText('Keep local').onClick(() => { this.resolved = true; this.resolve('local'); this.close(); }))
      .addButton(b => b.setButtonText('Keep remote').onClick(() => { this.resolved = true; this.resolve('remote'); this.close(); }))
      .addButton(b => b.setButtonText('Keep both').setCta().onClick(() => { this.resolved = true; this.resolve('both'); this.close(); }));
  }

  onClose() {
    if (!this.resolved) {
      this.resolve('both');
    }
    this.contentEl.empty();
  }
}