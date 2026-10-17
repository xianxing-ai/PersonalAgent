import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

test('dist-only image layout resolves the public observation implementation and declarations without src', async () => {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const scratch = fileURLToPath(new URL('../../../.cache/mod32-package/', import.meta.url));
  await mkdir(scratch, {recursive:true});
  const fixture = await mkdtemp(path.join(scratch, 'dist-only-'));
  // Same two asset classes as image-context.mjs: package manifest and dist.
  await cp(path.join(packageRoot, 'package.json'), path.join(fixture, 'package.json'));
  await cp(path.join(packageRoot, 'dist'), path.join(fixture, 'dist'), {recursive:true});
  for (const filename of ['index.mjs', 'index.d.mts', 'reader.mjs', 'reader.d.mts']) {
    assert.deepEqual(await readFile(path.join(fixture, 'dist/observability', filename)),
      await readFile(path.join(packageRoot, 'src/observability', filename)), 'Built observation asset must match the current source');
  }
  await assert.rejects(access(path.join(fixture, 'src')), {code:'ENOENT'});
  const manifest = JSON.parse(await readFile(path.join(fixture, 'package.json'), 'utf8'));
  const entry = manifest.exports['./observability'];
  for (const key of ['import', 'types']) {
    assert.ok(entry[key].startsWith('./dist/'));
    await access(path.resolve(fixture, entry[key]));
  }
  const readerEntry = manifest.exports['./observability/reader'];
  for (const key of ['import', 'types']) {
    assert.ok(readerEntry[key].startsWith('./dist/'));
    await access(path.resolve(fixture, readerEntry[key]));
  }
  const declaration = await readFile(path.resolve(fixture, entry.types), 'utf8');
  assert.match(declaration, /export function projectTraceObservation\(/);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import {projectTraceObservation, projectRunLogObservation, buildRunLogPath}
      from '@personal-agent/agentarts/observability';
    const trace = projectTraceObservation({total:0,span_list:[]},'synthetic-trace');
    assert.equal(trace.requestCorrelation.status,'not_checked');
    assert.equal(trace.deploymentVersion,'unavailable');
    assert.equal(projectRunLogObservation({count:0,is_query_complete:true,logs:[]}).returnedLogCount,0);
    assert.match(buildRunLogPath({agentRunId:'synthetic-run',startTime:'1792020000000',endTime:'1792020060000',limit:1}), /limit=1/);
    const reader = await import('@personal-agent/agentarts/observability/reader');
    assert.equal(typeof reader.readAgentArtsTraceObservation,'function');
    assert.equal(typeof reader.readAgentArtsRunLogs,'function');
  `], {cwd:fixture, encoding:'utf8', timeout:10_000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
