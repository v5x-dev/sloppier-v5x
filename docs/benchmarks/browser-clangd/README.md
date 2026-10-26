# Browser clangd performance

Measured October 26, 2026 for a typical school Chromebook with 4 GB RAM.
The test host was an Intel Core i7-8700K with 32 GB RAM, running Chromium 154
on Linux. A dedicated systemd cgroup limited the harness and every Chromium
process to one CPU quota and 2 GiB RAM. These results are a conservative proxy;
they are not measurements from Chromebook hardware.

## Results

Each run starts a fresh browser profile, then opens two sequential workers.
"Cold" is the first worker in that profile. "Warm" is the second worker, sharing
browser caches and compiled code. First completion includes asset download,
worker startup, LSP initialization, and the first completion request. Downloads
use localhost. This does not simulate a school network or persistent caches
across browser restarts.

| Runtime / template | Cold first completion | Warm first completion | Warm edit median / p95 | Process-group peak |
| --- | ---: | ---: | ---: | ---: |
| Asyncify / PROS | 30.20 s | 6.58 s | 119 / 205 ms | 1,201 MiB |
| JSPI / PROS | 11.81 s | 3.07 s | 74 / 97 ms | 777 MiB |
| JSPI / EZ-Template | 15.90 s | 3.70 s | 85 / 185 ms | 773 MiB |
| JSPI / VEXcode | 6.61 s | 2.11 s | 87 / 106 ms | 787 MiB |
| JSPI / JAR | 6.89 s | 1.91 s | 93 / 106 ms | 809 MiB |

The PROS comparison reduced cold time to first completion by 61%, warm edit p95
by 52%, and peak process-group memory by 35%. These are individual comparative
runs, not confidence intervals. Each edit distribution contains 30 incremental
insertion/completion/deletion cycles. The peak includes Chromium and the harness,
but excludes the real application's UI, repository storage, and ChromeOS.

Cold runs still have substantial latency spikes. PROS cold edit p95 was 1,506 ms;
EZ-Template was 301 ms, VEXcode 404 ms, and JAR 903 ms. CPU quota exhaustion can
also delay the UI despite language work running in a worker. Cold heartbeat p95
was 88–100 ms. Warm heartbeat p95 ranged from 16–58 ms. See the JSON files for
main-thread long tasks and full measurements. A worker prevents synchronous
parsing on the UI thread, but cannot remove competition for CPU time.

Unconstrained desktop PROS measured 3.32 s cold and 1.92 s warm to first
completion, with warm edit median/p95 of 19/26 ms. Do not use those numbers as
Chromebook estimates.

The Vite production worker also passed with automatic JSPI selection. Its PROS
run measured 11.80 s cold and 3.20 s warm to first completion, 89/105 ms warm
edit median/p95, and 756 MiB peak. This confirms the production bundle follows
the same runtime path. See `jspi-production.json`.

## Selected runtime

Modern Chromium automatically selects LLVM 21.1.0 built with Emscripten 4.0.22
and native WebAssembly suspension, JSPI. The runtime downloads as 11,245,578
bytes of gzip, compared with about 25.2 MB for the Asyncify fallback. The build
omits clang-tidy checks and the unrelated WASI sysroot, embeds compiler builtin
headers, starts with 64 MiB of linear memory, and caps it at 1 GiB. Template
headers download separately and cache by content hash. PROS linear memory after
the workload was about 159 MiB; EZ-Template was 191 MiB. This is only part of
browser memory use.

clangd uses one parsing job, memory PCH storage, no background index, and no
clang-tidy. Its reported core count is capped at two. The pthread pool is bounded
at eight. A four-worker experiment used 721 MiB peak but did not consistently
improve latency: 14.19 s cold first completion and 104 ms warm edit p95. Eight
remains the default.

Assets compile as a native HTTP gzip stream and use immutable hashed URLs.
Source reads overlap runtime loading, use at most six concurrent repository
reads, and transfer owned buffers to the worker. SDK/source buffers are installed
without an additional filesystem copy. All language requests and definition
reads stay in the browser; Smolmachines handle builds.

## Reproduce

From the repository root, prepare the assets:

```sh
bun run --cwd apps/code/web prepare-language
```

Then run each comparison in its own cgroup:

```sh
systemd-run --user --scope -p CPUQuota=100% -p MemoryMax=2G \
  env BENCHMARK_CGROUP=1 LANGUAGE_RUNTIME=jspi LANGUAGE_TEMPLATE=pros \
  BENCHMARK_ENVIRONMENT='one CPU quota, 2 GiB process-group limit' \
  BENCHMARK_OUTPUT=/tmp/clangd-pros.json \
  bun apps/code/web/scripts/benchmark-language.mjs
```

Install Playwright or set `PLAYWRIGHT_MODULE` to its installation path.
`CHROMIUM_PATH` defaults to `/usr/bin/chromium`. Use `LANGUAGE_RUNTIME=asyncify`
for the fallback, `LANGUAGE_TEMPLATE=ez-template|vexcode|jar` for other SDKs, and
`LANGUAGE_THREADS=4` for the pool experiment. A fresh invocation creates a fresh
browser profile. Page-level CDP CPU throttling does not throttle workers, so it
is not used.

The harness validates motor member completion, hover, formatting, definition
navigation and SDK reads, Unicode framing, and missing-header diagnostics. It
measures the real clangd worker, rather than a mocked language server. Run on a
physical 4 GB school Chromebook before treating these timings as a device
performance guarantee. Larger programs and school-network downloads also need
measurement.
