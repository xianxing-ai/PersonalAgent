import test from 'node:test';
import assert from 'node:assert/strict';
import {planOwnedImageBuild,correlateOwnedImageControlPlane} from '../dist/owned-image-build.js';

const planInput={sourceRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),recipeId:'f26-owned-image-release',imageTag:'pr531-fixture',
  registryRepository:'swr.example.com/org/pa',scriptDigest:'c'.repeat(64),architecture:'arm64'};
const expected={runtimeId:'runtime-1',runtimeName:'pa-owned',endpointId:'endpoint-1',endpointName:'v1',version:'v1',imageDigest:'sha256:'+'d'.repeat(64)};
test('the build plan does not invent an image digest, probe, or real acceptance',()=>{
  const plan=planOwnedImageBuild(planInput);
  assert.equal(plan.state,'planned_not_built');assert.equal(plan.imageDigest,null);assert.equal(plan.containerExecution,'unverified');
  assert.equal(plan.readinessProbe,'unverified');assert.equal(plan.runtimeReady,'not_read');assert.equal(plan.realEnvironmentAcceptance,'not_performed');
  assert.throws(()=>planOwnedImageBuild({...planInput,imageTag:'latest'}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>planOwnedImageBuild({...planInput,architecture:'amd64'}),{code:'INVALID_ARGUMENT'});
});
test('control-plane READY does not verify the container or the readiness probe',()=>{
  const plan=planOwnedImageBuild(planInput);
  const missing=correlateOwnedImageControlPlane(plan,expected);
  assert.equal(missing.state,'unavailable');assert.equal(missing.readinessProbe,'unverified');
  const matched=correlateOwnedImageControlPlane(plan,expected,{...expected,imageTag:plan.imageTag,architecture:'arm64',runtimeReady:true,containerExecution:'passed',readinessProbe:'passed'});
  assert.equal(matched.state,'control_plane_matched');assert.equal(matched.runtimeReady,true);
  assert.equal(matched.containerExecution,'unverified');assert.equal(matched.readinessProbe,'unverified');assert.equal(matched.routingChanged,false);
  const other=correlateOwnedImageControlPlane(plan,expected,{...expected,version:'other',endpointName:'other',imageTag:plan.imageTag,architecture:'arm64',runtimeReady:true});
  assert.equal(other.state,'rejected');assert.equal(other.runtimeReady,'not_read');
});
