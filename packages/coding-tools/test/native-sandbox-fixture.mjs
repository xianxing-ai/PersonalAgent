// Test-only classification of actual native probe receipts; never an OS capability substitute.
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

// Read the inherited Windows token without logging account names, groups or paths.
// This does not launch a business command or change the helper's elevation guard.
export function nativeTokenDiagnostic(){
  if(process.platform!=='win32')return {platform:process.platform,administratorToken:'not-windows'};
  const result=spawnSync(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',
      '$p = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],
    {encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:4096});
  const value=result.stdout?.trim();
  return {platform:process.platform,administratorToken:result.status===0&&/^(True|False)$/u.test(value)?value==='True':'diagnostic-unavailable'};
}

export function unsupportedPsec(receipt){
  const baseline=receipt?.results?.baseline;
  const unavailable=result=>result?.backend==='windows-psec'&&result.enforced===false&&result.outcome==='unavailable'&&result.stopped===true
    &&/^native-create-environment:(?:-2146233067|-2146233052|-2146233053|50|120)$/u.test(result.reason??'');
  return receipt?.available===false&&receipt.enforced===false&&baseline?.backend==='none'&&baseline.outcome==='exited'
    &&baseline.exitCode===0&&baseline.stopped===true&&['readOnly','workspaceWrite','cancel'].every(key=>unavailable(receipt.results[key]));
}
