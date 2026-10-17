import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSpring, springTrack, trackVelocity, springAt } from '../src/spring.ts';
import { geometryMesh } from '../src/motion-profiles.ts';

test('spring converges and remains stable after a long frame without unbounded substeps', () => {
  let point = { value: 112, velocity: 0 };
  for (let index = 0; index < 120; index++) point = stepSpring(point, 388, 1 / 60);
  assert.ok(Math.abs(point.value - 388) < .001);
  assert.ok(Math.abs(point.velocity) < .001);
  assert.deepEqual(stepSpring({ value: 112, velocity: 0 }, 388, 30), stepSpring({ value: 112, velocity: 0 }, 388, .05));
});

test('retargeting preserves sampled position and velocity instead of restarting from rest', () => {
  const opening = springTrack(112, 388, 280);
  const middle = opening[5];
  assert.ok(middle.velocity > 0);
  const closing = springTrack(middle.value, 112, 200, middle.velocity);
  assert.deepEqual(closing[0], middle);
  assert.equal(trackVelocity(opening, 280 * 5 / (opening.length - 1), 280), middle.velocity);
  assert.deepEqual(closing.at(-1), { value: 112, velocity: 0 });
  assert.ok(closing.length <= 513,'finite error-bounded track independent of monitor refresh');
});

test('invalid physics parameters cannot create NaN animation tracks or long loops', () => {
  for (const delta of [-1, NaN, Infinity]) assert.throws(() => stepSpring({ value: 0, velocity: 0 }, 1, delta));
  for (const duration of [0, -1, Infinity, 451]) assert.throws(() => springTrack(0, 1, duration));
  assert.throws(() => springTrack(NaN, 1, 200));
});

test('closing reaches its target without a forced final step or velocity reset',()=>{
  const end=springAt(360,112,190,190),near=springAt(360,112,190,189.99);
  assert.deepEqual(end,{value:112,velocity:0});
  assert.ok(Math.abs(near.value-end.value)<.000001);
  assert.ok(Math.abs(near.velocity)<.001);
  for(let t=1;t<190;t++){
    const eps=.0001;
    const derivative=(springAt(360,112,190,t+eps).value-springAt(360,112,190,t-eps).value)/(eps/500);
    assert.ok(Math.abs(derivative-springAt(360,112,190,t).velocity)<.001);
  }
});

test('the same elapsed time gives the same state across variable presentation intervals',()=>{
  for(const rate of [60,120,144,165,240,280]){
    const track=springTrack(112,360,290);
    let previous=112;
    for(let time=0;time<=290;time+=1000/rate){
      const point=springAt(112,360,290,time);
      assert.ok(point.value>=previous-1e-8&&point.value<=360);
      previous=point.value;
      assert.ok(Math.abs(trackVelocity(track,time,290)-point.velocity)<.75,'sub-pixel-per-second sampling error');
    }
    assert.deepEqual(springAt(112,360,290,290),{value:360,velocity:0});
  }
});

test('adaptive keyframe mesh retains bounded geometry error with fewer keyframes',()=>{
  const points=Array.from({length:513},(_,i)=>({
    width:springAt(112,360,290,290*i/512).value,
    height:springAt(34,172,290,290*i/512,0,'gentle').value,
    radius:springAt(17,28,290,290*i/512,0,'responsive').value,
  }));
  const indices=geometryMesh(points);
  assert.ok(indices.length<200&&indices.length>16);
  let error=0;
  for(let segment=1;segment<indices.length;segment++){
    const left=indices[segment-1],right=indices[segment];
    for(let i=left;i<=right;i++)for(const key of ['width','height','radius']){
      const mix=(i-left)/(right-left);
      error=Math.max(error,Math.abs(points[i][key]-(points[left][key]+(points[right][key]-points[left][key])*mix)));
    }
  }
  assert.ok(error<.03,`maximum mesh error ${error}`);
});
