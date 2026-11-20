#define _GNU_SOURCE
#include "warmup_control.h"
#include "../integration/deployment_target.h"
#include "../integration/joint_control.h"
#include "warmup_control_config.h"
#include "warmup_ue_backend.h"
#include "warmup_gt_schedule.h"
#include "../round/round_cycle.h"
#include "../publisher/warmup_publish.h"
#include "../publisher/refresh_cadence.h"
#include "../publisher/queue_display.h"
#include "../admission/queue_guard.h"
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define WC_BASE WARMUP_TARGET_BASE
#define WC_STATE WARMUP_TARGET_STATE
#define WC_CONFIG WC_BASE "/native-config.json"
#define WC_ARM WC_BASE "/native-pool.arm"
#define WC_INTENT WC_STATE "/native-pool.intent"
#define WC_REPORT WC_STATE "/status.json"
#define WC_BUDGET_NS UINT64_C(1500000)
#define WC_ARM_WINDOW_NS UINT64_C(30000000000)

typedef void (*control_tick_fn)(void *,float,bool);
#ifndef WARMUP_JOINT_TICK
static control_tick_fn original_tick=(control_tick_fn)WARMUP_UE_ORIGINAL_TICK;
#endif
static struct wn_pool pool;
static struct warmup_native_ops operations;
static int (*backend_publication_seal)(void *,const struct warmup_native_snapshot_v1 *);
static void *backend_context;
static pthread_mutex_t mailbox_lock=PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t report_lock=PTHREAD_MUTEX_INITIALIZER;
static struct wc_config mailbox;
static struct wc_arm arm_mailbox;
struct report_copy {
 struct wn_pool_status pool;
 uint32_t humans,owned,unknown,teams[2],owned_teams[2],target;
 uint64_t captured_ns,config_revision;
 uint64_t census_captured_ns,census_valid_until_ns,admission_valid_until_ns;
 int admission_valid;
 char round_state[48];uint64_t round_world,round_captured_ns,round_cycles;int round_action;uint32_t configured_target;
};
static struct report_copy report;
static char round_state[48]="unavailable";
static uint64_t round_world,round_captured_ns,round_next_sample;
static struct rc_state round_cycle;
static enum rc_action round_action=RC_HOLD;
int warmup_control_round_draining(void){return round_action==RC_DRAIN&&pool.config.target==0;}
static uint32_t configured_target;
static _Atomic int armed,arm_consumed,arm_request,failed,tick_installed;
#ifdef WARMUP_JOINT_TICK
static _Atomic int joint_prepared,joint_worker_started;
#endif
static _Atomic unsigned long long callbacks,max_tick_ns,slow_ticks,thread_mismatches;
static _Atomic uint64_t sample_turns,pool_turns,pool_attempts,pool_budget_skips;
static _Atomic uint64_t sample_last_ns,sample_max_ns,pool_last_ns,pool_max_ns;
static _Atomic uint64_t outer_gt_epoch;
static atomic_flag tick_busy=ATOMIC_FLAG_INIT;
static _Atomic(const char *) control_stage="not_initialized";
static char nonce[33],config_error[96]="not_loaded";
static uint64_t start_ticks,applied_revision;
static pid_t process_id;
/* A single lock-free word prevents mixed old/new target, capacity and enable
 * values across the two display callbacks. Only successful GT config commits
 * publish it; the worker mailbox and fresh census never write this word. */
#define WC_DISPLAY_READY UINT32_C(0x01000000)
#define WC_DISPLAY_MASK UINT32_C(0x0101ffff)
_Static_assert(ATOMIC_INT_LOCK_FREE==2,"display configuration must be lock-free");
static _Atomic uint32_t committed_display_word;

static void commit_display_config(const struct wc_config *config){
 uint32_t word=0;
 if(config&&config->revision&&(config->enabled==0||config->enabled==1)&&
    wu_config_validate(&config->values)==WU_OK){
  word=WC_DISPLAY_READY|config->values.target|(config->values.capacity<<8)|((uint32_t)config->enabled<<16);
 }
 atomic_store_explicit(&committed_display_word,word,memory_order_release);
}

