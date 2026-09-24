# UI performance and usability audit

Measured on 2026-09-24 against the production Azure Container App. The same
Chromium harness ran before and after the changes. Overview and pipeline results
below are medians of three serial samples per viewport, with the browser cache
disabled. Desktop was 1440 x 900 at normal CPU speed; mobile was 390 x 844 with
touch enabled and 4x CPU throttling. Network latency was not simulated or fixed.

## Measured results

Idle measurements cover two seconds; scrolling measurements cover 1.5 seconds.
JavaScript sizes are encoded transfer sizes reported by Resource Timing.

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop pipeline JavaScript | 206.8 KiB | 196.5 KiB |
| Desktop pipeline idle JavaScript time | 27.9 ms | 3.4 ms |
| Mobile pipeline idle JavaScript time | 96.3 ms | 7.9 ms |
| Desktop pipeline idle total task time | 117.9 ms | 18.3 ms |
| Mobile pipeline idle total task time | 438.2 ms | 50.8 ms |
| Desktop pipeline scroll frames | 24 | 75 |
| Desktop pipeline p95 frame interval | 83.4 ms | 33.4 ms |
| Mobile pipeline p95 frame interval | 33.4 ms | 16.7 ms |
| Mobile pipeline frames over 33.4 ms | 5 | 0 |
| Desktop pipeline search-to-result time | 47.1 ms | 47.6 ms |
| Mobile pipeline search-to-result time | 168.6 ms | 139.7 ms |
| Global particle style writes, desktop pipeline | 1,841 | 0 |
| Desktop overview scroll frames | 26 | 71 |
| Desktop overview p95 frame interval | 83.3 ms | 33.4 ms |

Load timings were mixed and depended heavily on server/network response time:

| Median LCP | Before | After |
| --- | ---: | ---: |
| Desktop overview | 1,160 ms | 1,028 ms |
| Desktop pipeline | 1,444 ms | 1,200 ms |
| Mobile overview | 916 ms | 888 ms |
| Mobile pipeline | 1,212 ms | 1,304 ms |

The final public-page sample transferred about 105 KiB of JavaScript on login,
compared with 178 KiB in the initial production-build sample. Signup, password
recovery and data recovery no longer load the global animation dependency.

Desktop overview idle total task time increased in the repeated samples
(132.8 to 198.3 ms), although a follow-up sample measured 131.4 ms. The small
sample size and rendering variability do not establish a universal CPU reduction.
Overview idle JavaScript time fell from 25.5 to 11.6 ms; its mobile equivalent
fell from 96.9 to 32.5 ms.

## Changes

- Removed five unused eagerly registered GSAP plugins.
- Removed the invisible global particle layer, which animated below the viewport.
  Landing-only particles use deterministic CSS and stop under reduced motion.
- Removed backdrop blur from opaque panels and the fixed header. Desktop smooth
  scrolling, touch-native scrolling and reduced-motion behavior remain intact.
- Improved shared text, solid-button and heatmap contrast.
- Added native keyboard sort buttons, announced sort direction and a search label.
- Added focus containment and focus return to the shared modal portal and mobile
  menu, using `focus-trap-react`. Palette selection is exposed through
  `aria-activedescendant`.
- Exposed interactive chart links correctly and made horizontally scrolling
  chart/table regions keyboard-accessible.
- Reflowed mobile scoring rows and constrained their layout to prevent overflow.

## Verification

The final production audit captured 40 samples across 16 routes and 32 distinct
desktop/mobile combinations. It found no automated WCAG A/AA violations, page
exceptions or document-level horizontal overflow. Maximum observed layout shift
was 0.00047. Screenshots and raw reports remain in the ignored local audit folder.

The audited routes were the landing, login, signup, forgot-password and recovery
pages, plus overview, pipeline, agents, scoring, industries, whitespace, data
quality, reminders, outbox, copilot and integration settings.

The focused browser regression batch passed 47 tests covering authentication,
drawers, charts, sorting, responsive layouts, motion and the tutorial. The extended
accessibility/focus/smooth-scroll checks passed after two mobile scroll-region
repairs. Production Docker builds and the deployment runner's live health and
recovery checks passed. Unit/type gates are also required before commit.

These are laboratory results, not field Core Web Vitals or p75 INP. Search timing
includes browser automation overhead. Headless frame measurements are useful for
comparison on this host, not a promise of frame rate on every device. Automated
accessibility checks do not replace screen-reader or real-device testing. The
production audit used a dedicated member account; administrator-only screens were
not included in its route set. Business-data writes and live AI/email sends were
not part of the performance audit.

## Repeat the audit

[../scripts/measure-ui.mjs](../scripts/measure-ui.mjs) uses Playwright, axe-core,
browser timing observers and Chrome performance metrics. Keep credentials, raw
reports and screenshots private under `.data`. The credentials file contains an
email and password on separate lines. Use a dedicated verification account.

```bash
node scripts/measure-ui.mjs \
  --origin https://YOUR_APP.azurecontainerapps.io \
  --credentials .data/ui-audit-credentials \
  --routes /dashboard,/dashboard/pipeline \
  --iterations 3 \
  --output .data/ui-audit/recheck/report.json

npx playwright test e2e/usability.spec.ts e2e/smooth.spec.ts
```

Run audits serially, without a build or another browser suite competing for CPU.
The script holds `.data/ui-audit.lock` to prevent overlap. After an interrupted
process, confirm its recorded PID has exited before removing a stale lock.