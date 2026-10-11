const {Plugin, Modal, Notice} = require('obsidian');
const {createHash} = require('node:crypto');
const {createObsidianVaultPort} = require('@personal-agent/knowledge/obsidian');
const {createObsidianPairingPeer, localVaultPairingIdentity} = require('@personal-agent/knowledge/pairing');
const {createObsidianBridgeOffer} = require('@personal-agent/knowledge/bridge');

function element(parent, tag, text) {
  const el = parent.ownerDocument.createElement(tag);
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el); return el;
}

class PairingModal extends Modal {
  constructor(plugin, offer) {super(plugin.app); this.plugin = plugin; this.offer = offer;}
  onOpen() {
    element(this.contentEl, 'h2', '配对 Desktop Runtime');
    element(this.contentEl, 'p', '在 Desktop 管理后台选择同一个 Vault 并启用，然后点击“配对 Obsidian”。配对码仅本机、单次使用，2 分钟失效；会话只读、私人，最多 15 分钟。');
    const input = element(this.contentEl, 'input'); input.type = 'password'; input.readOnly = true;
    input.autocomplete = 'off'; input.setAttribute('aria-label', '一次性配对码'); input.value = this.offer.code;
    const copy = element(this.contentEl, 'button', '复制一次性配对码');
    copy.addEventListener('click', async () => {
      try {await navigator.clipboard.writeText(input.value); new Notice('已复制，请粘贴到 Desktop 专用配对窗口；勿发送聊天或云端');}
      catch {new Notice('复制失败，可选中配对码复制');}
    });
    const status = element(this.contentEl, 'p'); status.setAttribute('role', 'status');
    const revoke = element(this.contentEl, 'button', '撤销配对');
    revoke.addEventListener('click', () => {this.plugin.revokeRuntimePairing(); this.close();});
    this.timer = setInterval(() => {
      if (this.offer.connected() || this.offer.signal.aborted) {
        input.value = ''; this.offer.code = ''; copy.disabled = true;
        status.textContent = this.offer.signal.aborted ? '配对已撤销或失效，请重新生成' : '连接已认证，请在 Desktop 完成原生确认';
      } else status.textContent = `配对码将在 ${Math.max(0, Math.ceil((this.offer.expiresAt - Date.now()) / 1000))} 秒后失效`;
    }, 250);
  }
  onClose() {clearInterval(this.timer); this.offer.code = ''; this.contentEl.replaceChildren(); this.plugin.modals.delete(this);}
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
    this.port = undefined; this.modals = new Set(); this.peers = new Set(); this.closed = false;
    this.addCommand({id: 'connect-folder', name: '连接本机文件夹', callback: () => this.show(true)});
    this.addCommand({id: 'search-local', name: '检索本机知识库', callback: () => this.show(false)});
    this.addCommand({id: 'clear-index', name: '清除本机临时索引', callback: () => {this.port?.clearIndex(); new Notice('临时索引已清除');}});
    this.addCommand({id: 'disconnect-folder', name: '撤销知识库连接', callback: () => this.disconnect()});
    this.addCommand({id: 'pair-runtime', name: '配对 Desktop Runtime', callback: () => {void this.pairRuntime();}});
    this.addCommand({id: 'revoke-runtime', name: '撤销 Desktop 配对', callback: () => this.revokeRuntimePairing()});
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
    this.disconnect(); this.port = port; this.folder = folder;
  }
  /** Trusted bridge composition only. A peer offer never grants Runtime tool permission. */
  createRuntimePairingPeer() {
    this.revokeRuntimePairing();
    const port = this.port;
    if (!port || this.closed) throw Error('请先连接本机文件夹');
    const root = this.app.vault.adapter.getBasePath(), vaultIdentity = localVaultPairingIdentity(root);
    for (const previous of this.peers) previous.close(); this.peers.clear();
    const peer = createObsidianPairingPeer({port, vaultIdentity,
      vaultId: createHash('sha256').update(this.app.vault.getName()).digest('hex'), folder: this.folder,
      bindingCurrent: () => !this.closed && this.port === port && localVaultPairingIdentity(this.app.vault.adapter.getBasePath()) === vaultIdentity});
    this.peers.add(peer); return peer;
  }
  async pairRuntime() {
    if (this.pairing || this.closed) return;
    this.pairing = true;
    try {
      const offer = await createObsidianBridgeOffer(this.createRuntimePairingPeer());
      if (this.closed || offer.signal.aborted) {offer.close(); return;}
      this.bridge = {close: offer.close, signal: offer.signal};
      const modal = new PairingModal(this, offer); this.modals.add(modal); modal.open();
    } catch {new Notice('无法配对，请先连接本机 Vault 文件夹并重新生成配对码');}
    finally {this.pairing = false;}
  }
  revokeRuntimePairing() {
    this.bridge?.close(); this.bridge = undefined;
    for (const modal of [...this.modals]) if (modal instanceof PairingModal) modal.close();
  }
  disconnect() {
    this.revokeRuntimePairing();
    for (const peer of this.peers) peer.close(); this.peers.clear();
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
