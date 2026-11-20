#ifndef WARMUP_CONTROL_H
#define WARMUP_CONTROL_H
#include <stdint.h>
/* Sticky for the entire process. false proves no pool action/Begin has run.
 * enabled=0 drains through target=0 and NEVER resets this bit. */
int warmup_control_is_armed(void);
/* Sticky terminal state. Callers must fail closed rather than interpreting
 * armed=false as permission to ignore still-owned objects. Safe on workers. */
int warmup_control_failed(void);
/* Game-thread-only hint for bounded settlement census batching. */
int warmup_control_round_draining(void);
/* Starts at zero. Advances once only after a non-reentered main-thread
 * original_tick returns and its engine identity matches. Metadata/pool phases
 * do not advance it; queue calls inside one outer tick share the same epoch. */
uint64_t warmup_control_outer_epoch(void);
/* Display-only, one coherent committed configuration shared by both pinned
 * display callsites. Never a census, capacity lease or admission authority. */
struct warmup_display_config { uint32_t target,capacity; int enabled; };
int warmup_control_display_config(struct warmup_display_config *out);
#endif
