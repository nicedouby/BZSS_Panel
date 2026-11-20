#define _GNU_SOURCE
#include "warmup_native_snapshot.h"
#include <stdatomic.h>
#include <string.h>
#include <unistd.h>
#include <sys/syscall.h>
static atomic_flag snapshot_lock=ATOMIC_FLAG_INIT;
static struct warmup_native_snapshot_v1 snapshot_value;
static _Atomic(warmup_native_live_validator_v1) live_validator;
static int main_thread(void){return (long)syscall(SYS_gettid)==(long)getpid();}
static int weak_valid(struct warmup_native_weak_v1 id){return id.address>=UINT64_C(0x10000)&&id.address<UINT64_C(0x0000800000000000)&&!(id.address&7)&&id.index>=0&&id.index<(1<<27)&&id.serial>0;}
static int shape_valid(const struct warmup_native_snapshot_v1 *s){
 if(!s||s->abi_version!=WARMUP_NATIVE_SNAPSHOT_ABI||s->struct_size!=sizeof *s||!s->revision||!s->world_epoch||!s->captured_ns||s->valid_until_ns<=s->captured_ns||s->valid_until_ns-s->captured_ns>UINT64_C(2000000000))return 0;
 if(!weak_valid(s->world)||!weak_valid(s->game_state)||!weak_valid(s->game_mode)||!weak_valid(s->game_session))return 0;
 if(s->H_total>100||s->B_actual>99||s->unknown>100||s->inflight_slots>80||s->h_team[0]>100||s->h_team[1]>100||s->h_unassigned>100||s->owned_team[0]>99||s->owned_team[1]>99||s->team_total[0]>100||s->team_total[1]>100||s->target>99||s->desired>99||!s->capacity||s->capacity>100||s->reserved||(s->flags&~UINT32_C(31)))return 0;
 return (uint64_t)s->H_total+s->B_actual<=s->capacity&&(uint64_t)s->owned_team[0]+s->owned_team[1]==s->B_actual&&(uint64_t)s->h_team[0]+s->h_team[1]+s->h_unassigned==s->H_total&&(uint64_t)s->h_team[0]+s->owned_team[0]==s->team_total[0]&&(uint64_t)s->h_team[1]+s->owned_team[1]==s->team_total[1];
}
int warmup_native_snapshot_bind_validator(warmup_native_live_validator_v1 validator){
 if(!validator||!main_thread())return 0;
 warmup_native_live_validator_v1 expected=0;
 return atomic_compare_exchange_strong_explicit(&live_validator,&expected,validator,memory_order_release,memory_order_relaxed);
}
int warmup_native_snapshot_invalidate(uint64_t world_epoch,uint32_t reason_flags){
 if(!main_thread()||(reason_flags&WARMUP_SNAPSHOT_VALID)||(reason_flags&~UINT32_C(31))||atomic_flag_test_and_set_explicit(&snapshot_lock,memory_order_acquire))return 0;
 if(world_epoch&&world_epoch<snapshot_value.world_epoch){atomic_flag_clear_explicit(&snapshot_lock,memory_order_release);return 0;}
 snapshot_value.flags=(snapshot_value.flags&~WARMUP_SNAPSHOT_VALID)|reason_flags;
 if(world_epoch)snapshot_value.world_epoch=world_epoch;
 atomic_flag_clear_explicit(&snapshot_lock,memory_order_release);return 1;
}
int warmup_native_snapshot_seal(const struct warmup_native_snapshot_v1 *s){
 if(!main_thread()||!shape_valid(s)||!(s->flags&WARMUP_SNAPSHOT_VALID)||!(s->flags&WARMUP_SNAPSHOT_BASELINE_READY)||(s->flags&(WARMUP_SNAPSHOT_MUTATION_INFLIGHT|WARMUP_SNAPSHOT_DRIFT|WARMUP_SNAPSHOT_WORLD_RESET))||s->unknown||s->inflight_slots||!atomic_load_explicit(&live_validator,memory_order_acquire))return 0;
 if(atomic_flag_test_and_set_explicit(&snapshot_lock,memory_order_acquire))return 0;
 int valid=s->revision>snapshot_value.revision&&s->world_epoch>=snapshot_value.world_epoch;
 if(valid)snapshot_value=*s;
 atomic_flag_clear_explicit(&snapshot_lock,memory_order_release);return valid;
}
int warmup_native_snapshot_read(struct warmup_native_snapshot_v1 *out,uint64_t now_ns){
 if(!out||!main_thread()||!now_ns||atomic_flag_test_and_set_explicit(&snapshot_lock,memory_order_acquire))return 0;
 struct warmup_native_snapshot_v1 copy=snapshot_value;
 atomic_flag_clear_explicit(&snapshot_lock,memory_order_release);
 if(!shape_valid(&copy)||!(copy.flags&WARMUP_SNAPSHOT_VALID)||!(copy.flags&WARMUP_SNAPSHOT_BASELINE_READY)||(copy.flags&(WARMUP_SNAPSHOT_MUTATION_INFLIGHT|WARMUP_SNAPSHOT_DRIFT|WARMUP_SNAPSHOT_WORLD_RESET))||copy.unknown||copy.inflight_slots||now_ns<copy.captured_ns||now_ns>=copy.valid_until_ns)return 0;
 warmup_native_live_validator_v1 validator=atomic_load_explicit(&live_validator,memory_order_acquire);
 if(!validator||!validator(&copy))return 0;
 *out=copy;return 1;
}
