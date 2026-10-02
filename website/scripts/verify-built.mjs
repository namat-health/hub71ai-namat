import {readFileSync, existsSync, readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /class="landing mvp-home"/, 'production serves the launch homepage');
assert.equal((html.match(/<h1\b/g) || []).length, 1, 'one H1');
assert.equal((html.match(/<form\b/g) || []).length, 1, 'one shared form');
assert.match(html, /Your health,<br\b[^>]*>expertly managed/, 'homepage uses the approved two-line hero headline');
assert.ok(html.includes('Tailor-made plans and direct 1:1 doctor access, all in one platform.'), 'homepage uses the approved hero supporting copy');
assert.ok(!html.includes('aria-label="Namat planned care cycle"'), 'homepage care-cycle ticker is removed');
const homeHero = html.match(/<section\b(?=[^>]*\bdata-home-hero(?:\s|=|>))(?=[^>]*\bdata-hero(?:\s|=|>))[^>]*>[\s\S]*?<\/section>/)?.[0];
assert.ok(homeHero, 'homepage has its dedicated hero while retaining shared motion hooks');
assert.match(homeHero, /<h1\b[^>]*\bid="hero-title"[^>]*>/, 'hero retains its labelled H1');
assert.match(homeHero, /\bdata-header-morph-trigger(?:\s|=|>)/, 'hero preserves the header morph trigger');
assert.equal((html.match(/<video\b/g) || []).length, 1, 'homepage contains exactly one background video');
const heroVideo = homeHero.match(/<video\b(?=[^>]*\bdata-hero-video(?:\s|=|>))[^>]*>/)?.[0];
assert.ok(heroVideo, 'background video has its playback hook');
for (const attribute of ['muted', 'loop', 'playsinline']) {
  assert.match(heroVideo, new RegExp(`\\s${attribute}(?=[\\s=>])`), `background video is ${attribute}`);
}
assert.match(heroVideo, /\spreload="none"/, 'background video does not preload before motion preferences are checked');
assert.match(heroVideo, /\sdata-src="\/assets\/hero\/namat-hero\.mp4\?v=3-review-v1"/, 'background video references the cache-busted production film');
assert.doesNotMatch(heroVideo, /\ssrc=/, 'background video source is attached by the playback controller');
const heroPoster = homeHero.match(/<img\b(?=[^>]*\ssrc="\/assets\/hero\/namat-hero-poster\.webp\?v=3-review-v1")[^>]*>/)?.[0];
assert.ok(heroPoster, 'hero has a real poster image for loading and static fallbacks');
assert.match(heroPoster, /\sloading="eager"/, 'hero poster loads eagerly');
assert.match(heroPoster, /\sfetchpriority="high"/, 'hero poster is prioritised');
assert.match(heroPoster, /\swidth="[1-9]\d*"/, 'hero poster declares a positive intrinsic width');
assert.match(heroPoster, /\sheight="[1-9]\d*"/, 'hero poster declares a positive intrinsic height');
const heroMedia = homeHero.match(/<div\b(?=[^>]*\baria-hidden="true")[^>]*>[\s\S]*?<video\b[^>]*>[\s\S]*?<\/div>/)?.[0];
assert.ok(heroMedia, 'decorative background media is hidden from assistive technology');
assert.ok(heroMedia.includes(heroPoster), 'poster belongs to the decorative media container');
assert.ok(!heroMedia.includes('data-hero-video-toggle'), 'video control is outside the aria-hidden media container');
const heroToggle = homeHero.match(/<button\b(?=[^>]*\bdata-hero-video-toggle(?:\s|=|>))[^>]*>/)?.[0];
assert.ok(heroToggle, 'hero has a background motion control');
assert.match(heroToggle, /\saria-label="Play background video"/, 'motion control has an accessible initial action');
assert.match(heroToggle, /\shidden(?=[\s=>])/, 'motion control stays hidden without JavaScript');
assert.ok(existsSync('dist/assets/hero/namat-hero.mp4'), 'production film is included in the build');
assert.ok(existsSync('dist/assets/hero/namat-hero-poster.webp'), 'production poster is included in the build');
assert.ok(!homeHero.includes('temporary hero film placeholder'), 'hero no longer displays the obsolete placeholder note');
for (const required of ['action="/api/waitlist"', 'name="consent" required', 'name="email"', 'class="original-wordmark"', 'data-variant="home"', 'data-product-explainer', 'data-product-motion-toggle', 'Look deeper across 150+ biomarkers.', 'Catch 1,000+ diseases earlier.', '/assets/conditions/chronic-liver-disease.webp', '/assets/conditions/alzheimers-disease.webp', 'Biomarker trend', 'trend-point', 'trend-target']) {
  assert.ok(html.includes(required), `has ${required}`);
}
for (const removed of ['Namat connects patterns across blood', 'Establish your baseline', 'A wider view of what your results may signal.', 'Longitudinal biomarker view', 'Illustrative trend — not patient data', 'biomarker-cursor', 'cursor-halo', 'chart-point', 'range-key']) {
  assert.ok(!html.includes(removed), `removed ${removed}`);
}
const healthspan = html.match(/<section\b(?=[^>]*\bid="healthspan")[^>]*>[\s\S]*?<\/section>/)?.[0];
assert.ok(healthspan, 'homepage has the healthspan section');
const order = ['data-home-hero', 'id="healthspan"', 'data-care-journey', 'data-product-explainer', 'data-health-chapters', 'id="faq"'].map(marker => html.indexOf(marker));
assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), 'homepage runs hero, healthspan, care journey, biomarkers, chapters, FAQ');
assert.match(healthspan, /<h2\b[^>]*\bid="healthspan-title"[^>]*>Living longer isn’t the same as living well\.<\/h2>/, 'healthspan uses the approved headline');
const healthspanText = healthspan.replace(/<[^>]*>/g, '');
for (const required of ['Life expectancy 73.8 years', 'Healthy life expectancy 63.1 years', '10.7 years in poor health', 'Global averages at birth, 2023 · Source: IHME, Global Burden of Disease Study 2023', 'Worldwide in 2023, life expectancy at birth was 73.8 years and healthy life expectancy was 63.1 years. On average, 10.7 years of life are spent in poor health. Source: IHME, Global Burden of Disease Study 2023.']) {
  assert.ok(healthspanText.includes(required), `healthspan shows sourced figure: ${required}`);
}
assert.ok(!/UAE|Abu Dhabi/.test(healthspan), 'global healthspan figures are never labelled as UAE figures');
const reliefSprites = new Set([...healthspan.matchAll(/src="(\/assets\/healthspan\/[^"]+)"/g)].map(match => match[1]));
assert.ok(reliefSprites.size >= 8, 'healthspan trails use baked relief sprites');
for (const sprite of reliefSprites) assert.ok(existsSync(`dist${sprite}`), `relief sprite ${sprite} is built`);
assert.equal((healthspan.match(/<div\b[^>]*class="healthspan-trail [^"]*"[^>]*aria-hidden="true"/g) || []).length, 2, 'decorative relief trails are hidden from assistive technology');
assert.ok(!/<img\b(?![^>]*alt="")[^>]*\/assets\/healthspan\//.test(healthspan), 'relief sprites are decorative images');
for (const required of ['data-care-journey', 'You want the good years to last.', 'With Namat Health', 'New supplements', 'Each cycle informs the next', '/assets/members/proactive-woman.webp', '/assets/members/proactive-man.webp', 'journey-readable', 'journey-time-tick', 'journey-cycle-brand', 'health-lockup-descriptor', 'journey-attempt-tail', 'journey-attempt-end']) {
  assert.ok(html.includes(required), `care journey has ${required}`);
}
assert.equal((html.match(/<div\b[^>]*\bdata-journey-attempt(?:\s|=|>)/g) || []).length, 3, 'Today has three scroll-driven attempts');
assert.ok(!html.includes('journey-fragment'), 'old static Today bars are replaced');
assert.ok(!html.includes('Tried it') && !html.includes('>Stopped<'), 'Today stays free of explanatory status labels');
for (const removed of ['The proposed structure', 'Built around continuity.', 'This is how continuity could feel.', 'class="story-stack"', 'class="cycle-scene"', 'class="audience-scene"', 'journey-lockup', 'journey-with-label']) {
  assert.ok(!html.includes(removed), `old homepage section removed: ${removed}`);
}
const chaptersSection = html.match(/<section\b(?=[^>]*\bid="membership")(?=[^>]*\bdata-health-chapters(?:\s|=|>))[^>]*>[\s\S]*?<\/section>/);
assert.ok(chaptersSection, 'homepage has the five-step health chapters section');
const chapters = chaptersSection[0];
assert.ok(!chapters.includes('chapter-takeaway'), 'chapter cards have no closing slogans');
for (const slogan of ['Your health, in context', 'From results to a personal plan', 'Guidance between appointments', 'A clearer view of your progress', 'Each cycle informs the next']) {
  assert.ok(!chapters.includes(slogan), `removed chapter slogan: ${slogan}`);
}
const chapterHeading = chapters.match(/<h2\b[^>]*\bid="experience-title"[^>]*>([\s\S]*?)<\/h2>/);
assert.ok(chapterHeading, 'health chapters has its labelled heading');
assert.equal(chapterHeading[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), 'Doctor-led care. The latest science, working for you.', 'health chapters uses the concise two-line headline');
for (const removed of ['chapters-eyebrow', 'chapters-close', 'chapters-cta', 'One relationship.', 'A cycle that keeps going.']) {
  assert.ok(!chapters.includes(removed), `chapter clutter removed: ${removed}`);
}
assert.equal((chapters.match(/<article\b[^>]*\bdata-health-chapter(?:\s|=|>)/g) || []).length, 5, 'health chapters has five actual chapter articles');
const chapterLinks = chapters.match(/<a\b[^>]*\bdata-chapter-link(?:\s|=|>)[^>]*>/g) || [];
assert.equal(chapterLinks.length, 5, 'health chapters has five step navigation links');
for (const step of ['baseline', 'plan', 'check-ins', 'retest', 'adjust']) {
  const anchoredChapter = chapters.match(new RegExp(`<div\\b(?=[^>]*\\bid="membership-${step}")(?=[^>]*\\bdata-chapter-anchor(?:\\s|=|>))[^>]*>\\s*</div>\\s*<article\\b(?=[^>]*\\bdata-health-chapter(?:\\s|=|>))(?=[^>]*\\baria-labelledby="chapter-${step}-title")[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(anchoredChapter, `${step}: its scroll anchor immediately precedes the labelled chapter article`);
  assert.match(anchoredChapter[1], new RegExp(`<h3\\b[^>]*\\bid="chapter-${step}-title"[^>]*>[^<]+</h3>`), `${step}: chapter is labelled by its own visible heading`);
  assert.ok(chapterLinks.some(link => link.includes(`href="#membership-${step}"`)), `${step}: navigation links to its chapter`);
  const chapterImage = chapters.match(new RegExp(`<img\\b[^>]*\\bsrc="/assets/how-it-works/${step}\\.webp"[^>]*>`));
  assert.ok(chapterImage, `${step}: uses the approved slide asset`);
  assert.match(chapterImage[0], /\bwidth="758"/, `${step}: image declares its width`);
  assert.match(chapterImage[0], /\bheight="1000"/, `${step}: image declares its height`);
  assert.match(chapterImage[0], /\bloading="lazy"/, `${step}: below-fold image is lazy loaded`);
}
const careJourneyIndex = html.search(/<section\b[^>]*\bdata-care-journey(?:\s|=|>)/);
assert.ok(careJourneyIndex >= 0 && careJourneyIndex < chaptersSection.index, 'health chapters follows the care journey');
// The medical leadership profile is shelved for now (founder request, 29 September 2026).
assert.ok(!html.includes('data-medical-leadership') && !html.includes('id="founders"'), 'medical leadership section is not on the homepage');
for (const removed of ['Chief Medical Officer', 'Gómez Bravo', 'href="/#founders"', '>Our doctor<']) {
  assert.ok(!html.includes(removed), `shelved doctor content stays off the homepage: ${removed}`);
}
const faq = html.match(/<section\b[^>]*\bid="faq"[^>]*>[\s\S]*?<\/section>/)?.[0];
assert.ok(faq, 'homepage has the FAQ section');
assert.ok(faq.includes('Frequently Asked Questions'), 'FAQ uses the requested heading');
assert.ok(!faq.includes('Current status') && !faq.includes('What you should know today') && !faq.includes('eyebrow'), 'FAQ removes the status label and superseded headline');
assert.equal((faq.match(/<details\b/g) || []).length, 12, 'FAQ answers twelve common customer questions');
assert.ok(faq.includes('not diagnoses a single test can confirm or rule out'), 'FAQ distinguishes test signals from diagnoses');
assert.ok(faq.includes('href="/privacy/"'), 'FAQ links to waitlist privacy details');
for (const removed of ['A calmer way to see what matters', 'What we’re building', 'experience-grid', 'development-strip']) {
  assert.ok(!html.includes(removed), `superseded product section removed: ${removed}`);
}
for (const id of ['hero-title', 'healthspan', 'problem', 'approach', 'experience', 'membership', 'audience', 'faq', 'waitlist']) {
  assert.ok(html.includes(`id="${id}"`), `has sourced ${id} section`);
}
// The how-it-works page is retired for now; vercel.json redirects its address to the homepage section.
assert.ok(!existsSync('dist/how-it-works/index.html'), 'retired /how-it-works/ page is not published');
assert.ok(!readFileSync('dist/sitemap.xml', 'utf8').includes('how-it-works'), 'sitemap no longer lists /how-it-works/');
for (const route of ['dune', 'fieldnotes', 'afterglow', 'journal', 'continuum', 'research']) {
  assert.ok(!existsSync(`dist/${route}/index.html`), `internal route /${route}/ is not published`);
}
for (const page of ['index.html', 'privacy/index.html', 'confirmed/index.html']) {
  const output = readFileSync(`dist/${page}`, 'utf8');
  const ids = [...output.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${page}: unique IDs`);
  assert.ok(!/design comparison|Compare designs|Design preview/i.test(output), `${page}: no internal review copy`);
  for (const match of output.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) {
    const url = match[1];
    if (url.startsWith('/api/')) continue;
    assert.ok(existsSync(`dist${url}`) || existsSync(`dist${url}/index.html`), `${page}: local asset/link ${url} exists`);
  }
}
// Old iOS Safari (15-16.3) and Chrome/Edge before 104 ignore range-syntax media queries and the
// unprefixed backdrop blur, so the build must keep the legacy forms (see cssTarget in astro.config.mjs).
const builtCss = readdirSync('dist/_astro').filter(file => file.endsWith('.css')).map(file => readFileSync(`dist/_astro/${file}`, 'utf8')).join('\n');
assert.ok(!/\((?:width|height)\s*[<>]=?/.test(builtCss), 'built CSS keeps legacy min-/max- media queries');
assert.ok(builtCss.includes('-webkit-backdrop-filter:blur(18px)'), 'built CSS keeps the Safari backdrop-filter prefix');
assert.match(builtCss, /@media \(max-width:760px\),\(max-height:500px\) and \(orientation:landscape\) and \(pointer:coarse\)\{\.healthspan-gap\[data-astro-cid-[a-z0-9]+\],\.healthspan-bracket\[data-astro-cid-[a-z0-9]+\]\{display:none\}/, 'phones in either orientation leave out the 10.7 annotation and its bracket');
assert.ok(!/\.healthspan\[data-astro-cid-[a-z0-9]+\]\{display:none/.test(builtCss), 'the healthspan section itself shows on every screen');
assert.ok(existsSync('dist/404.html'), 'custom 404 is built');
assert.ok(existsSync('dist/sitemap.xml'), 'sitemap is built');
assert.ok(existsSync('dist/favicon.svg'), 'favicon is built');
console.log('Public Namat MVP, sourced content, waitlist forms, routes, unique IDs, links and assets verified.');
