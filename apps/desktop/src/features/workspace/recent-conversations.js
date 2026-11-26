const shortWeekday = new Intl.DateTimeFormat('zh-CN', {weekday: 'short'});
const shortDate = new Intl.DateTimeFormat('zh-CN', {month: 'numeric', day: 'numeric'});

function calendarDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function dateLabel(date, today) {
  const daysAgo = today - calendarDay(date);
  if (daysAgo === 0) return '今天';
  if (daysAgo === 1) return '昨天';
  if (daysAgo > 1 && daysAgo < 7) return shortWeekday.format(date);
  return shortDate.format(date);
}

export function createRecentConversations(openConversation) {
  const element = document.createElement('section');
  element.className = 'cc-recent';
  element.hidden = true;
  element.setAttribute('aria-labelledby', 'cc-recent-title');
  element.innerHTML = '<header><h2 id="cc-recent-title">最近对话</h2><button type="button" class="cc-recent-all" aria-controls="cc-history" aria-expanded="false">查看全部</button></header><div class="cc-recent-list"></div>';
  const allButton = element.querySelector('.cc-recent-all');
  const list = element.querySelector('.cc-recent-list');
  list.onclick = event => {
    const row = event.target.closest('[data-recent-id]');
    if (row) void openConversation(row.dataset.recentId);
  };

  let previous;
  function update(sessions = []) {
    const today = calendarDay(new Date());
    const signature = JSON.stringify([today, sessions]);
    if (signature === previous) return;
    previous = signature;
    const focusedId = document.activeElement?.dataset.recentId;
    const rows = sessions.map(({id, title, lastActivityAt}) => {
      const date = new Date(lastActivityAt);
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.recentId = id;
      row.title = title;
      const name = document.createElement('span');
      name.textContent = title;
      const time = document.createElement('time');
      time.dateTime = lastActivityAt;
      time.textContent = dateLabel(date, today);
      time.title = date.toLocaleString('zh-CN');
      row.append(name, time);
      return row;
    });
    element.hidden = rows.length === 0;
    list.replaceChildren(...rows);
    if (focusedId) rows.find(row => row.dataset.recentId === focusedId)?.focus({preventScroll: true});
  }
  return {element, allButton, update};
}
