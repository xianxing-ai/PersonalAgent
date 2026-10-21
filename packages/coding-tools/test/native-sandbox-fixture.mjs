// Test-only classification of actual native probe receipts; never an OS capability substitute.
export function unsupportedPsec(receipt){
  const baseline=receipt?.results?.baseline;
  const unavailable=result=>result?.backend==='windows-psec'&&result.enforced===false&&result.outcome==='unavailable'&&result.stopped===true
    &&/^native-create-environment:(?:-2146233067|-2146233052|-2146233053|50|120)$/u.test(result.reason??'');
  return receipt?.available===false&&receipt.enforced===false&&baseline?.backend==='none'&&baseline.outcome==='exited'
    &&baseline.exitCode===0&&baseline.stopped===true&&['readOnly','workspaceWrite','cancel'].every(key=>unavailable(receipt.results[key]));
}
