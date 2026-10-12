import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';

export type RealtimeEvent =
  | {type: 'audio'; data: Uint8Array; responseId: string}
  | {type: 'transcript'; id: string; role: 'user' | 'assistant'; text: string}
  | {type: 'interrupted' | 'turn_complete' | 'speech_started' | 'speech_stopped'}
  | {type: 'error'; message: string};
export interface RealtimeSession {
  sendAudio(pcm: Uint8Array): void;
  interrupt(): void;
  close(): Promise<void>;
}
export interface RealtimeRequest {
  signal: AbortSignal;
  deadline: string;
  instructions: string;
  tools: readonly {name: string; description: string; parameters: Record<string, unknown>}[];
  onEvent(event: RealtimeEvent): void;
  onTool(name: string, args: Record<string, unknown>, callId: string): Promise<string>;
}

/** The model gateway's native audio entry. No connector, filesystem or Policy authority. */
export class QwenRealtimeModelGateway {
  constructor(private readonly config: {workspaceId: string; apiKey: string},
    private readonly Socket: typeof WebSocket = WebSocket) {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(config.workspaceId)
      || !config.apiKey || config.apiKey.length > 4096 || /\s/.test(config.apiKey)) {
      throw Error('请配置有效的北京业务空间 ID 和百炼 API Key');
    }
  }

  async connect(request: RealtimeRequest): Promise<RealtimeSession> {
    const remaining = Date.parse(request.deadline) - Date.now();
    // Official service limit is 120 minutes. The host renews before this deadline.
    if (request.signal.aborted || !(remaining > 0) || remaining > 120 * 60_000) throw Error('Live 会话期限无效');
    if (!request.instructions || request.instructions.length > 32000) throw Error('Live 上下文过长');
    const socket = new this.Socket(
      `wss://${this.config.workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime`,
      {headers: {Authorization: `Bearer ${this.config.apiKey}`}, handshakeTimeout: 15_000,
        maxPayload: 2 * 1024 * 1024, followRedirects: false, perMessageDeflate: false},
    );
    let ready = false, closing = false, currentResponse = '', responseRequested = false;
    let turn = 0, continuationTurn: number | undefined;
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const initialized = new Promise<void>((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
    const calls = new Map<string, {name: string; args: string; result: Promise<string>; turn: number; returned: boolean}>();
    const ignored = new Set<string>();
    const allowed = new Set(request.tools.map(tool => tool.name));
    let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => {resolveClosed = resolve;});
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const emit = (event: RealtimeEvent): void => {if (!closing) request.onEvent(event);};
    const send = (message: object): void => {
      if (closing || socket.readyState !== WebSocket.OPEN || request.signal.aborted) throw Error('Live 连接已关闭');
      if (socket.bufferedAmount > 128_000) throw Error('Live 网络发送阻塞，请重新连接');
      socket.send(JSON.stringify({event_id: `event_${randomUUID()}`, ...message}));
    };
    const close = (): Promise<void> => {
      if (!closing) {
        closing = true;
        rejectReady(Error('Live 连接已关闭'));
        clearTimeout(startTimer); clearTimeout(deadlineTimer);
        request.signal.removeEventListener('abort', abort);
        if (socket.readyState === WebSocket.CLOSED) resolveClosed();
        else {
          closeTimer = setTimeout(() => socket.terminate(), 1000);
          socket.close(1000, 'user');
        }
      }
      return closed;
    };
    const fail = (message: string): void => {
      if (closing) return;
      rejectReady(Error(message));
      emit({type: 'error', message});
      void close();
    };
    const forgetResponse = (id: string): void => {
      ignored.add(id);
      if (ignored.size > 64) ignored.delete(ignored.values().next().value!);
    };
    const continueTurn = (): void => {
      if (closing || request.signal.aborted || currentResponse || responseRequested || continuationTurn !== turn
        || [...calls.values()].some(call => call.turn === turn && !call.returned)) return;
      try {
        responseRequested = true; continuationTurn = undefined;
        send({type: 'response.create'});
      } catch {fail('Live 任务续答发送失败');}
    };
    const abort = (): void => {void close();};
    const startTimer = setTimeout(() => fail('Live 连接或会话配置超时'), 20_000);
    const deadlineTimer = setTimeout(() => fail('Live 会话已到期，请重新开启'), remaining);
    request.signal.addEventListener('abort', abort, {once: true});
    socket.on('error', () => fail('Live 连接失败，请检查北京业务空间、密钥和网络'));
    socket.on('close', () => {
      if (!closing) fail('Live 连接中断，已停止录音');
      clearTimeout(closeTimer); resolveClosed();
    });
    socket.on('open', () => {
      if (closing) return;
      try {
        send({type: 'session.update', session: {
          modalities: ['text', 'audio'], voice: 'Tina', instructions: request.instructions,
          audio: {input: {format: {type: 'pcm', sample_rate: 16000}},
            output: {format: {type: 'pcm', sample_rate: 24000}}},
          turn_detection: {type: 'server_vad', threshold: 0.5, silence_duration_ms: 600},
          tools: request.tools.map(tool => ({type: 'function', function: tool})),
        }});
      } catch {fail('Live 会话配置发送失败');}
    });
    const toolCall = async (message: Record<string, unknown>): Promise<void> => {
      const {name, call_id: callId, arguments: args} = message;
      if (typeof name !== 'string' || !allowed.has(name) || typeof callId !== 'string'
        || !/^[\w-]{1,256}$/.test(callId) || typeof args !== 'string' || args.length > 24000
        || !currentResponse || typeof message.response_id !== 'string' || message.response_id !== currentResponse) {
        fail('Live 返回了无效的工具请求'); return;
      }
      const previous = calls.get(callId);
      if (previous) {
        if (previous.name !== name || previous.args !== args) fail('Live 工具请求标识冲突');
        return;
      }
      if (calls.size >= 256) {fail('Live 会话工具记录已满，请重新开启'); return;}
      let parsed: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(args);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
        parsed = value as Record<string, unknown>;
      } catch {fail('Live 工具参数不是合法对象'); return;}
      const result = Promise.resolve().then(() => {
        if (closing || request.signal.aborted) throw Error('Live 连接已关闭');
        return request.onTool(name, parsed, callId);
      });
      const call = {name, args, result, turn, returned: false};
      calls.set(callId, call);
      let output: string;
      try {output = await result;} catch {output = '任务请求未能完成。请查看本地任务状态；不要宣称成功。';}
      if (closing || request.signal.aborted) return;
      if (typeof output !== 'string' || output.length > 32000) {fail('Live 工具返回超出约定范围'); return;}
      try {
        send({type: 'conversation.item.create', item: {type: 'function_call_output', call_id: callId, output}});
        call.returned = true;
        if (call.turn === turn) continuationTurn = turn;
        continueTurn();
      } catch {fail('Live 任务结果回传失败');}
    };
    const interrupt = (): void => {
      if (!ready || closing) return;
      turn++; continuationTurn = undefined;
      // The native API cannot identify which turn owns a not-yet-created response.
      if (responseRequested) {fail('Live 续答尚未确认，已停止通话；后台任务保留，请重新开启'); return;}
      if (currentResponse) {
        forgetResponse(currentResponse);
        try {send({type: 'response.cancel'});} catch {fail('Live 打断未能发送');}
      }
      currentResponse = '';
      emit({type: 'interrupted'});
    };
    socket.on('message', raw => {
      if (closing) return;
      try {
        const message = JSON.parse(raw.toString()) as Record<string, any>;
        if (!message || typeof message.type !== 'string') throw Error();
        if (message.type === 'session.updated') {ready = true; clearTimeout(startTimer); resolveReady(); return;}
        if (message.type === 'error') {
          if (message.error?.code === 'response_cancel_not_active') return;
          fail('Live 服务拒绝请求，请检查模型开通、配额或会话参数'); return;
        }
        if (!ready) return;
        if (message.type === 'input_audio_buffer.speech_started') {emit({type: 'speech_started'}); interrupt(); return;}
        if (message.type === 'input_audio_buffer.speech_stopped') {emit({type: 'speech_stopped'}); return;}
        if (message.type === 'response.created') {
          const id = message.response?.id;
          if (typeof id !== 'string' || !id || id.length > 256) throw Error();
          if (ignored.has(id) || currentResponse === id) return;
          if (currentResponse) throw Error();
          currentResponse = id; responseRequested = false; return;
        }
        const responseId = message.type === 'response.done' ? message.response?.id : message.response_id;
        if (responseId && (ignored.has(responseId) || responseId !== currentResponse)) return;
        if (message.type === 'response.audio.delta') {
          if (typeof message.delta !== 'string' || message.delta.length > 512000
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.delta) || !currentResponse
            || typeof message.response_id !== 'string' || message.response_id !== currentResponse) throw Error();
          const pcm = Buffer.from(message.delta, 'base64');
          if (!pcm.length || pcm.length % 2) throw Error();
          emit({type: 'audio', data: pcm, responseId: message.response_id});
        } else if (message.type === 'conversation.item.input_audio_transcription.completed'
          || message.type === 'response.audio_transcript.done') {
          if (message.type === 'response.audio_transcript.done'
            && (!currentResponse || message.response_id !== currentResponse)) throw Error();
          if (typeof message.transcript !== 'string' || message.transcript.length > 24000) throw Error();
          const trimmed = message.transcript.trim();
          if (!trimmed) return;
          const baseId = message.item_id ?? message.response_id ?? message.event_id;
          if (typeof baseId !== 'string') throw Error();
          const suffix = message.content_index !== undefined ? `_${message.content_index}` : (message.output_index !== undefined ? `_${message.output_index}` : '');
          const id = `${baseId}${suffix}`;
          if (!/^[\w-]{1,256}$/.test(id)) throw Error();
          emit({type: 'transcript', id, role: message.type.startsWith('conversation.') ? 'user' : 'assistant', text: trimmed});
        } else if (message.type === 'response.function_call_arguments.done') {void toolCall(message);}
        else if (message.type === 'response.done') {
          if (typeof responseId !== 'string' || !responseId) throw Error();
          forgetResponse(responseId);
          currentResponse = '';
          if (message.response?.status === 'failed') {fail('Live 本轮回答失败'); return;}
          if (message.response?.status === 'cancelled') {
            turn++; continuationTurn = undefined; emit({type: 'interrupted'}); return;
          }
          if (message.response?.status !== 'completed') {fail('Live 本轮回答未完整结束'); return;}
          emit({type: 'turn_complete'}); continueTurn();
        }
      } catch {fail('Live 返回了无法解析的数据');}
    });
    if (request.signal.aborted) abort();
    await initialized;
    return {
      sendAudio(pcm) {
        if (!ready || closing) return;
        if (!(pcm instanceof Uint8Array) || !pcm.length || pcm.length > 3200 || pcm.length % 2) throw Error('Live 音频帧无效');
        send({type: 'input_audio_buffer.append', audio: Buffer.from(pcm).toString('base64')});
      }, interrupt, close,
    };
  }
}
