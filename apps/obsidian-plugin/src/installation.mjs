import {createHash} from 'node:crypto';
import {existsSync, lstatSync, realpathSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
  unlinkSync, rmdirSync} from 'node:fs';
import path from 'node:path';

const id = 'personal-agent-knowledge';
const files = ['main.js', 'manifest.json'];
const receiptName = 'personal-agent-installation.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function ordinary(file, directory = false) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    || !samePath(realpathSync.native(file), file)) throw Error('插件路径不能包含链接或替换文件');
  return stat;
}
function target(vaultPath, create) {
  if (typeof vaultPath !== 'string' || !path.isAbsolute(vaultPath) || vaultPath.startsWith('\\\\')) {
    throw Error('需要明确的本机 Vault 绝对路径');
  }
  const root = path.resolve(vaultPath), volume = path.parse(root).root;
  if (root.startsWith('\\\\')) throw Error('需要明确的本机 Vault 绝对路径');
  if (root === volume) throw Error('不能安装到整个磁盘');
  let cursor = volume;
  for (const part of path.relative(volume, root).split(path.sep)) {
    cursor = path.join(cursor, part); ordinary(cursor, true);
  }
  for (const part of ['.obsidian', 'plugins']) {
    cursor = path.join(cursor, part);
    if (!existsSync(cursor) && create) mkdirSync(cursor);
    ordinary(cursor, true);
  }
  return path.join(cursor, id);
}

/** Explicit local installer; never edits community-plugins.json or auto-enables code. */
export function installPlugin({vaultPath, bundlePath}) {
  const bundle = path.resolve(bundlePath);
  ordinary(bundle, true);
  const bytes = Object.fromEntries(files.map(name => {
    const file = path.join(bundle, name); ordinary(file);
    if (lstatSync(file).size > 1024 * 1024) throw Error('安装产物大小超限');
    return [name, readFileSync(file)];
  }));
  const manifest = JSON.parse(bytes['manifest.json']);
  if (manifest.id !== id || manifest.isDesktopOnly !== true || typeof manifest.version !== 'string') {
    throw Error('安装产物身份不匹配');
  }
  const destination = target(vaultPath, true);
  if (existsSync(destination)) throw Error('插件目录已存在，保留原内容；请先核对并卸载本工具管理的旧版本');
  mkdirSync(destination); ordinary(destination, true);
  // Exclusive creates preserve concurrent/user files. An interrupted install remains visible for inspection.
  for (const name of files) writeFileSync(path.join(destination, name), bytes[name], {flag: 'wx', mode: 0o600});
  const receipt = {version: 1, id, pluginVersion: manifest.version,
    files: Object.fromEntries(files.map(name => [name, hash(bytes[name])]))};
  writeFileSync(path.join(destination, receiptName), JSON.stringify(receipt), {flag: 'wx', mode: 0o600});
  return {state: 'installed', id, version: manifest.version, enabled: false};
}

/** Removes only unchanged files proven by this install receipt; no recursive directory deletion. */
export function uninstallPlugin({vaultPath}) {
  const destination = target(vaultPath, false); ordinary(destination, true);
  const enabledPath = path.join(path.dirname(path.dirname(destination)), 'community-plugins.json');
  if (existsSync(enabledPath)) {
    ordinary(enabledPath);
    if (lstatSync(enabledPath).size > 1024 * 1024) throw Error('插件启用清单大小超限');
    const enabled = JSON.parse(readFileSync(enabledPath, 'utf8'));
    if (!Array.isArray(enabled) || enabled.some(value => typeof value !== 'string')) throw Error('插件启用清单无效');
    if (enabled.includes(id)) throw Error('请先在 Obsidian 停用插件，再卸载文件');
  }
  const receiptPath = path.join(destination, receiptName); ordinary(receiptPath);
  if (lstatSync(receiptPath).size > 8192) throw Error('安装回执大小超限');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.version !== 1 || receipt.id !== id || typeof receipt.pluginVersion !== 'string'
    || !receipt.files || Object.keys(receipt.files).sort().join(',') !== [...files].sort().join(',')
    || files.some(name => !/^[a-f0-9]{64}$/.test(receipt.files[name]))) throw Error('缺少受信安装回执');
  const names = readdirSync(destination);
  if (names.some(name => name !== receiptName && !files.includes(name))) throw Error('目录含其他文件，保留整个目录');
  for (const name of files) {
    const file = path.join(destination, name);
    if (!existsSync(file)) continue; // Resume an interrupted uninstall, never invent a replacement file.
    ordinary(file);
    if (hash(readFileSync(file)) !== receipt.files[name]) throw Error('插件文件已修改，保留整个目录');
  }
  for (const name of files) {
    const file = path.join(destination, name);
    if (!existsSync(file)) continue;
    ordinary(destination, true); ordinary(file);
    if (hash(readFileSync(file)) !== receipt.files[name]) throw Error('卸载期间文件已变化');
    unlinkSync(file);
  }
  unlinkSync(receiptPath); rmdirSync(destination);
  return {state: 'uninstalled', id};
}
