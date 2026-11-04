# Code web performance notes

## 2026-10-30: defer Builder ZIP support

The editor route statically imported `fflate` through Builder ZIP creation and
binary extraction. Both paths now load it when Build or Upload needs it.

| Measurement | Before | After |
| --- | ---: | ---: |
| Editor route static JavaScript graph, gzip | 576,808 B | 570,808 B |
| Program editor cold readiness, median of 5 | 2,148 ms | 2,136 ms |
| Open file from search, median of 5 | 90 ms | 76 ms |
| One-line edit, median of 5 | 80 ms | 78 ms |
| Open Program from dashboard, median of 5 | 598 ms | 565 ms |

Bundle sizes sum each statically imported JavaScript asset after gzip. Dynamic
features such as search, history, themes, and autocomplete data are excluded.
At this checkpoint, source-map attribution put most of the route in Yjs
collaboration and the Pierre editor/tree integrations.
The timing runs used the existing Playwright benchmark against the local Vite
development server, Desktop Chrome, no CPU throttle, and a dedicated PROS demo
Program. Timing differences are within run noise; the retained change has a
deterministic 6,000 B gzip reduction in the editor route's static graph.

The production preview served unauthenticated pages, but its authenticated
editor case could not run because demo sign-in is development-only. The demo
account also logged WorkOS email-verification errors from `syncProfile`, though
Program access and all benchmark scenarios worked. Use a valid authenticated
production test account and representative school Chromebook before making
claims about production editor readiness or Core Web Vitals.

## 2026-10-30: defer editor actions and Brain reads

The next local build moved Program upload/build UI and Brain slot/revision reads
out of the editor route's static import graph. Serial picker APIs remain inside
the action component and run directly from the user's click handler.

| Measurement | Before this split | After |
| --- | ---: | ---: |
| Editor route static JavaScript graph, gzip | 555,690 B | 525,732 B |
| `ProgramUpload` chunk, gzip | in static graph | 25,423 B, requested during Workbench render |
| `ProgramBuild` chunk, gzip | in static graph | 4,617 B, preloaded after first commit |
| Brain slot reader / revision chunks, gzip | in static graph | 410 B / 570 B, loaded on use |

The static graph is 29,958 B smaller (5.4%). For the EZ Template benchmark
route, the complete graph including the dynamically loaded upload, build, and
path-preview chunks is 585,604 B gzip. This split moves code later in the
render sequence; it does not claim a reduction in total route bytes.

Five-run benchmark on the existing ready EZ Template Program, local Vite dev
server, Desktop Chrome, no CPU throttle: cold editor readiness 2,297 ms,
reload 1,950 ms, file open 111 ms, one-line edit 238 ms, and dashboard-to-editor
679 ms. All six benchmark scenarios passed. The prior timing run used a PROS
Program, so these numbers are not a like-for-like before/after comparison. The
current run also logged WorkOS `syncProfile` email-verification errors. No
school Chromebook or authenticated production run was available.

## 2026-11-04: open Programs and files sooner

Opening a Program used to run its repository reads one after another. The
listing finished before the entry file's live document opened, and the
autocomplete snapshot read every language file while the editor was mounting.
The changes:

- A returning visit opens the saved active tab's live document with the listing
  instead of after it. A first visit does the same for the starter entry,
  `src/main.cpp`, which every template ships. The listing still decides whether
  the tab stays open.
- Autocomplete starts in idle time after the first editor mounts, so its snapshot
  reads and API database parse no longer run while a file opens.
- The C++ highlighter loads when the Program route opens, in parallel with the
  listing.
- Hovering a ready Program on the dashboard starts its listing and read-only file
  reads. The editor adopts that source on navigation. A hover does not open a live
  document, because opening one records a backup commit on the repository's main
  branch.

Measured on a production build (`vite build` and `vite preview`) with the local
Convex backend and Pierre Code Storage reached from this machine, Desktop Chrome,
8 runs each, median. The machine was shared with other sessions, and the load
average was about 5 on 12 cores, so differences under about 30 ms are noise.

| Measurement | Before | After |
| --- | ---: | ---: |
| Program editor cold readiness | 679 ms | 457 ms |
| Program editor reload readiness | 489 ms | 327 ms |
| Open Program from dashboard, Playwright click with no dwell | 389 ms | 359 ms |
| Return to Program from dashboard, no dwell | 153 ms | 151 ms |
| Open Program from dashboard, 4x CPU throttle | 2,968 ms | 1,293 ms |
| Return to Program from dashboard, 4x CPU throttle | 856 ms | 483 ms |

A pointer hovers before a click, and the dwell lets the prefetch start. With a
300 ms dwell over the dashboard tile, timed from the click to the editor's text
area:

| Path | Before | After |
| --- | ---: | ---: |
| First visit in a fresh browser, median of 8 | 324 ms | 283 ms |
| Returning visit, median of 8 | 221 ms | 139 ms |

The no-dwell rows isolate the work that the hover prefetch hides. Playwright's
`click()` moves the pointer and clicks immediately, so the no-dwell rows do not
show the prefetch.

What remains above target: a first visit in a fresh browser still waits for
first-time IndexedDB setup for the document (about 80 ms here) and the editor's
first mount and render (about 60 ms). The Program route chunk (320 KB gzip)
downloads on hover, through the router's intent preload, and the highlighter
chunk (120 KB gzip) downloads when the route opens. Without a hover, the route
chunk also downloads and evaluates after the click. This setup has no WAN latency
and no school Chromebook. Real deployments add network round trips to Convex and
Pierre, and the 4x CPU row is only a rough stand-in for lower-end hardware.

To measure a production bundle, the demo sign-in gate is development-only. A
measurement build can temporarily lift that gate in `src/lib/auth.ts`. Restore the
file before committing. The dev server (`bun run dev`) inflates cold-start timings
through dev transforms, so use it only for relative comparisons.
