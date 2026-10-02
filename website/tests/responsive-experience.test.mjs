import test from 'node:test';
import assert from 'node:assert/strict';
import {getJourneyLayout, getFlowJourneyProgress} from '../src/lib/journey-layout.mjs';
import {getJourneyMotion} from '../src/lib/care-journey-motion.mjs';

const profiles = [
  ['scaled Windows laptop', 1280, 590, 'pinned'],
  ['standard laptop', 1366, 768, 'pinned'],
  ['portrait monitor', 960, 1536, 'flow'],
  ['large portrait monitor', 1080, 1920, 'flow'],
  ['tablet', 768, 1024, 'flow'],
  ['phone', 390, 844, 'pinned'],
];

test('each screen gets a composition that fits its usable viewport', () => {
  for (const [name, width, height, expected] of profiles) {
    assert.equal(getJourneyLayout({width, height, reducedMotion: false}), expected, name);
  }
});

test('the old 599px and 700px cutoffs no longer remove laptop choreography', () => {
  for (const height of [480, 500, 599, 600, 699, 700]) {
    assert.equal(getJourneyLayout({width: 1280, height}), 'pinned', `height ${height}`);
  }
  assert.equal(getJourneyLayout({width: 1280, height: 479}), 'static');
});

test('short phones use readable content while compact desktop choreography remains enabled', () => {
  for (const [width, height, expected] of [
    [390, 599, 'static'], [390, 600, 'pinned'],
    [760, 599, 'static'], [761, 599, 'pinned'], [761, 480, 'pinned'],
  ]) assert.equal(getJourneyLayout({width, height}), expected, `${width}×${height}`);
});

test('flow requires adequate width, height and a genuinely tall aspect ratio', () => {
  for (const [width, height, expected] of [
    [760, 1200, 'pinned'], [761, 1200, 'flow'],
    [768, 999, 'pinned'], [768, 1000, 'flow'],
    [800, 1000, 'flow'], [801, 1000, 'pinned'],
  ]) assert.equal(getJourneyLayout({width, height}), expected, `${width}×${height}`);
});

test('reduced motion always selects readable content, including after a resize', () => {
  for (const [name, width, height] of profiles) {
    assert.equal(getJourneyLayout({width, height, reducedMotion: true}), 'static', name);
  }
  const resizeSequence = [[1280, 590], [960, 1536], [390, 844], [1280, 479], [1280, 590]];
  assert.deepEqual(resizeSequence.map(([width, height]) => getJourneyLayout({width, height})),
    ['pinned', 'flow', 'pinned', 'static', 'pinned']);
});

test('the Today panel draws successive attempts as it enters, then holds its completed state', () => {
  const progress = top => getFlowJourneyProgress('today', top, 640, 1440);
  const initial = getJourneyMotion(progress(1152));
  const underway = getJourneyMotion(progress(844.8));
  const complete = getJourneyMotion(progress(640));
  assert.ok(initial.attempts.every(attempt => attempt.draw === 0));
  assert.ok(underway.attempts.slice(0, 2).every(attempt => attempt.ended > .999));
  assert.ok(underway.attempts[2].draw > 0 && underway.attempts[2].draw < 1);
  assert.ok(complete.attempts.every(attempt => attempt.ended === 1));
  assert.equal(complete.scene['attempt-captions'], 1);
  assert.equal(progress(2000), progress(1152));
  assert.equal(progress(-640), progress(640));
  assert.equal(progress(896), .48);
});

test('the cycle panel draws its return line on entry and reverses on upward scrolling', () => {
  const progress = top => getFlowJourneyProgress('cycle', top, 640, 1440);
  const positions = [1152, 896, 640, 896, 1152];
  const returns = positions.map(top => getJourneyMotion(progress(top)).scene.return);
  assert.equal(returns[0], 0);
  assert.ok(returns[1] > 0 && returns[1] < 1);
  assert.equal(returns[2], 1);
  assert.equal(returns[3], returns[1]);
  assert.equal(returns[4], returns[0]);
  assert.equal(progress(2000), .74);
  assert.equal(progress(-640), 1);
});
