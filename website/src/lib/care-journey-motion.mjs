const clamp = value => Math.max(0, Math.min(1, value));
const between = (progress, start, end) => {
  const value = clamp((progress - start) / (end - start));
  return value * value * (3 - 2 * value);
};

/** Pure scroll choreography: the same position always produces the same scene. */
export function getJourneyMotion(progress) {
  const p = clamp(Number.isFinite(progress) ? progress : 0);
  const spread = between(p, .16, .37);
  return {
    scene: {
      spread,
      portraits: 1 - between(p, .16, .34),
      opening: 1 - between(p, .18, .32),
      'timeline-heading': between(p, .25, .38),
      today: between(p, .30, .38) * (1 - between(p, .62, .71)),
      'today-layout': between(p, .24, .38) * (1 - between(p, .60, .71)),
      'attempt-captions': 1 - between(p, .59, .64),
      cycle: between(p, .64, .77),
      endpoints: spread,
      connection: between(p, .62, .78),
      return: between(p, .78, .93),
      merge: between(p, .62, .73),
    },
    attempts: [.37, .435, .50].map(start => {
      const phase = (p - start) / .055;
      return {
        started: between(phase, 0, .12),
        draw: between(phase, 0, .52),
        segmentA: between(phase, .48, .64),
        segmentB: between(phase, .62, .76),
        segmentC: between(phase, .74, .86),
        ended: between(phase, .87, 1),
      };
    }),
  };
}
