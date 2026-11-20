#define _POSIX_C_SOURCE 200809L
#include "queue_display.h"
#include "queue_display_abi.generated.h"
#include "warmup_publish.h"
#include "../native/warmup_native_snapshot.h"
#include "../native/warmup_control.h"
#include <errno.h>
#include <limits.h>
#include <stdatomic.h>
#include <stddef.h>
#include <string.h>
#include <time.h>

_Static_assert(ATOMIC_LLONG_LOCK_FREE==2,"callback counters must be lock-free");
_Static_assert(sizeof qd_original_call==6&&sizeof qd_original_context==26,"pinned relay extent");
static _Atomic int qd_configured_mode=-1;
static atomic_flag qd_entered=ATOMIC_FLAG_INIT;
static _Atomic uint64_t qd_calls,qd_original_calls,qd_original_returns;
static _Atomic uint64_t qd_eligible,qd_replacements,qd_concurrent;
/* One outer callback owns this writer. All sample fields are atomic and use
 * the same SC order as the sequence, so telemetry never races plain storage. */
static _Atomic uint64_t qd_sequence,qd_revision,qd_epoch,qd_last_call_ns;
static _Atomic int64_t qd_raw,qd_candidate,qd_returned;
static _Atomic int qd_reason;

#ifdef WARMUP_QUEUE_DISPLAY_FIXTURE
extern uintptr_t qd_fixture_return_address(void);
extern uint64_t qd_fixture_clock_ns(void);
extern qd_original_fn qd_fixture_expected_original(void);
#endif

static uint64_t qd_clock_ns(void){
#ifdef WARMUP_QUEUE_DISPLAY_FIXTURE
 return qd_fixture_clock_ns();
#else
 struct timespec t;
 return clock_gettime(CLOCK_MONOTONIC,&t)?0:
  (uint64_t)t.tv_sec*UINT64_C(1000000000)+(uint64_t)t.tv_nsec;
#endif
}
static qd_original_fn qd_expected_original(void){
#ifdef WARMUP_QUEUE_DISPLAY_FIXTURE
 return qd_fixture_expected_original();
#else
 return (qd_original_fn)QD_ORIGINAL_VA;
#endif
}
int warmup_queue_display_configure(int mode){
 if(mode<QD_OFF||mode>QD_APPLY)return 0;
 int expected=-1;
 return atomic_compare_exchange_strong_explicit(&qd_configured_mode,&expected,mode,memory_order_release,memory_order_relaxed);
}
static int qd_mode(void){
 int mode=atomic_load_explicit(&qd_configured_mode,memory_order_acquire);
 if(mode<0){
  int expected=-1;
  (void)atomic_compare_exchange_strong_explicit(&qd_configured_mode,&expected,QD_OFF,memory_order_acq_rel,memory_order_acquire);
  mode=atomic_load_explicit(&qd_configured_mode,memory_order_acquire);
 }
 return mode;
}
static void qd_record(int64_t raw,int64_t candidate,int64_t returned,int reason,
                      uint64_t revision,uint64_t epoch,uint64_t now){
 atomic_fetch_add(&qd_sequence,1);
 atomic_store(&qd_raw,raw);atomic_store(&qd_candidate,candidate);atomic_store(&qd_returned,returned);
 atomic_store(&qd_reason,reason);atomic_store(&qd_revision,revision);atomic_store(&qd_epoch,epoch);atomic_store(&qd_last_call_ns,now);
 atomic_fetch_add(&qd_sequence,1);
}

