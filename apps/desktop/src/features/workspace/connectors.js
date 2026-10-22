const previews = {
  weather: '<p class="connector-empty">暂无天气数据，点击后在主对话填写要查询的城市。</p>',
  calendar: '<p class="connector-empty">暂无待办记录，可在主对话创建或查询。</p>',
  mail: '<p class="connector-empty">连接邮箱后显示邮件状态与未读数量。</p>',
  knowledge: '<p class="connector-empty">连接知识库后显示已挂载的笔记来源。</p>',
  feeds: '<p class="connector-empty">添加订阅后显示已配置的来源。</p>',
  notifications: '<p class="connector-empty">暂无通知。</p>',
};

const definitions = [
  {
    id: 'weather',
    name: '天气',
    path: 'M7 16a4 4 0 1 1 1-7 5 5 0 0 1 9 3 3 3 0 0 1 0 6H7M7 21l1-2m5 2 1-2m5 2 1-2',
    defaultPreview: previews.weather,
    render(data, escape) {
      if (Number.isFinite(data.weather?.temp)||Number.isFinite(data.weather?.temperatureMin)&&Number.isFinite(data.weather?.temperatureMax)) {
        return {
          status: data.weather.busy?'刷新中':data.weather.reason?'刷新失败':data.weather.stale||data.weather.ageMs>600000?'待刷新':'已更新',
          preview: `<div class="weather-preview"><strong>${Number.isFinite(data.weather.temp)?`${escape(data.weather.temp)}<span>°</span>`:escape(data.weather.range)}</strong><div>${escape(data.weather.condition ?? '天气预报')}<small>${escape(data.weather.city ?? '查询城市')} · ${escape(data.weather.range ?? '')}</small></div></div>`,
          footer: escape(data.weather.reason||`${data.weather.source??'天气来源'} · ${data.weather.fetchedAt?new Date(data.weather.fetchedAt).toLocaleString():data.weather.date??''} · 点击刷新`),
        };
      }
      const ready=(data.health??[]).some(item=>item.id==='weather.forecast'&&item.state==='ready');
      return {
        status: data.weather?.busy?'查询中':data.weather?.reason?'查询失败':ready?'待查询':'未就绪',
        preview: previews.weather,
        footer: data.weather?.reason??(ready?'天气查询入口已接入；尚未获取数据':'天气查询能力尚未就绪'),
      };
    },
  },
  {
    id: 'calendar',
    name: '日程与待办',
    path: 'M7 3v4m10-4v4M4 10h16M5 5h14v16H5V5m4 9h2m3 0h2m-7 4h2',
    defaultPreview: previews.calendar,
    render(data, escape) {
      const items = Array.isArray(data.todo?.items) ? data.todo.items : [];
      if (items.length > 0) {
        const rows = items.slice(0, 3).map(todo => {
          const time = todo.reminder?.remindAt?.utc
            ? new Date(todo.reminder.remindAt.utc).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
            : (todo.due?.utc ? new Date(todo.due.utc).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '待办');
          const statusText = {open: '待完成', done: '已完成', cancelled: '已取消'}[todo.status] ?? todo.status;
          return `<div class="agenda-row"><time>${escape(time)}</time><div>${escape(todo.title)}<small>${escape(statusText)}${todo.notes ? ' · ' + escape(todo.notes) : ''}</small></div></div>`;
        }).join('');
        return {
          status: data.todo.sessionAllowed ? '已允许' : '已就绪',
          preview: rows,
          footer: `本地待办 · ${items.length} 项`,
        };
      }
      if (data.todo?.available) {
        return {
          status: '已就绪',
          preview: previews.calendar,
          footer: '本地待办已就绪',
        };
      }
      return {
        status: '未连接',
        preview: '<p class="connector-empty">待办服务尚未就绪，请检查 Runtime 状态。</p>',
        footer: '待办服务未连接',
      };
    },
  },
  {
    id: 'mail',
    name: '邮件',
    path: 'M3 5h18v14H3V5m0 0 9 7 9-7',
    defaultPreview: previews.mail,
    render(data, escape) {
      if (!data.mail || !data.mail.configured) {
        return {
          status: '未配置',
          preview: previews.mail,
          footer: '邮箱未配置',
        };
      }
      const hasUnread = typeof data.mail.counts?.unread === 'number';
      const unreadText = hasUnread ? `${data.mail.counts.unread} 封未读` : (data.mail.status === 'ready' ? '未同步未读数' : '尚未拉取邮件');
      return {
        status: data.mail.sessionAllowed ? '已允许' : '已配置',
        preview: `<div class="mail-preview"><span class="mail-avatar">M</span><div><strong>${escape(data.mail.user || '电子邮箱')}</strong><small>${escape(unreadText)}</small></div></div><p class="preview-excerpt">${escape(data.mail.reason || (data.mail.sessionAllowed ? '已允许本会话读取与分析' : '已保存配置，会话读取未允许'))}</p>`,
        footer: `${data.mail.sessionAllowed ? '已授权本会话' : '已保存配置'} · ${escape(unreadText)}`,
      };
    },
  },
  {
    id: 'obsidian',
    name: '知识库与笔记',
    path: 'm12 3 7 5-2 11-8 2-4-9 7-9zm0 0 2 10-5 8m5-8 5-5',
    defaultPreview: previews.knowledge,
    render(data, escape) {
      if (data.knowledge?.configured) {
        const ready=data.knowledge.available===true;
        return {
          status: data.knowledge.enabled===false?'已停用':ready?'已就绪':data.knowledge.available===false?'未就绪':'已配置',
          preview: `<div class="note-preview"><span>知识库</span><strong>${escape(data.knowledge.displayName || data.knowledge.name || '本地知识与笔记')}</strong><p>${escape(data.knowledge.reason || (ready?'已连接，只读':'等待知识源就绪'))}</p></div>`,
          footer: ready?'本地知识库已挂载':'知识源尚未就绪，请检查目录与权限',
        };
      }
      return {
        status: '未配置',
        preview: previews.knowledge,
        footer: '知识库未挂载',
      };
    },
  },
  {
    id: 'feeds',
    name: '订阅',
    path: 'M5 4a15 15 0 0 1 15 15M5 10a9 9 0 0 1 9 9M5 17h2v2H5z',
    defaultPreview: previews.feeds,
    render(data, escape) {
      const subs = Array.isArray(data.feeds?.subscriptions) ? data.feeds.subscriptions : [];
      if (subs.length > 0) {
        return {
          status: data.feeds.requiresRestart?'待重启':data.feeds.available?'已接入':'已配置',
          preview: `<div class="feed-preview"><span>已订阅 ${subs.length} 个源</span><strong>${escape(subs[0].title)}</strong><p>${subs.length > 1 ? `以及 ${escape(subs[1].title)} 等` : ''}</p><small>${data.feeds.sessionAllowed ? '会话已授权' : '会话未授权'}</small></div>`,
          footer: `${data.feeds.requiresRestart?'重启应用接入新来源':data.feeds.sessionAllowed?'具体操作继续核对原授权':data.feeds.available?'读取时按原流程批准':'已保存配置'} · ${subs.length} 个订阅源`,
        };
      }
      if (data.feeds?.available) {
        return {
          status: '已就绪',
          preview: previews.feeds,
          footer: '订阅服务已就绪',
        };
      }
      if(data.feeds?.configured===false&&Array.isArray(data.feeds.subscriptions)){
        return {status:'待添加订阅',preview:previews.feeds,footer:'点击添加 RSS / Atom 来源；读取时按原流程批准'};
      }
      return {
        status: '未连接',
        preview: previews.feeds,
        footer: '订阅服务未连接',
      };
    },
  },
];
const labels = {ready: '已连接', connecting: '连接中', reauth_required: '需要授权', degraded: '连接异常', disconnected: '未连接', unavailable: '未接入'};
export function connectorDestination(id,data={}){
  return id==='weather'?(data.weather?.configured?{action:'weather.refresh'}:{draft:'查询天气：'}):{page:id==='obsidian'?'memory':'connections'};
}
export function connectorCards(data, escape) {
  const cards = definitions.map(item => {
    const health = (data.health || []).find(entry => entry.id === item.id);
    const rendered = item.render(data, escape);
    const status = rendered?.status ?? '未连接';
    const preview = rendered?.preview ?? item.defaultPreview;
    const footer = rendered?.footer ?? escape(health ? labels[health.state] || health.state : '未连接');
    return `<article class="connector-card" data-connector="${item.id}" role="button" tabindex="0" aria-label="${item.id==='weather'?'查询天气':'配置'+item.name}"><header><span class="connector-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${item.path}"/></svg></span><h3>${item.name}</h3><span class="connector-status">${escape(status)}</span></header>${preview}<footer>${footer}</footer></article>`;
  }).join('');

  const notifList = Array.isArray(data.notifications) ? data.notifications : [];
  const notifError = data.todo?.failure || (data.health || []).find(h => h.id === 'notifications' && h.state === 'error')?.reason;
  const notifStatus = notifError ? '读取失败' : notifList.length ? `${notifList.length} 条` : '暂无';
  const notifContent = notifError
    ? `<p class="notif-error" style="color:var(--danger)">通知读取失败：${escape(notifError)}</p>`
    : notifList.length
      ? notifList.slice(0, 5).map(item => `<p>${escape(item.summary)}<small>${escape(new Date(item.occurredAt).toLocaleString())}</small></p>`).join('')
      : previews.notifications;

  return cards + `<article class="connector-card notification-card"><header><h3>通知</h3><span class="connector-status">${escape(notifStatus)}</span></header>${notifContent}</article>`;
}

