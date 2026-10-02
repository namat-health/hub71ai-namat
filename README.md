# Namat · Hub71+ AI Hackathon, 2 October 2026

Team **namat** · Track: Move to, settle in and build a future in Abu Dhabi

Namat helps people who have just moved to Abu Dhabi bring their health history with them. A newcomer answers a short health questionnaire and uploads the blood tests they had before the move. Namat reads the values from the report, and a Namat doctor checks them in the doctor portal.

## Live demo

- https://namat.health/welcome: start here
- https://start.namat.health/welcome: questionnaire and report upload
- https://doctor.namat.health: doctor portal (Microsoft sign-in, Namat staff only)

## What's in this repo

<!-- sources:start -->
| Folder | What it is | Live at | Copied from |
| --- | --- | --- | --- |
| `welcome/` | Landing page: `site/` is exactly what is served, `src/` is its Astro source | https://namat.health/welcome | namat-website `8686a08`, source namat-hackathon `cdf4aca` |
| `start/` | Questionnaire, report upload, confirmation emails and the report reader | https://start.namat.health/welcome | start.namat.health `0654781` |
| `doctor-portal/` | Doctor portal: patient list, report review, plan | https://doctor.namat.health | doctor-portal `c6f8661` |
| `api/` | Shared Namat API between the portal and the questionnaire backend | (internal) | namat-api `cc9e624` |
<!-- sources:end -->

Each folder has its own README with how to run and test it.
