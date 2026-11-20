#ifndef NT_NATIVE_RUNTIME_H
#define NT_NATIVE_RUNTIME_H
#include "native_graph.h"
#include <stdint.h>
/* Initialization/worker do filesystem/socket work; on_tick only uses trylock and atomics. */
int nt_runtime_start(const char session[33]);
void nt_runtime_on_tick(const struct nt_snapshot *snapshot);
int nt_runtime_copy_snapshot(struct nt_snapshot *out);
const char *nt_runtime_state(void);
int nt_runtime_writes_enabled(void);
unsigned long long nt_runtime_applied_count(void);
#endif
