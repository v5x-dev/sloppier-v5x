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
