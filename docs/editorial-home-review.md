# Editorial home review — 2026-10-12

Base and rollback: `63b365b6f8f4924857edbfbae518467eca3370d7`.

## Scope

Eleven editorial sections, black/ivory palette, serif headlines, matte gold, authentic Bruno portrait, metallic relief SVG icons and tablet/phone composition. Primary CTAs lead to `/radar`; plans retain prices and interest capture. `/` and `/vendas` share home metadata with canonical root. `/radar`, `/privacidade`, `/app`, `/login`, `/local`, authentication and integrations remain intact.

## Reference and truthful content

Visual reference inspected in pixels: `C:\Users\User\Documents\Brunão\WhatsApp Image 2026-10-12 at 17.03.48.jpeg`. All five original photo files were also inspected. The seated monochrome portrait matches the previously confirmed production derivative; provenance remains in `bruno-portrait-assets.json`.

The seven markers are explicitly illustrative. No invented trends, score, clinical validation, testimonial, result, qualification, automatic monitoring or 17-photo feature is advertised. The original reference contains aspirational UI and claims; these are not presented as delivered functionality.

## Device screen provenance

`platform-tablet-demo.jpg` and `platform-phone-demo.jpg` are screenshots of the actual `persistent.js` UI, rendered by the actual backend in an isolated temporary SQLite fixture. Only fictional user `Aluno demonstrativo` and a synthetic `Treino demonstrativo` were used. No production records, personal data or credentials appear. Screens illustrate the implemented home and published training views; fixture prescriptions are not recommendations. Total JPEG payload approximately 91 KB; images lazy-load. Device depth and metallic icons use CSS/SVG without video, canvas, animation or extra libraries.

## Verification

- 11 focused home/routing tests pass locally with real temporary SQLite and a loader that stubs unused sharp/pg imports. Same-origin mockup assets return JPEG/200. Production dependency validation remains a release step.
- Browser inspected desktop 1280px and mobile 390px/320px, hero, markers, actual mockups and FAQ. No horizontal overflow or broken loaded images at those checked widths.
- Mobile menu opens/closes; selecting an anchor closes it and navigates correctly. FAQ expands. Capture cancellation, recoverable failure, synthetic successful submission, focus and return-to-plans verified. Fixed same-document return after capture/confirmation and narrow-header overflow.
- Reduced-motion styles disable smooth scrolling/transitions for this home. Native links/details, descriptive image alternatives, single h1 and skip link retained. No blanket accessibility or Core Web Vitals certification.
- Source changes do not modify production data, authentication, AI, billing or integrations. Backend changes only map the new sales document and two public image assets; Dockerfile includes sales.html.

Desktop/mobile screenshots are in the task's `home-qa` directory. Before deployment: publish a separate branch and rollback reference, run focused tests with actual installed dependencies, deploy, confirm health, exact files and public routes.

## Quality refinement

Base/rollback: 0470fc833869cfe09b6baeeb5cac68059ecb9465. The confirmed original portrait is 667 x 835 pixels; the hero is capped at 480 CSS pixels. The original JPEG is retained without recompression and a 400px derivative serves small layouts. This is not native 4K photography. Earlier mockups were 375 x 812 and 1009 x 749 compressed captures with CSS rotation. New fictional-data captures render the actual UI at 2x CSS zoom: tablet 2033 x 1332, phone 685 x 1313; the 1016 x 666 tablet alternative has matching composition. Temporary zoom was removed from application files. Neutral device frames and unrotated screens preserve legibility. Self-hosted Cormorant Garamond (Google Fonts, SIL OFL license included) provides editorial typography. Black/ivory/gold styling, constrained portrait size, restrained lighting and mobile composition were refined without changing claims or product functionality. Font source: https://github.com/google/fonts/tree/main/ofl/cormorantgaramond .

## Cinematic experience refinement

Base/rollback: 5293c32f2d44f9cd05b1fe553bf788878672e021. Gorgonoid home was inspected visually for contrast, image scale and typography only; no assets, identity or content were copied. The experience illustration now uses native HTML/SVG for sharp text and a gold frequency chart. Demonstration values are 2, 3, 2, 3, 1, 3, 2, 3 sessions across eight weeks (19 total); explicitly labeled conceptual/fictitious, not an implemented dashboard, clinical index or client outcome. The phone retains the genuine fixture training screenshot. CSS controls device lighting and depth without rotating chart text. Mobile uses a stacked composition and phone placement below the chart; geometry confirms no chart overlap or horizontal overflow at 390 and 320 pixels. No commerce/backend/auth/data files changed in this refinement.
