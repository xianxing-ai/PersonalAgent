/** Settings-only consumer. Saved credentials are never requested/read back into this view. */
export function mountSisVoiceSettings(root,invoke){
  const settings=document.createElement('details');settings.className='sis-settings';
  settings.innerHTML='<summary>华为 SIS 听写与播报设置</summary><div class="sis-fields"><p class="notice">本地可信 SIS 适配：凭据已保存不等于云端与设备已验证。经 AgentArts 的 SIS 适配当前不可用，等待适配与官方证据；不等同百炼 Live 双工语音。</p><label>区域<select id="sis-region"><option value="cn-north-4">华北-北京四</option><option value="cn-east-3">华东-上海一</option></select></label><label>华为云账号名<input id="sis-domain" autocomplete="off" maxlength="128" placeholder="IAM 用户所属账号"></label><label>IAM 用户名<input id="sis-username" autocomplete="off" maxlength="128" value="personalagent-sis"></label><label>IAM 用户密码<input id="sis-password" type="password" autocomplete="off" maxlength="1024"></label><button type="button" id="sis-login">保存华为 SIS 登录配置</button><p class="notice">密码仅用于原 IAM 登录，不保存；项目令牌由主进程在本机加密保存。仅显式开启录音时发送音频。</p><details><summary>已有 IAM Token：手动配置</summary><label>项目 ID<input id="sis-project" autocomplete="off" maxlength="128"></label><label>独立 IAM Token<input id="sis-token" type="password" autocomplete="off" maxlength="16384"></label><label>Token 到期时间（UTC，可选）<input id="sis-expiry" autocomplete="off" placeholder="YYYY-MM-DDTHH:mm:ssZ"></label><button type="button" id="sis-save">保存 SIS 配置</button></details><p class="notice" id="sis-result" role="status"></p><p class="notice" id="sis-reason" role="status"></p></div>';
  root.querySelector('#error').before(settings);
  const field=id=>settings.querySelector('#sis-'+id),status=field('result');let pending=false;
  const setPending=value=>{pending=value;for(const control of settings.querySelectorAll('input,select,button'))control.disabled=value;};
  async function save(action,request){
    setPending(true);status.textContent='正在交给可信主进程保存…';
    try{const result=await invoke(action,request);status.textContent=result.connected?'配置已保存，宿主已装配；云端与实际设备仍需单独验证。':'配置已保存；等待原 Competition Runtime 与语音宿主可用。';settings.open=false;}
    catch(error){status.textContent=error.message;}
    finally{if('password' in request)request.password='';if('iamToken' in request)request.iamToken='';setPending(false);}
  }
  field('login').onclick=()=>{
    if(pending)return;
    const request={region:field('region').value,domainName:field('domain').value.trim(),username:field('username').value.trim(),password:field('password').value};
    field('password').value='';return save('voice.login',request);
  };
  field('save').onclick=()=>{
    if(pending)return;
    const request={region:field('region').value,projectId:field('project').value.trim(),iamToken:field('token').value,tokenExpiresAt:field('expiry').value.trim()};
    field('token').value='';return save('voice.configure',request);
  };
  return {showSettings(show){settings.hidden=!show;},render(voice={}){
    const config=voice.configuration??{};
    settings.querySelector('summary').textContent=config.configured?'华为 SIS 听写与播报 · 配置已保存':'华为 SIS 听写与播报设置';
    field('reason').textContent=config.reason??voice.reason??'SIS 本地适配尚未配置；经 AgentArts 不可用';
    field('token').placeholder=config.configured?'已安全保存；仅更换时填写':'填写独立 IAM Token';
    if(!settings.open&&!pending){field('region').value=config.region??'cn-north-4';field('project').value=config.projectId??'';field('expiry').value=config.tokenExpiresAt??'';}
  }};
}
