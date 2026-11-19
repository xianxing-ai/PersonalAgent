/** MOD-12 explicit session management API (host side).
 *
 * Publishes the desktop session operations as a stable, machine-callable
 * catalog over the existing Conversations metadata store. Runtime task state
 * is never written here ("Desktop metadata only", same boundary as
 * conversation-actions.js). Renderer and settings UI are unchanged: this file
 * adds a published entry point, it does not replace the renderer's
 * conversation.* actions.
 *
 * Contract revision: see docs/interfaces/DESKTOP_SESSION_MANAGEMENT_API.md.
 */

export const SESSION_MANAGEMENT_API_REVISION = 1;

/** Published operations. Every name here is callable from a trusted
 * conversation window; anything else fails closed. */
export const SESSION_MANAGEMENT_OPERATIONS = Object.freeze([
  'session.list',
  'session.active',
  'session.create',
  'session.activate',
  'session.rename',
  'session.archive',
  'session.restore',
  'session.readDraft',
  'session.writeDraft',
  'session.delete',
]);

/** Operations that only exist to be rejected: permanent deletion has no
 * storage migration, so the API must answer with an explicit unavailable
 * code instead of guessing. */
export const SESSION_UNAVAILABLE_OPERATIONS = Object.freeze(['session.delete']);

export class SessionApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionApiError';
    this.code = code;
  }
}

const SURFACES = ['panel', 'workspace'];
// The small panel surface intentionally keeps exactly one conversation.
const PANEL_LIMITED = new Set(['session.create', 'session.activate', 'session.archive', 'session.restore']);
const FIELDS = {
  'session.list': [],
  'session.active': [],
  'session.create': ['title'],
  'session.activate': ['conversationId', 'expectedConversationId'],
  'session.rename': ['conversationId', 'title', 'expectedConversationId'],
  'session.archive': ['conversationId', 'expectedConversationId'],
  'session.restore': ['conversationId'],
  'session.readDraft': ['conversationId'],
  'session.writeDraft': ['conversationId', 'text'],
  'session.delete': ['conversationId'],
};
const TERMINAL_TASK_STATES = ['succeeded', 'failed', 'cancelled'];

const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new SessionApiError('SESSION_ARGUMENT_INVALID', `${field} 必须是非空字符串`);
  return value;
};

function conversationId(value) {
  const id = text(value, 'conversationId');
  if (id.length > 128 || !/^desktop-(panel|workspace)(:[a-f0-9-]{36})?$/.test(id)) {
    throw new SessionApiError('SESSION_ARGUMENT_INVALID', '对话标识无效');
  }
  return id;
}

