import type {BoundedDecisionModel, DecisionEvent, ModelChoice} from './proactive-decision.js';
import {INTERVENTIONS} from './proactive-decision.js';

/** Model transport is injected by a trusted local host; no model or service is started here. */
export interface LayaInferencePort {
  infer(payload: LayaPayload, signal: AbortSignal): Promise<unknown>;
}
export interface LayaPayload {
  readonly model: 'multilingual';
  readonly state: {readonly events: readonly {
    readonly index: number;
    readonly observation: string;
    readonly goal?: {readonly ref: string; readonly summary: string};
    readonly facts: readonly string[];
    readonly plan?: string;
  }[]};
  readonly questions: Readonly<Record<string, {
    readonly type: 'choice';
    readonly instructions: string;
    readonly criteria: Readonly<Record<string, string>>;
  }>>;
}

const criteria: Readonly<Record<string, string>> = Object.freeze({
  IGNORE: 'No meaningful change or already handled; no user notification.',
  MERGE: 'Fold into an existing batch or goal summary.',
  DEFER: 'Relevant, but wait for a more suitable time.',
  REMIND: 'Tell the user about a relevant fact without asking for a choice.',
  REQUEST_DECISION: 'User preference, new permission, or high impact choice is required.',
  EXECUTE: 'Suggest a bounded local action; trusted Runtime and Policy still decide.',
  ESCALATE_AGENTARTS: 'Complex reasoning or plan repair needs the AgentArts workflow.',
});

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One model call answers all questions over a bounded, local-only event batch. */
export class LayaDecisionModel implements BoundedDecisionModel {
  constructor(private readonly inference: LayaInferencePort) {}

  async choose(events: readonly DecisionEvent[], signal: AbortSignal): Promise<readonly ModelChoice[]> {
    const state = {events: events.map((event, index) => ({index,
      observation: event.observation,
      ...(event.goal ? {goal: {ref: `${event.goal.ref.id}@${event.goal.ref.revision}`,
        summary: event.goal.summary}} : {}),
      facts: event.facts.map(ref => `${ref.id}@${ref.revision}`),
      ...(event.plan ? {plan: `${event.plan.id}@${event.plan.revision}`} : {}),
    }))};
    const questions = Object.fromEntries(events.map((_, index) => [`event_${index}`, {
      type: 'choice' as const,
      instructions: `For event index ${index} only, choose one intervention label. This is advisory; do not assume permission or task success.`,
      criteria,
    }]));
    const raw = await this.inference.infer({model: 'multilingual', state, questions}, signal);
    if (!record(raw) || !record(raw.answers)) throw new Error('Invalid Laya response');
    const answers = raw.answers;
    if (Object.keys(answers).length !== events.length) throw new Error('Invalid Laya response');
    return events.map((_, index) => {
      const answer = answers[`event_${index}`];
      if (!record(answer) || !INTERVENTIONS.includes(answer.choice as typeof INTERVENTIONS[number])
        || typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence)
        || answer.confidence < 0 || answer.confidence > 1) throw new Error('Invalid Laya response');
      return {intervention: answer.choice as ModelChoice['intervention'], confidence: answer.confidence};
    });
  }
}

export async function readSmallJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty Laya response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65_536) throw new Error('Oversized Laya response');
      chunks.push(value);
    }
  } catch (error) {
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer)) as unknown;
}

/** Loopback only. API key comes from the trusted host and is never returned or logged. */
export class LocalLayaHttpTransport implements LayaInferencePort {
  constructor(private readonly port: number, private readonly getApiKey: () => string,
    private readonly request: typeof fetch = fetch) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Laya port');
  }

  async infer(payload: LayaPayload, signal: AbortSignal): Promise<unknown> {
    const apiKey = this.getApiKey();
    if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)) throw new Error('Laya key unavailable');
    const response = await this.request(`http://127.0.0.1:${this.port}/v1/systemone`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      body: JSON.stringify(payload),
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Local Laya unavailable');
    }
    return readSmallJson(response);
  }
}
