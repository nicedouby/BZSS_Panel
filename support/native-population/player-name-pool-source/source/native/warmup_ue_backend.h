#ifndef WARMUP_UE_BACKEND_H
#define WARMUP_UE_BACKEND_H
#include "warmup_pool_adapter.h"
#define WARMUP_UE_ENGINE_VPTR UINT64_C(0x2337bd8)
#define WARMUP_UE_TICK_CELL UINT64_C(0x2337ee8)
#define WARMUP_UE_ORIGINAL_TICK UINT64_C(0x7e93fe0)
#define WARMUP_UE_ENGINE_GLOBAL UINT64_C(0xd708078)
/* Called on process main thread only, after warmup_bootstrap_ready()==1.
 * Checks marker/env/hostname/pinned Tick preimage; opens read-only process mem.
 * Does not patch, create a thread, arm, spawn, or call the engine. */
int warmup_ue_backend_init(struct warmup_native_ops *out,void **context,char *error,size_t error_capacity);
/* Native control must call GT enter before any pool callback. If reentered
 * inside an active UE transaction, marks terminal reentry and returns zero. */
int warmup_ue_backend_gt_enter(void);
/* Bounded metadata scanning on GT; no engine calls. Call once each GT before
 * pool tick while metadata unavailable, or with the remaining read budget. */
void warmup_ue_backend_sample(uint64_t deadline_ns);
struct warmup_ue_telemetry {
 uint64_t engine_calls,process_event_calls,allocator_calls,gt_epoch;
 uint32_t metadata_classes,metadata_functions,reentry_detected,initialized;
 int32_t metadata_cursor,object_count;
 uint64_t completed_scans;
 int32_t census_failed_slot,read_error_errno;
 uint64_t read_error_address,read_error_size;
 int64_t read_error_result;
 uint64_t census_calls,census_last_ns,probe_calls,probe_last_ns,probe_max_ns;
 uint32_t census_checkpoint,common_abi_gate;
 int32_t census_result,probe_result;
};
/* Private diagnostic checkpoints. They never constitute a valid census or
 * admission lease and are not coherent across concurrent telemetry reads. */
enum warmup_ue_census_checkpoint {
 WUE_CENSUS_ENTRY=1,WUE_CENSUS_TRANSACTION=2,
 WUE_CENSUS_WORLD=10,WUE_CENSUS_TABLE=11,WUE_CENSUS_METADATA_BARRIER=12,
 WUE_CENSUS_GUARD_BEFORE_BIND=20,WUE_CENSUS_BIND_RUNTIME=21,
 WUE_CENSUS_GUARD_AFTER_BIND=22,WUE_CENSUS_COMMON_ABI=23,
 WUE_CENSUS_INIT_GS_ARRAY=30,WUE_CENSUS_INIT_TEAM_A=31,WUE_CENSUS_INIT_TEAM_B=32,
 WUE_CENSUS_CAPACITY=40,WUE_CENSUS_ROSTER_BUDGET=50,
 WUE_CENSUS_OWNED_STATE=51,WUE_CENSUS_OWNED_VERIFY=52,
 WUE_CENSUS_HUMAN_READ=53,WUE_CENSUS_TEAM_DUPLICATE=54,
 WUE_CENSUS_HUMAN_DUPLICATE=55,WUE_CENSUS_HUMAN_LIMIT=56,
 WUE_CENSUS_ROW_YIELD=60,WUE_CENSUS_FINAL_HUMAN=70,WUE_CENSUS_FINAL_OWNED=71,
 WUE_CENSUS_FINAL_GS_ARRAY=80,WUE_CENSUS_FINAL_TEAM_A=81,WUE_CENSUS_FINAL_TEAM_B=82,
 WUE_CENSUS_FINAL_GUARD=90,WUE_CENSUS_FINAL_WORLD=91,WUE_CENSUS_CAPTURED=100
};
enum warmup_ue_common_abi_gate {
 WUE_ABI_COLLISION_IDENTITY=1,WUE_ABI_SCALE_IDENTITY=2,
 WUE_ABI_MISSING_BEGIN=3,WUE_ABI_MISSING_FINISH=4,WUE_ABI_MISSING_DESTROY=5,
 WUE_ABI_MISSING_NAME=6,WUE_ABI_MISSING_TEAM=7,
 WUE_ABI_FRESH_BEGIN=10,WUE_ABI_FRESH_FINISH=11,WUE_ABI_FRESH_DESTROY=12,
 WUE_ABI_FRESH_NAME=13,WUE_ABI_FRESH_TEAM=14,
 WUE_ABI_VECTOR=15,WUE_ABI_QUAT=16,WUE_ABI_TRANSFORM=17,
 WUE_ABI_COLLISION_VALUES=18,WUE_ABI_SCALE_VALUES=19,WUE_ABI_NAMING_CODE=20,
 WUE_ABI_CDO_IDENTITY=21,WUE_ABI_CDO_HEADER=22,WUE_ABI_CDO_CLASS=23,
 WUE_ABI_CDO_FLAGS=24,WUE_ABI_CDO_NAME=25,WUE_ABI_CDO_PACKAGE=26,
 WUE_ABI_CDO_PROCESS_EVENT=27,WUE_ABI_MESSAGE=28,WUE_ABI_READY=100
};
/* Numeric atomic telemetry only; not a coherent gameplay/census snapshot. */
const char *warmup_ue_backend_error(void);
void warmup_ue_backend_telemetry(struct warmup_ue_telemetry *out);
int warmup_ue_round_state(char *state,size_t capacity,uint64_t *world_token);
#endif
