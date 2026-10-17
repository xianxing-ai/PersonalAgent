import { ProtocolError, validateContract } from '@personal-agent/contracts';
import type { ConnectorManifest, ConnectorPort } from '@personal-agent/contracts';
import type {ProactiveSourceDefinition,ProactiveContext,ProactivePage,ProactiveSourceBinding} from './proactive.js';
export * from './proactive.js';

export interface SecretStorePort {
  read(secretRef: string, signal: AbortSignal): string | undefined | Promise<string | undefined>;
}

export interface ConnectorFactoryContext {
  signal: AbortSignal;
  readSecret(secretRef: string): Promise<string>;
}

export interface ConnectorFactory {
  readonly manifest: ConnectorManifest;
  create(context: ConnectorFactoryContext): ConnectorPort | Promise<ConnectorPort>;
}

export interface ConnectorRegistrationOptions {
  secretRefs?: readonly string[];
  /** Trusted source configuration. Registration does not connect or start monitoring. */
  proactive?:readonly ProactiveSourceDefinition[];
}

export interface ConnectorStatus {
  manifest: ConnectorManifest;
  health: ReturnType<ConnectorPort['health']>;
}

interface Registration {
  factory: ConnectorFactory;
  secretRefs: Set<string>;
  instance?: ConnectorPort;
  connecting?: Promise<{sessionRef: string; interactionRequired: boolean}>;
  proactive:readonly ProactiveSourceDefinition[];
}

const requiredText = (value: string, field: string): string => {
  const result = value.trim();
  if (!result) throw new ProtocolError('INVALID_ARGUMENT', `${field} must not be empty`);
  return result;
};

export class ConnectorHost {
  private readonly registrations = new Map<string, Registration>();

  constructor(private readonly secretStore: SecretStorePort) {}

  register(factory: ConnectorFactory, options: ConnectorRegistrationOptions = {}): () => Promise<void> {
    validateContract('connector', factory.manifest);
    const id = factory.manifest.id;
    if (this.registrations.has(id)) throw new ProtocolError('REVISION_CONFLICT', `Connector ${id} is already registered`);
    const secretRefs = new Set((options.secretRefs ?? []).map(ref => requiredText(ref, 'secretRef')));
    const proactive=(options.proactive??[]).map(source=>({...source}));
    for(const source of proactive) {
      if(!source.sourceId?.trim()||!source.accountRef?.trim()||!source.configurationRevision?.trim()
        ||!['mail','calendar','todo','feeds','research','weather','file','wiki','git','ci','model_progress','other'].includes(source.kind)
        ||!['push','watch','poll-only','manual-only','unavailable'].includes(source.mode)
        ||proactive.filter(item=>item.sourceId===source.sourceId).length!==1
        ||this.listProactiveSources().some(item=>item.sourceId===source.sourceId))
        throw new ProtocolError('INVALID_ARGUMENT','Invalid or duplicate proactive source configuration');
    }
    const registration: Registration = {factory, secretRefs,proactive};
    this.registrations.set(id, registration);
    return async () => {
      if (this.registrations.get(id) !== registration) return;
      if (registration.connecting) await registration.connecting;
      if (registration.instance) await registration.instance.disconnect();
      this.registrations.delete(id);
    };
  }

  list(): ConnectorStatus[] {
    return [...this.registrations.values()].map(registration => ({
      manifest: structuredClone(registration.factory.manifest),
      health: registration.instance ? structuredClone(registration.instance.health()) : {state: 'disconnected'},
    }));
  }

  async connect(connectorId: string, signal: AbortSignal): Promise<{sessionRef: string; interactionRequired: boolean}> {
    const registration = this.registration(connectorId);
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Connector connection was cancelled');
    if (!registration.connecting) {
      registration.connecting = this.open(registration, signal).finally(() => {
        delete registration.connecting;
      });
    }
    return structuredClone(await registration.connecting);
  }

