#include "../native/warmup_gt_schedule.h"
#include <assert.h>
#include <stdio.h>

int main(void){
 const uint64_t budget=UINT64_C(1500000),sample_cost=UINT64_C(900000),probe_cost=UINT64_C(700000);
 unsigned old_progress=0,new_progress=0,discovery=0,pool=0,checks=0;
 for(uint64_t tick=1;tick<=10000;tick++){
  assert(wc_gt_read_turn(0,tick)==WC_GT_DISCOVERY);checks++;
  /* Previous ordering can enter pool, then expire before census: its
   * discovery and world-probe costs share one deadline. */
  if(sample_cost+probe_cost<budget)old_progress++;
  enum wc_gt_read_turn turn=wc_gt_read_turn(1,tick);
  if(turn==WC_GT_DISCOVERY)discovery++;
  else{pool++;if(probe_cost<budget)new_progress++;}
  assert(turn==(tick&1?WC_GT_POOL:WC_GT_DISCOVERY));checks++;
 }
 assert(old_progress==0&&new_progress==5000&&discovery==5000&&pool==5000);checks++;
 /* Scheduling does not authorize a phase when the probe itself overruns.
  * Real before_deadline checks must still block it; the budget is unchanged. */
 const uint64_t overlong_probe=budget+1;
 assert(!(overlong_probe<budget));checks++;
 assert(wc_gt_read_turn(1,UINT64_MAX)==WC_GT_POOL);checks++;
 assert(wc_gt_read_turn(1,0)==WC_GT_DISCOVERY);checks++;
 printf("gt_schedule_checks=%u old_progress=%u new_progress=%u budget_ns=%llu\n",checks,old_progress,new_progress,(unsigned long long)budget);
 return 0;
}
