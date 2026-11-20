#ifndef WARMUP_ROUND_CYCLE_H
#define WARMUP_ROUND_CYCLE_H
#include <stdint.h>
enum rc_phase {RC_UNKNOWN,RC_STARTING,RC_PLAYING,RC_SETTLEMENT,RC_TRAVEL};
enum rc_action {RC_HOLD,RC_DRAIN,RC_WAIT,RC_RUN,RC_FAULT};
struct rc_state {uint64_t world,start_ns,completed_cycles;int initialized,ending,cleared_old,running,fault;};
struct rc_input {uint64_t now_ns,world;enum rc_phase phase;int ready,clear;};
enum rc_phase rc_classify(const char *name);
enum rc_action rc_step(struct rc_state *s,const struct rc_input *in);
#endif
