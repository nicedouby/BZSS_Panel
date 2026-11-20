#ifndef IDENTITY_RECOVERY_H
#define IDENTITY_RECOVERY_H
#include <stdint.h>
struct ir_target {uint64_t address;int32_t index,serial;uint64_t team;};
struct ir_request {char operation[33];uint64_t pid,start_ticks,world,gs;uint32_t count;struct ir_target targets[99];};
struct ir_report {int stage,error;uint32_t done,index,calls;};
int warmup_recovery_begin(const struct ir_request *r);
void warmup_recovery_tick(struct ir_report *out);
#endif
