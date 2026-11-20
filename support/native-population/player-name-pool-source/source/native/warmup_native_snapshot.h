#ifndef WARMUP_NATIVE_SNAPSHOT_H
#define WARMUP_NATIVE_SNAPSHOT_H
#include <stdint.h>
#ifdef __GNUC__
#define WARMUP_NATIVE_HIDDEN __attribute__((visibility("hidden")))
#else
#define WARMUP_NATIVE_HIDDEN
#endif
#define WARMUP_NATIVE_SNAPSHOT_ABI 1U
#define WARMUP_NATIVE_MAX_OWNED 99U
#define WARMUP_NATIVE_MAX_PLAYERS 100U
#define WARMUP_SNAPSHOT_VALID UINT32_C(1)
#define WARMUP_SNAPSHOT_BASELINE_READY UINT32_C(2)
#define WARMUP_SNAPSHOT_MUTATION_INFLIGHT UINT32_C(4)
#define WARMUP_SNAPSHOT_DRIFT UINT32_C(8)
#define WARMUP_SNAPSHOT_WORLD_RESET UINT32_C(16)
struct warmup_native_weak_v1 { uint64_t address;int32_t index,serial; };
struct warmup_native_snapshot_v1 {
 uint32_t abi_version,struct_size;
 uint64_t revision,world_epoch,captured_ns,valid_until_ns;
 struct warmup_native_weak_v1 world,game_state,game_mode,game_session;
 uint32_t H_total,B_actual,unknown,inflight_slots;
 uint32_t team_total[2],owned_team[2],h_team[2],h_unassigned;
 uint32_t target,desired,capacity,flags,reserved;
};
/* The validator is native's bounded read-only current-table/active-World check.
 * It must resolve every saved positive weak slot before reading its address,
 * verify current World/GS/GM/GameSession links, and never call the engine.
 * Binding is one-time on the main thread, before native starts its worker. */
typedef int (*warmup_native_live_validator_v1)(const struct warmup_native_snapshot_v1 *snapshot);
WARMUP_NATIVE_HIDDEN int warmup_native_snapshot_bind_validator(warmup_native_live_validator_v1 validator);
/* Nonblocking. Successful invalidation release-publishes before any UE write.
 * If busy, caller must defer its UE operation; it may not proceed anyway. */
WARMUP_NATIVE_HIDDEN int warmup_native_snapshot_invalidate(uint64_t world_epoch,uint32_t reason_flags);
WARMUP_NATIVE_HIDDEN int warmup_native_snapshot_seal(const struct warmup_native_snapshot_v1 *snapshot);
/* Returns 1 only on main TID, valid/fresh/no-unknown/no-inflight, plus live
 * identity validation after copying. Busy or any failed gate returns 0. */
WARMUP_NATIVE_HIDDEN int warmup_native_snapshot_read(struct warmup_native_snapshot_v1 *out,uint64_t now_ns);
#endif
