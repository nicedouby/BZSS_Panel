# BZSS MEM Bridge — incremental sampling architecture

Status: Python implementation, read-only, incremental migration. The existing
`/v1/snapshot`, `/v1/players`, `/v1/map`, `/v1/map-points` and
`/v1/settings` contracts remain supported.

## Data ownership and boundaries

- `memory.py`: process identity, bounded `process_vm_readv`, read counters.
- `ue.py`: UE object validation, reflection and world transforms.
- `reader.py`: assemble a world-validated telemetry sample from independently
  scheduled player, map-point and metadata phases.
- `discovery.py`: resumable scan of loaded Level actor arrays. A new point set
  is published **only after a complete successful discovery pass**.
- `server.py`: sampler transaction and timing loop, read-only HTTP API.
- Panel: authentication, transport, UI-facing API. The browser must not call
  the memory reader directly.
- 3D Viewer: asset streaming and rendering, independent of memory sampling.

The current MemBridge page is a 2D tactical projection. Vehicle telemetry
shown there comes from Panel Tactical State, **not** from the Python memory
reader. Do not claim vehicle/occupant atomicity across these two sources.

## Incremental discovery (implemented in this branch)

1. Every snapshot validates process, World, GameState and persistent Level.
2. If a map-point discovery pass is due, `IncrementalPointDiscovery` begins
   walking the current Level list and its Actor arrays.
3. Each sample performs no more than `pointDiscoveryMaxActorsPerSample`
   inspected references and approximately `pointDiscoveryBudgetMs` in its
   scanner step (default 1,024 actors / 10 ms; synchronous reads may overrun).
4. The scan resumes at the next sample from its saved cursor. No partially
   discovered point set replaces the last completed set.
5. If loaded Levels change, the partial pass is invalidated. Completion
   replaces the published point registry and prunes the point-value cache.
6. Once discovered, dynamic point fields are refreshed independently, using
   `pointRefreshIntervalSeconds`, `pointMaxRefreshPerSample` and
   `pointMaxCacheAgeSeconds`. Default: 1 s / 24 points per sample / 10 s.
7. All cached point results are keyed by the verified UObject identity.
   A world Epoch change clears discovery state, points and player caches.
8. Failures inside discovery are reported in
   `health.discoveryError` and trigger discovery backoff. A failure must not
   induce an immediate tight rescan loop.

The `phaseDurationsMs` section of health separates world lookup, discovery,
player reads, point reads and final validation. Preserve `readCalls`,
`readBytes` and total `readDurationMs` when changing telemetry.

## Failure and stale data (implemented)

The last successful sample is retained for **transient** reader errors if it
has not exceeded `maxAgeSeconds`. It is reported with
`health.status = "degraded"`, a failure code and `staleAgeSeconds`; it is
never relabeled as fresh.

Process or World identity changes, layout mismatch, and permissions errors
invalidate the cached sample immediately. Expired cached samples become
`unavailable`. The sampler always yields briefly after a long read instead
of running back-to-back without rest.

## Planned entity scheduling — not yet wired to the API

Separate discovery, mutable state and viewer demand:

```text
Viewer focus + selected entities  -> Interest Manager
World Epoch + entity registry     -> Entity Registry
Field-group due times + priorities -> Refresh Scheduler
                                       |
                       background / focus / discovery queues
                                       |
                           bounded read transactions
                                       |
                            Entity Cache + Delta Publisher
                                       |
                                  Viewer renderer
```

### Entity groups

- `identity`: name, PlayerState identity, class; changed-on-discovery.
- `transform`: position, orientation and velocity; focus-sensitive.
- `relations`: vehicle occupancy, Seat/Pawn/Controller references; validate
  before sharing derived transforms.
- `gameplay`: health, role, team, squad, vehicle status; moderate cadence.
- `combat`: scoreboard stats; slow cadence.
- `static_world`: level and capture-geometry metadata; discovery cadence.

Deduplicate by `(epoch, entityId, fieldGroup, sampleGeneration)`. Reading a
vehicle transform can satisfy a seated player's **position** only if the seat
association and relative transform are validated. It cannot satisfy unrelated
health, identity or weapon fields. When entering/exiting a seat, invalidate
the cached relation and read the player's own position until verified.

### Focus scheduling requirements

A future Panel-authenticated focus subscription will carry a bounded viewer
identifier, target, world Epoch, camera position/frustum, selected Entity IDs
and short expiry. Multiple viewers are merged by interest area and entity ID.
Bound request size, world-coordinate ranges, focus radii, active subscriptions
and renewal frequency. Anonymous or stale subscriptions must not increase
memory-read demand.

The scheduler should aim for a higher **target cadence** on visible and
selected entities while reserving a guaranteed portion of the budget for
background updates. An expired focus falls back to background cadence.
Priority is determined by distance/visibility, age since last read,
entity type and starvation age. Use one shared per-target read budget;
do not spawn a new independent high-frequency scanner for every viewer.

A target frequency is not a guarantee. If the budget is exhausted, postpone
low-priority work, record its age and lower effective rates. Keep renderer FPS
independent of data acquisition Hz.

### Delta protocol (future v2)

Publish `epoch`, monotonically increasing `sequence`, `observedAt`,
per-entity `updatedFields`, field-group timestamps and removals. Support a
full baseline on subscription/reconnection, resynchronization on sequence
gap, and explicit stale field statuses. Keep v1 full snapshot for compatibility.

## 3D asset streaming is a separate concern

Build offline scene chunks, LODs and a spatial index; stream only relevant
chunks. Set explicit limits for network concurrency, mesh/texture decompression,
per-frame GPU uploads and cache memory. Avoid tying asset loading to memory
snapshot responses, and interpolate timestamped entity transforms in the
render loop.

## Validation

Run from the module directory:

```bash
cd support/mem-bridge
python3 -m unittest discover -s tests -v
```

Before deploying, collect per-phase P50/P95/P99 latency, `readCalls`,
`readBytes`, discovered/updated entity counts, sample staleness, map
transition errors and Squad server TPS. The Python unit tests do not validate
a live UE process layout; run the bridge against an isolated test server first.