static uint64_t clock_ns(void){
 struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;
 return (uint64_t)t.tv_sec*UINT64_C(1000000000)+(uint64_t)t.tv_nsec;
}
static void record_elapsed(_Atomic uint64_t *last,_Atomic uint64_t *maximum,uint64_t start){
 uint64_t end=clock_ns(),elapsed=end>=start?end-start:UINT64_MAX;
 atomic_store(last,elapsed);uint64_t previous=atomic_load(maximum);
 while(elapsed>previous&&!atomic_compare_exchange_weak(maximum,&previous,elapsed)){}
}
int warmup_control_is_armed(void){return atomic_load_explicit(&armed,memory_order_acquire);}
int warmup_control_failed(void){return atomic_load_explicit(&failed,memory_order_acquire)!=0;}
uint64_t warmup_control_outer_epoch(void){return atomic_load_explicit(&outer_gt_epoch,memory_order_acquire);}
int warmup_control_display_config(struct warmup_display_config *out){
 if(!out||warmup_control_failed()||!warmup_control_is_armed())return 0;
 uint32_t word=atomic_load_explicit(&committed_display_word,memory_order_acquire);
 if(!(word&WC_DISPLAY_READY)||(word&~WC_DISPLAY_MASK))return 0;
 struct warmup_display_config value={word&255U,(word>>8)&255U,(int)((word>>16)&1U)};
 if(!value.capacity||value.capacity>WU_MAX_CAPACITY||value.target>WU_MAX_TARGET||
    value.target>=value.capacity||warmup_control_failed())return 0;
 *out=value;return 1;
}
static void invalidate_terminal_on_gt(void){
 /* Worker failure is published atomically. The publisher's failed gate blocks
  * reads/replacement immediately; only the real GT may invalidate this store. */
 if(warmup_control_failed()&&(long)syscall(SYS_gettid)==(long)process_id)
  (void)warmup_native_snapshot_invalidate(pool.world_epoch,WARMUP_SNAPSHOT_DRIFT);
}
static void control_fail(const char *why){
 if(!atomic_exchange_explicit(&failed,1,memory_order_acq_rel))
  atomic_store_explicit(&control_stage,why,memory_order_release);
 invalidate_terminal_on_gt();
}
static int control_publication_seal(void *context,const struct warmup_native_snapshot_v1 *snapshot){
 if(warmup_control_failed()){invalidate_terminal_on_gt();return 0;}
 return backend_publication_seal(context,snapshot);
}
static int write_all(int fd,const void *data,size_t length){
 const unsigned char *p=data;
 while(length){ssize_t n=write(fd,p,length);if(n<0&&errno==EINTR)continue;if(n<=0)return 0;p+=n;length-=(size_t)n;}
 return 1;
}
/* 0 absent, -1 rejected, 1 complete root-owned immutable read. */
static int read_root_file(const char *path,char *out,size_t capacity,size_t *length){
 int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 if(fd<0)return errno==ENOENT?0:-1;
 struct stat before,after;int okay=!fstat(fd,&before)&&S_ISREG(before.st_mode)&&before.st_uid==0&&
  before.st_nlink==1&&!(before.st_mode&0022)&&before.st_size>0&&(uint64_t)before.st_size<capacity;
 ssize_t n=okay?pread(fd,out,(size_t)before.st_size,0):-1;
 okay=okay&&n==before.st_size&&!fstat(fd,&after)&&before.st_dev==after.st_dev&&before.st_ino==after.st_ino&&
  before.st_size==after.st_size&&before.st_mtim.tv_sec==after.st_mtim.tv_sec&&before.st_mtim.tv_nsec==after.st_mtim.tv_nsec;
 close(fd);if(!okay)return -1;out[n]=0;*length=(size_t)n;return 1;
}
static int read_process_start(uint64_t *out){
 FILE *f=fopen("/proc/self/stat","r");if(!f)return 0;
 char b[4096];int okay=fgets(b,sizeof b,f)!=NULL;fclose(f);if(!okay)return 0;
 char *p=strrchr(b,')');if(!p||p[1]!=' ')return 0;p+=2;
 for(int field=3;field<22;field++){p=strchr(p,' ');if(!p)return 0;p++;}
 errno=0;char *end;unsigned long long value=strtoull(p,&end,10);
 if(errno||end==p||!value||(*end!=' '&&*end!='\n'))return 0;
 *out=value;return 1;
}
#include "identity_recovery_control.inc"
#ifdef WARMUP_ROUND_TEST
/* Only the isolated QA build accepts a bounded synthetic settlement event.
 * Shipping builds omit this code. It never changes the engine MatchState. */
