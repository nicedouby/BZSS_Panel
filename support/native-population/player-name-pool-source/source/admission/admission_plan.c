#include "admission_plan.h"
#include <stddef.h>
int warmup_admission_plan(const struct admission_snapshot *s,int32_t *remove_owned){
 if(!s||!remove_owned)return ADMISSION_BAD_INPUT;
 *remove_owned=0;
 if(s->native_global_count<0||s->native_joining_count<0||s->party_size<1||s->max_players<1||s->max_players>100||s->native_global_count>100||s->native_joining_count>4096||s->party_size>100||s->team_count<0||s->team_count>100||s->other_team_count<0||s->other_team_count>100||s->owned_team_count<0||s->owned_team_count>s->team_count||s->imbalance_allowance<0||s->imbalance_allowance>100)return ADMISSION_BAD_INPUT;
 if((int64_t)s->native_global_count+s->native_joining_count+s->party_size>s->max_players)return ADMISSION_REAL_CAPACITY_BLOCKED;
 int64_t half=(int64_t)s->team_count+s->party_size-((int64_t)s->max_players+s->imbalance_allowance)/2;
 int64_t difference=(int64_t)s->team_count+s->party_size-s->other_team_count-9;
 int64_t needed=half>difference?half:difference;if(needed<0)needed=0;
 if(needed>s->owned_team_count)return ADMISSION_OWNED_ROOM_UNAVAILABLE;
 *remove_owned=(int32_t)needed;
 return needed?ADMISSION_REMOVE_OWNED_THEN_RECHECK:ADMISSION_ROOM_READY;
}
