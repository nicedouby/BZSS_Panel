#include "round_cycle.h"
#include <stdio.h>
#include <stdlib.h>
#define CHECK(x) do{if(!(x)){fprintf(stderr,"line %d: %s\n",__LINE__,#x);exit(1);}++checks;}while(0)
static unsigned checks;
int main(void){
 struct rc_state s={0};struct rc_input v={1,10,RC_STARTING,1,1};
 CHECK(rc_step(&s,&v)==RC_WAIT);v.now_ns=3000000000;CHECK(rc_step(&s,&v)==RC_WAIT);
 v.now_ns=3000000001;v.ready=0;CHECK(rc_step(&s,&v)==RC_WAIT);v.ready=1;CHECK(rc_step(&s,&v)==RC_RUN);
 v.phase=RC_SETTLEMENT;v.clear=0;CHECK(rc_step(&s,&v)==RC_DRAIN);
 v.phase=RC_PLAYING;CHECK(rc_step(&s,&v)==RC_DRAIN);v.clear=1;CHECK(rc_step(&s,&v)==RC_DRAIN);
 v.world=99;v.phase=RC_TRAVEL;v.clear=0;CHECK(rc_step(&s,&v)==RC_HOLD);CHECK(s.world==10&&s.cleared_old);
 v.world=11;v.phase=RC_STARTING;v.clear=1;v.now_ns+=10;CHECK(rc_step(&s,&v)==RC_WAIT);CHECK(s.completed_cycles==1);
 v.now_ns+=3000000000;CHECK(rc_step(&s,&v)==RC_RUN);
 v.phase=RC_UNKNOWN;CHECK(rc_step(&s,&v)==RC_HOLD);v.phase=RC_PLAYING;CHECK(rc_step(&s,&v)==RC_RUN);
 v.phase=RC_SETTLEMENT;v.clear=0;CHECK(rc_step(&s,&v)==RC_DRAIN);v.world=12;v.phase=RC_STARTING;CHECK(rc_step(&s,&v)==RC_FAULT);CHECK(s.fault);
 CHECK(rc_classify("WaitingPostMatch")==RC_SETTLEMENT);CHECK(rc_classify("WaitingToStart")==RC_STARTING);CHECK(rc_classify("invented")==RC_UNKNOWN);
 for(unsigned n=0;n<100;n++){
  struct rc_state t={0};struct rc_input a={1,100,RC_PLAYING,1,1};CHECK(rc_step(&t,&a)==RC_WAIT);a.now_ns+=3000000000;CHECK(rc_step(&t,&a)==RC_RUN);
  for(unsigned cycle=0;cycle<n;cycle++){a.phase=RC_SETTLEMENT;CHECK(rc_step(&t,&a)==RC_DRAIN);a.phase=RC_TRAVEL;CHECK(rc_step(&t,&a)==RC_HOLD);a.world++;a.now_ns++;a.phase=RC_STARTING;CHECK(rc_step(&t,&a)==RC_WAIT);a.now_ns+=3000000000;CHECK(rc_step(&t,&a)==RC_RUN);}
  CHECK(t.completed_cycles==n);
 }
 printf("round_cycle checks=%u passed\n",checks);return 0;
}