  private async open(registration: Registration, signal: AbortSignal): Promise<{sessionRef: string; interactionRequired: boolean}> {
    if (!registration.instance) {
      const context: ConnectorFactoryContext = {
        signal,
        readSecret: async secretRef => {
          const ref = requiredText(secretRef, 'secretRef');
          if (!registration.secretRefs.has(ref)) throw new ProtocolError('SCOPE_DENIED', 'Connector requested an undeclared secret');
          if (signal.aborted) throw new ProtocolError('CANCELLED', 'Connector connection was cancelled');
          const value = await this.secretStore.read(ref, signal);
          if (signal.aborted) throw new ProtocolError('CANCELLED', 'Connector connection was cancelled');
          if (value === undefined) throw new ProtocolError('UNAUTHORIZED', 'Required connector credential is unavailable');
          return value;
        },
      };
      const instance = await registration.factory.create(context);
      validateContract('connector', instance.manifest);
      if (instance.manifest.id !== registration.factory.manifest.id || instance.manifest.version !== registration.factory.manifest.version) {
        throw new ProtocolError('PROTOCOL_MISMATCH', 'Connector instance manifest does not match its factory');
      }
      registration.instance = instance;
    }
    if (signal.aborted) throw new ProtocolError('CANCELLED', 'Connector connection was cancelled');
    return registration.instance.connect();
  }

  async disconnect(connectorId: string): Promise<{disconnected: boolean; cleanupState: string}> {
    const registration = this.registration(connectorId);
    if (registration.connecting) await registration.connecting;
    if (!registration.instance) return {disconnected: true, cleanupState: 'not_started'};
    return structuredClone(await registration.instance.disconnect());
  }

  getCapabilities(connectorId: string): string[] {
    const registration = this.registration(connectorId);
    return registration.instance
      ? [...registration.instance.getCapabilities()]
      : [...registration.factory.manifest.capabilities];
  }

  listProactiveSources():ProactiveSourceBinding['descriptor'][] {
    return [...this.registrations.values()].flatMap(registration=>registration.proactive.map(source=>{
      const manifest=registration.factory.manifest;
      const polling=!!source.read||manifest.capabilities.includes('fetchChanges')
        ||manifest.syncStrategy==='poll'&&manifest.capabilities.includes('collect');
      const available=source.mode==='manual-only'?true:source.mode==='poll-only'?polling
        :source.mode==='push'||source.mode==='watch'?!!source.watch:false;
      return {sourceId:source.sourceId,connectorId:manifest.id,connectorVersion:manifest.version,
        accountRef:source.accountRef,sourceKind:source.kind,configurationRevision:source.configurationRevision,
        declaredMode:source.mode,mode:available?source.mode:'unavailable',
        ...(!available?{reason:'Declared source has no matching public read/watch adapter'}:{}),
        verification:manifest.verification};
    }));
  }

  /** Resolves through this original registry; no second connector/source registry. Host-only. */
  proactiveSource(sourceId:string):ProactiveSourceBinding {
    for(const registration of this.registrations.values()) {
      const source=registration.proactive.find(item=>item.sourceId===sourceId);if(!source)continue;
      const descriptor=this.listProactiveSources().find(item=>item.sourceId===sourceId)!;
      const current=()=>{
        if(this.registrations.get(registration.factory.manifest.id)!==registration)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Proactive connector was unregistered');
        const instance=registration.instance;
        if(!instance)throw new ProtocolError('UNAUTHORIZED','Proactive source was not explicitly connected');
        const health=instance.health().state;
        if(health==='reauth_required')throw new ProtocolError('UNAUTHORIZED','Proactive source requires fresh authorization');
        if(health!=='ready')throw new ProtocolError('EXTERNAL_FAILURE','Proactive source is offline or degraded');
        return instance;
      };
      return {descriptor,
        read:async(input,context)=>{
          const connector=current();
          if(!source.read&&!connector.getCapabilities().includes('fetchChanges')
            &&!(connector.manifest.syncStrategy==='poll'&&connector.getCapabilities().includes('collect')))
            throw new ProtocolError('UNSUPPORTED_CAPABILITY','Source needs an explicitly configured public read adapter');
          if(source.read)return source.read(connector,input,context);
          const {cursor,...query}=input;
          // Public calendar paging uses an empty end-of-window cursor, not a resumable cursor token.
          return connector.fetchChanges({accountRef:source.accountRef,...query,...(cursor?{cursor}:{})});
        },
        ...(source.watch?{watch:async(input,accept,context)=>source.watch!(current(),input,accept,context)}:{}),
        ...(source.reconcile?{reconcile:async(reason,context)=>source.reconcile!(current(),reason,context)}:{})};
    }
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Proactive source is not registered');
  }

  private registration(connectorId: string): Registration {
    const id = requiredText(connectorId, 'connectorId');
    const registration = this.registrations.get(id);
    if (!registration) throw new ProtocolError('UNSUPPORTED_CAPABILITY', `Connector ${id} is not registered`);
    return registration;
  }
}
