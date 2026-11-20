#ifndef WARMUP_ADMISSION_PLAN_H
#define WARMUP_ADMISSION_PLAN_H
#include <stdint.h>
enum admission_plan_result { ADMISSION_BAD_INPUT=-2, ADMISSION_REAL_CAPACITY_BLOCKED=-1, ADMISSION_OWNED_ROOM_UNAVAILABLE=0, ADMISSION_ROOM_READY=1, ADMISSION_REMOVE_OWNED_THEN_RECHECK=2 };
struct admission_snapshot { int32_t native_global_count,native_joining_count,party_size,max_players,team_count,other_team_count,owned_team_count,imbalance_allowance; };
/* Pure planning only. Never authorizes Join, removes an actor or changes a
 * native counter. Caller owns serialized reservation leases and must reread
 * original native +808 after any confirmed GS/Team removals. */
int warmup_admission_plan(const struct admission_snapshot *snapshot,int32_t *remove_owned);
#endif