static pthread_mutex_t round_test_lock=PTHREAD_MUTEX_INITIALIZER;
static uint64_t test_world,test_until;
static void load_round_test(void){
 char b[160],extra;size_t n=0;unsigned long long world=0,until=0,ticks=0;long pid=0;
 if(read_root_file(WC_BASE "/test-settlement",b,sizeof b,&n)!=1||
    sscanf(b,"%ld %llu %llu %llu %c",&pid,&ticks,&world,&until,&extra)!=4||
    pid!=(long)process_id||ticks!=start_ticks||until<=clock_ns()||until-clock_ns()>UINT64_C(30000000000)){world=0;until=0;}
 pthread_mutex_lock(&round_test_lock);test_world=world;test_until=until;pthread_mutex_unlock(&round_test_lock);
}
static void apply_round_test(struct rc_input *in){
 if(pthread_mutex_trylock(&round_test_lock))return;
 if(test_world==in->world&&test_until>in->now_ns&&pool.census.human_count==0)in->phase=RC_SETTLEMENT;
 pthread_mutex_unlock(&round_test_lock);
}
#endif
static void load_config(void){
 char body[512];size_t bytes=0;struct wc_config next;
 int read=read_root_file(WC_CONFIG,body,sizeof body,&bytes);
 if(read!=1||!wc_parse_config(body,bytes,&next)){snprintf(config_error,sizeof config_error,"%s",read==0?"config_absent":"config_owner_or_schema_rejected");return;}
 pthread_mutex_lock(&mailbox_lock);
 if(next.revision>mailbox.revision){
  warmup_queue_guard_config(next.enabled && next.values.target ? next.revision : 0);
  mailbox=next;strcpy(config_error,"accepted");}
 else if(next.revision==mailbox.revision){
  if(next.enabled!=mailbox.enabled||memcmp(&next.values,&mailbox.values,sizeof next.values))strcpy(config_error,"same_revision_content_changed_rejected");
  else strcpy(config_error,"accepted");
 }else strcpy(config_error,"stale_revision_rejected");
 pthread_mutex_unlock(&mailbox_lock);
}
static void consume_arm(void){
 if(atomic_load(&arm_consumed)||atomic_load(&failed))return;
 char body[512];size_t bytes=0;int read=read_root_file(WC_ARM,body,sizeof body,&bytes);
 if(read==0)return;
 atomic_store(&arm_consumed,1);
 struct wc_arm candidate;uint64_t now=clock_ns();
 if(read!=1||!wc_parse_arm(body,bytes,&candidate)||candidate.pid!=(long)process_id||
    candidate.start_ticks!=start_ticks||strcmp(candidate.nonce,nonce)||!now||
    candidate.expires_ns<=now||candidate.expires_ns-now>WC_ARM_WINDOW_NS){
  control_fail("arm_binding_rejected_no_retry");return;
 }
 pthread_mutex_lock(&mailbox_lock);
 int match=mailbox.revision==candidate.config_revision;
 if(match)arm_mailbox=candidate;
 pthread_mutex_unlock(&mailbox_lock);
 if(!match){control_fail("arm_config_revision_rejected_no_retry");return;}
 int fd=open(WC_INTENT,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);
 if(fd<0){control_fail("existing_or_unwritable_intent_no_retry");return;}
 int okay=write_all(fd,body,bytes)&&!fsync(fd);close(fd);
 if(!okay){control_fail("intent_write_failed_no_retry");return;}
 atomic_store_explicit(&arm_request,1,memory_order_release);
 atomic_store(&control_stage,"arm_accepted_waiting_gt");
}
static void publish_report(uint64_t now){
 if(pthread_mutex_trylock(&report_lock))return;
 wn_pool_get_status(&pool,&report.pool);
 report.humans=pool.census.human_count;report.owned=pool.census.owned_count;report.unknown=pool.census.unknown;
 for(int i=0;i<2;i++){report.teams[i]=pool.census.team_total[i];report.owned_teams[i]=pool.census.owned_team[i];}
 report.target=pool.config.target;report.config_revision=applied_revision;report.captured_ns=now;
 report.census_captured_ns=pool.census.captured_ns;report.census_valid_until_ns=pool.census.valid_until_ns;
 report.admission_valid_until_ns=pool.admission.valid_until_ns;report.admission_valid=pool.admission.valid;
 memcpy(report.round_state,round_state,sizeof round_state);report.round_world=round_world;report.round_captured_ns=round_captured_ns;report.round_action=round_action;report.round_cycles=round_cycle.completed_cycles;report.configured_target=configured_target;
 pthread_mutex_unlock(&report_lock);
}
#ifdef WARMUP_JOINT_TICK
int warmup_control_tick_enter(void){
 const int reentered=atomic_flag_test_and_set_explicit(&tick_busy,memory_order_acquire);
 if(reentered)control_fail("tick_reentry_terminal");
 return reentered;
}
void warmup_control_after_tick(void *engine,float dt,bool idle,int reentered){
 (void)dt;(void)idle;atomic_fetch_add(&callbacks,1);
#else
static void control_tick(void *engine,float dt,bool idle){
 const int reentered=atomic_flag_test_and_set_explicit(&tick_busy,memory_order_acquire);
 if(reentered)control_fail("tick_reentry_terminal");
 original_tick(engine,dt,idle);atomic_fetch_add(&callbacks,1);
#endif
 if(reentered){invalidate_terminal_on_gt();return;}
 if((long)syscall(SYS_gettid)!=(long)process_id){atomic_fetch_add(&thread_mismatches,1);goto done;}
 if(warmup_control_failed()){warmup_queue_guard_sync(0);goto done;}
 if(!engine||(uintptr_t)engine!=__atomic_load_n((uintptr_t *)WARMUP_UE_ENGINE_GLOBAL,__ATOMIC_RELAXED)||
    __atomic_load_n((uintptr_t *)engine,__ATOMIC_RELAXED)!=WARMUP_UE_ENGINE_VPTR)goto done;
 uint64_t epoch=atomic_load_explicit(&outer_gt_epoch,memory_order_relaxed);
 if(epoch==UINT64_MAX){control_fail("outer_gt_epoch_exhausted");goto done;}
 atomic_store_explicit(&outer_gt_epoch,epoch+1,memory_order_release);
 uint64_t start=clock_ns();if(!start||start>UINT64_MAX-WC_BUDGET_NS){control_fail("tick_clock_or_deadline_failed");goto done;}
 if(!warmup_ue_backend_gt_enter()){control_fail("backend_gt_entry_failed");goto done;}
 uint64_t deadline=start+WC_BUDGET_NS;
 if(start>=round_next_sample){
  char state[48]={0};uint64_t world=0;round_next_sample=start+UINT64_C(250000000);
  if(warmup_ue_round_state(state,sizeof state,&world)){memcpy(round_state,state,sizeof state);round_world=world;round_captured_ns=clock_ns();}
  else {strcpy(round_state,"unavailable");round_captured_ns=0;}
 }

 /* Metadata helpers have indivisible reads: a nominal 500us sub-deadline
  * cannot reserve the remaining pool budget. Alternate GT turns after arm,
  * retaining the original 1.5ms deadline and every pool/World guard. */
 enum wc_gt_read_turn read_turn=wc_gt_read_turn(warmup_control_is_armed(),epoch+1);
 /* Settlement gets pool service on 15/16 GT turns. Discovery still advances;
    each native callback retains live metadata/world verification. */
 if(warmup_control_is_armed()&&((epoch+1)%16))read_turn=WC_GT_POOL;
 if(read_turn==WC_GT_DISCOVERY){
  atomic_fetch_add(&sample_turns,1);uint64_t sample_start=clock_ns();
  warmup_ue_backend_sample(deadline);record_elapsed(&sample_last_ns,&sample_max_ns,sample_start);
 }else atomic_fetch_add(&pool_turns,1);
 if(warmup_control_failed())goto measured;
 struct wc_config next={0};struct wc_arm arm={0};
 if(!pthread_mutex_trylock(&mailbox_lock)){next=mailbox;arm=arm_mailbox;pthread_mutex_unlock(&mailbox_lock);}
 if(!warmup_control_is_armed()&&atomic_load_explicit(&arm_request,memory_order_acquire)&&next.revision){
  uint64_t now=clock_ns();
  if(next.revision!=arm.config_revision||!now||now>=arm.expires_ns){control_fail("arm_expired_or_config_changed_before_gt");goto measured;}
  struct wu_config cfg=next.values;cfg.target=0;
  if(wn_pool_set_config(&pool,&cfg)!=WN_OK){control_fail("initial_config_failed");goto measured;}
  applied_revision=next.revision;atomic_store_explicit(&armed,1,memory_order_release);
  commit_display_config(&next);
  atomic_store(&control_stage,"active");
 }
 if(warmup_control_is_armed()&&next.revision>applied_revision){
  struct wu_config cfg=next.values;cfg.target=0;
  if(wn_pool_set_config(&pool,&cfg)!=WN_OK){control_fail("config_apply_failed");goto measured;}
  applied_revision=next.revision;
  commit_display_config(&next);
 }
 if(warmup_control_is_armed()&&!warmup_control_failed()&&next.revision){
  uint64_t now=clock_ns();
  uint64_t pool_world=((uint64_t)(uint32_t)pool.bindings.world.serial<<32)|(uint32_t)pool.bindings.world.index;
  int evidence=pool_world==round_world&&pool.census.captured_ns&&now<pool.census.valid_until_ns&&pool.census.unknown==0;
  int clear=evidence&&pool.census.owned_count==0&&pool.action==WU_NOOP;
  for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(pool.owned[i].state!=WN_FREE)clear=0;
  struct rc_input in={now,round_world,round_captured_ns&&now>=round_captured_ns&&now-round_captured_ns<UINT64_C(1000000000)?rc_classify(round_state):RC_UNKNOWN,evidence,clear};
  #ifdef WARMUP_ROUND_TEST
  apply_round_test(&in);
#endif
  round_action=rc_step(&round_cycle,&in);configured_target=next.enabled?next.values.target:0;
  pool.round_draining=round_action==RC_DRAIN;
  struct wu_config cfg=next.values;cfg.target=round_action==RC_RUN?configured_target:0;
  if(pool.config.target!=cfg.target&&wn_pool_set_config(&pool,&cfg)!=WN_OK){control_fail("round_config_apply_failed");goto measured;}
 }
 if(ir_gt(&next))goto measured;
 if(warmup_control_is_armed()&&!warmup_control_failed()&&round_action!=RC_HOLD&&round_action!=RC_FAULT&&read_turn==WC_GT_POOL){
  uint64_t now=clock_ns();
  if(now&&now<deadline){
   atomic_fetch_add(&pool_attempts,1);
   if(pool.round_draining)wn_pool_drain_tick(&pool,deadline-now);else wn_pool_burst_tick(&pool,deadline-now);
   record_elapsed(&pool_last_ns,&pool_max_ns,now);
  }else atomic_fetch_add(&pool_budget_skips,1);
  if(pool.failed)control_fail("pool_halted_inspection_required");
 }
measured:;
 warmup_queue_guard_sync(round_action==RC_RUN && warmup_control_is_armed() && pool.config.target ? applied_revision : 0);
 uint64_t finish=clock_ns(),elapsed=finish>=start?finish-start:UINT64_MAX;
 unsigned long long old=atomic_load(&max_tick_ns);
 while(elapsed>old&&!atomic_compare_exchange_weak(&max_tick_ns,&old,elapsed)){}
 if(elapsed>WC_BUDGET_NS)atomic_fetch_add(&slow_ticks,1);
 publish_report(finish);
done:
 invalidate_terminal_on_gt();
 atomic_flag_clear_explicit(&tick_busy,memory_order_release);
}
static void write_report(void){
 struct report_copy copy;pthread_mutex_lock(&report_lock);copy=report;pthread_mutex_unlock(&report_lock);
 struct wp_telemetry pub;warmup_publish_telemetry_read(&pub);
 struct qd_telemetry display;warmup_queue_display_telemetry_read(&display);
 struct warmup_ue_telemetry ue;warmup_ue_backend_telemetry(&ue);
 struct warmup_queue_guard_telemetry queue;warmup_queue_guard_telemetry(&queue);
 char body[8192],tmp[256];
 int n=snprintf(body,sizeof body,
  "{\"schema\":1,\"identity_recovery_api\":1,\"mode\":\"integrated_isolated_candidate\",\"pid\":%ld,\"start_ticks\":%" PRIu64 ",\"nonce\":\"%s\",\"now_ns\":%" PRIu64 ","
  "\"stage\":\"%s\",\"config_state\":\"%s\",\"backend_state\":\"%s\",\"armed\":%d,\"arm_consumed\":%d,\"failed\":%d,\"tick_installed\":%d,"
  "\"config_revision\":%" PRIu64 ",\"target\":%u,\"human\":%u,\"owned\":%u,\"unknown\":%u,\"teams\":[%u,%u],\"owned_teams\":[%u,%u],"
  "\"round_action\":%d,\"round_cycles\":%" PRIu64 ",\"configured_target\":%u,"
  "\"round_state\":\"%s\",\"round_world\":%" PRIu64 ",\"round_captured_ns\":%" PRIu64 ","
  "\"gt_captured_ns\":%" PRIu64 ",\"census_captured_ns\":%" PRIu64 ",\"census_valid_until_ns\":%" PRIu64 ",\"admission_valid_until_ns\":%" PRIu64 ",\"admission_valid\":%d,"
  "\"active_owned\":%u,\"name_reservations\":%u,\"inflight_slots\":%u,\"waiting_world_change\":%d,\"publisher_last_call_ns\":%" PRIu64 ","
  "\"world_epoch\":%" PRIu64 ",\"snapshot_revision\":%" PRIu64 ",\"pool_phase\":%d,\"pool_step\":%d,\"pool_stage\":\"%s\",\"party_safety_verified\":%d,"
  "\"operation_id\":%" PRIu64 ",\"operation_deadline_ns\":%" PRIu64 ",\"last_step_stage\":\"%s\",\"last_step_issued\":%u,\"last_step_returned\":%u,"
  "\"callbacks\":%llu,\"outer_gt_epoch\":%" PRIu64 ",\"max_tick_ns\":%llu,\"soft_budget_exceeded_ticks\":%llu,\"thread_mismatches\":%llu,"
  "\"sample_turns\":%" PRIu64 ",\"pool_turns\":%" PRIu64 ",\"pool_attempts\":%" PRIu64 ",\"pool_budget_skips\":%" PRIu64 ","
  "\"sample_last_ns\":%" PRIu64 ",\"sample_max_ns\":%" PRIu64 ",\"pool_last_ns\":%" PRIu64 ",\"pool_max_ns\":%" PRIu64 ","
  "\"pool_probe_calls\":%" PRIu64 ",\"pool_probe_last_ns\":%" PRIu64 ",\"pool_probe_max_ns\":%" PRIu64 ",\"pool_probe_result\":%" PRId32 ","
  "\"census_calls\":%" PRIu64 ",\"census_last_ns\":%" PRIu64 ",\"census_checkpoint\":%" PRIu32 ",\"census_result\":%" PRId32 ",\"common_abi_gate\":%" PRIu32 ","
  "\"engine_calls\":%" PRIu64 ",\"process_event_calls\":%" PRIu64 ",\"allocator_calls\":%" PRIu64 ",\"metadata_classes\":%u,\"metadata_functions\":%u,"
  "\"metadata_cursor\":%" PRId32 ",\"metadata_object_count\":%" PRId32 ",\"metadata_completed_scans\":%" PRIu64 ","
  "\"census_failed_slot\":%" PRId32 ",\"read_error_errno\":%" PRId32 ",\"read_error_address\":%" PRIu64 ",\"read_error_size\":%" PRIu64 ",\"read_error_result\":%" PRId64 ","
  "\"refresh_cadence_seconds\":%d,\"publisher_calls\":%" PRIu64 ",\"publisher_replaced\":%" PRIu64 ",\"publisher_raw\":%" PRId64 ",\"publisher_effective\":%" PRId64 ",\"publisher_reason\":\"%s\","
  "\"publisher_helper_calls\":%" PRIu64 ",\"publisher_helper_returns\":%" PRIu64 ",\"publisher_snapshot_revision\":%" PRIu64 ",\"publisher_world_epoch\":%" PRIu64 ","
  "\"queue_display_mode\":%d,\"queue_display_installed\":%d,\"queue_display_calls\":%" PRIu64 ",\"queue_display_eligible\":%" PRIu64 ",\"queue_display_replaced\":%" PRIu64 ","
  "\"queue_display_original_calls\":%" PRIu64 ",\"queue_display_original_returns\":%" PRIu64 ",\"queue_display_concurrent\":%" PRIu64 ","
  "\"queue_display_raw\":%" PRId64 ",\"queue_display_candidate\":%" PRId64 ",\"queue_display_returned\":%" PRId64 ",\"queue_display_reason\":%d,"
  "\"queue_display_snapshot_revision\":%" PRIu64 ",\"queue_display_world_epoch\":%" PRIu64 ",\"queue_display_last_call_ns\":%" PRIu64 ",\"queue_display_sample_sequence\":%" PRIu64 ",\"queue_display_coherent\":%d,"
  "\"queue_guard_installed\":%u,\"queue_unknown\":%u,\"queue_public_parties\":%u,\"queue_reserved_parties\":%u,\"queue_native_joining\":%u,\"queue_team_deficit\":[%u,%u],"
  "\"queue_wrapper_calls\":%" PRIu64 ",\"queue_original_calls\":%" PRIu64 ",\"queue_allowed\":%" PRIu64 ",\"queue_denied\":%" PRIu64 ","
  "\"queue_unarmed_passthrough\":%" PRIu64 ",\"queue_reentry_denied\":%" PRIu64 ",\"queue_thread_denied\":%" PRIu64 ",\"queue_request_generation\":%" PRIu64 ","
  "\"client_visible_accepted\":false,\"production_release\":false}\n",
  (long)process_id,start_ticks,nonce,clock_ns(),atomic_load(&control_stage),config_error,warmup_ue_backend_error(),atomic_load(&armed),atomic_load(&arm_consumed),atomic_load(&failed),atomic_load(&tick_installed),
  copy.config_revision,copy.target,copy.humans,copy.owned,copy.unknown,copy.teams[0],copy.teams[1],copy.owned_teams[0],copy.owned_teams[1],
  copy.round_action,copy.round_cycles,copy.configured_target,copy.round_state,copy.round_world,copy.round_captured_ns,copy.captured_ns,copy.census_captured_ns,copy.census_valid_until_ns,copy.admission_valid_until_ns,copy.admission_valid,
  copy.pool.active_owned,copy.pool.name_reservations,copy.pool.inflight_slots,copy.pool.waiting_world_change,pub.last_call_ns,
  copy.pool.world_epoch,copy.pool.snapshot_revision,(int)copy.pool.phase,(int)copy.pool.step,copy.pool.stage,copy.pool.party_safety_verified,
  copy.pool.operation_id,copy.pool.operation_deadline_ns,copy.pool.last_receipt.stage,copy.pool.last_receipt.issued,copy.pool.last_receipt.returned,
  atomic_load(&callbacks),warmup_control_outer_epoch(),atomic_load(&max_tick_ns),atomic_load(&slow_ticks),atomic_load(&thread_mismatches),
  atomic_load(&sample_turns),atomic_load(&pool_turns),atomic_load(&pool_attempts),atomic_load(&pool_budget_skips),
  atomic_load(&sample_last_ns),atomic_load(&sample_max_ns),atomic_load(&pool_last_ns),atomic_load(&pool_max_ns),
  ue.probe_calls,ue.probe_last_ns,ue.probe_max_ns,ue.probe_result,
  ue.census_calls,ue.census_last_ns,ue.census_checkpoint,ue.census_result,ue.common_abi_gate,
  ue.engine_calls,ue.process_event_calls,ue.allocator_calls,ue.metadata_classes,ue.metadata_functions,
  ue.metadata_cursor,ue.object_count,ue.completed_scans,
  ue.census_failed_slot,ue.read_error_errno,ue.read_error_address,ue.read_error_size,ue.read_error_result,
  warmup_refresh_cadence_seconds(),pub.natural_calls,pub.replaced_calls,pub.raw_count,pub.effective_count,warmup_publish_reason((enum wp_reason)pub.reason),pub.helper_calls,pub.helper_returns,pub.confirmed_revision,pub.world_epoch,
  display.mode,pub.queue_display_patched,display.calls,display.eligible,display.replacements,
  display.original_calls,display.original_returns,display.concurrent,
  display.raw,display.candidate,display.returned,display.reason,
  display.revision,display.epoch,display.last_call_ns,display.sample_sequence,display.coherent,
  queue.installed,queue.unknown,queue.public_parties,queue.reserved_parties,queue.native_joining,queue.team_deficit[0],queue.team_deficit[1],
  queue.wrapper_calls,queue.original_calls,queue.allowed,queue.denied,queue.unarmed_passthrough,queue.reentry_denied,queue.thread_denied,queue.request_generation);
 if(n<=0||(size_t)n>=sizeof body)return;
 snprintf(tmp,sizeof tmp,WC_STATE "/.status.%ld.tmp",(long)process_id);
 int fd=open(tmp,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);if(fd<0)return;
 int okay=write_all(fd,body,(size_t)n)&&!fsync(fd);close(fd);
 if(okay){if(rename(tmp,WC_REPORT))unlink(tmp);}else unlink(tmp);
}
static void *control_worker(void *unused){
 (void)unused;
 for(;;){
#ifdef WARMUP_ROUND_TEST
 load_round_test();
#endif
 load_config();consume_arm();ir_worker();write_report();struct timespec delay={0,250000000};while(nanosleep(&delay,&delay)&&errno==EINTR){}}
 return NULL;
}
static void fatal_control(const char *why){control_fail(why);fprintf(stderr,"warmup integrated control: %s\n",why);_exit(125);}
__attribute__((constructor(201))) static void control_install(void){
 if(!warmup_bootstrap_ready())return;
 process_id=getpid();if(!read_process_start(&start_ticks))fatal_control("start_ticks_failed");
 unsigned char random[24];size_t done=0;
 while(done<sizeof random){ssize_t n=getrandom(random+done,sizeof random-done,0);if(n<0&&errno==EINTR)continue;if(n<=0)fatal_control("random_failed");done+=(size_t)n;}
 static const char hex[]="0123456789abcdef";
 for(size_t i=0;i<16;i++){nonce[2*i]=hex[random[i]>>4];nonce[2*i+1]=hex[random[i]&15];}
 uint64_t seed;memcpy(&seed,random+16,sizeof seed);
 char error[128]={0};
 if(!warmup_ue_backend_init(&operations,&backend_context,error,sizeof error))fatal_control(error[0]?error:"backend_init_failed");
 backend_publication_seal=operations.publication_seal;
 if(!backend_publication_seal)fatal_control("backend_seal_missing");
 operations.publication_seal=control_publication_seal;
 const struct wu_config initial={0,100,1,2};
 if(wn_pool_init(&pool,&initial,&operations,backend_context,seed)!=WN_OK)fatal_control("pool_init_failed");
#ifdef WARMUP_JOINT_TICK
 atomic_store_explicit(&joint_prepared,1,memory_order_release);
 atomic_store(&control_stage,"joint_prepared_waiting_tick_owner");
#else
 long page_size=sysconf(_SC_PAGESIZE);if(page_size<=0||((unsigned long)page_size&((unsigned long)page_size-1)))fatal_control("invalid_page_size");
 uintptr_t page=WARMUP_UE_TICK_CELL&~((uintptr_t)page_size-1);
 if(mprotect((void *)page,(size_t)page_size,PROT_READ|PROT_WRITE))fatal_control("tick_page_rw_failed");
 uintptr_t expected=WARMUP_UE_ORIGINAL_TICK;
 bool changed=__atomic_compare_exchange_n((uintptr_t *)WARMUP_UE_TICK_CELL,&expected,(uintptr_t)control_tick,false,__ATOMIC_RELEASE,__ATOMIC_RELAXED);
 if(mprotect((void *)page,(size_t)page_size,PROT_READ)||!changed)fatal_control("tick_patch_or_readonly_restore_failed");
 atomic_store(&tick_installed,1);atomic_store(&control_stage,"unarmed_metadata_observe");
 pthread_t thread;if(pthread_create(&thread,NULL,control_worker,NULL))fatal_control("worker_start_failed");
 if(pthread_detach(thread))fatal_control("worker_detach_failed");
#endif
}
#ifdef WARMUP_JOINT_TICK
int warmup_control_joint_prepared(void){return warmup_bootstrap_ready()&&atomic_load_explicit(&joint_prepared,memory_order_acquire)&&!warmup_control_failed();}
void warmup_control_joint_tick_installed(void){
 if(!warmup_control_joint_prepared())fatal_control("joint_prepare_missing");
 atomic_store(&tick_installed,1);atomic_store(&control_stage,"unarmed_metadata_observe");
}
int warmup_control_joint_start_worker(void){
 if(!warmup_control_joint_prepared()||!atomic_load(&tick_installed)||atomic_exchange(&joint_worker_started,1))return 0;
 pthread_t thread;if(pthread_create(&thread,NULL,control_worker,NULL))return 0;
 return pthread_detach(thread)==0;
}
#endif
