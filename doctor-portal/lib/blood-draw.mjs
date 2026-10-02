import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMIRATES, quote, SORT_LABEL } from "./lab-quote.mjs";

// Where a patient can have the doctor-approved tests drawn, from the lab catalogue
// snapshot in data/lab-catalogue (one file per emirate, exported from the namat-website
// lab_catalog schema). Branches carry no coordinates and the questionnaire records only
// the emirate, so "closest" means providers collecting in the patient's emirate.
export const CATALOGUE_DIR = join(process.cwd(), "data", "lab-catalogue");
export const EMIRATE_NAMES = {
  abu_dhabi: "Abu Dhabi",
  dubai: "Dubai",
  sharjah: "Sharjah",
  ajman: "Ajman",
  umm_al_quwain: "Umm Al Quwain",
  ras_al_khaimah: "Ras Al Khaimah",
  fujairah: "Fujairah",
};
const MAX_PLACES = 3;
const cache = new Map();

function readCatalogue(dir, name) {
  const key = join(dir, `${name}.json`);
  if (!cache.has(key)) cache.set(key, JSON.parse(readFileSync(key, "utf8")));
  return cache.get(key);
}

// The questionnaire stores the emirate with hyphens ("abu-dhabi"); the catalogue uses
// underscores. Anything else (or no answer) falls back to Abu Dhabi, and says so.
export function patientEmirate(location) {
  const emirate =
    typeof location === "string" ? location.trim().replaceAll("-", "_") : "";
  return EMIRATES.includes(emirate)
    ? { emirate, assumed: false }
    : { emirate: "abu_dhabi", assumed: true };
}

// The catalogue biomarker behind an approved plan test: the grounding knowledge ID
// ("marker:ferritin"), else the test ID ("marker-ferritin"). Screening tests have none.
export function testBiomarker(test, grounding) {
  const knowledgeId = grounding?.tests?.find(
    (item) => item.testId === test.id,
  )?.knowledgeId;
  if (typeof knowledgeId === "string" && knowledgeId.startsWith("marker:"))
    return knowledgeId.slice("marker:".length);
  return typeof test.id === "string" && test.id.startsWith("marker-")
    ? test.id.slice("marker-".length)
    : null;
}

/**
 * Up to `limit` options in the patient's emirate for these catalogue biomarkers,
 * sorted by the catalogue's sort-v1 rule, each with its branches (walk-in) or the
 * areas it lists for home visits. Returns null when no test can be priced.
 */
export function closestBloodDraws({
  location,
  biomarkers,
  limit = 3,
  dir = CATALOGUE_DIR,
}) {
  const names = readCatalogue(dir, "biomarkers").biomarkers;
  const wanted = [...new Set(biomarkers.filter(Boolean))];
  const known = wanted.filter((id) => Object.hasOwn(names, id));
  if (!known.length) return null;
  const { emirate, assumed } = patientEmirate(location);
  const data = readCatalogue(dir, emirate);
  const result = quote(data, { biomarkers: known, emirate, limit });
  const nameOf = (id) => names[id] || id;
  return {
    emirate,
    emirateName: EMIRATE_NAMES[emirate],
    assumed,
    fictional: Boolean(data.fictional),
    sortLabel: SORT_LABEL,
    requested: known.map(nameOf),
    coversAll: result.covers_all,
    options: result.options.map((option) => {
      const provider = data.providers.find(
        (item) => item.slug === option.provider.slug,
      );
      return {
        provider: option.provider.name,
        mode: option.mode,
        totalAed: option.total_aed,
        visitFeeAed: option.visit_fee_aed,
        feeRule: option.fee_rule,
        coversAll: option.covers_all,
        covered: option.covered.length,
        missing: option.missing.map(nameOf),
        notOrdered: option.not_ordered,
        turnaround: option.turnaround_text,
        prices: option.offerings.map((offering) => ({
          name: offering.name,
          priceAed: offering.price_aed,
          url: offering.url,
          checkedOn: offering.checked_on,
        })),
        places:
          option.mode === "walk_in"
            ? data.branches
                .filter((branch) => branch.provider === option.provider.slug)
                .slice(0, MAX_PLACES)
                .map(({ name, address, area, hours }) => ({
                  name,
                  address,
                  area,
                  hours,
                }))
            : [],
        homeAreas:
          option.mode === "home"
            ? provider?.options.find((item) => item.mode === "home")?.areas ||
              null
            : null,
      };
    }),
  };
}
