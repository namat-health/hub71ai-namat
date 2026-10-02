-- Lab catalogue: who sells blood tests, what each offering contains and what it costs.
-- scripts/lab-catalog.mjs applies this once per schema, replacing __SCHEMA__:
-- lab_catalog holds real providers; lab_catalog_demo holds the fictional demo providers.
CREATE SCHEMA IF NOT EXISTS __SCHEMA__;

CREATE DOMAIN __SCHEMA__.emirate AS text
  CHECK (VALUE IN ('abu_dhabi','dubai','sharjah','ajman','umm_al_quwain','ras_al_khaimah','fujairah'));

-- One row per brand (Intel Lab, PureLab, DarDoc...).
CREATE TABLE __SCHEMA__.providers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  type text NOT NULL CHECK (type IN ('lab','home_collection_service','hospital_clinic')),
  website text,
  booking_phone text,
  booking_whatsapp text,
  booking_url text,
  licence_authority text CHECK (licence_authority IN ('doh','dha','mohap')),
  licence_number text,
  accreditation text[] NOT NULL DEFAULT '{}',
  performing_lab_note text,       -- who actually runs the samples, when the provider says so
  price_list_contact jsonb CHECK (jsonb_typeof(price_list_contact) = 'object'),
  notes text
);

-- Where a provider collects and what a visit costs. Fees apply once per visit, not per test.
CREATE TABLE __SCHEMA__.collection_options (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES __SCHEMA__.providers(id) ON DELETE CASCADE,
  emirate __SCHEMA__.emirate NOT NULL,
  mode text NOT NULL CHECK (mode IN ('home','walk_in')),
  -- none: no fee; flat: always fee_aed; free_above: fee_aed until the order reaches
  -- free_above_aed (fee_aed NULL = fee below the threshold not stated);
  -- all_inclusive: prices already include the visit.
  fee_rule text NOT NULL CHECK (fee_rule IN ('none','flat','free_above','all_inclusive','not_stated')),
  fee_aed numeric(10,2) CHECK (fee_aed >= 0),
  free_above_aed numeric(10,2) CHECK (free_above_aed > 0),
  minimum_order_aed numeric(10,2) CHECK (minimum_order_aed > 0),
  areas text[],                   -- home visits: areas covered; NULL = not stated
  turnaround_hours integer CHECK (turnaround_hours > 0),
  turnaround_text text,
  source_url text,
  checked_on date,
  UNIQUE (provider_id, emirate, mode),
  CHECK (fee_rule <> 'flat' OR fee_aed IS NOT NULL),
  CHECK ((fee_rule = 'free_above') = (free_above_aed IS NOT NULL)),
  CHECK (fee_rule IN ('flat','free_above') OR fee_aed IS NULL)
);

-- Walk-in addresses.
CREATE TABLE __SCHEMA__.branches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES __SCHEMA__.providers(id) ON DELETE CASCADE,
  name text,
  address text NOT NULL,
  area text,
  emirate __SCHEMA__.emirate NOT NULL,
  latitude numeric(8,5) CHECK (latitude BETWEEN 22 AND 27),
  longitude numeric(8,5) CHECK (longitude BETWEEN 51 AND 57),
  hours text,
  source_url text,
  checked_on date
);
CREATE INDEX branches_provider_idx ON __SCHEMA__.branches(provider_id);

-- Master list. Starts as the clinical knowledge base's markers (source 'kb').
CREATE TABLE __SCHEMA__.biomarkers (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  category text NOT NULL CHECK (category IN ('lipids','glycaemic','liver','kidney','blood-count','iron','vitamins-minerals',
    'thyroid','sex-hormones','inflammation','infection','other')),
  specimens text[] NOT NULL CHECK (cardinality(specimens) > 0 AND specimens <@ ARRAY['blood','urine','stool']),
  hlmcs_tier text CHECK (hlmcs_tier IN ('mandatory','optional-recommended','not-listed')),
  restriction text NOT NULL DEFAULT 'none' CHECK (restriction IN ('none','consent')),
  loinc text[] NOT NULL DEFAULT '{}',
  source text NOT NULL CHECK (source IN ('kb','added'))
);

-- Standard groups a doctor can order as one (lipid panel, full blood count...).
CREATE TABLE __SCHEMA__.biomarker_groups (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL
);
CREATE TABLE __SCHEMA__.biomarker_group_members (
  group_id text NOT NULL REFERENCES __SCHEMA__.biomarker_groups(id) ON DELETE CASCADE,
  biomarker_id text NOT NULL REFERENCES __SCHEMA__.biomarkers(id),
  PRIMARY KEY (group_id, biomarker_id)
);

