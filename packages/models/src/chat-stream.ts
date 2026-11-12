import {ProtocolError} from '@personal-agent/contracts';
import type {ModelDelta, ModelUsage} from './index.js';

export interface ChatCompletionBody {
  text: string;
  reasoning?: string;
  finishReason: string;
  usage?: ModelUsage;
}

interface ChatTransport {
  request: typeof globalThis.fetch;
  url: string;
  headers: Record<string, string>;
  /** Provider body without the stream flag. Used when the endpoint rejects streaming. */
  payload: Record<string, unknown>;
  /** Exact first request body, including stream:true, so a token meter can bind the sent bytes. */
  streamBody?: string;
  signal: AbortSignal;
  onDelta?: (delta: ModelDelta) => void;
  /** Race credential/abort promises the caller already owns. */
  race<T>(operation: Promise<T>): Promise<T>;
  mapStatus: (status: number, retryAfter: string | null) => ProtocolError;
}

function usageFrom(value: unknown): ModelUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const toCount = (item: unknown): number | undefined =>
    typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 ? item : undefined;
  const promptTokens = toCount(usage.prompt_tokens);
  const completionTokens = toCount(usage.completion_tokens);
  const totalTokens = toCount(usage.total_tokens);
  const parsed: ModelUsage = {
    ...(promptTokens === undefined ? {} : {promptTokens}),
    ...(completionTokens === undefined ? {} : {completionTokens}),
    ...(totalTokens === undefined ? {} : {totalTokens}),
  };
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

function textField(record: Record<string, unknown>, names: readonly string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'thinking'] as const;

function emit(onDelta: ChatTransport['onDelta'], kind: ModelDelta['kind'], text: string): void {
  if (!text || !onDelta) return;
  try { onDelta({kind, text}); }
  catch { /* A display callback cannot change the model result. */ }
}

function fromChoice(choice: Record<string, unknown>, onDelta: ChatTransport['onDelta'], streamed: {text: string; reasoning: string}): ChatCompletionBody {
  const message = choice.message;
  const delta = choice.delta;
  const source = message && typeof message === 'object' ? message as Record<string, unknown>
    : delta && typeof delta === 'object' ? delta as Record<string, unknown> : undefined;
  if (!source) throw new ProtocolError('EXTERNAL_FAILURE', 'Model response is missing message');
  const reasoning = textField(source, REASONING_FIELDS);
  const content = typeof source.content === 'string' ? source.content : '';
  if (!streamed.reasoning && reasoning) emit(onDelta, 'reasoning', reasoning);
  if (!streamed.text && content) emit(onDelta, 'text', content);
  const text = streamed.text || content;
  if (!text.trim()) throw new ProtocolError('EXTERNAL_FAILURE', 'Model response is missing message content');
  const combinedReasoning = streamed.reasoning || reasoning;
  return {
    text,
    ...(combinedReasoning ? {reasoning: combinedReasoning} : {}),
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop',
  };
}

function parseCompletion(body: unknown, onDelta: ChatTransport['onDelta'], streamed: {text: string; reasoning: string}): ChatCompletionBody & {usage?: ModelUsage} {
  if (!body || typeof body !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Model endpoint returned an invalid response');
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Model response is missing choices');
  }
  const parsed = fromChoice(choices[0] as Record<string, unknown>, onDelta, streamed);
  const usage = usageFrom(record.usage);
  return {...parsed, ...(usage ? {usage} : {})};
}

function applyDelta(choice: Record<string, unknown>, onDelta: ChatTransport['onDelta'], streamed: {text: string; reasoning: string}): void {
  const delta = choice.delta;
  if (!delta || typeof delta !== 'object') return;
  const record = delta as Record<string, unknown>;
  const reasoning = textField(record, REASONING_FIELDS);
  const content = typeof record.content === 'string' ? record.content : '';
  if (reasoning) {
    streamed.reasoning += reasoning;
    emit(onDelta, 'reasoning', reasoning);
  }
  if (content) {
    streamed.text += content;
    emit(onDelta, 'text', content);
  }
}

