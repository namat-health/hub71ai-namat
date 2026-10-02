# Public claim ledger

This file records the source and wording guardrails for public Namat claims. Marketing copy remains centralised in `src/data/content.ts`.

## Company deck

The supplied `NamatHealth_September2026.pdf` supports the core preventive-health model, Abu Dhabi positioning, founders, audience, care cycle and waitlist-stage copy.

## Founder capability update — 21 September 2026

The founder confirmed that Namat now tests more than 150 biomarkers and approved the public headline “Look deeper across 150+ biomarkers. Catch 1,000+ diseases earlier.” The founder also approved naming the condition examples visible in the supplied reference recording.

Supporting wording should use “signals,” “indicators,” “patterns associated with,” or equivalent language. The global website notice continues to state that the site provides general information rather than medical advice.

This wording also follows the [NIH definition of biomarkers](https://www.nih.gov/nih-style-guide/appendix-biomedical-definitions) as measurable indicators of biological state or processes, and preserves the distinction between association and causation.

Approved example condition names for the capability visualization:

- Chronic liver disease
- Pancreatic cancer
- Ovarian cancer
- Sickle cell disease
- Diabetes
- Rheumatoid arthritis
- Mold toxicity
- Anemia
- Gout
- Chronic kidney disease
- Hashimoto’s thyroiditis
- Prostate cancer
- Lead toxicity
- Hypogonadism
- Lupus
- Coronary artery disease
- Hypothyroidism
- Alzheimer’s disease

## Medical leadership — 21 September 2026

The founder approved the title **Co-founder and Chief Medical Officer** for Dr. Miguel Gómez Bravo and requested a patient-facing profile instead of the homepage's two-founder/investor section. The supplied `Dr.Bravo.png` is the visual and biographical reference. Public copy is in `content.medicalLeadership`.

Verified credentials:

- European Board-Certified **plastic surgeon**; do not imply board certification in preventive medicine.
- Fellowship at Beth Israel Deaconess Medical Center / Harvard Medical School; do not imply a Harvard medical degree.
- **Previous** clinical practice at Cleveland Clinic Abu Dhabi; not a current appointment or institutional endorsement of Namat.
- Executive MBA from IESE Business School; no claim of a healthcare-specific degree concentration.
- Practising in Abu Dhabi; background in research, education, medical leadership and patient safety.

Primary sources reviewed: [American Society of Plastic Surgeons member profile](https://www.plasticsurgery.org/md/Miguel-Bravo-MD.html), [Elyzee Hospital profile](https://www.elyzee.ae/en/doctors/dr-miguel-bravo.html), [Dr. Bravo’s biography](https://drbravoplasticsurgery.com/about), and [Cleveland Clinic Abu Dhabi’s own profile post](https://www.linkedin.com/posts/cleveland-clinic-abu-dhabi_clevelandclinicabudhabi-activity-7270029114953121792-zogh). The certification year is omitted because the member profile and personal biography differ by one year.

LinkedIn and Instagram are the selected public profiles. Facebook adds little further context; the personal website is focused on plastic-surgery services and is deliberately not a Namat conversion link. Investor details, pilot-zero references and patient-count anecdotes are excluded. Institution cards describe Dr. Bravo’s education and past experience, not Namat affiliations.

The portrait and three institutional marks in `public/assets/leadership/` are the original embedded images extracted from page 6 of the supplied full-quality deck (`output/pdf/Namat Health - September 2026 - Full quality.pdf`), optimised to transparent WebP. They are not generated substitutes or screenshot crops.

### Longevity training and profile refinement

Dr. Bravo’s [public LinkedIn activity](https://ae.linkedin.com/in/dr-miguel-bravo), reviewed 21 September 2026, reports further longevity training and the Certified Longevity Physician credential from Geneva College of Longevity Science. His post discusses metabolic health, nutrition, exercise, sleep and care beyond the postoperative period. The [issuer describes the course as continuing medical education](https://gcls.study/course/certified-longevity-physician-cme-course); completion is self-reported by Dr. Bravo, not checked against an independent recipient registry.

The site says **additional training in longevity medicine**. This must not be changed to board certification in longevity or preventive medicine. The following sentence about personalised protocols and ongoing review describes his user-approved role at Namat, not a claim of established longevity outcomes.

At the founder’s request, the three institution logos now float without visible card captions. Their alternative text retains the precise fellowship, previous-practice and MBA relationships. They are presented within Dr. Bravo’s profile, not as Namat partners.

## Expanded consumer FAQs — 21 September 2026

The thirteen homepage FAQs cover the care cycle, audience, biomarker interpretation, medical leadership, support, retesting, relationship to existing care, Abu Dhabi availability, pricing/insurance and waitlist handling. They do not promise dates, fixed retest intervals, appointment availability, prices, coverage, response times or a particular testing venue.

The test-results explanation is based on [NIH MedlinePlus: How to Understand Your Lab Results](https://medlineplus.gov/lab-tests/how-to-understand-your-lab-results/): an isolated result is not a diagnosis, and reference ranges do not establish or exclude every condition. This does not independently substantiate the panel-specific “1,000+” headline. The care model and 150+ count remain based on founder-approved company information.

The waitlist answers follow the actual form, double opt-in implementation and `/privacy/` notice. Unconfirmed service details are explicitly left open. Existing development-stage messaging elsewhere on the site is outside this refinement’s scope and should receive a separate founder-approved consistency review.

## Healthspan section — 29 September 2026 (local, not published)

The new section after the hero uses the global figures from the Global Burden of Disease Study 2023 morbidity-gap analysis:

- Life expectancy at birth: **73.8 years** (global, both sexes, 2023)
- Healthy life expectancy (HALE) at birth: **63.1 years**
- Difference ("years spent in poor health"): **10.7 years** (95% uncertainty interval 8.2–13.7), about 14.5% of life

Primary sources reviewed:

- [IHME news release, 21 July 2026](https://www.healthdata.org/news-events/newsroom/news-releases/people-are-living-longer-spending-more-years-poor-health), which states all three figures, the 1990 comparison (64.6 / 55.9 / 8.8) and the sex split (women 12.1 years, men 9.3 years).
- Hay SI et al. "Global, regional, and national trends in the morbidity gap and contributing diseases, injuries, and risk factors, 1990–2023: a systematic analysis for the Global Burden of Disease Study 2023." *The Lancet Public Health* 2026; 11(8): e487–e505. [doi:10.1016/S2468-2667(26)00098-8](https://doi.org/10.1016/S2468-2667(26)00098-8). Only the abstract was reviewed, on [IHME's publication page](https://www.healthdata.org/research-analysis/library/global-regional-and-national-trends-morbidity-gap-and-contributing); the full text is paywalled.
- GBD 2023 Demographics Collaborators. *Lancet* 2025; 406: 1731–1810, [Table 1](https://pmc.ncbi.nlm.nih.gov/articles/PMC12535839/): global life expectancy at birth in 2023 was 73.8 (73.6–74.1).

Wording rules:

- Label the figures as **global averages at birth, 2023**. Never present them as UAE or Abu Dhabi figures.
- The source says the gap builds up across adult life, not only at the end. Do not write "the last decade of life", "at the end of life" or "healthy until 63". HALE is a summary measure, not an age.
- "Years spent/lived in poor health" is IHME's own wording and is acceptable. Headlines that call those years "lost life" should say "healthy life". The founder chose the number-free headline “Living longer isn’t the same as living well.”
- No outcome claims: Namat must not be said to add, restore or protect a number of healthy years, or to close the gap.
- Founder decision, 29 September 2026: the footprint trails are an accentuated illustration, not a chart. They show adult life from age 30, and the healthy-life trail starts dimming before the 63.1 mark and fades almost to nothing by the end. At first the on-page source line ended “Illustrative, not to scale”. At the founder’s request (29 September, one-screen layout), the longer note explaining the age-30 start and the grouping of poor-health years was removed from the page, and the 10.7 caption reads “Years lived in poor health” without “on average” (later shown as the clay annotation “10.7 years in poor health” under the bracket). Later the same day the founder removed the visible source line entirely, so the page no longer shows “Global averages at birth, 2023”, the IHME attribution or “Illustrative, not to scale”. The screen-reader summary still reads “Worldwide in 2023 … On average … Source: IHME, Global Burden of Disease Study 2023.” The figures are still never labelled as UAE figures. Risk accepted by the founder: without a visible label, visitors in Abu Dhabi may assume the figures are local. That evening the founder asked for the source back: the page again shows “Global averages at birth, 2023 · Source: IHME, Global Burden of Disease Study 2023” (without “Illustrative, not to scale”). The exact figures appear only in text labels. No ages are marked on the trails.
- Do not reproduce IHME charts or downloaded IHME data files. Cite the figures with attribution.

UAE alternatives reviewed, not used:

- WHO Global Health Estimates 2021 (GHO indicators WHOSIS_000001 / WHOSIS_000002), UAE 2021: life expectancy 78.3, HALE 67.3, gap 11.0. Male 77.2 / 67.4 (9.8); female 80.0 / 66.8 (13.2). For 2019: 81.4 / 69.7 (11.7). Not used because 2021 was a pandemic year and WHO methods differ from IHME's.
- IHME GBD 2023, UAE: life expectancy 80.1 (79.6–80.6) was read in Table 1. **UAE HALE is not yet verified.** It is in the GHDx "GBD 2023 Morbidity Gap Estimates 1990–2023" CSV, which requires an IHME login. Switch to UAE figures only after the UAE row has been read and recorded here.
- No Abu Dhabi Department of Health or SCAD healthy-life-expectancy figure has been found.

Implementation: the figures live once in `content.healthspan`. The 10.7 displayed on the page is derived from them (`roundGap` in `src/lib/healthspan-relief.mjs`). `tests/healthspan-relief.test.mjs` checks the derived gap, the position of the 63.1 mark on the age-30-to-73.8 illustration, and that the healthy-life trail only ever fades.

Closing line “Namat is built around the second number.”: removed from the page on 29 September 2026 at the founder’s request and parked (not in `content.ts`). Its meaning now opens the care-journey section as “You want the good years to last. So do we.” (founder choice). It states the reader’s wish and Namat’s shared aim, and makes no outcome claim. Both need CMO sign-off before publication.

Status: the global figures are verified against IHME primary sources. The founder must approve the section before publication.