-- One row per product a provider sells, under its own marketing name.
-- A single test is an offering with one biomarker.
CREATE TABLE __SCHEMA__.offerings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES __SCHEMA__.providers(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  kind text NOT NULL CHECK (kind IN ('single_test','panel','package')),
  description text,
  includes_other text[] NOT NULL DEFAULT '{}',   -- non-lab items in the price: consultation, ECG...
  specimen text[] NOT NULL DEFAULT '{}' CHECK (specimen <@ ARRAY['venous_blood','finger_prick','urine','stool','saliva']),
  fasting text NOT NULL DEFAULT 'not_stated' CHECK (fasting IN ('required','not_required','not_stated')),
  turnaround_hours integer CHECK (turnaround_hours > 0),
  turnaround_text text,
  stated_biomarker_count integer CHECK (stated_biomarker_count > 0),
  contents_complete boolean NOT NULL DEFAULT false,   -- we hold the provider's full list
  url text,
  checked_on date,
  notes text,
  UNIQUE (provider_id, slug)
);

-- What's inside each offering. Items not yet matched to the master list keep their
-- printed name with biomarker_id NULL, so an offering's full size is still known.
CREATE TABLE __SCHEMA__.offering_biomarkers (
  offering_id bigint NOT NULL REFERENCES __SCHEMA__.offerings(id) ON DELETE CASCADE,
  printed_name text NOT NULL CHECK (length(printed_name) BETWEEN 1 AND 300),
  biomarker_id text REFERENCES __SCHEMA__.biomarkers(id),
  calculated boolean NOT NULL DEFAULT false,      -- reported as a calculation (e.g. eGFR)
  mapped_by text,                                 -- how the match was made
  verified_by text,                               -- the person who confirmed it; NULL = unchecked
  PRIMARY KEY (offering_id, printed_name),
  CHECK (biomarker_id IS NOT NULL OR (mapped_by IS NULL AND verified_by IS NULL))
);
CREATE INDEX offering_biomarkers_biomarker_idx ON __SCHEMA__.offering_biomarkers(biomarker_id) WHERE biomarker_id IS NOT NULL;

-- Prices per emirate, kept as history: a new check adds a row.
-- emirate NULL = one price wherever the provider collects.
CREATE TABLE __SCHEMA__.offering_prices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offering_id bigint NOT NULL REFERENCES __SCHEMA__.offerings(id) ON DELETE CASCADE,
  emirate __SCHEMA__.emirate,
  price_aed numeric(10,2) NOT NULL CHECK (price_aed > 0),
  list_price_aed numeric(10,2) CHECK (list_price_aed > price_aed),   -- the crossed-out price during a promo
  price_type text NOT NULL DEFAULT 'list' CHECK (price_type IN ('list','promo','contracted','indicative')),
  vat text NOT NULL DEFAULT 'not_stated' CHECK (vat IN ('included','excluded','not_stated')),
  source text NOT NULL CHECK (source IN ('website','price_list','quote')),
  source_url text,
  checked_on date NOT NULL,
  valid_until date,
  UNIQUE NULLS NOT DISTINCT (offering_id, emirate, checked_on)
);

-- Latest unexpired price per offering and emirate.
CREATE VIEW __SCHEMA__.current_prices AS
SELECT DISTINCT ON (offering_id, emirate) *
FROM __SCHEMA__.offering_prices
WHERE valid_until IS NULL OR valid_until >= current_date
ORDER BY offering_id, emirate, checked_on DESC, id DESC;

-- One readable row per offering and current price, for browsing.
CREATE VIEW __SCHEMA__.catalogue AS
SELECT p.name AS provider, o.name AS offering, o.kind, cp.emirate, cp.price_aed, cp.list_price_aed, cp.price_type,
  (SELECT count(*) FROM __SCHEMA__.offering_biomarkers b WHERE b.offering_id = o.id)::int AS items,
  (SELECT count(*) FROM __SCHEMA__.offering_biomarkers b WHERE b.offering_id = o.id AND b.biomarker_id IS NOT NULL)::int AS matched,
  o.contents_complete, o.includes_other, cp.checked_on, o.url, p.slug AS provider_slug, o.id AS offering_id
FROM __SCHEMA__.offerings o
JOIN __SCHEMA__.providers p ON p.id = o.provider_id
LEFT JOIN __SCHEMA__.current_prices cp ON cp.offering_id = o.id;