__attribute__((noinline,visibility("hidden")))
int32_t warmup_queue_display_hook(void *gm,qd_original_fn original){
#ifdef WARMUP_QUEUE_DISPLAY_FIXTURE
 const uintptr_t return_site=qd_fixture_return_address();
#else
 const uintptr_t return_site=(uintptr_t)__builtin_return_address(0);
#endif
 const int reentered=atomic_flag_test_and_set_explicit(&qd_entered,memory_order_acquire);
 const int mode=reentered?QD_OFF:qd_mode();
 atomic_fetch_add_explicit(&qd_calls,1,memory_order_relaxed);
 atomic_fetch_add_explicit(&qd_original_calls,1,memory_order_relaxed);
 /* The relay supplies the actual valid original target. Do not issue a
  * second engine query, including on a wrong thread/callsite or reentry. */
 const int32_t raw=original(gm);
 const int native_errno=errno;
 atomic_fetch_add_explicit(&qd_original_returns,1,memory_order_relaxed);
 if(reentered){
  atomic_fetch_add_explicit(&qd_concurrent,1,memory_order_relaxed);
  errno=native_errno;return raw; /* outer owner alone releases the fence */
 }

 uint64_t now=qd_clock_ns(),revision=0,epoch=0;
 struct wp_decision decision={0,raw,WP_NO_SNAPSHOT};
 int reason=WP_NO_SNAPSHOT;
 if(mode==QD_OFF)reason=QD_REASON_OFF;
 else if(return_site!=QD_HOOK_RETURN_VA)reason=WP_CALLSITE_MISMATCH;
 else if(original!=qd_expected_original())reason=QD_REASON_ORIGINAL;
 else if(warmup_control_failed())reason=QD_REASON_FAILED;
 else if(!now)reason=QD_REASON_CLOCK;
 else{
  struct warmup_display_config display={0};
  const int got=warmup_control_display_config(&display);
  if(warmup_control_failed())reason=QD_REASON_FAILED;
  else{
   const struct wp_display_input input={.raw_count=raw,.target=display.target,
    .capacity=display.capacity,.config_valid=got,.enabled=display.enabled,.callsite_valid=gm!=NULL};
   decision=warmup_display_decide(&input);reason=decision.reason;
  }
 }
 if(decision.replace&&(decision.count<INT32_MIN||decision.count>INT32_MAX)){
  decision=(struct wp_decision){0,raw,WP_INVALID_COUNT};
  reason=WP_INVALID_COUNT;
 }
 int32_t returned=raw;
 if(decision.replace){
  atomic_fetch_add_explicit(&qd_eligible,1,memory_order_relaxed);
  if(mode==QD_APPLY){returned=(int32_t)decision.count;atomic_fetch_add_explicit(&qd_replacements,1,memory_order_relaxed);}
 }
 qd_record(raw,decision.count,returned,reason,revision,epoch,now);
 errno=native_errno;
 atomic_flag_clear_explicit(&qd_entered,memory_order_release);
 return returned;
}

void warmup_queue_display_telemetry_read(struct qd_telemetry *out){
 if(!out)return;
 memset(out,0,sizeof *out);
 const int mode=atomic_load_explicit(&qd_configured_mode,memory_order_acquire);
 out->mode=mode<0?QD_OFF:mode;
 out->calls=atomic_load_explicit(&qd_calls,memory_order_relaxed);
 out->original_calls=atomic_load_explicit(&qd_original_calls,memory_order_relaxed);
 out->original_returns=atomic_load_explicit(&qd_original_returns,memory_order_relaxed);
 out->eligible=atomic_load_explicit(&qd_eligible,memory_order_relaxed);
 out->replacements=atomic_load_explicit(&qd_replacements,memory_order_relaxed);
 out->concurrent=atomic_load_explicit(&qd_concurrent,memory_order_relaxed);
 for(unsigned attempt=0;attempt<3;attempt++){
  const uint64_t before=atomic_load(&qd_sequence);
  if(!before||(before&1))continue;
  const int64_t raw=atomic_load(&qd_raw),candidate=atomic_load(&qd_candidate),returned=atomic_load(&qd_returned);
  const int reason=atomic_load(&qd_reason);
  const uint64_t revision=atomic_load(&qd_revision),epoch=atomic_load(&qd_epoch),now=atomic_load(&qd_last_call_ns);
  const uint64_t after=atomic_load(&qd_sequence);
  if(before!=after||(after&1))continue;
  out->raw=raw;out->candidate=candidate;out->returned=returned;out->reason=reason;
  out->revision=revision;out->epoch=epoch;out->last_call_ns=now;out->sample_sequence=after;out->coherent=1;
  break;
 }
}
