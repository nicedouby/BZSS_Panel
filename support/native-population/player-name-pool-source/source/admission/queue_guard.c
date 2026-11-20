#define _GNU_SOURCE
#include "queue_guard.h"
#include "queue_gate_preimage.generated.h"
#include "../native/warmup_control.h"
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <dirent.h>
#include <fcntl.h>
#include <time.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>

#define QG_GATE UINT64_C(0xa54b530)
#define QG_CELL UINT64_C(0x2376df0)
#define QG_HOST_VPTR UINT64_C(0x23765e8)
#define QG_TABLE UINT64_C(0xd57bcb8)
#define QG_WORLD UINT64_C(0xd7052c0)
#define QG_MAX_QUEUE 128U
#define QG_CHUNK_ELEMENTS UINT32_C(65536)
#define QG_MAX_CHUNKS 64
#define QG_MAX_AGE_NS UINT64_C(5000000)
#define QG_PLAN_LEASE_NS UINT64_C(500000000)
typedef bool (*qg_gate_fn)(void *,const void *,int32_t);
_Static_assert(sizeof(qg_gate_fn)==8,"x86-64 function-pointer ABI");
struct qg_header { uint64_t data;int32_t count,capacity; };
struct qg_object { uint64_t vptr;uint32_t flags;int32_t index;uint64_t cls;uint32_t ni,nn;uint64_t outer; };
struct qg_slot { uint64_t flags,object;int32_t serial,other; };
struct qg_table { uint64_t chunks,pre;int32_t max,count,maxchunks,nchunks; };
struct qg_party { struct qg_header members;struct warmup_native_weak_v1 beacon;int32_t team,size;uint64_t address; };
struct qg_state { struct qg_header joining,public,reserved;struct qg_party parties[QG_MAX_QUEUE*2];uint32_t count; };
struct qg_request { int valid;int32_t team;struct warmup_native_weak_v1 beacon; };
static struct qg_request requests[2];
static uint64_t request_world,last_allowed_world,last_allowed_outer;
static _Atomic int install_attempted,installed,entered,ever_armed;
static int memory_fd=-1;
static _Atomic uint64_t wanted_revision, attached_revision;
static uint64_t drift_revision;
/* Main-thread state. A native refusal buys one owned departure per retry. */
static uint64_t join_hold_until;
static int yield_pending;
static uint64_t native_request_until;
void warmup_queue_owned_departed(void){yield_pending=0;}
static uintptr_t gate_page, gate_size;
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
static uint64_t fixture_cell = QG_GATE;
#endif

