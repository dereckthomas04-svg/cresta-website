# Cresta Agency — agency website

A complete, production-ready agency site: premium design, 5 languages (EN/ES/FR/PT/DE), lead capture, and a **real** website audit tool.
No build step, no npm dependencies.

## Run locally
```bash
node server.js          # http://localhost:8080
npm test                # offline tests (scoring, HTML analysis, SSRF guard, lead validation)
```
Leads are saved to `data/leads.jsonl` locally, and are also emailed or posted to a webhook if those are configured (see below).

## Deploy (Netlify — recommended)
1. Push this folder to GitHub and import it in Netlify. `netlify.toml` already sets `public/` + functions.
2. In Site settings → Environment variables, add the values from `.env.example`.
3. Done: `/api/inspect` and `/api/lead` run as Netlify Functions.

Any Node host (Render, Railway, Fly, a VPS) also works: `node server.js`.

## Before launch — edit `public/js/config.js`
- `email`, `phone`, `whatsapp`, `hours`, `location` (footer and contact section), optional `bookingUrl` (e.g. Calendly)
- `psiKey`: free Google PageSpeed Insights API key. Without one, Google's shared quota runs out quickly. Restrict the key to your domain.
- `ga4Id` and/or `plausibleDomain` for analytics. Nothing loads if these are empty.
- `testimonials`: **real ones only**, with permission. The section shows an honest placeholder until you add some.
- Have `privacy.html` and `terms.html` (templates) reviewed for your jurisdiction.
- Replace `crestaagency.com` in `index.html`, `robots.txt` and `sitemap.xml` with your domain, and add `public/img/og.png` (1200×630).

## Lead delivery (`.env`)
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `LEADS_TO_EMAIL`, optional `FROM_EMAIL` (plain address is fine) | Email every lead to you, and email audit reports to customers who ask for a copy |
| `LEADS_WEBHOOK_URL` | POST each lead as JSON to Zapier/Make/Google Sheets/your CRM |

If no channel is configured on Netlify, forms say "not connected yet" and show your email instead. They never pretend a message was sent.

## How the audit works (nothing is invented)
| Category | Source |
|---|---|
| Speed & performance, Accessibility | Google Lighthouse via PageSpeed Insights (mobile + desktop) |
| SEO | Lighthouse SEO score + on-page checks (title, meta, H1, canonical, schema, noindex, lang) |
| Mobile | Lighthouse mobile audits + viewport tag + mobile performance and CLS |
| Security & HTTPS | Backend: HTTPS, HTTP→HTTPS redirect, HSTS, mixed content, CSP and other headers |
| UX, Conversion, CTAs, Content | Backend HTML signals (marked "Automated signals" in the report) |
| Design | **Never auto-scored.** The report shows Lighthouse's mobile screenshot and offers a manual review |

If a source fails (quota used up, site unreachable, backend missing), those categories show "Could not be checked" with the reason, and they're left out of the overall score.
PageSpeed is called from the visitor's browser (no serverless timeout problems). The backend scanner guards against SSRF: it blocks private/internal IPs, checks every redirect, and limits time and response size.

## Structure
```
public/            static site (index.html, css/, js/, img/, privacy.html, 404.html)
public/js/         app.js · audit-core.js (scoring) · config.js · i18n-*.js
lib/               inspect.js (scanner) · lead.js · api.js (shared handlers)
netlify/functions/ inspect.mjs · lead.mjs
server.js          zero-dependency Node server
```
