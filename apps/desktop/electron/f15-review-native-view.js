import {spawn as defaultSpawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';

// Static code only. Review content is sent on stdin, never in command arguments.
const SCRIPT=String.raw`$ErrorActionPreference='Stop'
try {
  [Console]::InputEncoding=[Text.UTF8Encoding]::new($false,$true)
  $raw=[Console]::In.ReadToEnd()
  $inputValue=ConvertFrom-Json -InputObject $raw
  if ($null -eq $inputValue.text -or $inputValue.text -isnot [string]) { exit 2 }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $window=[System.Windows.Forms.Form]::new()
  $window.Text='F15 原始补丁及源码 - 本机只读展示'
  $window.Width=1100; $window.Height=780
  $window.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterScreen
  $box=[System.Windows.Forms.TextBox]::new()
  $box.Multiline=$true; $box.ReadOnly=$true; $box.WordWrap=$false
  $box.ScrollBars=[System.Windows.Forms.ScrollBars]::Both
  $box.Dock=[System.Windows.Forms.DockStyle]::Fill
  $box.ShortcutsEnabled=$false
  $box.Font=[System.Drawing.Font]::new('Consolas',10)
  $box.MaxLength=1048576; $box.Text=$inputValue.text
  $window.Controls.Add($box)
  $window.add_Shown({[Console]::Out.WriteLine('SHOWN');[Console]::Out.Flush()})
  [void]$window.ShowDialog()
  [Console]::Out.WriteLine('CLOSED');[Console]::Out.Flush()
  $window.Dispose()
} catch { exit 2 }`;
const encoded=Buffer.from(SCRIPT,'utf16le').toString('base64');
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/u.test(value);
const safeText=value=>String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff\ud800-\udfff]/gu,
  character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0')).replace(/\r/g,'\\r');
function render(value){
  if(!plain(value)||![value.taskId,value.sessionId,value.snapshotId,value.reviewerId,value.authorId,value.policyId].every(id)
    ||!/^[a-f0-9]{64}$/.test(value.patchDigest)||!Array.isArray(value.patches)||!Array.isArray(value.sources)
    ||value.patches.length<1||value.patches.length!==value.sources.length
    ||new Set(value.patches.map(item=>item?.path)).size!==value.patches.length
    ||new Set(value.sources.map(item=>item?.path)).size!==value.sources.length
    ||createHash('sha256').update(JSON.stringify(value.patches)).digest('hex')!==value.patchDigest)throw Error('invalid_input');
  const lines=['F15 本机原始补丁与源码（本窗口仅展示，不表示审查通过）',
    '不可见控制字符以 \\uXXXX 显示；回车显示为 \\r。',
    '任务: '+safeText(value.taskId),'会话: '+safeText(value.sessionId),'快照: '+safeText(value.snapshotId),'补丁 SHA-256: '+value.patchDigest,
    '审核者: '+safeText(value.reviewerId),'部署作者标识: '+safeText(value.authorId),'审核策略: '+safeText(value.policyId),''];
  for(const patch of value.patches){
    if(!plain(patch)||!id(patch.path)||!Array.isArray(patch.edits)||!value.sources.some(source=>source?.path===patch.path))throw Error('invalid_input');
    const source=value.sources.find(item=>item.path===patch.path);
    if(source.source!==null&&typeof source.source!=='string')throw Error('invalid_input');
    if(source.source===null?patch.expectedSha256!==null:
      typeof patch.expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(patch.expectedSha256)
        ||createHash('sha256').update(source.source,'utf8').digest('hex')!==patch.expectedSha256)throw Error('invalid_input');
    lines.push('════════ 文件 '+safeText(patch.path)+' ════════','原始 SHA-256: '+(patch.expectedSha256??'（新建）'),
      '原始源码:',source.source===null?'（新建文件）':safeText(source.source),'');
    if(patch.createText!==undefined){if(typeof patch.createText!=='string')throw Error('invalid_input');lines.push('新建内容:',safeText(patch.createText),'');}
    for(const edit of patch.edits){if(!plain(edit)||typeof edit.oldText!=='string'||typeof edit.newText!=='string')throw Error('invalid_input');
      lines.push('原内容:',safeText(edit.oldText),'替换为:',safeText(edit.newText),'');}
  }
  const text=lines.join('\r\n');if(Buffer.byteLength(text,'utf8')>512*1024)throw Error('size_limit');return text;
}