/* The mailbox worker can revoke interception even if gameplay cleanup halted. */
void warmup_queue_guard_config(uint64_t enabled_revision){
 atomic_store(&wanted_revision,enabled_revision);
}
static _Atomic uint64_t calls,original_calls,allowed,denied,pass_unarmed,reentries,thread_errors,generation;
static _Atomic uint32_t unknown=1,pub_count,res_count,joining_count,deficit_one,deficit_two;
static bool qg_wrapper(void *,const void *,int32_t);
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
/* Compile-time standalone dependency mocks only; no runtime switch exists. */
extern int qg_fixture_read(uint64_t,void *,size_t);
extern int qg_fixture_code_ready(void);
extern bool qg_fixture_original(void *,const void *,int32_t);
#endif
static uint64_t clock_ns(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*UINT64_C(1000000000)+(uint64_t)t.tv_nsec;}
static int main_thread(void){return (pid_t)syscall(SYS_gettid)==getpid();}
static int rd(uint64_t at,void *out,size_t n){
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
 return qg_fixture_read(at,out,n);
#else
 return memory_fd>=0&&at>=UINT64_C(0x10000)&&at<UINT64_C(0x800000000000)&&n&&n<=4096&&at+n<UINT64_C(0x800000000000)&&pread(memory_fd,out,n,(off_t)at)==(ssize_t)n;
#endif
}
static int weak_equal(struct warmup_native_weak_v1 a,struct warmup_native_weak_v1 b){return a.address==b.address&&a.index==b.index&&a.serial==b.serial;}
static int slot(const struct qg_table *t,int32_t i,struct qg_slot *out){
 uint64_t p;
 if(i<0||i>=t->count||(uint32_t)i/QG_CHUNK_ELEMENTS>=(uint32_t)t->nchunks||!rd(t->chunks+8UL*((uint32_t)i/QG_CHUNK_ELEMENTS),&p,8)||p<0x10000||p>=UINT64_C(0x800000000000)||(p&7))return 0;
 return rd(p+24UL*((uint32_t)i%QG_CHUNK_ELEMENTS),out,sizeof *out);
}
static int table_read(struct qg_table *t){
 if(!rd(QG_TABLE,t,sizeof *t)||t->chunks<0x10000||t->chunks>=UINT64_C(0x800000000000)||(t->chunks&7)||t->maxchunks<1||t->maxchunks>QG_MAX_CHUNKS||t->nchunks<1||t->nchunks>t->maxchunks||t->max<1||t->count<1||t->count>t->max)return 0;
 /* MaxElements is RESERVED chunk capacity; NumChunks is the currently
  * allocated prefix. They need not describe the same number of chunks. */
 const uint64_t reserved=(uint64_t)(uint32_t)t->maxchunks*QG_CHUNK_ELEMENTS;
 const uint64_t allocated=(uint64_t)(uint32_t)t->nchunks*QG_CHUNK_ELEMENTS;
 const uint64_t prior=(uint64_t)(uint32_t)(t->nchunks-1)*QG_CHUNK_ELEMENTS;
 return (uint64_t)(uint32_t)t->max<=reserved&&(uint64_t)(uint32_t)t->count>prior&&(uint64_t)(uint32_t)t->count<=allocated;
}
static int weak_live(const struct qg_table *t,struct warmup_native_weak_v1 w,struct qg_object *out){
 struct qg_slot a,b;struct qg_object h,again;
 if(w.serial<=0||!slot(t,w.index,&a)||a.object!=w.address||a.serial!=w.serial||(a.flags&UINT64_C(0x1020000000000000))||!rd(w.address,&h,sizeof h)||h.index!=w.index||(h.flags&0x18010U)||!rd(w.address,&again,sizeof again)||memcmp(&h,&again,sizeof h)||!slot(t,w.index,&b)||a.object!=b.object||a.serial!=b.serial||(b.flags&UINT64_C(0x1020000000000000)))return 0;
 if(out)*out=h;
 return 1;
}
static int observe(const struct qg_table *t,uint64_t at,struct warmup_native_weak_v1 *out){struct qg_object h;struct qg_slot s;if(!rd(at,&h,sizeof h)||!slot(t,h.index,&s)||s.object!=at||s.serial<=0)return 0;struct warmup_native_weak_v1 w={at,h.index,s.serial};if(!weak_live(t,w,NULL))return 0;*out=w;return 1;}
static int header(uint64_t owner,uint64_t off,struct qg_header *h){return rd(owner+off,h,sizeof *h)&&h->count>=0&&h->count<=65536&&h->capacity>=h->count&&h->capacity<=65536&&(!h->count||(h->data>=0x10000&&!(h->data&7)));}
static int view_ok(const struct warmup_ue_queue_view *v,uint64_t now,struct qg_table *t){
 if(v->abi_version!=WARMUP_QUEUE_VIEW_ABI||v->struct_size!=sizeof *v||!v->world_epoch||!v->outer_gt_epoch||v->outer_gt_epoch!=warmup_control_outer_epoch()||!v->captured_ns||now<v->captured_ns||now-v->captured_ns>QG_MAX_AGE_NS||v->capacity<1||v->capacity>100||v->actual_gs_count>200||v->team_total[0]>200||v->team_total[1]>200||v->team_total[0]+v->team_total[1]>v->actual_gs_count||v->removable_owned_team[0]+v->removable_owned_team[1]>99||v->removable_owned_team[0]>99||v->removable_owned_team[1]>99||v->removable_owned_team[0]>v->team_total[0]||v->removable_owned_team[1]>v->team_total[1]||!v->native_team_allowance_known||v->native_team_allowance<0||!table_read(t))return 0;
 struct qg_object host;uint64_t world;
 if(!weak_live(t,v->bindings.world,NULL)||!weak_live(t,v->bindings.game_state,NULL)||!weak_live(t,v->bindings.game_mode,NULL)||!weak_live(t,v->bindings.game_session,NULL)||!weak_live(t,v->host,&host)||host.vptr!=QG_HOST_VPTR||!rd(QG_WORLD,&world,8)||world!=v->bindings.world.address)return 0;
 return 1;
}
static int queues_read(const struct warmup_ue_queue_view *v,const struct qg_table *t,struct qg_state *q){
 memset(q,0,sizeof *q);
 if(!header(v->host.address,0x2e0,&q->joining)||q->joining.count>4096||!header(v->host.address,0x2f0,&q->public)||!header(v->host.address,0x300,&q->reserved)||q->public.count>(int32_t)QG_MAX_QUEUE||q->reserved.count>(int32_t)QG_MAX_QUEUE)return 0;
 struct qg_header arrays[2]={q->public,q->reserved};
 for(int a=0;a<2;a++)for(int32_t i=0;i<arrays[a].count;i++){
  struct qg_party *p=&q->parties[q->count++];uint64_t beacon;int32_t cap;struct qg_header members;
  p->address=arrays[a].data+160UL*(uint32_t)i;
  if(!rd(p->address+0x10,&p->team,4)||!rd(p->address+0x80,&beacon,8)||!header(p->address,0x90,&members)||members.count<1||members.count>100||!rd(p->address+0x9c,&cap,4)||cap<members.count||!observe(t,beacon,&p->beacon))return 0;
  p->size=members.count;p->members=members;
 }
 for(uint32_t i=0;i<q->count;i++){
  const struct qg_party *p=&q->parties[i];uint64_t beacon;int32_t team;struct qg_header members;
  if(!rd(p->address+0x10,&team,4)||team!=p->team||!rd(p->address+0x80,&beacon,8)||beacon!=p->beacon.address||!header(p->address,0x90,&members)||memcmp(&members,&p->members,sizeof members)||!weak_live(t,p->beacon,NULL))return 0;
 }
 struct qg_header h;
 return header(v->host.address,0x2e0,&h)&&!memcmp(&h,&q->joining,sizeof h)&&header(v->host.address,0x2f0,&h)&&!memcmp(&h,&q->public,sizeof h)&&header(v->host.address,0x300,&h)&&!memcmp(&h,&q->reserved,sizeof h)&&weak_live(t,v->host,NULL)&&weak_live(t,v->bindings.world,NULL);
}
/* Minimize owned removals under physical headroom AND the unchanged native
 * selected-team arithmetic. The original native G capacity remains authoritative. */
