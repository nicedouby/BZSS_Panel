#ifndef WARMUP_PUBLISH_H
#define WARMUP_PUBLISH_H
#include <stddef.h>
#include <stdint.h>

enum wp_reason {
    WP_CONFIRMED = 0, WP_NO_SNAPSHOT, WP_STALE, WP_WRONG_WORLD,
    WP_MUTATING, WP_UNKNOWN, WP_COUNT_MISMATCH, WP_INVALID_COUNT,
    WP_CALLSITE_MISMATCH, WP_CONCURRENT, WP_CONFIGURED_TARGET,
    WP_DISPLAY_DISABLED, WP_DISPLAY_UNAVAILABLE
};
/* Engine-independent decision input. All identity booleans come from fresh
 * native validation; no caller may infer them from pointer equality alone. */
struct wp_input {
    uint64_t now_ns, captured_ns, valid_until_ns;
    uint32_t human_count, owned_count, unknown_count, capacity;
    int64_t raw_count;
    int snapshot_valid, identities_match, mutation_inflight, callsite_valid;
};
struct wp_decision { int replace; int64_t count; enum wp_reason reason; };
struct wp_decision warmup_publish_decide(const struct wp_input *input);
/* Display-only input. No H/B snapshot, World lease or admission evidence is
 * accepted here. The two pinned display exits share the same GT commit. */
struct wp_display_input {
    int64_t raw_count;
    uint32_t target,capacity;
    int config_valid,enabled,callsite_valid;
};
struct wp_decision warmup_display_decide(const struct wp_display_input *input);
const char *warmup_publish_reason(enum wp_reason reason);
int warmup_bootstrap_ready(void);
const char *warmup_bootstrap_error(void);

/* Numeric-only telemetry; each field is an atomic load, not a single coherent
 * engine-state snapshot. Legacy confirmed_revision/world_epoch remain zero for
 * configured-target display; neither field claims a consumed census. */
struct wp_telemetry {
    uint64_t natural_calls, replaced_calls, helper_calls, helper_returns;
    uint64_t concurrent_calls, confirmed_revision, world_epoch, last_call_ns;
    int64_t raw_count, effective_count;
    int reason, patched, admission_installed, queue_display_patched;
};
void warmup_publish_telemetry_read(struct wp_telemetry *out);
#endif
