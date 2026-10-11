import {constants, createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import * as path from 'node:path';
import {createServer, connect} from 'node:tls';
import type {TLSSocket} from 'node:tls';
import {isDeepStrictEqual} from 'node:util';
import {setTimeout, clearTimeout} from 'node:timers';
import {KnowledgeError} from './index.js';
import type {KnowledgeSearchResult} from './index.js';
import {parseObsidianPairingDescriptor} from './pairing.js';
import type {ObsidianPairingDescriptor, ObsidianPairingPeer} from './pairing.js';

const tlsOptions = {minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', ciphers: 'TLS_AES_128_GCM_SHA256'} as const;
const maxFrame = 128 * 1024;
const unavailable = () => new KnowledgeError('SOURCE_UNAVAILABLE');
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value
  && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

export interface ObsidianBridgeOffer {
  readonly version: 1; readonly port: number; readonly secret: string;
  readonly certificateSha256: string;
  readonly expiresAt: number; readonly descriptor: ObsidianPairingDescriptor;
}

export function parseObsidianBridgeCode(code: unknown): ObsidianBridgeOffer {
  try {
    if (typeof code !== 'string' || code.length > 4096 || !/^PA1\.[A-Za-z0-9_-]+$/.test(code)) throw Error();
    const data: unknown = JSON.parse(Buffer.from(code.slice(4), 'base64url').toString('utf8'));
    if (!exact(data, ['version', 'port', 'secret', 'certificateSha256', 'expiresAt', 'descriptor']) || data.version !== 1
      || !Number.isInteger(data.port) || Number(data.port) < 1 || Number(data.port) > 65535
      || typeof data.secret !== 'string' || !/^[a-f0-9]{64}$/.test(data.secret)
      || typeof data.certificateSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.certificateSha256)
      || !Number.isSafeInteger(data.expiresAt) || Number(data.expiresAt) <= Date.now()
      || Number(data.expiresAt) > Date.now() + 120_000) throw Error();
    return {version: 1, port: Number(data.port), secret: data.secret, certificateSha256: data.certificateSha256, expiresAt: Number(data.expiresAt),
      descriptor: parseObsidianPairingDescriptor(data.descriptor)};
  } catch {throw new KnowledgeError('INVALID_ARGUMENT');}
}

// Windows product host: generate an ephemeral certificate in memory, without a certificate-store entry/file.
// Fixed script, no external input. No provider key, bundled script or user content is executed.
async function ephemeralCertificate(signal: AbortSignal): Promise<{pfx: Buffer; certificateSha256: string}> {
  if (process.platform !== 'win32' || signal.aborted) throw unavailable();
  const script = `$ErrorActionPreference='Stop';$rsa=[Security.Cryptography.RSACng]::new(2048);
try {$request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=PersonalAgent local pairing',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1);
$cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddMinutes(16));
try {[Console]::WriteLine((@{pfx=[Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,''));cert=[Convert]::ToBase64String($cert.RawData)}|ConvertTo-Json -Compress))}
finally {$cert.Dispose()}} finally {$rsa.Dispose()}`;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const output = await new Promise<string>((resolve, reject) => execFile(executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024, signal},
      (error, stdout) => error ? reject(unavailable()) : resolve(stdout)));
    const data: unknown = JSON.parse(output);
    if (!exact(data, ['pfx', 'cert']) || typeof data.pfx !== 'string' || typeof data.cert !== 'string'
      || !/^[A-Za-z0-9+/=]+$/.test(data.pfx) || !/^[A-Za-z0-9+/=]+$/.test(data.cert)) throw unavailable();
    return {pfx: Buffer.from(data.pfx, 'base64'), certificateSha256: createHash('sha256').update(Buffer.from(data.cert, 'base64')).digest('hex')};
  } catch {throw unavailable();}
}

// Bounded encrypted frames only. No remote exception or pairing secret is reflected.
function frames(socket: TLSSocket, receive: (value: unknown) => void, close: () => void) {
  let pending = Buffer.alloc(0);
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > maxFrame) {close(); return;}
    let end: number;
    while ((end = pending.indexOf(10)) !== -1) {
      const frame = pending.subarray(0, end); pending = pending.subarray(end + 1);
      try {receive(JSON.parse(frame.toString('utf8')));} catch {close(); return;}
      if (socket.destroyed) return;
    }
  });
}
function send(socket: TLSSocket, value: unknown) {
  const data = Buffer.from(JSON.stringify(value) + '\n');
  if (data.length > maxFrame || socket.destroyed) throw unavailable();
  socket.write(data);
}

