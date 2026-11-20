#define _GNU_SOURCE
#include "warmup_publish.h"
#include "../integration/deployment_target.h"
#include "pinned_abi.h"
#include "queue_display.h"
#include "refresh_cadence.h"
#include "queue_display_abi.generated.h"
#include "../common/sha256.h"
#include "../native/warmup_native_snapshot.h"
#include "../native/warmup_control.h"
#include "../admission/warmup_admission.h"
#include "../admission/queue_guard.h"
#include <dirent.h>
#include <elf.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "Pinned Linux x86_64 startup-only build"
#endif
_Static_assert(ATOMIC_LLONG_LOCK_FREE == 2,"callback counters must be lock-free");
#define LAB_DIR WARMUP_TARGET_BASE
#define STATE_DIR WARMUP_TARGET_STATE
#define MARKER WARMUP_TARGET_MARKER
#define MARKER_TEXT WARMUP_TARGET_MARKER_TEXT

typedef void (*setting_fn)(void *,const uint64_t *,const int64_t *,uint32_t);
static setting_fn original_helper=(setting_fn)HELPER_VA;
static atomic_flag callback_busy=ATOMIC_FLAG_INIT;
static _Atomic int bootstrap_ready,admission_installed;
static _Atomic unsigned long long calls,replacements,helper_calls,helper_returns;
static _Atomic unsigned long long concurrent_calls,revision,epoch,last_call_ns;
static _Atomic long long raw_count,effective_count;
static _Atomic int last_reason=WP_NO_SNAPSHOT;
static int callsite_verified,patched;
static uintptr_t relay_va;
static unsigned long long process_start_ticks;
static char install_error[128]="not_enabled";

static uint64_t monotonic_ns(void) {
    struct timespec t;
    return clock_gettime(CLOCK_MONOTONIC,&t)?0:
        (uint64_t)t.tv_sec*UINT64_C(1000000000)+(uint64_t)t.tv_nsec;
}

/* One original helper call per natural native invocation. No native producer
 * calls, polling, object mutation, allocation or network work occur here. */
__attribute__((noinline,visibility("hidden")))
void warmup_playercount_hook(void *receiver,const uint64_t *key,
                            const int64_t *source,uint32_t advert,void *gm) {
    const uintptr_t return_address=(uintptr_t)__builtin_return_address(0);
    if (atomic_flag_test_and_set_explicit(&callback_busy,memory_order_acquire)) {
        atomic_fetch_add(&concurrent_calls,1);
        atomic_store(&last_reason,WP_CONCURRENT);
        atomic_fetch_add(&helper_calls,1);
        original_helper(receiver,key,source,advert);
        atomic_fetch_add(&helper_returns,1);
        return;
    }
    struct warmup_display_config display={0};
    const uint64_t now=monotonic_ns();
    /* Native source is the exact input the original helper would read. */
    const int64_t raw=*source;
    const int got=warmup_control_display_config(&display);
    const struct wp_display_input input={
        .raw_count=raw,.target=display.target,.capacity=display.capacity,
        .config_valid=got,.enabled=display.enabled,
        .callsite_valid=return_address==RETURN_VA && advert==3 && receiver && gm && key
    };
    const struct wp_decision decision=warmup_display_decide(&input);
    atomic_fetch_add(&calls,1);atomic_store(&last_call_ns,now);
    atomic_store(&raw_count,raw);atomic_store(&effective_count,decision.count);
    atomic_store(&last_reason,decision.reason);
    if (decision.replace) {
        atomic_fetch_add(&replacements,1);
    }
    atomic_fetch_add(&helper_calls,1);
    original_helper(receiver,key,decision.replace?&decision.count:source,advert);
    atomic_fetch_add(&helper_returns,1);
    atomic_flag_clear_explicit(&callback_busy,memory_order_release);
}

/* Verification and the audited five-byte callsite relay are retained from the
 * earlier fixed-count experiment. Its worker, arm and target=51 were removed. */
#include "bootstrap_helpers.inc"
#include "queue_display_bootstrap.inc"

int warmup_bootstrap_ready(void) {return atomic_load_explicit(&bootstrap_ready,memory_order_acquire);}
const char *warmup_bootstrap_error(void) {return install_error;}
void warmup_publish_telemetry_read(struct wp_telemetry *o) {
    if (!o) return;
    *o=(struct wp_telemetry){.natural_calls=atomic_load(&calls),
        .replaced_calls=atomic_load(&replacements),.helper_calls=atomic_load(&helper_calls),
        .helper_returns=atomic_load(&helper_returns),.concurrent_calls=atomic_load(&concurrent_calls),
        .confirmed_revision=atomic_load(&revision),.world_epoch=atomic_load(&epoch),
        .last_call_ns=atomic_load(&last_call_ns),.raw_count=atomic_load(&raw_count),
        .effective_count=atomic_load(&effective_count),.reason=atomic_load(&last_reason),
        .patched=patched,.admission_installed=atomic_load(&admission_installed),
        .queue_display_patched=qd_patched};
}
static void fatal_bootstrap(const char *why) {
    snprintf(install_error,sizeof install_error,"%s",why);
    fprintf(stderr,"warmup integrated bootstrap: %s\n",install_error);
    _exit(125);
}
__attribute__((constructor(101))) static void warmup_bootstrap_install(void) {
    const char *enabled=getenv("WARMUP_INTEGRATED_ENABLE");
    if (!enabled || strcmp(enabled,"1")) return;
    char hostname[128]={0};
    if (gethostname(hostname,sizeof hostname-1) || strcmp(hostname,WARMUP_TARGET_HOSTNAME) ||
        geteuid()!=WARMUP_TARGET_UID || getegid()!=WARMUP_TARGET_GID)
        fatal_bootstrap("unexpected_isolated_host");
    if (!marker_gate()) fatal_bootstrap("marker_or_directory_gate");
    if (!start_ticks(&process_start_ticks)) fatal_bootstrap("process_identity_failed");
    const char *error=verify_elf_and_code();
    if (error) fatal_bootstrap(error);
    error=warmup_refresh_cadence_install(PINNED_ELF_SHA);
    if (error) fatal_bootstrap(error);
    char admission_error[128]={0};
    if (!warmup_admission_install(admission_error,sizeof admission_error))
        fatal_bootstrap(admission_error[0]?admission_error:"admission_install_failed");
    atomic_store(&admission_installed,1);
    if (!warmup_queue_guard_install(admission_error,sizeof admission_error))
        fatal_bootstrap(admission_error[0]?admission_error:"queue_guard_install_failed");
    error=install_callsite();
    if (error) fatal_bootstrap(error);
    if (!callsite_verified || !patched || !relay_va) fatal_bootstrap("publisher_install_incomplete");
    error=install_queue_display();
    if (error) fatal_bootstrap(error);
    if (qd_patched && !qd_relay_va) fatal_bootstrap("queue_display_install_incomplete");
    strcpy(install_error,"ready_before_engine_start");
    atomic_store_explicit(&bootstrap_ready,1,memory_order_release);
    /* Native's later constructor owns the worker and game-thread tick hook. */
    unsetenv("LD_PRELOAD");
}
