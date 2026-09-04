# Shared homepage and Audit layout

This update keeps the Cloudflare Pages build command blank and output directory at the repository root. Generated HTML is committed, so visitors do not wait for JavaScript to insert the navigation.

## Routes

- Homepage: /
- Mia Audit: /audit/
- Old /#audit links redirect to /audit/.
- Other pages still link to the existing Carrd website. No domain/DNS changes are needed.

## Edit once, update both pages

- site/components/header.html: shared header.
- site/components/footer.html: shared footer.
- assets/site.css: shared responsive styling.
- site/pages/home.html and assets/home.css: homepage story.
- site/pages/audit.html and assets/audit.css: Audit layout.
- audit-chat.js: existing chat logic, unchanged.

After edits run:

    node build.mjs
    node tests/layout.test.mjs

Then commit the changed sources AND generated index.html and audit/index.html, and push to main.
Do not edit generated HTML directly; the next build replaces it.

## Show or hide navigation

In site/pages.json each page has independent header and footer booleans.
For example, set "header": false and "footer": true to omit only the header.
Run the build after changing them. These are layout settings, not security controls.

## Design and validation

All ten supplied homepage image URLs retain their order, natural aspect ratios and full browser width. The first loads eagerly; the remaining images load lazily. Screenshot-only headings and the closing offer are live text.
The approved Audit/header/footer styling is retained, including the smaller mobile header and subtle violet desktop footer links.
The homepage has no floating Audit bar; the existing bar remains on the Audit page.

Static tests cover shared layout rendering, every header/footer toggle combination, local links, image count, and legacy Audit routing.
Remote images and browser appearance could not be checked in this working environment. Check the published preview on a real phone and laptop before moving the main domain.
Check voice, a complete Audit conversation, and actual delivery separately; a rendered page or intake receipt does not verify report delivery.

The private clinic workspace is a future phase, not part of this release. It needs server-side authorization before any private clinic information is added.