/** Explicit plugin command only; no listener is started during plugin loading. */
export async function createObsidianBridgeOffer(peer: ObsidianPairingPeer) {
  const descriptor = parseObsidianPairingDescriptor(peer.describe());
  const certificate = await ephemeralCertificate(peer.signal);
  peer.assertCurrent();
  const secret = randomBytes(32), expiresAt = Date.now() + 120_000;
  const controller = new AbortController(), sockets = new Set<TLSSocket>();
  let used = false, busy = false;
  let offerTimer: NodeJS.Timeout | undefined, sessionTimer: NodeJS.Timeout | undefined;
  const close = () => {
    if (controller.signal.aborted) return;
    controller.abort(); clearTimeout(offerTimer); clearTimeout(sessionTimer);
    peer.signal.removeEventListener('abort', close);
    server.close(); for (const socket of sockets) socket.destroy();
    secret.fill(0); peer.close();
  };
  const server = createServer({...tlsOptions, pfx: certificate.pfx, passphrase: '', handshakeTimeout: 4000, secureOptions: constants.SSL_OP_NO_TICKET}, socket => {
    if (used || controller.signal.aborted || Date.now() >= expiresAt) {socket.destroy(); return;}
    sockets.add(socket);
    let authenticated = false;
    const authTimer = setTimeout(() => socket.destroy(), 4000);
    socket.on('close', () => {clearTimeout(authTimer); if (authenticated) close();});
    frames(socket, message => {
      if (!authenticated) {
        if (used || controller.signal.aborted || Date.now() >= expiresAt
          || !exact(message, ['version', 'kind', 'sessionId', 'secret']) || message.version !== 1 || message.kind !== 'authenticate'
          || message.sessionId !== descriptor.sessionId || typeof message.secret !== 'string' || !/^[a-f0-9]{64}$/.test(message.secret)
          || !timingSafeEqual(Buffer.from(message.secret, 'hex'), secret)) {socket.destroy(); return;}
        authenticated = true; used = true; clearTimeout(authTimer); clearTimeout(offerTimer); server.close();
        sessionTimer = setTimeout(close, 15 * 60_000); sessionTimer.unref();
        peer.assertCurrent(); send(socket, {version: 1, kind: 'ready', descriptor}); return;
      }
      if (busy || !exact(message, ['version', 'kind', 'id', 'query', 'limit', 'deadline'])
        || message.version !== 1 || message.kind !== 'search' || typeof message.id !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(message.id)
        || typeof message.query !== 'string' || !message.query.trim() || message.query.length > 128
        || !Number.isInteger(message.limit) || Number(message.limit) < 1 || Number(message.limit) > 20
        || typeof message.deadline !== 'string' || !Number.isFinite(Date.parse(message.deadline))
        || Date.parse(message.deadline) <= Date.now() || Date.parse(message.deadline) > Date.now() + 30_000) {
        close(); return;
      }
      busy = true;
      const deadline = message.deadline;
      const timer = setTimeout(close, Date.parse(deadline) - Date.now());
      void peer.search({query: message.query, limit: Number(message.limit), deadline, signal: controller.signal})
        .then(result => {
          peer.assertCurrent();
          if (controller.signal.aborted || Date.now() >= Date.parse(deadline)) throw unavailable();
          send(socket, {version: 1, kind: 'result', id: message.id, result});
        }).catch(close).finally(() => {clearTimeout(timer); busy = false;});
    }, () => authenticated ? close() : socket.destroy());
  });
  certificate.pfx.fill(0);
  server.maxConnections = 4;
  server.on('connection', socket => {
    sockets.add(socket as TLSSocket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket as TLSSocket));
  });
  server.on('tlsClientError', () => {});
  server.on('resumeSession', (_id, callback) => callback(null, null));
  server.on('error', close);
  peer.signal.addEventListener('abort', close, {once: true});
  offerTimer = setTimeout(close, 120_000); offerTimer.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => {cleanup(); reject(unavailable());};
      const cleanup = () => {server.removeListener('error', fail); peer.signal.removeEventListener('abort', fail);};
      server.once('error', fail); peer.signal.addEventListener('abort', fail, {once: true});
      if (peer.signal.aborted) {fail(); return;}
      server.listen(0, '127.0.0.1', () => {cleanup(); resolve();});
    });
    peer.assertCurrent();
    if (controller.signal.aborted) throw unavailable();
    const address = server.address();
    if (!address || typeof address === 'string') throw unavailable();
    const code = 'PA1.' + Buffer.from(JSON.stringify({version: 1, port: address.port,
      secret: secret.toString('hex'), certificateSha256: certificate.certificateSha256, expiresAt, descriptor})).toString('base64url');
    return {code, expiresAt, signal: controller.signal, connected: () => used, close};
  } catch {close(); throw unavailable();}
}