static int removal_plan(const struct warmup_ue_queue_view *v,uint32_t j,int team,int p,uint32_t result[2]){
 if(team<1||team>2||p<1||p>100)return 0;
 unsigned chosen=(unsigned)team-1,other=1U-chosen,best=161;
 result[0]=result[1]=0;
 for(uint32_t a=0;a<=v->removable_owned_team[chosen];a++)for(uint32_t b=0;b<=v->removable_owned_team[other];b++){
  int64_t total=(int64_t)v->actual_gs_count+j+p-a-b,t=(int64_t)v->team_total[chosen]-a,o=(int64_t)v->team_total[other]-b;
  if(total<=v->capacity&&2*(t+p)-(int64_t)v->capacity<=v->native_team_allowance&&t+p-o<10&&(a+b<best||(a+b==best&&a>result[chosen]))){best=a+b;result[chosen]=a;result[other]=b;}
 }
 return best<=160;
}
static void reset_world(uint64_t epoch){if(request_world!=epoch){if(request_world){join_hold_until=native_request_until=0;yield_pending=0;}memset(requests,0,sizeof requests);request_world=epoch;last_allowed_world=last_allowed_outer=0;atomic_fetch_add(&generation,1);}}
static int refresh_requests(const struct warmup_ue_queue_view *v,const struct qg_state *q,uint32_t result[2]){
 result[0]=result[1]=0;reset_world(v->world_epoch);
 for(int r=0;r<2;r++)if(requests[r].valid){
  const struct qg_party *found=NULL;
  for(uint32_t i=0;i<q->count;i++)if(weak_equal(q->parties[i].beacon,requests[r].beacon)){if(found)return 0;found=&q->parties[i];}
  if(!found){requests[r].valid=0;atomic_fetch_add(&generation,1);continue;}
  if(found->team>=1&&found->team<=2&&found->team!=requests[r].team){requests[r].team=found->team;atomic_fetch_add(&generation,1);}
  uint32_t needed[2];
  if(!removal_plan(v,(uint32_t)q->joining.count,requests[r].team,found->size,needed))continue;
  for(int i=0;i<2;i++)if(needed[i]>result[i])result[i]=needed[i];
 }
 return 1;
}
static void numeric(const struct qg_state *q,const uint32_t d[2]){atomic_store(&pub_count,(uint32_t)q->public.count);atomic_store(&res_count,(uint32_t)q->reserved.count);atomic_store(&joining_count,(uint32_t)q->joining.count);atomic_store(&deficit_one,d[0]);atomic_store(&deficit_two,d[1]);atomic_store(&unknown,0);}
static qg_gate_fn original_gate(void){
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
 return qg_fixture_original;
#else
 uint64_t address=QG_GATE;qg_gate_fn fn;memcpy(&fn,&address,sizeof fn);return fn;
#endif
}
static uint64_t wrapper_address(void){qg_gate_fn fn=qg_wrapper;uint64_t address;memcpy(&address,&fn,sizeof address);return address;}
static uint64_t gate_value(void){
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
 return fixture_cell;
#else
 return __atomic_load_n((const uint64_t *)(uintptr_t)QG_CELL,__ATOMIC_ACQUIRE);
#endif
}