async function readSse(response: Response, onDelta: ChatTransport['onDelta'], race: ChatTransport['race']): Promise<ChatCompletionBody & {usage?: ModelUsage}> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProtocolError('EXTERNAL_FAILURE', 'Model stream is missing a body');
  const decoder = new TextDecoder('utf-8', {fatal: false});
  let buffer = '';
  const streamed = {text: '', reasoning: ''};
  let finishReason = 'stop';
  let usage: ModelUsage | undefined;
  const consumeBlock = (block: string): void => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); }
    catch { throw new ProtocolError('EXTERNAL_FAILURE', 'Model stream returned invalid JSON'); }
    if (!parsed || typeof parsed !== 'object') throw new ProtocolError('EXTERNAL_FAILURE', 'Model stream returned an invalid event');
    const record = parsed as Record<string, unknown>;
    if (record.error) throw new ProtocolError('EXTERNAL_FAILURE', 'Model stream reported a failure', true);
    const nextUsage = usageFrom(record.usage);
    if (nextUsage) usage = nextUsage;
    const choices = record.choices;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return;
    const choice = choices[0] as Record<string, unknown>;
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
    applyDelta(choice, onDelta, streamed);
    if (choice.message && typeof choice.message === 'object') {
      const message = choice.message as Record<string, unknown>;
      const reasoning = textField(message, REASONING_FIELDS);
      const content = typeof message.content === 'string' ? message.content : '';
      if (reasoning && !streamed.reasoning.endsWith(reasoning)) {
        streamed.reasoning += reasoning;
        emit(onDelta, 'reasoning', reasoning);
      }
      if (content && !streamed.text.endsWith(content)) {
        streamed.text += content;
        emit(onDelta, 'text', content);
      }
    }
  };
  try {
    while (true) {
      const part = await race(reader.read());
      if (part.done) break;
      buffer += decoder.decode(part.value, {stream: true});
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        consumeBlock(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeBlock(buffer);
  } finally {
    try { reader.releaseLock(); } catch { /* The stream is already closed. */ }
  }
  if (!streamed.text.trim()) throw new ProtocolError('EXTERNAL_FAILURE', 'Model stream ended without text');
  return {text: streamed.text, ...(streamed.reasoning ? {reasoning: streamed.reasoning} : {}), finishReason, ...(usage ? {usage} : {})};
}

function streamUnsupported(status: number, body: string): boolean {
  return (status === 400 || status === 404 || status === 422 || status === 501) && /stream/i.test(body);
}

/** Open stream:true, parse reasoning and text deltas, and retry once without streaming when the endpoint rejects it. */
export async function completeChatCompletion(transport: ChatTransport): Promise<ChatCompletionBody> {
  const post = async (stream: boolean): Promise<Response> => transport.race(Promise.resolve(transport.request(transport.url, {
    method: 'POST',
    headers: transport.headers,
    body: stream && transport.streamBody ? transport.streamBody : JSON.stringify({...transport.payload, stream}),
    signal: transport.signal,
  })));
  let response = await post(true);
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { detail = ''; }
    if (streamUnsupported(response.status, detail)) response = await post(false);
    else throw transport.mapStatus(response.status, response.headers?.get('retry-after') ?? null);
  }
  if (!response.ok) throw transport.mapStatus(response.status, response.headers?.get('retry-after') ?? null);
  const media = response.headers?.get('content-type') ?? '';
  const streamed = {text: '', reasoning: ''};
  if (media.includes('text/event-stream') && response.body && typeof response.body.getReader === 'function') {
    return readSse(response, transport.onDelta, transport.race);
  }
  let body: unknown;
  try { body = await transport.race(response.json()); }
  catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('EXTERNAL_FAILURE', 'Model endpoint returned invalid JSON');
  }
  return parseCompletion(body, transport.onDelta, streamed);
}