/** Authenticated transport peer; Runtime still validates scope/results and asks for native consent. */
export async function connectObsidianBridge(code: string, context: {deadline: string; signal: AbortSignal}): Promise<ObsidianPairingPeer> {
  const offer = parseObsidianBridgeCode(code), controller = new AbortController();
  const duration = Math.min(Date.parse(context.deadline) - Date.now(), offer.expiresAt - Date.now(), 5000);
  if (context.signal.aborted || !Number.isFinite(duration) || duration <= 0) throw unavailable();
  const secret = Buffer.from(offer.secret, 'hex');
  // The code pins this exact ephemeral certificate; CA/name trust is intentionally replaced, never omitted.
  const socket = connect({...tlsOptions, host: '127.0.0.1', port: offer.port, rejectUnauthorized: false});
  let pending: {id: string; resolve: (result: KnowledgeSearchResult) => void; reject: (error: Error) => void} | undefined;
  const close = () => {
    if (controller.signal.aborted) return;
    controller.abort(); socket.destroy(); secret.fill(0);
    context.signal.removeEventListener('abort', close);
    pending?.reject(unavailable()); pending = undefined;
  };
  context.signal.addEventListener('abort', close, {once: true});
  socket.on('error', close); socket.on('close', close);
  let pinned = false;
  socket.once('secureConnect', () => {
    try {
      const certificate = socket.getPeerCertificate();
      if (socket.getProtocol() !== 'TLSv1.3' || !certificate.raw
        || createHash('sha256').update(certificate.raw).digest('hex') !== offer.certificateSha256) throw unavailable();
      pinned = true;
      send(socket, {version: 1, kind: 'authenticate', sessionId: offer.descriptor.sessionId, secret: secret.toString('hex')});
      secret.fill(0);
    } catch {close();}
  });
  const assertCurrent = () => {if (controller.signal.aborted || socket.destroyed) throw unavailable();};
  let ready = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(close, duration);
      const abort = () => {clearTimeout(timer); reject(unavailable());};
      controller.signal.addEventListener('abort', abort, {once: true});
      frames(socket, message => {
        if (!ready) {
          if (!exact(message, ['version', 'kind', 'descriptor']) || message.version !== 1 || message.kind !== 'ready'
            || !pinned
            || !isDeepStrictEqual(parseObsidianPairingDescriptor(message.descriptor), offer.descriptor)) throw unavailable();
          ready = true; clearTimeout(timer); controller.signal.removeEventListener('abort', abort); resolve(); return;
        }
        if (!pending || !exact(message, ['version', 'kind', 'id', 'result']) || message.version !== 1
          || message.kind !== 'result' || message.id !== pending.id) throw unavailable();
        const current = pending; pending = undefined; current.resolve(message.result as KnowledgeSearchResult);
      }, close);
    });
    assertCurrent();
    return {signal: controller.signal, close, assertCurrent, describe: () => {assertCurrent(); return {...offer.descriptor};},
      async search(request) {
        assertCurrent();
        const duration = Math.min(Date.parse(request.deadline) - Date.now(), 30_000);
        if (pending || request.signal.aborted || !Number.isFinite(duration) || duration <= 0) throw unavailable();
        let timer: NodeJS.Timeout | undefined;
        try {
          return await new Promise<KnowledgeSearchResult>((resolve, reject) => {
            pending = {id: randomUUID(), resolve, reject};
            timer = setTimeout(close, duration);
            request.signal.addEventListener('abort', close, {once: true});
            try {send(socket, {version: 1, kind: 'search', id: pending.id, query: request.query, limit: request.limit,
              deadline: new Date(Date.now() + duration).toISOString()});} catch {close();}
          });
        } finally {clearTimeout(timer); request.signal.removeEventListener('abort', close);}
      }};
  } catch {close(); throw unavailable();}
}
