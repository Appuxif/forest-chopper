import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceTutorial} from '../src/tutorial.js';

test('tutorial advances only on matching real gameplay milestone in correct order',()=>{
  assert.equal(advanceTutorial(0,'tree-fell'),0);
  assert.equal(advanceTutorial(0,'log-placed'),0);
  assert.equal(advanceTutorial(0,'tree-aimed'),1);
  assert.equal(advanceTutorial(1,'tree-aimed'),1);
  assert.equal(advanceTutorial(1,'log-placed'),1);
  assert.equal(advanceTutorial(1,'tree-fell'),2);
  assert.equal(advanceTutorial(2,'tree-fell'),2);
  assert.equal(advanceTutorial(2,'log-placed'),3);
  assert.equal(advanceTutorial(3,'tree-aimed'),3);
  assert.equal(advanceTutorial(3,'log-placed'),3);
  assert.equal(advanceTutorial(-1,'tree-aimed'),-1);
});
