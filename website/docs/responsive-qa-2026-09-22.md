# Responsive troubleshooting — 22 September 2026

## Reproduced causes

- Production was current: HTML revalidated, assets had content-hashed URLs, and no service worker was present. This was not reproduced as a stale-cache issue.
- At 1280 × 590 CSS pixels, with reduced motion **off**, the previous journey was hidden and the five cards used ordinary flow. JavaScript disabled the journey below 600px; CSS disabled stacking below 700px. Windows display scaling can produce this usable viewport on a much larger physical screen.
- All portrait screens previously inherited the phone composition and viewport-height-based spacing. Tall monitors reserved three full screens for the journey.
- Tablet and very narrow layouts also exposed footer overflow from legacy flex styles.

## Changes

- Compact desktop choreography and card stacking remain available down to 480px usable height.
- Tall, sufficiently wide screens use three compact panels with the same people, Today diagram and care cycle; the lines still draw on scroll. No multi-screen empty pinning runway.
- Phone choreography remains unchanged at normal heights. Very short phones and reduced-motion users receive complete readable content.
- Card heights reserve space for the header, chapter navigation, all five stack caps and bottom clearance. Equal bottom margins prevent earlier images peeking above the final card.
- Both header navigation variants target `/#membership`.
- Footer columns adapt before their minimum content widths overflow.

## Verification

Tested in connected Chrome with explicit CSS viewport overrides; no Windows/Edge installation or remote HP session was available. These tests reproduce the layout conditions, not the mother's exact browser configuration.

| Viewport | Verified presentation |
| --- | --- |
| 1280 × 590 and 1280 × 500 | Animated journey; compact stacked cards fit fully; final image caps stay concealed |
| 1280 × 599 / 600 / 699 / 700 | No unexpected choreography cutoff at the former boundaries |
| 1366 × 768 and 1440 × 900 | Desktop choreography and card stacking |
| 768 × 1024 | Compact portrait sequence; no horizontal overflow |
| 960 × 1536 and 1080 × 1920 | Compact portrait sequence; no duplicated scenes after resizing |
| 390 × 844 | People → Today → completed cycle, all visible in their intended states |
| 390 × 480 and 320 × 568 | Readable short-screen fallback; no horizontal overflow |
| 1280 × 479 | Complete readable fallback |

Also checked flow → pinned → static → pinned resizing, duplicate DOM IDs, loaded images, hero video readiness, header anchor navigation and card text bounds. No browser console errors were recorded. Reduced-motion mode selection is unit-tested; the rendered static fallback was inspected through the short-height mode, not an OS preference change.

An isolated release was built from the Git index, excluding unrelated waitlist/funnel work. `astro check`: zero diagnostics. All 24 release tests passed. Build and built-route/asset verification passed.
