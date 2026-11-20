#ifndef WARMUP_POOL_ADAPTER_H
#define WARMUP_POOL_ADAPTER_H
#include "../core/warmup_core.h"
#include "warmup_native_snapshot.h"
#include <stddef.h>
#include <stdint.h>
#define WN_MAX_OWNED 99U
#define WN_MAX_HUMANS 100U
#define WN_CLEANUP_TIMEOUT_NS UINT64_C(30000000000)
enum wn_result { WN_OK=0,WN_WAIT=1,WN_WORLD_CHANGED=2,WN_RECIPIENT_GONE=3,WN_DRIFT=-1,WN_ERROR=-2 };
enum wn_slot_state { WN_FREE=0,WN_RESERVED,WN_SPAWNED,WN_NAMED,WN_ACTIVE,WN_DETACHED,WN_DESTROYED_PENDING,WN_REMOVED_NOTIFY,WN_SLOT_FAILED };
enum wn_step { WN_BEGIN_FINISH=0,WN_SET_NAME,WN_SET_TEAM,WN_MOVE_TEAM,WN_DETACH,WN_DESTROY,WN_VERIFY_ACTIVE,WN_VERIFY_DETACHED,WN_CLEANUP,WN_MESSAGE_JOIN,WN_MESSAGE_LEAVE,WN_STEP_COUNT };
struct wn_world {
 struct warmup_native_weak_v1 world,game_state,game_mode,game_session;
};
struct wn_human {
 struct warmup_native_weak_v1 player_state,controller,connection;
 uint32_t team; /* 0 unassigned, 1 or 2; never a name or account. */
 unsigned char headers[3][40]; /* PS, PC, connection immutable event witness */
};
struct wn_owned {
 uint32_t slot_index,team;
 uint64_t generation,world_epoch;
 enum wn_slot_state state;
 struct warmup_native_weak_v1 actor;
 unsigned char actor_header[40];
 struct wu_name name; /* immutable through cleanup + leave notification. */
};
struct wn_census {
 struct wn_world bindings;
 uint64_t captured_ns,valid_until_ns,binding_signature,sample_id;
 uint32_t capacity,human_count,unknown,team_total[2],human_team[2],human_unassigned;
 uint32_t owned_count,owned_team[2];
 uint8_t owned_present[WN_MAX_OWNED],owned_observed_team[WN_MAX_OWNED];
 struct wn_human humans[WN_MAX_HUMANS];
};
struct wn_admission {
 int valid; /* Missing telemetry must NEVER be fabricated as valid zero. */
 struct warmup_native_weak_v1 world;
 uint64_t lease_generation,valid_until_ns;
 uint32_t inflight_slots,team_deficit[2];
 int party_safety_verified;
};
struct wn_receipt {
 uint64_t operation_id,started_ns,finished_ns;
 uint32_t issued,returned,input_freed,engine_calls,process_event_calls,allocator_calls;
 uint32_t subcalls_issued; /* Begin/Finish indivisible within one GT callback. */
 struct warmup_native_weak_v1 actor;
 unsigned char actor_header[40];
 char stage[64];
};
/* All callbacks run only on GT. Read callbacks may return WN_WAIT and resume
 * bounded work next GT. Mutation callbacks MUST set receipt.issued BEFORE
 * their first UE call, and never issue again if receipt.issued is already set.
 * WN_WAIT is permitted only with issued==0. Any uncertain issued operation is
 * terminal; no compensating retry/Destroy/RPC is inferred by the adapter.
 * Destroyed ownPS may only be an array needle in CLEANUP/MESSAGE_LEAVE. */
struct warmup_native_ops {
 uint64_t (*clock_ns)(void *context);
 int (*probe_world)(void *context,struct wn_world *out);
 void (*world_reset)(void *context,uint64_t old_epoch,uint64_t new_epoch,const struct wn_world *bindings);
 int (*census)(void *context,uint64_t world_epoch,const struct wn_owned owned[WN_MAX_OWNED],uint64_t gt_deadline_ns,struct wn_census *out);
 int (*admission)(void *context,uint64_t world_epoch,const struct wn_world *bindings,uint64_t now_ns,struct wn_admission *out);
 int (*step)(void *context,uint64_t world_epoch,const struct wn_world *bindings,const struct wn_owned *owned,enum wn_step step,uint32_t to_team,const struct wn_human *recipient,const uint16_t *message,size_t message_units,uint64_t absolute_deadline_ns,struct wn_receipt *receipt);
 int (*publication_invalidate)(void *context,uint64_t epoch,uint32_t flags); /* bool: 1 success */
 int (*publication_seal)(void *context,const struct warmup_native_snapshot_v1 *snapshot); /* bool: 1 success */
};

