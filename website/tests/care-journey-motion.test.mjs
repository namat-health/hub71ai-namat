import test from 'node:test';
import assert from 'node:assert/strict';
import {getJourneyMotion} from '../src/lib/care-journey-motion.mjs';

const attemptKeys = ['started', 'draw', 'segmentA', 'segmentB', 'segmentC', 'ended'];
const starts = [.37, .435, .50];
const duration = .055;
const closeTo = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
};

test('journey opens on the portraits and finishes on the complete care cycle', () => {
  const initial = getJourneyMotion(0);
  assert.deepEqual(initial.scene, {
    spread: 0,
    portraits: 1,
    opening: 1,
    'timeline-heading': 0,
    today: 0,
    'today-layout': 0,
    'attempt-captions': 1,
    cycle: 0,
    endpoints: 0,
    connection: 0,
    return: 0,
    merge: 0,
  });
  assert.equal(initial.attempts.length, 3);
  initial.attempts.forEach(attempt => attemptKeys.forEach(key => assert.equal(attempt[key], 0)));

  const final = getJourneyMotion(1);
  assert.deepEqual(final.scene, {
    spread: 1,
    portraits: 0,
    opening: 0,
    'timeline-heading': 1,
    today: 0,
    'today-layout': 0,
    'attempt-captions': 0,
    cycle: 1,
    endpoints: 1,
    connection: 1,
    return: 1,
    merge: 1,
  });
  final.attempts.forEach(attempt => attemptKeys.forEach(key => assert.equal(attempt[key], 1)));
});

test('progress outside the scroll scene clamps to its nearest endpoint', () => {
  assert.deepEqual(getJourneyMotion(-10), getJourneyMotion(0));
  assert.deepEqual(getJourneyMotion(10), getJourneyMotion(1));
  for (let index = -20; index <= 120; index++) {
    const state = getJourneyMotion(index / 100);
    for (const values of [state.scene, ...state.attempts]) {
      for (const [key, value] of Object.entries(values)) {
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${key} remains in [0, 1]`);
      }
    }
  }
});

test('the established opening portrait, check-up, and headline timings are preserved', () => {
  for (const [key, start, end, reversed] of [
    ['spread', .16, .37, false],
    ['endpoints', .16, .37, false],
    ['portraits', .16, .34, true],
    ['opening', .18, .32, true],
    ['timeline-heading', .25, .38, false],
  ]) {
    closeTo(getJourneyMotion(start).scene[key], reversed ? 1 : 0, `${key} start`);
    closeTo(getJourneyMotion((start + end) / 2).scene[key], .5, `${key} midpoint`);
    closeTo(getJourneyMotion(end).scene[key], reversed ? 0 : 1, `${key} end`);
    const quarterValue = getJourneyMotion(start + (end - start) / 4).scene[key];
    closeTo(quarterValue, reversed ? .84375 : .15625, `${key} uses smoothstep easing`);
  }
});

test('attempts draw one at a time and leave a pause before the next starts', () => {
  starts.forEach((start, index) => {
    const during = getJourneyMotion(start + duration * .3).attempts;
    assert.ok(during[index].draw > 0 && during[index].draw < 1);
    assert.equal(during[index].started, 1);
    assert.equal(during[index].ended, 0);
    during.slice(0, index).forEach(attempt => assert.equal(attempt.ended, 1));
    during.slice(index + 1).forEach(attempt => attemptKeys.forEach(key => assert.equal(attempt[key], 0)));

    if (index < starts.length - 1) {
      const gap = getJourneyMotion((start + duration + starts[index + 1]) / 2).attempts;
      attemptKeys.forEach(key => assert.equal(gap[index][key], 1));
      attemptKeys.forEach(key => assert.equal(gap[index + 1][key], 0));
    }
  });
});

test('each attempt draws its solid line, fragments, and only then its end mark', () => {
  const windows = {
    started: [0, .12],
    draw: [0, .52],
    segmentA: [.48, .64],
    segmentB: [.62, .76],
    segmentC: [.74, .86],
    ended: [.87, 1],
  };
  starts.forEach((start, index) => {
    for (const [key, [from, to]] of Object.entries(windows)) {
      const sample = offset => getJourneyMotion(start + duration * offset).attempts[index][key];
      closeTo(sample(from), 0, `attempt ${index + 1} ${key} start`);
      closeTo(sample((from + to) / 2), .5, `attempt ${index + 1} ${key} midpoint`);
      closeTo(sample(to), 1, `attempt ${index + 1} ${key} finish`);
    }
    const beforeEnd = getJourneyMotion(start + duration * .865).attempts[index];
    assert.equal(beforeEnd.draw, 1);
    assert.equal(beforeEnd.segmentA, 1);
    assert.equal(beforeEnd.segmentB, 1);
    assert.equal(beforeEnd.segmentC, 1);
    assert.equal(beforeEnd.ended, 0);
  });
});

test('the completed fragmented timeline holds before the continuous cycle appears', () => {
  const hold = getJourneyMotion(.57);
  assert.equal(hold.scene.today, 1);
  assert.equal(hold.scene['today-layout'], 1);
  assert.equal(hold.scene['attempt-captions'], 1);
  assert.equal(hold.scene.cycle, 0);
  assert.equal(hold.scene.connection, 0);
  assert.equal(hold.scene.merge, 0);
  hold.attempts.forEach(attempt => attemptKeys.forEach(key => assert.equal(attempt[key], 1)));
});

test('fragment merging overlaps Today and the growing connection for a continuous transition', () => {
  const transitioning = getJourneyMotion(.665).scene;
  for (const key of ['today', 'cycle', 'connection', 'merge']) {
    assert.ok(transitioning[key] > 0 && transitioning[key] < 1, `${key} is active during the hand-off`);
  }
  assert.equal(transitioning.return, 0);
  assert.equal(getJourneyMotion(.73).scene.merge, 1);
  assert.equal(getJourneyMotion(.71).scene.today, 0);
  assert.equal(getJourneyMotion(.71).scene['today-layout'], 0);
  assert.equal(getJourneyMotion(.64).scene['attempt-captions'], 0);
  assert.equal(getJourneyMotion(.78).scene.connection, 1);
  assert.equal(getJourneyMotion(.93).scene.return, 1);
});

test('forward scrolling never reverses an individual draw or reintroduces a faded portrait', () => {
  const increasingSceneKeys = ['spread', 'timeline-heading', 'cycle', 'endpoints', 'connection', 'return', 'merge'];
  let previous = getJourneyMotion(0);
  for (let index = 1; index <= 1000; index++) {
    const next = getJourneyMotion(index / 1000);
    increasingSceneKeys.forEach(key => assert.ok(next.scene[key] >= previous.scene[key], key));
    ['portraits', 'opening', 'attempt-captions'].forEach(key => assert.ok(next.scene[key] <= previous.scene[key], key));
    next.attempts.forEach((attempt, attemptIndex) => {
      attemptKeys.forEach(key => assert.ok(attempt[key] >= previous.attempts[attemptIndex][key], `attempt ${attemptIndex + 1} ${key}`));
    });
    previous = next;
  }
});

test('scrolling back recreates the same state without remembered animation progress', () => {
  const earlier = getJourneyMotion(.46);
  getJourneyMotion(1);
  assert.deepEqual(getJourneyMotion(.46), earlier);
  getJourneyMotion(0);
  assert.deepEqual(getJourneyMotion(.46), earlier);
});
