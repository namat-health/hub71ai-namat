import {entryHref, resolveStartUrl, startCanonical} from '../lib/attribution.mjs';

// Unset locally and until the subdomain is live, so CTAs keep using /start/.
export const START_URL = resolveStartUrl(import.meta.env.PUBLIC_START_URL);
export const START_CANONICAL = startCanonical(START_URL);
export const startHref = (page: string, placement: string) => entryHref(START_URL, page, placement);
