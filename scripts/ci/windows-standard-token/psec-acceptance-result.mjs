// Acceptance is stricter than exit 0: the named real root and every expected
// scenario must execute, with one unambiguous complete TAP summary and no skip/TODO.
export function assessPsecTap(run,rootName,minimumTests){
  const log=(run.stdout??'')+(run.stderr??'');
  const summary={};
  for(const field of ['tests','pass','fail','cancelled','skipped','todo']){
    const values=[...log.matchAll(new RegExp('^# '+field+' (\\d+)$','gmu'))];
    if(values.length!==1)return {accepted:false,reason:'missing-or-duplicate-summary'};
    summary[field]=Number(values[0][1]);
  }
  const roots=[...log.matchAll(/^ok \d+ - (.+)$/gmu)].map(match=>match[1]);
  const accepted=run.status===0&&!run.error&&!run.signal&&roots.length===1&&roots[0]===rootName
    &&summary.tests>=minimumTests&&summary.pass===summary.tests
    &&['fail','cancelled','skipped','todo'].every(field=>summary[field]===0)
    &&!/^\s*(?:not ok\b|ok\s+\d+\b.*#\s*(?:SKIP|TODO)\b)/imu.test(log);
  return {accepted,summary,reason:accepted?'all-real-scenarios-passed':'real-scenarios-incomplete'};
}
