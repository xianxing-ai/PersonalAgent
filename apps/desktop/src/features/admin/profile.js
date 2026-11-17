const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3zM14 5l5 5"/></svg>';

export function readProfile() {
  try {
    const value = JSON.parse(localStorage.getItem('pa-profile') || '{}');
    return {name: String(value.name || '我的个人资料').slice(0, 60), bio: String(value.bio || '').slice(0, 200), avatar: /^data:image\/(png|jpeg|webp);base64,/.test(value.avatar || '') ? value.avatar : ''};
  } catch { return {name: '我的个人资料', bio: '', avatar: ''}; }
}

export function profilePage(data, escape) {
  const profile = readProfile();
  return `<section class="profile-page"><header class="profile-toolbar"><h2>个人资料</h2><div><span class="profile-private">仅本机</span><button class="profile-action" id="profile-edit">${pencil}编辑</button></div></header><div class="profile-identity"><div class="profile-avatar" id="profile-avatar">${profile.avatar ? `<img src="${escape(profile.avatar)}" alt="个人头像">` : '<span aria-hidden="true">P</span>'}</div><h1 id="profile-name">${escape(profile.name)}</h1><p id="profile-bio">${escape(profile.bio || '仅在此设备保存的个人资料')}</p></div><div class="profile-insights"><section><h3>本机记录</h3><div><span>已完成</span><b>${(data.tasks || []).filter(task=>task.state==='succeeded').length}</b></div><div><span>失败</span><b>${(data.tasks || []).filter(task=>task.state==='failed').length}</b></div></section></div><dialog id="profile-dialog"><form id="profile-form" class="settings-form"><h2>编辑个人资料</h2><label>显示名称<input id="profile-name-input" maxlength="60" value="${escape(profile.name)}" required></label><label>简介<input id="profile-bio-input" maxlength="200" value="${escape(profile.bio)}"></label><label>头像<input id="profile-image-input" type="file" accept="image/png,image/jpeg,image/webp"></label><p id="profile-edit-error" role="alert"></p><div class="form-actions"><button class="btn btn-primary" type="submit">保存</button><button class="btn" id="profile-cancel" type="button">取消</button></div></form></dialog></section>`;
}

export function bindProfile(root, escape) {
  const dialog = root.querySelector('#profile-dialog');
  let revision = 0;
  const invalidate = () => { revision++; };
  const isCurrent = request => request === revision && dialog.isConnected && dialog.open;
  root.querySelector('#profile-edit').onclick = () => { invalidate(); window.addEventListener('unload', invalidate, {once: true}); dialog.showModal(); };
  root.querySelector('#profile-cancel').onclick = () => { invalidate(); dialog.close(); };
  dialog.addEventListener('cancel', invalidate);
  dialog.addEventListener('close', () => { if (!dialog.open) { invalidate(); window.removeEventListener('unload', invalidate); } });
  root.querySelector('#profile-form').onsubmit = async event => {
    event.preventDefault();
    const request = ++revision;
    try {
      const next = {...readProfile(), name: root.querySelector('#profile-name-input').value.trim(), bio: root.querySelector('#profile-bio-input').value.trim()};
      if (!next.name) throw Error('请输入显示名称');
      const file = root.querySelector('#profile-image-input').files[0];
      if (file) {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw Error('请选择 2MB 以内的 PNG、JPEG 或 WebP 图片');
        next.avatar = await new Promise((resolve,reject)=>{const reader = new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('无法读取图片'));reader.readAsDataURL(file);});
      }
      if (!isCurrent(request)) return;
      localStorage.setItem('pa-profile', JSON.stringify(next));
      root.querySelector('#profile-name').textContent = next.name;
      root.querySelector('#profile-bio').textContent = next.bio || '仅在此设备保存的个人资料';
      if (next.avatar) root.querySelector('#profile-avatar').innerHTML = `<img src="${escape(next.avatar)}" alt="个人头像">`;
      dialog.close();
    } catch (error) { if (isCurrent(request)) root.querySelector('#profile-edit-error').textContent = error.message; }
  };
}
