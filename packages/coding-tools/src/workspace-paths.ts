/** Shared path policy for workspace read/write/create tools. */
import {isAbsolute, relative, sep, win32} from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

export const MAX_RELATIVE_PATH_LENGTH = 1024;

const blockedDirectoryNames = new Set([
  '.aws', '.azure', '.codex', '.direnv', '.docker', '.git', '.gnupg', '.kube', '.ssh',
]);
const blockedFileNames = new Set([
  '.git-credentials', '.netrc', '.npmrc', '.pypirc', '.envrc', 'application-default-credentials.json',
  'credentials', 'credentials.json', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa', 'secrets',
  'secrets.json', 'service-account.json',
]);
const blockedPrivateKeyExtensions = new Set(['.jks', '.key', '.keystore', '.p12', '.pem', '.pfx', '.ppk']);
const windowsReservedName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu;

export function canonicalRelativePath(value: string): {normalized: string; segments: string[]} {
  if (value.length > MAX_RELATIVE_PATH_LENGTH || value.includes('\0')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path is invalid');
  }
  if (isAbsolute(value) || win32.isAbsolute(value) || value.startsWith('/') || value.startsWith('\\')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path must be relative');
  }
  if (value.includes(':')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Drive-qualified and alternate data stream paths are not allowed');
  }
  const segments = value.split(/[\\/]/u);
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path must use canonical child segments');
  }
  for (const segment of segments) {
    if (/[. ]$/u.test(segment)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Workspace path contains a Windows-ambiguous segment');
    }
    const deviceCandidate = segment.split('.')[0] ?? segment;
    if (windowsReservedName.test(deviceCandidate)) {
      throw new ProtocolError('INVALID_ARGUMENT', 'Windows device names are not allowed');
    }
  }
  return {normalized: segments.join('/'), segments};
}

export function canonicalRelativeDirectoryPath(value: string): {normalized: string; segments: string[]} {
  if (value === '.') return {normalized: '.', segments: []};
  return canonicalRelativePath(value);
}

export function pathIsWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation !== '' && relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

export function pathIsAtOrWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}


export function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right;
}

export function isSensitivePath(normalizedPath: string): boolean {
  const segments = normalizedPath.toLocaleLowerCase('en-US').split('/');
  if (segments.some(segment => blockedDirectoryNames.has(segment))) return true;
  const fileName = segments.at(-1) ?? '';
  if (blockedFileNames.has(fileName) || /^\.env(?:\..+)?$/u.test(fileName)) return true;
  if (/^(?:credentials|secrets|service-account)(?:\..+)?$/u.test(fileName)) return true;
  const extensionIndex = fileName.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : '';
  return blockedPrivateKeyExtensions.has(extension);
}