static int code_ready(void){
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
 return qg_fixture_code_ready();
#else
 if(memory_fd<0 || memcmp((const void *)(uintptr_t)QG_GATE,queue_gate_preimage,sizeof queue_gate_preimage))return 0;
 return gate_value()==(atomic_load(&installed)?wrapper_address():QG_GATE);
#endif
}
static bool qg_wrapper(void *host,const void *entry,int32_t team){
 atomic_fetch_add(&calls,1);
 uint64_t want=atomic_load(&wanted_revision);
 if(!want || want!=atomic_load(&attached_revision) || warmup_control_failed()){
  atomic_fetch_add(&pass_unarmed,1);
  atomic_fetch_add(&original_calls,1);
  return original_gate()(host,entry,team);
 }
 if(!main_thread()){atomic_fetch_add(&thread_errors,1);atomic_store(&unknown,1);return false;}
 if(atomic_exchange(&entered,1)){atomic_fetch_add(&reentries,1);atomic_store(&unknown,1);return false;}
 bool result=false;struct warmup_ue_queue_view v={0};v.native_g=-1;struct qg_table t;struct qg_state q;
 if(!code_ready()||warmup_control_failed())goto denied_out;
 if(warmup_control_is_armed())atomic_store(&ever_armed,1);
 if(!atomic_load(&ever_armed)){atomic_fetch_add(&pass_unarmed,1);atomic_fetch_add(&original_calls,1);result=original_gate()(host,entry,team);goto done;}
 uint64_t now=clock_ns();
 if(!now||!warmup_ue_queue_snapshot(&v)||!view_ok(&v,now=clock_ns(),&t)||v.host.address!=(uint64_t)(uintptr_t)host||!queues_read(&v,&t,&q))goto denied_out;
 reset_world(v.world_epoch);
 native_request_until=now+UINT64_C(8000000000);
 const struct qg_party *party=NULL;
 for(uint32_t i=0;i<q.count;i++)if(q.parties[i].address==(uint64_t)(uintptr_t)entry){if(party)goto denied_out;party=&q.parties[i];}
 if(!party||team<1||team>2)goto denied_out;
 uint32_t needed[2];
 if(!removal_plan(&v,(uint32_t)q.joining.count,team,party->size,needed))goto blocked_without_room;
 if(needed[0]||needed[1]){
  requests[team-1]=(struct qg_request){1,team,party->beacon};atomic_fetch_add(&generation,1);numeric(&q,needed);goto ordinary_deny;
 }
 if(last_allowed_world==v.world_epoch&&last_allowed_outer==v.outer_gt_epoch){uint32_t zero[2]={0,0};numeric(&q,zero);goto ordinary_deny;}
 atomic_fetch_add(&original_calls,1);result=original_gate()(host,entry,team);
 if(result){last_allowed_world=v.world_epoch;last_allowed_outer=v.outer_gt_epoch;requests[team-1].valid=0;atomic_fetch_add(&allowed,1);}
 {uint32_t zero[2]={0,0};numeric(&q,zero);}goto done;
blocked_without_room:
 {uint32_t zero[2]={0,0};numeric(&q,zero);}
ordinary_deny:atomic_fetch_add(&denied,1);goto done;
denied_out:
 atomic_store(&unknown,1);
 atomic_fetch_add(&original_calls,1);
 result=original_gate()(host,entry,team);
 join_hold_until=clock_ns()+UINT64_C(8000000000);
 if(result)atomic_fetch_add(&allowed,1);
 else {yield_pending=1;atomic_fetch_add(&denied,1);}

done:atomic_store(&entered,0);return result;
}
int warmup_queue_guard_admission(void *context,uint64_t epoch,const struct wn_world *bindings,uint64_t now,struct wn_admission *out){
 (void)context;if(!out)return WN_ERROR;memset(out,0,sizeof *out);
 if(!main_thread()||!bindings||!now||atomic_exchange(&entered,1))return WN_WAIT;
 int result=WN_WAIT;struct warmup_ue_queue_view v={0};v.native_g=-1;struct qg_table t;struct qg_state q;uint32_t d[2];
 if(warmup_control_is_armed())atomic_store(&ever_armed,1);
 if((drift_revision && drift_revision==atomic_load(&wanted_revision)) || !code_ready()||warmup_control_failed())goto done;
 reset_world(epoch);
 if(!warmup_ue_queue_snapshot(&v)||!view_ok(&v,clock_ns(),&t)||v.world_epoch!=epoch||!weak_equal(v.bindings.world,bindings->world)||!weak_equal(v.bindings.game_state,bindings->game_state)||!weak_equal(v.bindings.game_mode,bindings->game_mode)||!weak_equal(v.bindings.game_session,bindings->game_session)||!queues_read(&v,&t,&q)||!refresh_requests(&v,&q,d)){
  /* The pool independently checks current world, census, capacity and
     reserved slots before creating an object. Only the attached observer
     can report native join attempts while the queue snapshot is missing. */
  if(!epoch||!bindings->world.address||!atomic_load(&installed)||
     !atomic_load(&wanted_revision)||atomic_load(&attached_revision)!=atomic_load(&wanted_revision))goto done;
  uint64_t sampled=clock_ns();
  out->valid=1;out->world=bindings->world;out->lease_generation=atomic_load(&generation);
  out->valid_until_ns=sampled+QG_PLAN_LEASE_NS;
  out->party_safety_verified=sampled>=join_hold_until && sampled>=native_request_until;
  if(!out->party_safety_verified && yield_pending)
   out->team_deficit[0]=out->team_deficit[1]=1;
  atomic_store(&unknown,1);result=WN_OK;goto done;
 }

 uint64_t issued_at=clock_ns();if(!issued_at||issued_at>UINT64_MAX-QG_PLAN_LEASE_NS)goto done;
 out->valid=1;out->world=v.bindings.world;out->lease_generation=atomic_load(&generation);out->valid_until_ns=issued_at+QG_PLAN_LEASE_NS;
 out->inflight_slots=(uint32_t)q.joining.count;out->team_deficit[0]=d[0];out->team_deficit[1]=d[1];
 out->party_safety_verified=q.public.count==0&&q.reserved.count==0&&q.joining.count==0&&d[0]==0&&d[1]==0;
 if(issued_at<join_hold_until){
  out->party_safety_verified=0;
  if(yield_pending && !d[0] && !d[1])out->team_deficit[0]=out->team_deficit[1]=1;
 }
 numeric(&q,d);result=WN_OK;
done:if(result!=WN_OK)atomic_store(&unknown,1);atomic_store(&entered,0);return result;
}
static void error_text(char *error,size_t n,const char *text){if(error&&n)snprintf(error,n,"%s",text);}
static int private_map(uintptr_t start,uintptr_t end,const char *wanted){
 struct stat st;if(stat("/proc/self/exe",&st))return 0;FILE *f=fopen("/proc/self/maps","r");if(!f)return 0;
 char line[4096],p[5];unsigned long a,b,offset,inode;unsigned ma,mi;uintptr_t cursor=start;int valid=1;
 while(cursor<end&&fgets(line,sizeof line,f))if(sscanf(line,"%lx-%lx %4s %lx %x:%x %lu",&a,&b,p,&offset,&ma,&mi,&inode)==7&&b>cursor){if(a>cursor||strcmp(p,wanted)||inode!=(unsigned long)st.st_ino||ma!=major(st.st_dev)||mi!=minor(st.st_dev)){valid=0;break;}cursor=b<end?b:end;}
 int okay=valid&&cursor==end&&!ferror(f);if(fclose(f))okay=0;return okay;
}
#ifndef WARMUP_QUEUE_GUARD_FIXTURE
static void fatal_readonly(void){static const char text[]="warmup_queue_guard: readonly restore failed\n";ssize_t n=write(2,text,sizeof text-1);if(n<0)_exit(125);_exit(125);}
#endif
int warmup_queue_guard_install(char *error,size_t n){
 int expected=0;if(!atomic_compare_exchange_strong(&install_attempted,&expected,1)){error_text(error,n,"queue_install_attempted_no_retry");return 0;}
 if(!main_thread()){error_text(error,n,"queue_install_not_main");return 0;}
 DIR *d=opendir("/proc/self/task");if(!d){error_text(error,n,"queue_threads_unavailable");return 0;}unsigned threads=0;struct dirent *e;while((e=readdir(d)))if(e->d_name[0]>='0'&&e->d_name[0]<='9')threads++;int closed=closedir(d);if(closed||threads!=1){error_text(error,n,"queue_install_requires_single_thread");return 0;}
 long value=sysconf(_SC_PAGESIZE);if(value<4096||((unsigned long)value&((unsigned long)value-1))){error_text(error,n,"queue_page_size_invalid");return 0;}
 uintptr_t size=(uintptr_t)value,page=QG_CELL&~(size-1);uint64_t old;
 if((QG_CELL&7)||QG_CELL+8>page+size||!private_map(QG_GATE,QG_GATE+sizeof queue_gate_preimage,"r-xp")||!private_map(page,page+size,"r--p")||memcmp((const void *)(uintptr_t)QG_GATE,queue_gate_preimage,sizeof queue_gate_preimage)){error_text(error,n,"queue_code_or_original_protection_mismatch");return 0;}
 memcpy(&old,(const void *)(uintptr_t)QG_CELL,8);if(old!=QG_GATE){error_text(error,n,"queue_original_vtable_target_mismatch");return 0;}
 memory_fd=open("/proc/self/mem",O_RDONLY|O_CLOEXEC);if(memory_fd<0){error_text(error,n,"queue_readonly_memory_unavailable");return 0;}
 gate_page=page;
 gate_size=size;
 if(error&&n)error[0]=0;
 return 1;
}

