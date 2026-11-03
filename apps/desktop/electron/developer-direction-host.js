import {createDeveloperDirectionSession, renderPullRequestBody} from '@personal-agent/runtime/application';

/** 桌面通知通道。系统不支持弹出时记拒绝原因，不把“只记下意图”当成已投递。 */
export function createElectronDesktopChannel() {
  return {name: 'desktop', async send(notice) {
    try {
      const electron = await import('electron');
      const Notification = electron.Notification;
      if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) {
        return {accepted: false, reason: 'desktop notification unsupported'};
      }
      const item = new Notification({title: notice.title, body: notice.body});
      if (typeof item.show === 'function') item.show();
      return {accepted: true, evidenceRef: `desktop:${notice.id}`};
    } catch {
      return {accepted: false, reason: 'electron notification unavailable'};
    }
  }};
}

export function createDeveloperDirectionHost(options = {}) {
  const session = options.session ?? createDeveloperDirectionSession({
    channel: options.channel ?? createElectronDesktopChannel(),
    ...(options.git ? {git: options.git} : {}),
    ...(options.runRecipe ? {runRecipe: options.runRecipe} : {}),
    ...(options.subagentControl ? {subagentControl: options.subagentControl} : {}),
    ...(options.now ? {now: options.now} : {}),
    ...(options.compensation ? {compensation: options.compensation} : {}),
  });
  const body = payload => payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return {session, invoke(action, payload) {
    const input = body(payload);
    if (action === 'snapshot' || action === 'board') return {snapshot: session.snapshot(), items: session.board(), timeline: session.timeline(), wizard: ['github', 'repo', 'profile', 'autonomy', 'runner']};
    if (action === 'enroll') return session.enroll(input);
    if (action === 'setAutonomy') return session.setAutonomy(input);
    if (action === 'goal') return session.submitGoal(input);
    if (action === 'duty') return session.addDuty(input);
    if (action === 'pause') return session.pause(input.goalId);
    if (action === 'resume') return session.resume(input.goalId);
    if (action === 'redirect') return session.redirect(input.goalId, input.instruction);
    if (action === 'handoff') return session.handoff(input.goalId);
    if (action === 'stop') return session.stop(input.goalId);
    if (action === 'emergency') return session.emergencyStop(input.reason || 'emergency stop');
    if (action === 'subscribe') {session.subscribe(input.repo, input.classes ?? ['interrupt']); return session.timeline();}
    if (action === 'notify') return session.notify(input);
    if (action === 'wizard') return session.applyWizard(input);
    if (action === 'report') {
      const report = session.report(input.goalId, input.extra);
      return {report, pullRequestBody: renderPullRequestBody(report)};
    }
    if (action === 'period') return {text: session.periodReport(input)};
    if (action === 'compensate') return session.compensate(input);
    throw new Error('未知的开发者方向操作');
  }};
}
