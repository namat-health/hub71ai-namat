// Geometry for the healthspan footprint trails. Pure and deterministic so the labels and
// screen-reader copy always come from the same sourced statistics as the art.
//
// The trails are an illustration, not a chart: they show adult life from age 30 and let the
// healthy-life trail fade before, through and after the healthy-life-expectancy mark, so the
// years in poor health read at a glance (founder decision, 29 September 2026).

/** Distance between consecutive prints, in print lengths (a natural adult walking step). */
export const STEP = 2.2;
/** Each baked sprite is 480×240 with a 300px-long foot centred in it. */
export const SPRITE_TO_PRINT = 1.6;
/** Illustrated trails begin at this age. */
export const ILLUSTRATION_FROM_AGE = 30;

/** Height of a trail's band, in print lengths: room for a hip-width stance plus shadows. */
export const BAND = 1.5;
// Distance from the trail's centre line to each foot's centre, in print lengths. Standing feet
// sit hip-width apart; walking steps land a little closer to the line, as they do in real gait.
export const STANCE_OFFSET = 0.36;
export const WALK_OFFSET = 0.29;
const TOE_OUT = 7;
const STEP_JITTER = [0.03, -0.04, 0.02, -0.02, 0.04, -0.03, 0.01, -0.01];
const SIDE_JITTER = [0.015, -0.01, 0.01, -0.015, 0.01, 0, -0.01, 0.015];
const ANGLE_JITTER = [0.8, -1.1, 0.4, -0.5, 1.2, -0.3, 0.9, -1.3];
const VARIANTS = [1, 2, 2, 1, 2, 1, 1, 2];

/** Gradual decline: full depth, then dimming before the mark, then fading almost to nothing. */
export const DECLINE = {start: 0.42, atMark: 0.55, end: 0.06};

export const roundGap = (lifeExpectancy, healthyLifeExpectancy) =>
  Math.round((lifeExpectancy - healthyLifeExpectancy) * 10) / 10;

const round = (value) => Math.round(value * 1e4) / 1e4;
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (from, to, t) => from + (to - from) * t;

/** How deep a print is (1 = full depth, 0 = gone) at `position` along the healthy-life trail. */
export function healthyDepth(position, mark) {
  if (position <= DECLINE.start) return 1;
  if (position <= mark) return lerp(1, DECLINE.atMark, smooth((position - DECLINE.start) / (mark - DECLINE.start)));
  return lerp(DECLINE.atMark, DECLINE.end, Math.min(1, (position - mark) / (1 - mark)));
}

/** Sprite opacities that express a depth: deep sprites give way to faint ones, then fade out. */
export function depthAlphas(depth) {
  if (depth >= 0.5) return {deep: round(depth * 2 - 1), faint: round(2 - depth * 2)};
  return {deep: 0, faint: round(depth * 2)};
}

/**
 * One trail walking left to right: both feet side by side (a standing start), then `steps`
 * alternating prints one step apart. `x` and `y` are fractions of the trail's length and band
 * height; `beat` orders the walk (the standing pair share beat 0).
 */
export function getTrail({steps, depthAt = () => 1}) {
  if (!Number.isInteger(steps) || steps < 2) throw new RangeError('A trail needs at least two steps');
  const printLength = 1 / (1 + steps * STEP);
  const prints = [];
  const place = (foot, beat, advance, offset, index) => {
    const side = foot === 'left' ? -1 : 1;
    const x = printLength / 2 + advance * printLength;
    const depth = depthAt(x);
    prints.push({
      index,
      foot,
      beat,
      stance: beat === 0,
      variant: VARIANTS[index % VARIANTS.length],
      x: round(x),
      y: round(0.5 + (side * offset) / BAND),
      rotate: round(side * TOE_OUT + ANGLE_JITTER[index % ANGLE_JITTER.length]),
      depth: round(depth),
      ...depthAlphas(depth),
    });
  };

  place('left', 0, 0, STANCE_OFFSET, 0);
  place('right', 0, 0, STANCE_OFFSET, 1);
  for (let beat = 1; beat <= steps; beat++) {
    const foot = beat % 2 === 1 ? 'left' : 'right';
    const jitter = beat < steps ? STEP_JITTER[beat % STEP_JITTER.length] : 0;
    place(foot, beat, beat * STEP + jitter, WALK_OFFSET + SIDE_JITTER[beat % SIDE_JITTER.length], beat + 1);
  }

  return {
    prints,
    beats: steps + 1,
    printLength: round(printLength),
    // Sprite width as a fraction of the trail's length.
    width: round(printLength * SPRITE_TO_PRINT),
    aspectRatio: round(1 / (printLength * BAND)),
  };
}

/** Both trails for one layout: life expectancy (walked in full) and healthy life expectancy. */
export function getHealthspanRelief({lifeExpectancy, healthyLifeExpectancy, steps, fromAge = ILLUSTRATION_FROM_AGE}) {
  if (!(healthyLifeExpectancy > fromAge && healthyLifeExpectancy < lifeExpectancy)) {
    throw new RangeError('Healthy life expectancy must fall between the illustrated start age and life expectancy');
  }
  const mark = (healthyLifeExpectancy - fromAge) / (lifeExpectancy - fromAge);
  return {
    mark: round(mark),
    gap: roundGap(lifeExpectancy, healthyLifeExpectancy),
    life: getTrail({steps}),
    healthy: getTrail({steps, depthAt: (position) => healthyDepth(position, mark)}),
  };
}
