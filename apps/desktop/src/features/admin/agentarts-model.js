export function agentArtsModelPage(model, escape) {
  return `<div class="model-page"><div class="page-lead"><div><h2>云端模型</h2><p>本机安全配置</p></div></div><div class="sheet"><h3>当前运行配置</h3><p>${model.configured ? '已配置；不代表任务已经完成' : '尚未配置'}</p><p>部署：${escape(model.deployment || '未提供')}</p><p>${escape(model.reason || '真实调用与本地结果读回尚未验证')}</p></div><p class="model-footnote">在下方保存云端配置。密钥保存后不再显示，任务结果以实际执行记录为准；云端失败不会自动改用本机模型。</p></div>`;
}