export function handleSessionManagementApi({name, payload, surface, conversations, tasks, taskSurface, submitting, publish}) {
  if (!SESSION_MANAGEMENT_OPERATIONS.includes(name)) throw new SessionApiError('SESSION_OPERATION_UNSUPPORTED', '不支持的显式会话管理操作');
  if (!SURFACES.includes(surface)) throw new SessionApiError('SESSION_SURFACE_INVALID', '请从受信对话窗口管理会话');
  if (!conversations) throw new SessionApiError('SESSION_STORE_UNAVAILABLE', '会话存储尚未就绪');
  if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    throw new SessionApiError('SESSION_ARGUMENT_INVALID', '会话操作格式无效');
  }
  const input = payload ?? {};
  const unknown = Object.keys(input).filter(key => !FIELDS[name].includes(key));
  if (unknown.length) throw new SessionApiError('SESSION_ARGUMENT_INVALID', `会话操作包含无效字段：${unknown.join(',')}`);
  if (PANEL_LIMITED.has(name) && surface === 'panel') throw new SessionApiError('SESSION_SURFACE_LIMITED', '小工作区只保留一个主对话');

  const guarded = fn => {
    try { return fn(); }
    catch (error) { throw error instanceof SessionApiError ? error : new SessionApiError('SESSION_REJECTED', error.message); }
  };
  const requireId = () => {
    const id = conversationId(input.conversationId);
    let session;
    try { session = conversations.session(id, surface); }
    catch { throw new SessionApiError('SESSION_NOT_FOUND', '对话不存在或不属于当前窗口'); }
    return {id, session};
  };
  const expectCurrent = () => {
    if (input.expectedConversationId !== undefined) {
      const expected = conversationId(input.expectedConversationId);
      if (expected !== conversations.activeConversationId(surface)) {
        throw new SessionApiError('SESSION_REVISION_CONFLICT', '当前对话已切换，请重试');
      }
    }
  };

  if (name === 'session.list') return {...conversations.snapshot(surface), apiRevision: SESSION_MANAGEMENT_API_REVISION};
  if (name === 'session.active') {
    const id = conversations.activeConversationId(surface);
    const session = guarded(() => conversations.session(id, surface));
    return {surface, conversationId: id, title: session.title, draft: session.draft};
  }
  if (name === 'session.delete') {
    requireId();
    throw new SessionApiError('SESSION_DELETE_UNAVAILABLE', '会话永久删除未实现，只能归档；这是显式不可用，不是成功');
  }
  if (name === 'session.create') {
    if (input.title !== undefined) text(input.title, 'title');
    const created = guarded(() => conversations.create(surface, input.title ?? '新对话'));
    publish();
    return {...conversations.snapshot(surface), createdId: created.id, apiRevision: SESSION_MANAGEMENT_API_REVISION};
  }
  if (name === 'session.activate') {
    const {id} = requireId();
    if (id !== conversations.activeConversationId(surface)) {
      if (conversations.session(id, surface).archived) throw new SessionApiError('SESSION_ARCHIVED', '请先恢复已归档对话');
      expectCurrent();
      guarded(() => conversations.switch(surface, id));
      publish();
    }
    return {...conversations.snapshot(surface), apiRevision: SESSION_MANAGEMENT_API_REVISION};
  }
  if (name === 'session.rename') {
    const {id} = requireId();
    text(input.title, 'title');
    expectCurrent();
    const renamed = guarded(() => conversations.rename(surface, id, input.title));
    publish();
    return {surface, conversationId: renamed.id, title: renamed.title, archived: renamed.archived};
  }
  if (name === 'session.archive') {
    const {id, session} = requireId();
    if (!session.archived) {
      expectCurrent();
      if (submitting?.has(id)) throw new SessionApiError('SESSION_TASK_SUBMITTING', '任务正在受理，请稍后归档会话');
      const running = [...tasks.values()].some(task => taskSurface(task) === surface
        && conversations.conversationIdForTask(task) === id && !TERMINAL_TASK_STATES.includes(task.state));
      if (running) throw new SessionApiError('SESSION_TASK_ACTIVE', '任务尚未结束，请先停止或核实后归档');
      guarded(() => conversations.archive(surface, id, true));
      publish();
    }
    return {...conversations.snapshot(surface), apiRevision: SESSION_MANAGEMENT_API_REVISION};
  }
  if (name === 'session.restore') {
    const {id} = requireId();
    if (!conversations.session(id, surface).archived) return {...conversations.snapshot(surface), apiRevision: SESSION_MANAGEMENT_API_REVISION};
    guarded(() => conversations.archive(surface, id, false));
    publish();
    return {...conversations.snapshot(surface), apiRevision: SESSION_MANAGEMENT_API_REVISION};
  }
  if (name === 'session.readDraft') {
    const {id, session} = requireId();
    return {conversationId: id, text: session.draft};
  }
  if (name === 'session.writeDraft') {
    const {id} = requireId();
    if (conversations.session(id, surface).archived) throw new SessionApiError('SESSION_ARCHIVED', '已归档对话不接受草稿写入');
    if (typeof input.text !== 'string') throw new SessionApiError('SESSION_ARGUMENT_INVALID', '草稿文本必须是字符串');
    guarded(() => conversations.setDraft(surface, id, input.text));
    // Draft writes intentionally do not publish: they arrive per keystroke and
    // the caller observes state through the next session.list/snapshot.
    return {conversationId: id, saved: true};
  }
  throw new SessionApiError('SESSION_OPERATION_UNSUPPORTED', '不支持的显式会话管理操作');
}
