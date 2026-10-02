/** Choose a composition from usable CSS pixels, independent of browser or device. */
export function getJourneyLayout({width, height, reducedMotion}) {
  if (reducedMotion || height < 480) return 'static';
  // A narrow, short viewport cannot fit the mobile heading and vertical timeline.
  if (width <= 760 && height < 600) return 'static';
  if (width >= 761 && height >= 1000 && width / height <= .8) return 'flow';
  return 'pinned';
}

/** Draw each unpinned portrait panel as it enters the viewport. */
export function getFlowJourneyProgress(phase, panelTop, panelHeight, viewportHeight) {
  const entered = Math.max(0, Math.min(1, (viewportHeight * .8 - panelTop) / Math.max(1, panelHeight * .8)));
  return phase === 'today' ? .37 + entered * .22 : .74 + entered * .26;
}
