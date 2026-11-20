#ifndef WARMUP_QUEUE_DISPLAY_H
#define WARMUP_QUEUE_DISPLAY_H
#include <stdint.h>

#if defined(__GNUC__)
#define QD_HIDDEN __attribute__((visibility("hidden")))
#else
#define QD_HIDDEN
#endif

enum qd_mode { QD_OFF=0, QD_OBSERVE=1, QD_APPLY=2 };
/* Other reason values are the existing enum wp_reason. */
enum qd_reason { QD_REASON_OFF=100, QD_REASON_FAILED=101,
                 QD_REASON_ORIGINAL=102, QD_REASON_CLOCK=103 };
typedef int32_t (*qd_original_fn)(void *gm);

/* Startup-only, before installing the relay/starting workers. Returns 1 once.
 * Invalid modes do not consume configuration. First unconfigured invocation
 * seals OFF, so this cannot become a later worker-controlled mode switch. */
QD_HIDDEN int warmup_queue_display_configure(int mode);
/* original is the valid native target captured by the pinned natural relay.
 * Every invocation calls that target exactly once, including all fallbacks. */
QD_HIDDEN int32_t warmup_queue_display_hook(void *gm,qd_original_fn original);

struct qd_telemetry {
 uint64_t calls,original_calls,original_returns,eligible,replacements,concurrent;
 int64_t raw,candidate,returned;
 uint64_t revision,epoch,last_call_ns,sample_sequence;
 int mode,reason,coherent;
};
/* Fixed three read attempts; never waits. coherent covers only the last-call
 * raw/candidate/returned/reason/revision/epoch/time tuple, not cumulative
 * counters. Reentered calls update counters only and leave that tuple alone.
 * Telemetry is observational and must never become an authorization input. */
QD_HIDDEN void warmup_queue_display_telemetry_read(struct qd_telemetry *out);
#endif
