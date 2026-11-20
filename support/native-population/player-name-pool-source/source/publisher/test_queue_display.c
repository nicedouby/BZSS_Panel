/* Actual Beacon display callback; only external dependencies are synthetic. */
#define _POSIX_C_SOURCE 200809L
#define WARMUP_QUEUE_DISPLAY_FIXTURE 1
#include "queue_display.c"
#include <stdio.h>
#include <stdlib.h>

static unsigned checks;
#define CHECK(x) do{++checks;if(!(x)){fprintf(stderr,"FAIL %d: %s\n",__LINE__,#x);exit(1);}}while(0)
#define GM ((void *)(uintptr_t)0x40000)
static struct {
 struct warmup_display_config display;
 uint64_t now;
 uintptr_t return_site;
 int32_t raw,inner_return;
 int failed,valid,reenter,depth;
 unsigned original,other_original,reads,snapshot_reads;
 void *received_gm;
} mock;
static int32_t native_original(void *gm);
static int32_t other_original(void *gm){++mock.other_original;mock.received_gm=gm;errno=EDOM;return mock.raw;}
uintptr_t qd_fixture_return_address(void){return mock.return_site;}
uint64_t qd_fixture_clock_ns(void){errno=EIO;return mock.now;}
qd_original_fn qd_fixture_expected_original(void){return native_original;}
int warmup_control_failed(void){return mock.failed;}
int warmup_control_display_config(struct warmup_display_config *out){
 ++mock.reads;errno=EIO;if(!mock.valid||mock.failed)return 0;*out=mock.display;return 1;
}
int warmup_native_snapshot_read(struct warmup_native_snapshot_v1 *out,uint64_t now){
 (void)out;(void)now;++mock.snapshot_reads;return 0;
}
static int32_t native_original(void *gm){
 ++mock.original;mock.received_gm=gm;
 if(mock.reenter&&!mock.depth){mock.depth=1;mock.inner_return=warmup_queue_display_hook(gm,native_original);mock.depth=0;}
 errno=EDOM;return mock.depth?-7:mock.raw;
}
static void reset(void){
 memset(&mock,0,sizeof mock);mock.now=100;mock.return_site=QD_HOOK_RETURN_VA;mock.valid=1;
 mock.display=(struct warmup_display_config){60,100,1};
 atomic_store(&qd_configured_mode,-1);atomic_flag_clear(&qd_entered);
 atomic_store(&qd_calls,0);atomic_store(&qd_original_calls,0);atomic_store(&qd_original_returns,0);
 atomic_store(&qd_eligible,0);atomic_store(&qd_replacements,0);atomic_store(&qd_concurrent,0);
 atomic_store(&qd_sequence,0);atomic_store(&qd_raw,0);atomic_store(&qd_candidate,0);atomic_store(&qd_returned,0);
 atomic_store(&qd_revision,0);atomic_store(&qd_epoch,0);atomic_store(&qd_last_call_ns,0);atomic_store(&qd_reason,0);
}
static struct qd_telemetry sample(void){struct qd_telemetry t;warmup_queue_display_telemetry_read(&t);return t;}
static void one_original(const struct qd_telemetry *t){
 CHECK(t->calls==1&&t->original_calls==1&&t->original_returns==1);
 CHECK(mock.original+mock.other_original==1&&mock.received_gm==GM);
 CHECK(t->coherent&&t->sample_sequence==2);CHECK(errno==EDOM);CHECK(mock.snapshot_reads==0);
 CHECK(t->revision==0&&t->epoch==0);
}
static void modes(void){
 for(int mode=QD_OFF;mode<=QD_APPLY;mode++){
  reset();CHECK(warmup_queue_display_configure(mode));CHECK(!warmup_queue_display_configure(mode));
  mock.raw=13;int32_t value=warmup_queue_display_hook(GM,native_original);struct qd_telemetry t=sample();
  one_original(&t);CHECK(t.mode==mode&&t.raw==13&&t.returned==value);
  CHECK(value==(mode==QD_APPLY?60:13));CHECK(t.candidate==(mode==QD_OFF?13:60));
  CHECK(t.eligible==(uint64_t)(mode!=QD_OFF)&&t.replacements==(uint64_t)(mode==QD_APPLY));
  CHECK(t.reason==(mode==QD_OFF?QD_REASON_OFF:WP_CONFIGURED_TARGET));
 }
 reset();CHECK(!warmup_queue_display_configure(-1));CHECK(!warmup_queue_display_configure(3));CHECK(warmup_queue_display_configure(QD_APPLY));
 reset();CHECK(warmup_queue_display_hook(GM,native_original)==0);CHECK(!warmup_queue_display_configure(QD_APPLY));
}
static void fixed_and_disabled(void){
 const int32_t values[]={INT32_MIN,-1,0,13,59,60,61,99,100,INT32_MAX};
 for(unsigned i=0;i<sizeof values/sizeof values[0];i++){
  reset();mock.raw=values[i];CHECK(warmup_queue_display_configure(QD_APPLY));
  CHECK(warmup_queue_display_hook(GM,native_original)==60);struct qd_telemetry t=sample();one_original(&t);
  CHECK(t.candidate==60&&t.reason==WP_CONFIGURED_TARGET);
  mock.display.enabled=0;CHECK(warmup_queue_display_hook(GM,native_original)==values[i]);CHECK(sample().reason==WP_DISPLAY_DISABLED);
 }
 reset();CHECK(warmup_queue_display_configure(QD_APPLY));
 for(uint32_t target=0;target<=99;target++){
  mock.display.target=target;CHECK(warmup_queue_display_hook(GM,native_original)==(int32_t)target);
 }
}
static void fallbacks(void){
 const int reasons[]={QD_REASON_FAILED,WP_DISPLAY_UNAVAILABLE,WP_INVALID_COUNT,QD_REASON_CLOCK,WP_CALLSITE_MISMATCH,QD_REASON_ORIGINAL};
 for(unsigned i=0;i<sizeof reasons/sizeof reasons[0];i++){
  reset();mock.raw=13;CHECK(warmup_queue_display_configure(QD_APPLY));qd_original_fn original=native_original;
  switch(i){case 0:mock.failed=1;break;case 1:mock.valid=0;break;case 2:mock.display.target=100;break;
   case 3:mock.now=0;break;case 4:mock.return_site++;break;case 5:original=other_original;break;default:CHECK(0);}
  CHECK(warmup_queue_display_hook(GM,original)==13);struct qd_telemetry t=sample();one_original(&t);
  CHECK(t.candidate==13&&t.reason==reasons[i]&&!t.eligible&&!t.replacements);
 }
}
static void reentry(void){
 reset();CHECK(warmup_queue_display_configure(QD_APPLY));mock.reenter=1;
 CHECK(warmup_queue_display_hook(GM,native_original)==60);CHECK(mock.inner_return==-7);
 struct qd_telemetry t=sample();CHECK(mock.original==2&&t.original_calls==2&&t.original_returns==2&&t.concurrent==1);
 CHECK(mock.reads==1&&!mock.snapshot_reads&&t.replacements==1&&t.candidate==60);
 CHECK(!atomic_flag_test_and_set(&qd_entered));atomic_flag_clear(&qd_entered);
 atomic_store(&qd_sequence,3);CHECK(!sample().coherent);atomic_store(&qd_sequence,2);CHECK(sample().coherent);
 warmup_queue_display_telemetry_read(NULL);
}
int main(void){modes();fixed_and_disabled();fallbacks();reentry();printf("PASS fixed Beacon callback: %u checks; original once, snapshot reads zero, UE0\n",checks);return 0;}