/** The caller is Main-only and must already have native user consent. No fallback viewer exists. */
export function createF15NativeReviewViewer({powerShellPath,verifyExecutable,excludedDirectories=[],
  dependencies={platform:process.platform,spawn:defaultSpawn,lstatSync,realpathSync,readFileSync,systemRoot:process.env.SystemRoot}}={}) {
  const {platform,spawn,lstatSync:stat,realpathSync:real,readFileSync:read,systemRoot}=dependencies;
  let disposed=false;const activeStops=new Set();
  const fail=reason=>({state:'unavailable',reason});
  function executable(){
    if(platform!=='win32'||typeof verifyExecutable!=='function'||typeof spawn!=='function'||typeof powerShellPath!=='string'
      ||!path.win32.isAbsolute(powerShellPath)||powerShellPath.startsWith('\\\\')||path.win32.basename(powerShellPath).toLowerCase()!=='pwsh.exe'
      ||typeof systemRoot!=='string'||!path.win32.isAbsolute(systemRoot)||!Array.isArray(excludedDirectories))return undefined;
    try{
      const initial=stat(powerShellPath,{bigint:true});if(!initial.isFile()||initial.isSymbolicLink()||initial.size>134217728n)return undefined;
      const canonical=real.native(powerShellPath);if(path.win32.normalize(canonical).toLowerCase()!==path.win32.normalize(powerShellPath).toLowerCase())return undefined;
      for(const excluded of excludedDirectories){if(typeof excluded!=='string'||!path.win32.isAbsolute(excluded))return undefined;
        const resolved=real.native(excluded);
        for(const root of [excluded,resolved]){const relative=path.win32.relative(root,canonical);
          if(relative===''||relative!=='..'&&!relative.startsWith('..\\')&&!path.win32.isAbsolute(relative))return undefined;}}
      const bytes=read(canonical);if(bytes.length>128*1024*1024)return undefined;
      const fingerprint=createHash('sha256').update(bytes).digest('hex'),after=stat(canonical,{bigint:true});
      if(initial.dev!==after.dev||initial.ino!==after.ino||initial.size!==after.size||initial.mtimeNs!==after.mtimeNs
        ||initial.ctimeNs!==after.ctimeNs||initial.birthtimeNs!==after.birthtimeNs
        ||verifyExecutable({path:canonical,sha256:fingerprint})!==true)return undefined;
      return {path:canonical,fingerprint,dev:after.dev,ino:after.ino,size:after.size,mtimeNs:after.mtimeNs,
        ctimeNs:after.ctimeNs,birthtimeNs:after.birthtimeNs};
    }catch{return undefined;}
  }
  return {
    snapshot(){return !disposed&&executable()?{available:true}:{available:false,reason:disposed?'native_viewer_closed':'trusted_native_viewer_unavailable'};},
    /** App shutdown/reconfiguration requests termination; the original show promise reports its observed result. */
    close(){disposed=true;for(const stop of activeStops)stop();},
    async show(value,{signal,assertCurrent}={}){
      if(disposed)return fail('native_viewer_closed');
      if(!(signal instanceof AbortSignal)||typeof assertCurrent!=='function')return fail('original_authorization_unavailable');
      const deadline=Date.parse(value?.deadline);if(!Number.isFinite(deadline)||deadline<=Date.now())return fail('deadline_expired');
      let text;try{text=render(value);}catch{return fail('invalid_or_oversized_review');}
      const binary=executable();if(!binary)return fail('trusted_native_viewer_unavailable');
      const current=()=>{try{return !signal.aborted&&Date.now()<deadline&&assertCurrent()===true;}catch{return false;}};
      if(!current())return fail('original_authorization_unavailable');
      return new Promise(resolve=>{
        let child,output='',shown=false,closed=false,finished=false,reason,stopTimer,watchTimer;
        const cleanup=()=>{clearInterval(watchTimer);clearTimeout(stopTimer);signal.removeEventListener('abort',abort);activeStops.delete(abort);};
        const finish=result=>{if(finished)return;finished=true;cleanup();resolve(result);};
        const stop=why=>{if(finished||reason)return;reason=why;
          stopTimer=setTimeout(()=>finish({state:'unknown',reason:'native_view_termination_unconfirmed'}),5000);
          try{child?.kill();}catch{/* Do not claim termination. */}};
        const abort=()=>stop('cancelled');
        try{
          child=spawn(binary.path,['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',encoded],{
            shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{SystemRoot:systemRoot,WINDIR:systemRoot,
              PATH:path.win32.join(systemRoot,'System32')}});
          child.once('error',()=>stop('native_viewer_start_failed'));
          child.stdout.on('data',chunk=>{if(finished||reason)return;if(chunk.length>32){stop('invalid_native_protocol');return;}
            output+=chunk.toString('utf8');if(output.length>32||!/^(?:SHOWN\r?\n)?(?:CLOSED\r?\n)?$/u.test(output)){
            // Partial line is accepted only if it is a prefix of the fixed protocol.
            if(!['SHOWN','SHOWN\r','SHOWN\nCLOSED','SHOWN\r\nCLOSED','SHOWN\r\nCLOSED\r'].some(prefix=>prefix.startsWith(output)))stop('invalid_native_protocol');
          }
          shown=/^SHOWN\r?\n/u.test(output);closed=/^SHOWN\r?\nCLOSED\r?\n$/u.test(output);});
          child.stdout.on('error',()=>stop('native_viewer_io_failed'));child.stdin.on('error',()=>stop('native_viewer_io_failed'));
          child.once('close',code=>{if(reason)return finish(reason==='cancelled'?{state:'cancelled',reason}:fail(reason));
            if(!current())return finish(signal.aborted?{state:'cancelled',reason:'cancelled'}:fail('original_authorization_changed'));
            return finish(code===0&&shown&&closed?{state:'shown'}:fail('native_window_not_observed'));});
          activeStops.add(abort);signal.addEventListener('abort',abort,{once:true});
          if(disposed){stop('cancelled');return;}
          const after=executable();
          if(!current()||!after||after.path!==binary.path||after.fingerprint!==binary.fingerprint||after.dev!==binary.dev
            ||after.ino!==binary.ino||after.size!==binary.size||after.mtimeNs!==binary.mtimeNs||after.ctimeNs!==binary.ctimeNs
            ||after.birthtimeNs!==binary.birthtimeNs){stop(signal.aborted?'cancelled':'original_authorization_unavailable');return;}
          watchTimer=setInterval(()=>{if(!current())stop(signal.aborted?'cancelled':Date.now()>=deadline?'deadline_expired':'original_authorization_changed');},250);
          child.stdin.end(JSON.stringify({text}));text='';
        }catch{if(child)stop('native_viewer_start_failed');else finish(fail('native_viewer_start_failed'));}
      });
    },
  };
}
