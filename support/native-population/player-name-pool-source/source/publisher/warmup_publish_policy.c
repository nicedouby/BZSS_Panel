#include "warmup_publish.h"
#include <limits.h>

struct wp_decision warmup_publish_decide(const struct wp_input *v) {
    struct wp_decision out={0,v?v->raw_count:0,WP_NO_SNAPSHOT};
    if (!v) return out;
    if (!v->callsite_valid) { out.reason=WP_CALLSITE_MISMATCH; return out; }
    if (!v->snapshot_valid) return out;
    if (!v->now_ns || !v->captured_ns || v->now_ns<v->captured_ns ||
        v->now_ns>v->valid_until_ns || v->valid_until_ns<v->captured_ns ||
        v->valid_until_ns-v->captured_ns>UINT64_C(2000000000)) {
        out.reason=WP_STALE; return out;
    }
    if (!v->identities_match) { out.reason=WP_WRONG_WORLD; return out; }
    if (v->mutation_inflight) { out.reason=WP_MUTATING; return out; }
    if (v->unknown_count) { out.reason=WP_UNKNOWN; return out; }
    if (!v->capacity || v->capacity>100 || v->human_count>v->capacity ||
        v->owned_count>99 || v->owned_count>v->capacity-v->human_count ||
        v->raw_count<0 || v->raw_count>(int64_t)v->capacity) {
        out.reason=WP_INVALID_COUNT; return out;
    }
    /* This catches login/logout between the sealed census and the native
     * producer call. Travellers with different native semantics also pass
     * through until the counts agree; never overwrite a larger live count. */
    if (v->raw_count!=(int64_t)v->human_count) {
        out.reason=WP_COUNT_MISMATCH; return out;
    }
    out.replace=1; out.count=(int64_t)v->human_count+v->owned_count;
    out.reason=WP_CONFIRMED;
    return out;
}
struct wp_decision warmup_display_decide(const struct wp_display_input *v) {
    struct wp_decision out={0,v?v->raw_count:0,WP_DISPLAY_UNAVAILABLE};
    if(!v)return out;
    if(!v->callsite_valid){out.reason=WP_CALLSITE_MISMATCH;return out;}
    if(!v->config_valid)return out;
    if(!v->enabled){out.reason=WP_DISPLAY_DISABLED;return out;}
    if(v->enabled!=1||!v->capacity||v->capacity>100||v->target>99||v->target>=v->capacity){
        out.reason=WP_INVALID_COUNT;return out;
    }
    /* Intentionally exact, even when the real/native count exceeds target.
     * This return value is never fed to census, party or capacity decisions. */
    out.replace=1;out.count=v->target;out.reason=WP_CONFIGURED_TARGET;return out;
}
const char *warmup_publish_reason(enum wp_reason r) {
    static const char *const names[]={"confirmed_actual_count","no_snapshot",
        "snapshot_stale","world_identity_changed","mutation_inflight",
        "unknown_roster_members","native_human_count_changed","invalid_count",
        "callsite_changed","concurrent_callback","configured_target",
        "display_disabled","display_config_unavailable"};
    return (unsigned)r<sizeof names/sizeof names[0]?names[r]:"invalid_reason";
}
