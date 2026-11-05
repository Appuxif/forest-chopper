import test from 'node:test';
import assert from 'node:assert/strict';
import {validHenPoses} from '../src/hen-pose.js';
test('corpse pose persistence rejects invalid transforms and unbounded records',()=>{
 const p={id:'hen:0,0:0:g0',bones:[{name:'Spine',p:[0,.1,0],q:[0,0,0,1]}]};
 assert.equal(validHenPoses([p]),true);
 assert.equal(validHenPoses([p,p]),false);
 assert.equal(validHenPoses([{...p,bones:[{...p.bones[0],p:[NaN,0,0]}]}]),false);
 assert.equal(validHenPoses([{...p,bones:[{...p.bones[0],q:[0,0,0,0]}]}]),false);
 assert.equal(validHenPoses(Array(33).fill(p)),false);
});
