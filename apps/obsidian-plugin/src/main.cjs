const {Plugin, Modal, Notice} = require('obsidian');
const {createHash} = require('node:crypto');
const {createObsidianVaultPort} = require('@personal-agent/knowledge/obsidian');

function element(parent, tag, text) {
  const el = parent.ownerDocument.createElement(tag);
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el); return el;
}

class KnowledgeModal extends Modal {
  constructor(plugin, select) {super(plugin.app); this.plugin = plugin; this.select = select; this.request = new AbortController();}
  onOpen() {
    const body = this.contentEl;
    element(body, 'h2', this.select ? '连接本机知识库文件夹' : '本机知识检索');
    element(body, 'p', this.select ? '输入当前 Vault 内的文件夹。输入 / 明确选择整个 Vault。仅本机只读，关闭插件即撤销。'
      : '检索摘录仅在内存中显示；不会保存长期记忆或发送云端。');
    const input = element(body, 'input'); input.setAttribute('aria-label', this.select ? '允许的文件夹' : '检索词');
    const button = element(body, 'button', this.select ? '确认连接' : '检索');
    const output = element(body, 'div'); output.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      button.disabled = true; output.replaceChildren();
      try {
        if (this.select) {this.plugin.connect(input.value.trim()); this.close(); return;}
        const binding = this.plugin.port;
        if (!binding) throw Error('请先连接文件夹');
        const result = await binding.search({query: input.value, limit: 20,
          deadline: new Date(Date.now() + 30000).toISOString(), signal: this.request.signal});
        if (this.request.signal.aborted || binding !== this.plugin.port) return;
        if (!result.hits.length) element(output, 'p', '没有匹配内容');
        for (const hit of result.hits) {
          element(output, 'p', hit.excerpt);
          const open = element(output, 'button', `${hit.source.path}:${hit.source.line}`);
          open.addEventListener('click', async () => {
            try {await this.plugin.openCitation(hit.source, this.request.signal);} catch {new Notice('引用已变化或不可用，请重新检索');}
          });
        }
        if (result.truncated) element(output, 'p', '只显示前 20 条，请缩小检索范围');
      } catch {if (!this.request.signal.aborted) element(output, 'p', '未能完成：请检查文件夹、检索词、文件大小或重新连接');}
      finally {button.disabled = false;}
    });
  }
  onClose() {this.request.abort(); this.contentEl.replaceChildren(); this.plugin.modals.delete(this);}
}

module.exports = class PersonalAgentKnowledge extends Plugin {
  async onload() {
    this.port = undefined; this.modals = new Set(); this.closed = false;
    this.addCommand({id: 'connect-folder', name: '连接本机文件夹', callback: () => this.show(true)});
    this.addCommand({id: 'search-local', name: '检索本机知识库', callback: () => this.show(false)});
    this.addCommand({id: 'clear-index', name: '清除本机临时索引', callback: () => {this.port?.clearIndex(); new Notice('临时索引已清除');}});
    this.addCommand({id: 'disconnect-folder', name: '撤销知识库连接', callback: () => this.disconnect()});
    for (const event of ['modify', 'rename', 'delete', 'create']) {
      this.registerEvent(this.app.vault.on(event, () => this.port?.clearIndex()));
    }
  }
  show(select) {
    if (this.closed) return;
    if (!select && !this.port) {new Notice('请先运行“连接本机文件夹”'); return;}
    const modal = new KnowledgeModal(this, select); this.modals.add(modal); modal.open();
  }
  connect(folder) {
    if (this.closed) throw Error('插件已关闭');
    const port = createObsidianVaultPort({vaultId: createHash('sha256').update(this.app.vault.getName()).digest('hex'),
      allowedFolder: folder, vault: this.app.vault});
    if (folder !== '/' && !this.app.vault.getAbstractFileByPath(folder)?.children) throw Error('文件夹不存在');
    this.disconnect(); this.port = port;
  }
  disconnect() {
    for (const modal of [...this.modals]) modal.close();
    this.port?.clearIndex(); this.port = undefined;
  }
  async openCitation(source, signal) {
    const port = this.port;
    if (!port || this.closed || signal.aborted) throw Error('连接已撤销');
    await port.readCitation({source, signal, deadline: new Date(Date.now() + 10000).toISOString()});
    if (this.closed || signal.aborted || port !== this.port) throw Error('连接已撤销');
    const file = this.app.vault.getAbstractFileByPath(source.path);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    if (this.closed || signal.aborted || port !== this.port) return;
    leaf.view?.editor?.setCursor({line: source.line - 1, ch: 0});
  }
  onunload() {this.closed = true; this.disconnect();}
};
