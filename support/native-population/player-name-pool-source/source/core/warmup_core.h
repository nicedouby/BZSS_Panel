#ifndef WARMUP_CORE_H
#define WARMUP_CORE_H

#include <stddef.h>
#include <stdint.h>

/* C11, caller-owned storage, no engine calls, I/O, threads or global RNG. */
#define WU_MAX_TARGET 99u
#define WU_MAX_CAPACITY 100u
#define WU_NAME_MAX_UNITS 32u /* display UTF-16 units, excluding NUL */
#define WU_NAME_STORAGE_UNITS (WU_NAME_MAX_UNITS + 1u)
#define WU_NAME_MAX_UTF8_BYTES (WU_NAME_MAX_UNITS * 4u)
#define WU_MESSAGE_MAX_UNITS (WU_NAME_MAX_UNITS + 19u) /* longest suffix + NUL */
#define WU_NAME_MAX_POOL 4096u
#define WU_NAME_POOL_SIZE 80u

enum wu_result {
    WU_OK = 0,
    WU_ERR_ARGUMENT = -1,
    WU_ERR_CONFIG = -2,
    WU_ERR_SNAPSHOT = -3,
    WU_ERR_UTF8 = -4,
    WU_ERR_NAME_TOO_LONG = -5,
    WU_ERR_NAME_EXHAUSTED = -6,
    WU_ERR_BUFFER = -7
};

struct wu_config {
    uint32_t target;          /* 0..99 */
    uint32_t capacity;        /* 1..100 */
    uint32_t reserved_slots;  /* >=1; target + reserved_slots <= capacity */
    uint32_t settle_samples;  /* 1..1000 distinct confirmed samples */
};

struct wu_snapshot {
    uint64_t sample_id;       /* strictly increasing within a World */
    uint64_t world_generation;/* caller's real World epoch, never scan count */
    uint32_t confirmed_h_total;
    uint32_t h1, h2, h_unassigned; /* sum exactly equals confirmed_h_total */
    uint32_t owned_b1, owned_b2;   /* confirmed valid owned objects only */
    uint32_t unknown;             /* never silently classified as human */
    uint32_t inflight_slots;      /* additional reserved capacity, never H/B */
    int baseline_ready;
};

enum wu_action_type { WU_NOOP = 0, WU_ADD, WU_REMOVE, WU_MOVE };
struct wu_action {
    enum wu_action_type type;
    uint32_t from_team; /* 1/2 for REMOVE/MOVE, else 0 */
    uint32_t to_team;   /* 1/2 for ADD/MOVE, else 0 */
};
enum wu_reason {
    WU_REASON_STABLE = 0, WU_REASON_ACTION,
    WU_REASON_BASELINE, WU_REASON_UNKNOWN, WU_REASON_INFLIGHT,
    WU_REASON_INFLIGHT_HEADROOM,
    WU_REASON_CAPACITY, WU_REASON_SETTLING, WU_REASON_PENDING,
    WU_REASON_STALE_SAMPLE, WU_REASON_INVALID_CONFIG,
    WU_REASON_INVALID_SNAPSHOT
};
struct wu_plan {
    uint32_t desired; /* business target = max(0, T-H), never counts inflight as H */
    uint32_t admission_safe_owned_target; /* min(desired, capacity-reserve-H-inflight) */
    uint32_t target_b1, target_b2; /* sum equals admission_safe_owned_target */
    uint32_t published_confirmed; /* H + valid owned B; NEVER desired */
    uint32_t capacity_used;       /* H + valid owned B + unknown + inflight */
    int publication_ready;        /* false for baseline/unknown/inflight/invalid */
    struct wu_action action;     /* at most one owned-object operation */
    enum wu_reason reason;
};

int wu_config_validate(const struct wu_config *config);
/* Pure calculation. previous is optional; only a same-World previous sample
 * may prioritize removing an arriving human's own team. Unknown freezes all
 * actions and publication. Inflight forbids ADD/MOVE/publication, but permits
 * confirmed owned REMOVE to reserve headroom. It is not confirmed H or B.
 * This cannot authorize admission: native party/capacity leases are separate. */
int wu_make_plan(const struct wu_config *config, const struct wu_snapshot *now,
                 const struct wu_snapshot *previous, struct wu_plan *out);

/* Optional debounce / duplicate-dispatch wrapper. A returned action is latched
 * until resolve. Caller must resolve only after confirmed completion or an
 * explicit rejected operation, then obtain a NEW confirmed sample. Never use
 * resolve as a timer retry. Inflight headroom REMOVE bypasses settle_samples;
 * it is still latched, while later replenishment uses the normal debounce.
 * Reset on World change before touching old UE refs. */
struct wu_controller {
    struct wu_snapshot last, stable;
    struct wu_config config;
    uint32_t stable_samples;
    uint64_t emitted_sample_id;
    int initialized, awaiting_resolution;
};
void wu_controller_reset(struct wu_controller *controller);
int wu_controller_next(struct wu_controller *controller,
                       const struct wu_config *config,
                       const struct wu_snapshot *now, struct wu_plan *out);
void wu_controller_resolve(struct wu_controller *controller);

enum wu_name_style {
    WU_STYLE_CHINESE = 1, WU_STYLE_ENGLISH = 2,
    WU_STYLE_MIXED = 4, WU_STYLE_ANY = 7
};
struct wu_name {
    uint16_t units[WU_NAME_STORAGE_UNITS];
    uint32_t unit_count; /* INCLUDES NUL; immutable after assignment */
    uint32_t style;
    char utf8[WU_NAME_MAX_UTF8_BYTES + 1u]; /* same confirmed name for receipts */
};
struct wu_rng {
    uint64_t state;
    uint64_t (*entropy)(void *context); /* optional caller entropy */
    void *context;
};
void wu_rng_seed(struct wu_rng *rng, uint64_t seed);
/* bytes excludes final NUL. Rejects embedded NUL/control/invalid UTF-8,
 * invalid scalars and >32 display UTF-16 units; never truncates a surrogate. */
int wu_name_from_utf8(const char *utf8, size_t bytes, struct wu_name *out);
int wu_name_equal(const struct wu_name *a, const struct wu_name *b);
/* existing contains pointers to caller-held assigned/pending name snapshots.
 * Keep names reserved through cleanup + leave handling; reserve new names
 * serially before another call. No owned-object identity is derived from name.
 * Bounded complete pool traversal, no numeric fallback or infinite retries. */
int wu_name_select(const char *const *pool, size_t pool_count, struct wu_rng *rng,
                   const struct wu_name *const *existing, size_t existing_count,
                   struct wu_name *out);
int wu_name_generate(uint32_t styles, struct wu_rng *rng,
                     const struct wu_name *const *existing,
                     size_t existing_count, struct wu_name *out);
/* Appends " has connected." or " has disconnected." to the saved name.
 * capacity and *unit_count use UTF-16 units INCLUDING NUL, not UTF-8 bytes.
 * On WU_ERR_BUFFER, *unit_count is required capacity and out is untouched. */
int wu_message_build(const struct wu_name *name, int joining,
                     uint16_t *out, size_t capacity, size_t *unit_count);
const char *wu_result_name(int result);
const char *wu_reason_name(enum wu_reason reason);

#endif
