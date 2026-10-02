import test from 'node:test';
import assert from 'node:assert/strict';
import {BAND, DECLINE, depthAlphas, getHealthspanRelief, getTrail, healthyDepth, roundGap, STEP} from '../src/lib/healthspan-relief.mjs';

const IHME_2023 = {lifeExpectancy: 73.8, healthyLifeExpectancy: 63.1};

test('the headline gap is the rounded difference of the sourced figures', () => {
  assert.equal(roundGap(73.8, 63.1), 10.7);
  for (const [le, hale] of [[78.3, 67.3], [80.1, 69.4], [71.4, 61.9], [82.25, 70.1]]) {
    assert.equal(roundGap(le, hale), Math.round((le - hale) * 10) / 10);
  }
});

test('the healthy-life mark sits where 63.1 falls on an adult life drawn from age 30', () => {
  const {mark} = getHealthspanRelief({...IHME_2023, steps: 7});
  assert.ok(Math.abs(mark - (63.1 - 30) / (73.8 - 30)) < 1e-4);
});

for (const steps of [3, 5, 7]) {
  test(`${steps}-step trails walk in full, then fade on the healthy-life trail`, () => {
    const {life, healthy, mark} = getHealthspanRelief({...IHME_2023, steps});
    assert.ok(life.prints.every(print => print.depth === 1 && print.deep === 1 && print.faint === 0), 'life expectancy is walked at full depth');

    const depths = healthy.prints.map(print => print.depth);
    depths.slice(1).forEach((depth, index) => assert.ok(depth <= depths[index] + 1e-9, 'quality never recovers along the trail'));
    assert.equal(healthy.prints[0].depth, 1, 'the walk starts in good health');
    assert.ok(healthy.prints.some(print => print.x < mark && print.depth < 1), 'dimming starts before the healthy-life mark');
    assert.ok(healthy.prints.at(-1).depth < 0.2, 'the final print has almost disappeared');
  });
}

test('prints are spaced like a real walk and start from a standing stance', () => {
  const {prints, printLength, beats} = getTrail({steps: 7});
  assert.equal(prints.length, 9);
  assert.equal(beats, 8);
  assert.equal(prints[0].x, prints[1].x, 'standing start: both feet side by side');
  assert.deepEqual([prints[0].foot, prints[1].foot], ['left', 'right']);
  for (let index = 2; index < prints.length; index++) {
    const gap = prints[index].x - prints[index - 1].x;
    assert.ok(gap > printLength * (STEP - 0.1) && gap < printLength * (STEP + 0.1), `step ${index} is a natural step length`);
    assert.notEqual(prints[index].foot, prints[index - 1].foot, 'feet alternate');
  }
  assert.ok(Math.abs(prints.at(-1).x + printLength / 2 - 1) < 1e-3, 'the walk fills the trail');
  assert.ok(prints.filter(print => print.foot === 'left').every(print => print.y < .5), 'left prints walk on the upper side');

  // Measured centre to centre across the trail, in print lengths.
  const across = (a, b) => Math.abs(a.y - b.y) * BAND;
  const stance = across(prints[0], prints[1]);
  assert.ok(stance >= 0.65 && stance <= 0.8, `standing feet are hip-width apart (${stance})`);
  for (let index = 3; index < prints.length; index++) {
    const walking = across(prints[index], prints[index - 1]);
    assert.ok(walking < stance && walking > stance * 0.7, `walking steps stay proportionate to the stance (${walking})`);
  }
});

test('depth maps to deep and faint sprite opacities without gaps', () => {
  assert.deepEqual(depthAlphas(1), {deep: 1, faint: 0});
  assert.deepEqual(depthAlphas(.5), {deep: 0, faint: 1});
  assert.deepEqual(depthAlphas(.25), {deep: 0, faint: .5});
  assert.equal(healthyDepth(DECLINE.start, .75), 1);
  assert.ok(Math.abs(healthyDepth(.75, .75) - DECLINE.atMark) < 1e-9);
  assert.ok(Math.abs(healthyDepth(1, .75) - DECLINE.end) < 1e-9);
});

test('invalid statistics are rejected rather than drawn', () => {
  assert.throws(() => getHealthspanRelief({lifeExpectancy: 60, healthyLifeExpectancy: 70, steps: 5}), RangeError);
  assert.throws(() => getHealthspanRelief({lifeExpectancy: 73.8, healthyLifeExpectancy: 25, steps: 5}), RangeError);
  assert.throws(() => getTrail({steps: 1}), RangeError);
});
