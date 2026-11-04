const STATUS_LABEL = {
  'production-gap': { label: '生产口缺口', cls: 'st-gap' },
  'wiring-in-pr': { label: '接线在途 PR', cls: 'st-pr' },
  'needs-real-environment': { label: '待真机/真云验收', cls: 'st-real' },
  unknown: { label: '未知', cls: 'st-unknown' },
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

function unavailableNote(msg) {
  const banner = document.getElementById('banner');
  banner.textContent = '';
  banner.append(el('strong', {}, 'unavailable：'), msg);
  banner.classList.remove('hidden');
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message ?? ''; } catch { /* 忽略非 JSON 错误体 */ }
    throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}`);
  }
  return res.json();
}

async function main() {
  let data;
  try {
    data = await fetchJson('/api/demo-data');
  } catch (err) {
    document.getElementById('meta').textContent = '数据不可用';
    unavailableNote(`无法加载 /api/demo-data（${err.message}）。请在仓库根目录运行：node docs/demo/web-demo/build-demo-data.mjs`);
    return;
  }
  render(data);
}

function render(data) {
  document.getElementById('profile').textContent = data.profile;
  const head = data.git?.head ? data.git.head.slice(0, 12) : '未知';
  document.getElementById('meta').textContent = `数据生成于 ${new Date(data.generatedAt).toLocaleString('zh-CN')} · HEAD ${head} · 校验 ${data.verification}`;

  const s = data.stats;
  const statsEl = document.getElementById('stats');
  statsEl.append(
    statCard(s.workflowCount, '张工作流图'),
    statCard(s.designNodeCount, '个设计节点'),
    statCard(`${s.configuredCount}/${s.configuredTotal}`, '已 configured（接线完成）'),
    statCard(`${s.hostGuardChecklistDone ?? 0}/${s.hostGuardChecklistTotal ?? '—'}`, '宿主守卫清单勾选'),
  );
  for (const [status, count] of Object.entries(s.statusCounts)) {
    const meta = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
    statsEl.append(statCard(count, meta.label));
  }

  document.getElementById('rule').textContent = data.globalRule;

  const hl = document.getElementById('highlights');
  for (const item of data.highlights ?? []) {
    hl.append(
      el('div', { class: 'hl' },
        el('div', { class: 'hl-title' }, item.title),
        el('div', { class: 'hl-note muted' }, item.note),
        el('a', { class: 'hl-pr', href: `https://github.com/xianxing-ai/PersonalAgent/pull/${item.pr}`, target: '_blank', rel: 'noopener noreferrer' }, `PR #${item.pr} · ${item.state}`),
      ),
    );
  }

  renderWorkflows(data.workflows);
  renderSources(data.sources);
}

function statCard(value, label) {
  return el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label muted' }, label));
}

let currentFilter = 'all';
let workflowsData = [];

function renderWorkflows(workflows) {
  workflowsData = workflows;
  const filters = document.getElementById('filters');
  filters.textContent = '';
  const counts = { all: workflows.length };
  for (const w of workflows) {
    counts[w.status.status] = (counts[w.status.status] ?? 0) + 1;
  }
  for (const [status, count] of Object.entries(counts)) {
    const meta = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
    const btn = el('button', {
      class: `filter ${currentFilter === status ? 'active' : ''}`,
      onclick: () => { currentFilter = status; renderWorkflows(workflowsData); },
    }, `${meta.label} · ${count}`);
    filters.append(btn);
  }
  const grid = document.getElementById('wf-grid');
  grid.textContent = '';
  for (const w of workflows.filter((w) => currentFilter === 'all' || w.status.status === currentFilter)) {
    const meta = STATUS_LABEL[w.status.status] ?? STATUS_LABEL.unknown;
    grid.append(
      el('div', { class: `wf ${meta.cls}`, onclick: () => showDetail(w) },
        el('div', { class: 'wf-head' },
          el('span', { class: 'wf-id' }, w.workflowId),
          el('span', { class: 'wf-name' }, w.name),
        ),
        el('div', { class: 'wf-meta muted' }, `${w.nodeCount} 节点 · ${w.capabilityNames.length} 能力 · ${w.status.owners.join(' / ') || '未分配'}`),
        el('div', { class: `chip ${meta.cls}` }, meta.label),
      ),
    );
  }
}

function showDetail(w) {
  const card = document.getElementById('detail-card');
  document.getElementById('detail-title').textContent = `${w.workflowId} · ${w.name}（binding ${w.bindingId}，版本 ${w.version}）`;
  const body = document.getElementById('detail-body');
  body.textContent = '';

  body.append(el('p', {}, el('strong', {}, '状态：'), w.status.summary));
  if (w.status.openGaps?.length) body.append(el('p', {}, el('strong', {}, '开放缺口：'), w.status.openGaps.join('；')));
  if (w.status.inFlightPrs?.length) {
    const prWrap = el('p', {}, el('strong', {}, '在途 PR：'));
    w.status.inFlightPrs.forEach((pr, i) => {
      if (i) prWrap.append('、');
      prWrap.append(el('a', { href: `https://github.com/xianxing-ai/PersonalAgent/pull/${pr}`, target: '_blank', rel: 'noopener noreferrer' }, `#${pr}`));
    });
    body.append(prWrap);
  }
  for (const src of w.status.sources ?? []) body.append(el('p', { class: 'muted' }, '来源：', src));

  body.append(el('h3', {}, '能力依赖'));
  const capWrap = el('div', { class: 'caps' });
  for (const cap of w.capabilityNames) capWrap.append(el('code', { class: 'cap' }, cap));
  body.append(capWrap);

  body.append(el('h3', {}, `节点（${w.nodes.length}）`));
  const list = el('ol', { class: 'nodes' });
  for (const n of w.nodes) {
    list.append(
      el('li', {},
        el('div', { class: 'node-label' }, `${n.id} · ${n.label}`),
        el('div', { class: 'muted node-kind' }, `类型 ${n.kind} · 副作用 ${n.effect}${n.capabilityNames.length ? ' · 能力 ' + n.capabilityNames.join(', ') : ''}${n.dependencies.length ? ' · 依赖 ' + n.dependencies.join(', ') : ''}`),
        n.evidenceRequirement ? el('div', { class: 'muted node-evidence' }, `证据要求：${n.evidenceRequirement}`) : null,
      ),
    );
  }
  body.append(list);
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSources(sources) {
  const elx = document.getElementById('sources');
  elx.textContent = '数据来源：' + (sources ?? []).map((s) => `${s.path}（sha256 ${s.sha256.slice(0, 16)}…）`).join(' · ');
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail-card').hidden = true;
});

document.getElementById('probe-btn').addEventListener('click', async () => {
  const result = document.getElementById('probe-result');
  const input = document.getElementById('runtime-url');
  result.classList.remove('hidden');
  const base = (input.value || '').trim().replace(/\/+$/, '');
  if (!base) {
    result.textContent = 'unavailable：请输入已部署 Runtime 地址后重试；本页不做任何写请求，也不提供模拟数据。';
    return;
  }
  result.textContent = `探测中：GET ${base}/healthz（只读）…`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/healthz`, { signal: controller.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    result.textContent = `HTTP ${res.status}\n${text.slice(0, 2000) || '（空响应体）'}\n\n探测为只读 GET；更完整的部署读回（F26）见 docs/competition/evaluation/。`;
  } catch (err) {
    result.textContent = `unavailable：探测失败（${err.name === 'AbortError' ? '5 秒超时' : err.message}）。Runtime 未部署或地址不可达；本页不提供模拟数据。`;
  } finally {
    clearTimeout(timer);
  }
});

main();
