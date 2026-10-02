# What is ready, and what remains

This is an implementation note for the private design review, not customer-facing membership information.

## Prepared

- Five separate routes, one shared claim-checked content source and one shared waitlist component.
- Astro pages, locally hosted fonts, mobile layouts, keyboard focus styling and reduced-motion support.
- Existing private GitHub repository and protected Vercel project.
- Shared server endpoint with input and consent validation, same-origin checks, a honeypot, bounded request size, instance-level throttling and provider timeouts.
- Brevo phone verification completed. Dedicated list **Namat website waitlist**, ID **3**.
- Active **Namat waitlist confirmation** template, ID **1**, using the native `{{ doubleoptin }}` confirmation link. The sender is authenticated `hello@updates.namat.health`, with replies to `borja@namat.health`.
- The endpoint checks that the template is active and recognised as a double-opt-in template before requesting confirmation.

## Connection verified end to end

The API key is saved privately as a sensitive Vercel environment variable. Server-side checks verified provider access, the dedicated list, active template recognition and the native confirmation-link variable. On 17 September 2026, the authorized test completed successfully: one form submission with consent, one confirmation email from `hello@updates.namat.health`, one confirmation-link click, and the founder’s address appearing as subscribed in list 3. That record is a setup test, not external member traction.

Incomplete configuration and provider failures return a clear error rather than a successful signup.

All five forms use the same endpoint. A successful provider request means **confirmation pending**, not confirmed membership. Brevo adds the contact to the designated list after the email confirmation action. [Brevo double-opt-in API](https://developers.brevo.com/reference/create-doi-contact)

## Before public launch

Sending-domain authentication is complete: Brevo verified `updates.namat.health` after the approved ownership, two DKIM and subdomain DMARC records were added. Google Workspace mail records were left unchanged. The active confirmation template uses that verified sender.

1. Approve the final company privacy notice and retention policy. The preview notice describes the implemented flow and is explicitly marked as a draft for launch purposes.
2. Add platform-level rate limiting or equivalent bot protection before public exposure. Instance-local throttling is a secondary safeguard, not a distributed rate limiter.
3. Choose the final design, then decide the domain and public launch timing. Deployment protection and no-index settings remain in place during this review.

## Validation completed

Astro checks and the production build pass. Eight shared-backend tests pass. Built-output checks confirm identical sourced sections across all five designs, one shared form on each page, unique IDs and valid internal links/assets. The private GitHub branch passes its automatic checks and produces a protected Vercel preview. Browser testing covered the authorized Dune signup flow; a broader cross-viewport visual audit was not performed.

## Future changes and experiments

Keep changes in the GitHub repository. Each branch can receive a Vercel preview before merging. Keep copy in the shared content file and secrets only in Vercel. The five alternatives are for design selection; later experiments should isolate one change and measure confirmed waitlist signups consistently.

PostHog is optional for a later measurement plan. No Azure account or additional database is needed for these static pages and the Brevo waitlist flow. No analytics tracker has been installed in the preview.
