#ifndef WARMUP_QUEUE_GUARD_H
#define WARMUP_QUEUE_GUARD_H
#include <stddef.h>
#include <stdint.h>
#include "../native/warmup_pool_adapter.h"

/* Root-control exports; declarations mirrored here for the shared guard contract. */
uint64_t warmup_control_outer_epoch(void);
int warmup_control_failed(void);
#define WARMUP_QUEUE_VIEW_ABI 1U
struct warmup_ue_queue_view {
 uint32_t abi_version,struct_size;
 uint64_t world_epoch,outer_gt_epoch,captured_ns;
 struct wn_world bindings;
 struct warmup_native_weak_v1 host;
 uint32_t actual_gs_count,team_total[2],removable_owned_team[2],removable_owned_unassigned,capacity;
 int32_t native_team_allowance; /* actual max(settings+60,0); never guessed0. */
 int native_team_allowance_known;
 int32_t native_g;             /* optional exact +7f0 value; unknown stays-1. */
 int native_g_known;
};
/* Native's direct callback, implemented in its own directory. GT-only current
 * World/GS/GM/session and current GI->Host binding; positive weak identities,
 * typed fields, raw GS/Team double reads and own-registry reconciliation.
 * Any transaction/reentry/unavailable/unknown relation returns0. No old census
 * or publication snapshot is substituted. outer_gt_epoch is an actual OUTER
 * EngineTick ordinal, incremented only after the previous original Tick fully
 * returned, never a census generation or pool callback counter. */
int warmup_ue_queue_snapshot(struct warmup_ue_queue_view *out);

/* Root constructor101 after exact ELF SHA and sentinel installation, before
 * native/control workers. Prepare the reader without claiming the native gate. */
void warmup_queue_owned_departed(void);
void warmup_queue_guard_config(uint64_t enabled_revision);
void warmup_queue_guard_sync(uint64_t eligible_revision);
int warmup_queue_guard_install(char *error,size_t capacity);

/* Direct ops.admission callback. It reads current native joining/queue scalars,
 * derives fresh blocked-party owned-removal requests and never invokes UE.
 * Out.valid=0/WN_WAIT on missing telemetry; nativeJ is never fabricated0. */
int warmup_queue_guard_admission(void *context,uint64_t world_epoch,
 const struct wn_world *bindings,uint64_t now_ns,struct wn_admission *out);

struct warmup_queue_guard_telemetry {
 uint64_t wrapper_calls,original_calls,allowed,denied,unarmed_passthrough,reentry_denied,thread_denied,request_generation;
 uint32_t installed,unknown,public_parties,reserved_parties,native_joining,team_deficit[2];
};
void warmup_queue_guard_telemetry(struct warmup_queue_guard_telemetry *out);
#endif