enum wn_pool_phase {
 WN_POOL_CENSUS=0,WN_POOL_ADMISSION,WN_POOL_PLAN,WN_POOL_STEP,
 WN_POOL_EVENT_CENSUS,WN_POOL_MESSAGES,WN_POOL_FINAL_CENSUS,WN_POOL_HALTED,
 WN_POOL_PREPARE_CENSUS,WN_POOL_PREPARE_ADMISSION,WN_POOL_PREPARE_PLAN,
 WN_POOL_FINAL_ADMISSION,WN_POOL_FINAL_SEAL
};
struct wn_pool_status {
 uint64_t world_epoch,operation_id,operation_deadline_ns,snapshot_revision;
 uint32_t active_owned,name_reservations,recipient_count,recipient_cursor;
 uint32_t H_total,B_actual,unknown,inflight_slots,team_total[2],owned_team[2],team_deficit[2];
 enum wn_pool_phase phase;
 enum wn_step step;
 int failed,waiting_world_change,party_safety_verified,admission_remove;
 struct wu_plan plan;
 struct wn_receipt last_receipt;
 char stage[64];
};
/* Explicit caller-owned storage; it contains only controlled refs/names, never
 * account identities. Tick must be called by the GT owner, never concurrently.
 * One tick starts at most one census/admission/step callback, after its World
 * probe. Completed reads survive to the next phase instead of being repeated
 * when a bounded synchronous callback exhausts the soft GT budget. Callbacks
 * must not sleep; all phases preserve the original operation deadline. */
struct wn_pool {
 int refill_fast;
 struct warmup_native_ops ops;
 void *context;
 struct wu_config config;
 struct wu_controller controller;
 struct wu_rng rng;
 struct wn_world bindings;
 struct wn_owned owned[WN_MAX_OWNED];
 struct wn_census census;
 struct wn_admission admission;
 struct wn_human recipients[WN_MAX_HUMANS];
 uint8_t recipient_done[WN_MAX_HUMANS];
 uint16_t message[WU_MESSAGE_MAX_UNITS];
 size_t message_units;
 uint64_t world_epoch,next_generation,next_operation_id,operation_id;
 uint64_t operation_deadline_ns,snapshot_revision,last_census_sample;
 uint32_t slot_index,to_team,recipient_count,recipient_cursor;
 enum wu_action_type action;
 enum wn_pool_phase phase;
 enum wn_step step;
 struct wn_receipt receipt,last_receipt;
 struct wu_plan last_plan;
 int initialized,failed,waiting_world_change,admission_remove;
 int round_draining; /* GT owner: settlement only; effective target must be 0. */
 char stage[64];
};
int wn_pool_init(struct wn_pool *pool,const struct wu_config *config,
                 const struct warmup_native_ops *ops,void *context,uint64_t seed);
/* Config changes never interrupt or repeat an issued operation. New desired
 * state is reconciled after its existing lifecycle has confirmed completion. */
int wn_pool_set_config(struct wn_pool *pool,const struct wu_config *config);
int wn_pool_tick(struct wn_pool *pool,uint64_t gt_budget_ns);
/* Settlement: coalesce read/plan transitions within one absolute GT budget,
 * but still at most one native step callback. Never spins on a stalled WAIT. */
int wn_pool_burst_tick(struct wn_pool *pool,uint64_t budget_ns);
int wn_pool_progress_tick(struct wn_pool *pool,uint64_t budget_ns);
int wn_pool_drain_tick(struct wn_pool *pool,uint64_t gt_budget_ns);
void wn_pool_get_status(const struct wn_pool *pool,struct wn_pool_status *out);
/* World replacement is automatic only after probe_world confirms a DIFFERENT
 * four-node binding. All old refs and name reservations are dropped in memory;
 * no Destroy, verification or leave RPC reads the vanished World. Terminal
 * uncertainty does not auto-recover or retry, even after later World changes.
 * Tombstones otherwise stay reserved through cleanup + every leave recipient.
 * Missing admission telemetry is WAIT, not a fabricated zero. A verified party
 * guard is additionally required for ADD/MOVE; owned REMOVE may free headroom.
 * A fresh team_deficit lease may request same-team REMOVE even when native J
 * is zero. This is an explicit lease policy, never fake H/J; ADD/MOVE remain
 * blocked until deficits clear. Unknown still freezes every new operation.
 * Normal preparation is census -> admission -> plan -> step across ticks.
 * During explicit round_draining with target 0, a validated unexpired census
 * and admission may be reused for REMOVE preparation and subsequent planning.
 * Cleanup's event census may also serve final confirmation while unexpired.
 * Every removed actor still gets a post-cleanup census. Expiry and native
 * first-step rejection fall back to a fresh census; no lease is extended.
 * The actual native first step must revalidate the completed census witness,
 * World/owned identities and admission immediately before issuing UE calls;
 * a first-step WAIT with issued=0 restarts the preparation census, never UE.
 * This adapter and its mocks are not evidence that native callbacks are wired. */
#endif
