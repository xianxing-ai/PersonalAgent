export const OPERATOR_BRAKE_ACTION = 'operator.brake';

/** One switch and one status line. No counts, refresh or second settings entry. */
export function operatorBrakePresentation(snapshot) {
  const paused = snapshot?.paused === true;
  return {
    label: paused ? '恢复' : '暂停',
    pressed: paused,
    title: paused ? '恢复运行，任务从断点继续' : '暂停全部自主任务',
    status: paused ? '已暂停。自主任务、主动触发和进行中的调用已停下，恢复后从断点继续。' : '',
    stateLabel: paused ? '已暂停' : '',
  };
}

export function applyOperatorBrake({button, status, state, snapshot}) {
  const view = operatorBrakePresentation(snapshot);
  if (button) {
    button.hidden = false;
    button.textContent = view.label;
    button.title = view.title;
    button.setAttribute('aria-label', view.title);
    button.setAttribute('aria-pressed', String(view.pressed));
  }
  if (status) {
    status.hidden = !view.status;
    status.textContent = view.status;
  }
  if (state) {
    state.classList.toggle('paused', view.pressed);
    if (view.stateLabel) state.textContent = view.stateLabel;
  }
  return view;
}