/* Called only at a game-thread tick boundary. Never replace a foreign owner. */
static int switch_cell(uint64_t expected,uint64_t desired){
#ifdef WARMUP_QUEUE_GUARD_FIXTURE
 if(fixture_cell!=expected)return 0;
 fixture_cell=desired;
 return 1;
#else
 if(!gate_size || gate_value()!=expected ||
    !private_map(gate_page,gate_page+gate_size,"r--p") ||
    memcmp((const void *)(uintptr_t)QG_GATE,queue_gate_preimage,sizeof queue_gate_preimage))return 0;
 if(mprotect((void *)gate_page,gate_size,PROT_READ|PROT_WRITE))return 0;
 int changed=__atomic_compare_exchange_n((uint64_t *)(uintptr_t)QG_CELL,&expected,desired,0,__ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE);
 if(mprotect((void *)gate_page,gate_size,PROT_READ))fatal_readonly();
 return changed && gate_value()==desired;
#endif
}
void warmup_queue_guard_sync(uint64_t eligible_revision){
 if(!main_thread())return;
#ifndef WARMUP_QUEUE_GUARD_FIXTURE
 if(memory_fd<0 || !gate_size)return;
#endif
 uint64_t want=atomic_load(&wanted_revision),cell=gate_value(),wrapper=wrapper_address();
 int own=atomic_load(&installed);
 if(own && cell!=wrapper){
  /* An operator restored the native gate, or another provider owns it.
     A new explicit config revision is required before reacquiring it. */
  drift_revision=want;
  atomic_store(&attached_revision,0);
  atomic_store(&installed,0);
  own=0;
 }
 int enable=want && want==eligible_revision && want!=drift_revision && !warmup_control_failed();
 if(!enable)atomic_store(&attached_revision,0);
 if(own && !enable){
  if(!switch_cell(wrapper,QG_GATE))return;
  atomic_store(&installed,0);
 }else if(!own && enable){
  if(cell!=QG_GATE || !switch_cell(QG_GATE,wrapper)){drift_revision=want;return;}
  atomic_store(&installed,1);
 }else{
  if(own && enable)atomic_store(&attached_revision,want);
  return;
 }
 memset(requests,0,sizeof requests);
 join_hold_until=native_request_until=0;yield_pending=0;request_world=last_allowed_world=last_allowed_outer=0;
 atomic_store(&deficit_one,0);atomic_store(&deficit_two,0);
 atomic_fetch_add(&generation,1);
 if(enable)atomic_store(&attached_revision,want);
}
void warmup_queue_guard_telemetry(struct warmup_queue_guard_telemetry *o){if(!o)return;memset(o,0,sizeof *o);o->wrapper_calls=atomic_load(&calls);o->original_calls=atomic_load(&original_calls);o->allowed=atomic_load(&allowed);o->denied=atomic_load(&denied);o->unarmed_passthrough=atomic_load(&pass_unarmed);o->reentry_denied=atomic_load(&reentries);o->thread_denied=atomic_load(&thread_errors);o->request_generation=atomic_load(&generation);o->installed=(uint32_t)atomic_load(&installed);o->unknown=atomic_load(&unknown);o->public_parties=atomic_load(&pub_count);o->reserved_parties=atomic_load(&res_count);o->native_joining=atomic_load(&joining_count);o->team_deficit[0]=atomic_load(&deficit_one);o->team_deficit[1]=atomic_load(&deficit_two);}
