#include "warmup_pool_adapter.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks;
#define CHECK(x) do{++checks;if(!(x)){fprintf(stderr,"FAIL %s:%d: %s\n",__FILE__,__LINE__,#x);exit(1);}}while(0)
struct rpc_record {uint64_t generation;uint32_t step;struct warmup_native_weak_v1 connection;};
struct model {
 uint64_t now,sample,tick,invalidated_tick,next_tick_ns,tick_interval_ns,budget_ns;
 uint64_t census_cost_ns,admission_cost_ns,census_ttl_ns,admission_ttl_ns,last_census_fingerprint;
 struct wn_world world;
 struct wn_human humans[WN_MAX_HUMANS];uint8_t human_live[WN_MAX_HUMANS];uint32_t humans_used;
 uint8_t present[WN_MAX_OWNED],destroyed[WN_MAX_OWNED];uint32_t team[WN_MAX_OWNED];
 struct warmup_native_weak_v1 actor[WN_MAX_OWNED];struct wu_name names[WN_MAX_OWNED];
 uint32_t unknown,unknown_team[2],inflight,deficit[2],lease_generation,last_detach_team;
 int burst_mode;
 int telemetry,party_verified,publication_valid,steps_this_tick,reads_this_tick,corrupt_census;
 int drain_batch;
 unsigned census_calls,admission_calls,first_step_rejections;
 unsigned calls[WN_STEP_COUNT],issues[WN_STEP_COUNT],waits[WN_STEP_COUNT];
 unsigned resets,seals,invalidations,cleanup_waits,step_waits,census_waits,invalidate_busy,seal_busy;
 uint64_t wait_ids[WN_STEP_COUNT];
 enum wn_step wait_step,bad_wait_step,error_step;
 int bad_wait_enabled,error_enabled,gone_mode,gone_done;
 uint32_t gone_human;
 struct rpc_record rpc[10000];size_t rpc_count;
 struct warmup_native_snapshot_v1 published;
};
static struct warmup_native_weak_v1 weak_id(uint64_t address,int32_t serial){struct warmup_native_weak_v1 w={address,(int32_t)(address/8%1000000),serial};return w;}
static int weak_equal(struct warmup_native_weak_v1 a,struct warmup_native_weak_v1 b){return a.address==b.address&&a.index==b.index&&a.serial==b.serial;}
static uint64_t model_fingerprint(const struct model *m){
 uint64_t h=UINT64_C(1469598103934665603);
 for(uint32_t i=0;i<WN_MAX_HUMANS;i++){
  h=(h^m->human_live[i])*UINT64_C(1099511628211);
  if(m->human_live[i]){h=(h^m->humans[i].team)*UINT64_C(1099511628211);h=(h^(uint32_t)m->humans[i].player_state.serial)*UINT64_C(1099511628211);h=(h^(uint32_t)m->humans[i].connection.serial)*UINT64_C(1099511628211);}
 }
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){h=(h^m->present[i])*UINT64_C(1099511628211);if(m->present[i]){h=(h^m->team[i])*UINT64_C(1099511628211);h=(h^(uint32_t)m->actor[i].serial)*UINT64_C(1099511628211);}}
 h=(h^m->unknown)*UINT64_C(1099511628211);h=(h^m->unknown_team[0])*UINT64_C(1099511628211);h=(h^m->unknown_team[1])*UINT64_C(1099511628211);return h;
}
static uint64_t mock_clock(void *v){return ((struct model *)v)->now;}
static int mock_world(void *v,struct wn_world *out){*out=((struct model *)v)->world;return WN_OK;}
static void mock_reset(void *v,uint64_t old,uint64_t next,const struct wn_world *w){
 struct model *m=v;CHECK(next==old+1);CHECK(weak_equal(w->world,m->world.world));++m->resets;
 if(old){memset(m->present,0,sizeof m->present);memset(m->destroyed,0,sizeof m->destroyed);memset(m->team,0,sizeof m->team);}
}
static void add_human(struct model *m,uint32_t team){
 CHECK(m->humans_used<WN_MAX_HUMANS);uint32_t i=m->humans_used++;uint64_t a=UINT64_C(0x100000)+i*0x1000;
 m->humans[i].player_state=weak_id(a,100+(int32_t)i);m->humans[i].controller=weak_id(a+0x100,200+(int32_t)i);m->humans[i].connection=weak_id(a+0x200,300+(int32_t)i);m->humans[i].team=team;
 for(size_t j=0;j<3;j++)for(size_t k=0;k<40;k++)m->humans[i].headers[j][k]=(unsigned char)(i+j+k);
 m->human_live[i]=1;
}
static int mock_census(void *v,uint64_t epoch,const struct wn_owned owned[WN_MAX_OWNED],uint64_t deadline,struct wn_census *out){
 struct model *m=v;CHECK(epoch>0&&m->now<deadline);
 CHECK(++m->reads_this_tick<=(m->drain_batch?32:1));++m->census_calls;m->now+=m->census_cost_ns;
 if(m->census_waits){--m->census_waits;return WN_WAIT;}
 memset(out,0,sizeof *out);out->bindings=m->world;out->captured_ns=m->now;out->valid_until_ns=m->now+m->census_ttl_ns;
 if(m->corrupt_census)++out->bindings.game_state.serial;
 out->binding_signature=77;out->sample_id=++m->sample;out->capacity=100;out->unknown=m->unknown;
 for(uint32_t i=0;i<m->humans_used;i++)if(m->human_live[i]){
  out->humans[out->human_count++]=m->humans[i];
  if(m->humans[i].team)++out->human_team[m->humans[i].team-1];else ++out->human_unassigned;
 }
 for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(m->present[i]){
  /* The mock never reads actor/header/name fields after Destroy. Such a slot
   * remains an array needle until CLEANUP removes it from this census. */
  CHECK(!m->destroyed[i]);CHECK(owned[i].state==WN_ACTIVE);
  CHECK(weak_equal(owned[i].actor,m->actor[i]));CHECK(m->team[i]>=1&&m->team[i]<=2);
  out->owned_present[i]=1;out->owned_observed_team[i]=(uint8_t)m->team[i];++out->owned_count;++out->owned_team[m->team[i]-1];
 }
 for(uint32_t i=0;i<2;i++){out->team_total[i]=out->human_team[i]+out->owned_team[i]+m->unknown_team[i];}
 m->last_census_fingerprint=model_fingerprint(m);
 return WN_OK;
}
static int mock_admission(void *v,uint64_t epoch,const struct wn_world *world,uint64_t now,struct wn_admission *out){
 struct model *m=v;CHECK(epoch&&weak_equal(world->world,m->world.world));memset(out,0,sizeof *out);
 CHECK(++m->reads_this_tick<=(m->drain_batch?32:1));++m->admission_calls;m->now+=m->admission_cost_ns;CHECK(m->now>=now);
 if(!m->telemetry)return WN_WAIT;
 out->valid=1;out->world=m->world.world;out->lease_generation=++m->lease_generation;out->valid_until_ns=m->now+m->admission_ttl_ns;
 out->inflight_slots=m->inflight;out->team_deficit[0]=m->deficit[0];out->team_deficit[1]=m->deficit[1];out->party_safety_verified=m->party_verified;return WN_OK;
}
static int mutating(enum wn_step step){return step!=WN_VERIFY_ACTIVE&&step!=WN_VERIFY_DETACHED&&step!=WN_CLEANUP;}
static void record_rpc(struct model *m,const struct wn_owned *owned,enum wn_step step,const struct wn_human *recipient,const uint16_t *message,size_t units){
 uint16_t expected[WU_MESSAGE_MAX_UNITS];size_t expected_units=0;
 CHECK(wu_message_build(&owned->name,step==WN_MESSAGE_JOIN,expected,WU_MESSAGE_MAX_UNITS,&expected_units)==WU_OK);
 CHECK(units==expected_units&&!memcmp(message,expected,units*sizeof(uint16_t)));
 for(size_t i=0;i<m->rpc_count;i++)CHECK(!(m->rpc[i].generation==owned->generation&&m->rpc[i].step==(uint32_t)step&&weak_equal(m->rpc[i].connection,recipient->connection)));
 CHECK(m->rpc_count<10000);m->rpc[m->rpc_count++]=(struct rpc_record){owned->generation,(uint32_t)step,recipient->connection};
}
static int mock_step(void *v,uint64_t epoch,const struct wn_world *world,const struct wn_owned *owned,enum wn_step step,uint32_t to_team,const struct wn_human *recipient,const uint16_t *message,size_t units,uint64_t deadline,struct wn_receipt *receipt){
 struct model *m=v;CHECK(++m->steps_this_tick<=(m->burst_mode?4:1));CHECK(epoch&&weak_equal(world->world,m->world.world));CHECK(m->now<deadline);
 CHECK(m->drain_batch||!m->reads_this_tick);
 CHECK(!receipt->issued&&receipt->operation_id&&receipt->started_ns);++m->calls[step];
 uint32_t i=owned->slot_index;CHECK(i<WN_MAX_OWNED);
 if(mutating(step))CHECK(!m->publication_valid&&m->invalidated_tick==m->tick);
 if(step==WN_BEGIN_FINISH||step==WN_MOVE_TEAM||step==WN_DETACH){
  if(m->last_census_fingerprint!=model_fingerprint(m)||((step==WN_BEGIN_FINISH||step==WN_MOVE_TEAM)&&(!m->party_verified||m->inflight||m->deficit[0]||m->deficit[1]))){
   ++m->first_step_rejections;(void)snprintf(receipt->stage,sizeof receipt->stage,"last_census_changed_before_mutation");return WN_WAIT;
  }
 }
 if(m->wait_ids[step])CHECK(m->wait_ids[step]==receipt->operation_id);
 if(step==m->wait_step&&m->step_waits){--m->step_waits;++m->waits[step];m->wait_ids[step]=receipt->operation_id;return WN_WAIT;}
 if(step==WN_CLEANUP&&m->cleanup_waits){--m->cleanup_waits;++m->waits[step];CHECK(owned->state==WN_DESTROYED_PENDING&&m->destroyed[i]);return WN_WAIT;}
 if(m->bad_wait_enabled&&step==m->bad_wait_step){receipt->issued=1;receipt->engine_calls=1;++m->issues[step];return WN_WAIT;}
 if(m->error_enabled&&step==m->error_step){receipt->issued=1;receipt->engine_calls=1;++m->issues[step];return WN_ERROR;}
 if(step==WN_MESSAGE_JOIN||step==WN_MESSAGE_LEAVE){
  CHECK(recipient&&message&&units);CHECK(owned->state==(step==WN_MESSAGE_JOIN?WN_ACTIVE:WN_REMOVED_NOTIFY));
  uint32_t human=WN_MAX_HUMANS;for(uint32_t j=0;j<m->humans_used;j++)if(weak_equal(m->humans[j].connection,recipient->connection))human=j;
  CHECK(human<WN_MAX_HUMANS);CHECK(!memcmp(recipient->headers,m->humans[human].headers,sizeof recipient->headers));
  if(m->gone_mode&&!m->gone_done&&human==m->gone_human){
   m->gone_done=1;m->human_live[human]=0;
   if(m->gone_mode==2){receipt->issued=1;receipt->returned=1;receipt->input_freed=1;receipt->engine_calls=2;receipt->allocator_calls=2;++m->issues[step];}
   return WN_RECIPIENT_GONE;
  }
  if(!m->human_live[human])return WN_RECIPIENT_GONE;
  record_rpc(m,owned,step,recipient,message,units);
 }
 if(mutating(step)){receipt->issued=1;receipt->returned=1;receipt->engine_calls=1;receipt->process_event_calls=1;++m->issues[step];}
 switch(step){
  case WN_BEGIN_FINISH:
   CHECK(!m->present[i]&&owned->state==WN_RESERVED);m->present[i]=1;m->destroyed[i]=0;m->team[i]=0;
   m->actor[i]=weak_id(UINT64_C(0x1000000)+i*0x1000,(int32_t)owned->generation+1000);receipt->actor=m->actor[i];receipt->subcalls_issued=2;memset(receipt->actor_header,0x5a,sizeof receipt->actor_header);break;
  case WN_SET_NAME:CHECK(m->present[i]&&!m->destroyed[i]);m->names[i]=owned->name;receipt->input_freed=1;break;
  case WN_SET_TEAM:case WN_MOVE_TEAM:CHECK(m->present[i]&&!m->destroyed[i]&&to_team>=1&&to_team<=2);m->team[i]=to_team;break;
  case WN_VERIFY_ACTIVE:CHECK(m->present[i]&&!m->destroyed[i]&&m->team[i]==to_team);CHECK(wu_name_equal(&m->names[i],&owned->name));break;
  case WN_DETACH:CHECK(m->present[i]&&!m->destroyed[i]);m->last_detach_team=m->team[i];m->team[i]=0;break;
  case WN_VERIFY_DETACHED:CHECK(m->present[i]&&!m->destroyed[i]&&!m->team[i]);break;
  case WN_DESTROY:CHECK(m->present[i]&&!m->destroyed[i]&&!m->team[i]);m->destroyed[i]=1;break;
  case WN_CLEANUP:
   CHECK(m->destroyed[i]&&owned->state==WN_DESTROYED_PENDING);m->present[i]=0;
   if(m->deficit[owned->team-1])--m->deficit[owned->team-1];
   break;
  case WN_MESSAGE_JOIN:case WN_MESSAGE_LEAVE:receipt->input_freed=1;receipt->engine_calls=3;receipt->allocator_calls=2;break;
  default:CHECK(0);
 }
 receipt->finished_ns=m->now;m->wait_ids[step]=0;return WN_OK;
}
static int mock_invalidate(void *v,uint64_t epoch,uint32_t flags){struct model *m=v;CHECK(epoch&&!(flags&WARMUP_SNAPSHOT_VALID));if(m->invalidate_busy){--m->invalidate_busy;return 0;}m->publication_valid=0;m->invalidated_tick=m->tick;++m->invalidations;return 1;}
static int mock_seal(void *v,const struct warmup_native_snapshot_v1 *snapshot){
 struct model *m=v;CHECK(!snapshot->unknown&&!snapshot->inflight_slots&&snapshot->flags==(WARMUP_SNAPSHOT_VALID|WARMUP_SNAPSHOT_BASELINE_READY));
 if(m->seal_busy){--m->seal_busy;return 0;}
 CHECK(snapshot->H_total+snapshot->B_actual<=snapshot->capacity&&snapshot->revision>m->published.revision);
 CHECK(m->now>=snapshot->captured_ns&&m->now<snapshot->valid_until_ns);m->published=*snapshot;m->publication_valid=1;++m->seals;return 1;
}
static const struct warmup_native_ops ops={mock_clock,mock_world,mock_reset,mock_census,mock_admission,mock_step,mock_invalidate,mock_seal};
static void model_init(struct model *m){
 memset(m,0,sizeof *m);m->now=UINT64_C(1000000000);m->next_tick_ns=m->now;m->telemetry=m->party_verified=1;
 m->tick_interval_ns=UINT64_C(10000000);m->budget_ns=UINT64_C(1000000);m->census_ttl_ns=m->admission_ttl_ns=UINT64_C(500000000);
 m->world.world=weak_id(0x20000,1);m->world.game_state=weak_id(0x30000,2);m->world.game_mode=weak_id(0x40000,3);m->world.game_session=weak_id(0x50000,4);
}
static int tick(struct wn_pool *p,struct model *m){
 ++m->tick;m->next_tick_ns+=m->tick_interval_ns;if(m->now<m->next_tick_ns)m->now=m->next_tick_ns;
 m->steps_this_tick=m->reads_this_tick=0;int r=m->drain_batch?wn_pool_drain_tick(p,m->budget_ns):wn_pool_tick(p,m->budget_ns);CHECK(m->steps_this_tick<=1&&m->reads_this_tick<=(m->drain_batch?32:1));return r;
}
static uint32_t active(const struct wn_pool *p){uint32_t n=0;for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(p->owned[i].state==WN_ACTIVE)++n;return n;}
static void quiet(struct wn_pool *p,struct model *m,uint32_t wanted,unsigned limit){
 for(unsigned i=0;i<limit;i++){
  int r=tick(p,m);CHECK(r!=WN_DRIFT&&r!=WN_ERROR);
  uint32_t humans=0;for(uint32_t j=0;j<m->humans_used;j++)if(m->human_live[j])++humans;
  if(p->action==WU_NOOP&&p->phase==WN_POOL_CENSUS&&active(p)==wanted&&m->seals&&m->published.B_actual==wanted&&m->published.H_total==humans&&m->published.world_epoch==p->world_epoch)return;
 }
 fprintf(stderr,"QUIET timeout stage=%s phase=%d step=%d active=%u wanted=%u\n",p->stage,p->phase,p->step,active(p),wanted);CHECK(0);
}
static void reach_step(struct wn_pool *p,struct model *m,enum wn_step step){
 for(unsigned i=0;i<1000;i++){CHECK(tick(p,m)!=WN_DRIFT);if(p->phase==WN_POOL_STEP&&p->step==step)return;}CHECK(0);
}
static void basic_lifecycle(void){
 static struct model m;static struct wn_pool p;model_init(&m);add_human(&m,1);add_human(&m,2);add_human(&m,0);
 struct wu_config c={5,100,1,2};CHECK(wn_pool_init(&p,&c,&ops,&m,123)==WN_OK);m.wait_step=WN_SET_NAME;m.step_waits=2;m.cleanup_waits=2;
 quiet(&p,&m,2,1000);CHECK(m.issues[WN_BEGIN_FINISH]==2&&m.issues[WN_SET_NAME]==2&&m.waits[WN_SET_NAME]==2);
 CHECK(m.rpc_count==6&&m.published.H_total==3&&m.published.B_actual==2);CHECK(!wu_name_equal(&p.owned[0].name,&p.owned[1].name));
 struct wn_pool_status status;wn_pool_get_status(&p,&status);CHECK(status.name_reservations==2&&status.active_owned==2&&status.H_total==3);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);reach_step(&p,&m,WN_CLEANUP);
 struct wu_name tombstone=p.owned[p.slot_index].name;uint64_t original_deadline=p.operation_deadline_ns;
 CHECK(tick(&p,&m)==WN_WAIT);CHECK(p.owned[p.slot_index].state==WN_DESTROYED_PENDING&&wu_name_equal(&tombstone,&p.owned[p.slot_index].name));CHECK(p.operation_deadline_ns==original_deadline);
 quiet(&p,&m,0,1000);CHECK(m.rpc_count==12&&m.issues[WN_DESTROY]==2&&m.waits[WN_CLEANUP]==2);
 wn_pool_get_status(&p,&status);CHECK(!status.name_reservations&&m.published.H_total==3);
}
static void upper_population_lifecycle(void){
 const uint32_t targets[]={80,99};
 for(size_t run=0;run<sizeof targets/sizeof targets[0];run++){
  static struct model m;static struct wn_pool p,rejected;
  model_init(&m);struct wu_config c={targets[run],100,1,1},bad=c;bad.target=100;
  CHECK(wn_pool_init(&rejected,&bad,&ops,&m,90)==WN_ERROR);
  CHECK(!m.issues[WN_BEGIN_FINISH]);
  CHECK(wn_pool_init(&p,&c,&ops,&m,91+run)==WN_OK);
  quiet(&p,&m,c.target,5000);
  CHECK(m.issues[WN_BEGIN_FINISH]==c.target&&m.issues[WN_SET_NAME]==c.target&&m.issues[WN_SET_TEAM]==c.target);
  CHECK(m.published.B_actual==c.target&&!m.published.H_total&&p.owned[c.target-1].state==WN_ACTIVE);
  CHECK(m.published.team_total[0]+m.published.team_total[1]==c.target);
  CHECK(m.published.team_total[0]<=m.published.team_total[1]+1&&m.published.team_total[1]<=m.published.team_total[0]+1);
  CHECK(wn_pool_set_config(&p,&bad)==WN_ERROR&&p.config.target==c.target);
  struct wn_pool_status status;wn_pool_get_status(&p,&status);CHECK(status.name_reservations==c.target);

  uint32_t human_team=p.owned[0].team;add_human(&m,human_team);struct wn_human human=m.humans[0];
  quiet(&p,&m,c.target-1,1000);
  CHECK(m.issues[WN_DESTROY]==1&&m.issues[WN_BEGIN_FINISH]==c.target&&m.last_detach_team==human_team);
  CHECK(m.human_live[0]&&!memcmp(&m.humans[0],&human,sizeof human));
  CHECK(m.published.H_total==1&&m.published.B_actual==c.target-1);
  CHECK(m.published.H_total+m.published.B_actual==c.target);

  m.human_live[0]=0;quiet(&p,&m,c.target,1000);
  CHECK(m.issues[WN_BEGIN_FINISH]==c.target+1&&!m.published.H_total&&m.published.B_actual==c.target);
  c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);quiet(&p,&m,0,5000);
  CHECK(m.issues[WN_DESTROY]==targets[run]+1&&!m.published.H_total&&!m.published.B_actual);
  for(uint32_t i=0;i<WN_MAX_OWNED;i++)CHECK(!m.present[i]&&p.owned[i].state==WN_FREE);
  wn_pool_get_status(&p,&status);CHECK(!status.name_reservations&&!status.active_owned&&!p.failed);
 }
}
static void recipient_departures(void){
 for(int mode=1;mode<=2;mode++){
  static struct model m;static struct wn_pool p;model_init(&m);add_human(&m,1);add_human(&m,2);add_human(&m,0);
  m.gone_mode=mode;m.gone_human=1;struct wu_config c={4,100,1,1};CHECK(wn_pool_init(&p,&c,&ops,&m,mode)==WN_OK);
  quiet(&p,&m,1,1000);CHECK(m.gone_done&&m.rpc_count==2&&!p.failed);CHECK(m.published.H_total==2);
  CHECK(m.calls[WN_MESSAGE_JOIN]==3);CHECK(m.issues[WN_MESSAGE_JOIN]==(unsigned)(mode==2?3:2));
 }
 /* Large multi-recipient snapshot: every generation/session/channel exactly once. */
 static struct model many;static struct wn_pool pool;model_init(&many);for(uint32_t i=0;i<79;i++)add_human(&many,i%2+1);
 struct wu_config c={80,100,1,1};CHECK(wn_pool_init(&pool,&c,&ops,&many,5)==WN_OK);quiet(&pool,&many,1,2000);
 CHECK(many.rpc_count==79&&many.calls[WN_MESSAGE_JOIN]==79);
}
static void freeze_and_leases(void){
 static struct model m;static struct wn_pool p;model_init(&m);struct wu_config c={4,100,1,1};CHECK(wn_pool_init(&p,&c,&ops,&m,6)==WN_OK);
 m.telemetry=0;for(unsigned i=0;i<15;i++)CHECK(tick(&p,&m)!=WN_DRIFT);CHECK(!m.issues[WN_BEGIN_FINISH]&&!m.seals);
 m.telemetry=1;m.party_verified=0;for(unsigned i=0;i<30;i++)CHECK(tick(&p,&m)!=WN_DRIFT);CHECK(!m.issues[WN_BEGIN_FINISH]&&m.seals);
 m.party_verified=1;m.unknown=1;m.unknown_team[0]=1;for(unsigned i=0;i<30;i++)CHECK(tick(&p,&m)!=WN_DRIFT);CHECK(!m.issues[WN_BEGIN_FINISH]&&!m.publication_valid&&!p.failed);
 CHECK(p.census.team_total[0]==1&&!p.census.human_count&&!p.census.owned_count);
 m.unknown=0;m.unknown_team[0]=0;quiet(&p,&m,4,1000);CHECK(p.owned[0].team==1&&p.owned[1].team==2);
 /* Queued party/J=0 is a distinct team deficit lease, never fake humans/J.
  * Clear two same-team objects, keep ADD/MOVE blocked until request expires. */
 m.party_verified=0;m.deficit[0]=2;unsigned old_spawns=m.issues[WN_BEGIN_FINISH];unsigned old_destroy=m.issues[WN_DESTROY];
 for(unsigned i=0;i<1000;i++){
  CHECK(tick(&p,&m)!=WN_DRIFT);CHECK(!m.inflight);
  if(!m.deficit[0]&&p.action==WU_NOOP&&p.phase==WN_POOL_CENSUS&&active(&p)==2)break;
 }
 CHECK(!m.deficit[0]&&active(&p)==2&&m.issues[WN_DESTROY]==old_destroy+2);CHECK(m.issues[WN_BEGIN_FINISH]==old_spawns);
 for(unsigned i=0;i<30;i++){CHECK(tick(&p,&m)!=WN_DRIFT);}
 CHECK(active(&p)==2&&m.issues[WN_BEGIN_FINISH]==old_spawns);
 m.party_verified=1;quiet(&p,&m,4,1000);CHECK(m.issues[WN_BEGIN_FINISH]==old_spawns+2);
 /* Native J pressure alone also requests transient global headroom cleanup. */
 m.inflight=98;m.party_verified=0;
 for(unsigned i=0;i<1000;i++){
  CHECK(tick(&p,&m)!=WN_DRIFT);if(p.action==WU_NOOP&&p.phase==WN_POOL_CENSUS&&active(&p)==1)break;
 }
 CHECK(active(&p)==1&&!m.publication_valid);CHECK(p.last_plan.desired==4&&p.last_plan.capacity_used==99);
 m.inflight=0;m.party_verified=1;quiet(&p,&m,4,1000);
}
static void terminal_no_retry(void){
 static struct model m;static struct wn_pool p;model_init(&m);struct wu_config c={1,100,1,1};CHECK(wn_pool_init(&p,&c,&ops,&m,7)==WN_OK);quiet(&p,&m,1,1000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);m.bad_wait_enabled=1;m.bad_wait_step=WN_DESTROY;
 for(unsigned i=0;i<1000&&!p.failed;i++)(void)tick(&p,&m);
 CHECK(p.failed&&m.issues[WN_DESTROY]==1&&!m.calls[WN_CLEANUP]);unsigned calls=m.calls[WN_DESTROY];
 for(unsigned i=0;i<20;i++){CHECK(tick(&p,&m)==WN_DRIFT);}
 CHECK(m.calls[WN_DESTROY]==calls&&!m.publication_valid);
 CHECK(wn_pool_set_config(&p,&c)==WN_ERROR);
 /* Issued message error does not infer a Destroy or retry the same RPC. */
 model_init(&m);add_human(&m,1);c.target=2;CHECK(wn_pool_init(&p,&c,&ops,&m,8)==WN_OK);m.error_enabled=1;m.error_step=WN_MESSAGE_JOIN;
 for(unsigned i=0;i<1000&&!p.failed;i++)(void)tick(&p,&m);
 CHECK(p.failed&&m.calls[WN_MESSAGE_JOIN]==1&&!m.calls[WN_DESTROY]);for(unsigned i=0;i<10;i++)CHECK(tick(&p,&m)==WN_DRIFT);CHECK(m.calls[WN_MESSAGE_JOIN]==1);
}
static void deadline_and_world(void){
 static struct model m;static struct wn_pool p;model_init(&m);struct wu_config c={1,100,1,1};CHECK(wn_pool_init(&p,&c,&ops,&m,9)==WN_OK);quiet(&p,&m,1,1000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);m.cleanup_waits=10000;reach_step(&p,&m,WN_CLEANUP);
 uint64_t deadline=p.operation_deadline_ns;CHECK(tick(&p,&m)==WN_WAIT);CHECK(p.operation_deadline_ns==deadline);
 m.now=deadline-1;m.next_tick_ns=m.now;CHECK(tick(&p,&m)==WN_DRIFT);CHECK(p.failed&&m.issues[WN_DESTROY]==1&&!m.issues[WN_CLEANUP]);
 model_init(&m);c.target=1;CHECK(wn_pool_init(&p,&c,&ops,&m,10)==WN_OK);quiet(&p,&m,1,1000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);m.cleanup_waits=100;reach_step(&p,&m,WN_CLEANUP);
 uint64_t old_epoch=p.world_epoch;unsigned cleanup_calls=m.calls[WN_CLEANUP],destroy_calls=m.calls[WN_DESTROY];
 m.world.world=weak_id(0x60000,11);m.world.game_state=weak_id(0x70000,12);m.world.game_mode=weak_id(0x80000,13);m.world.game_session=weak_id(0x90000,14);
 CHECK(tick(&p,&m)==WN_WORLD_CHANGED&&p.world_epoch==old_epoch+1&&!p.failed);
 struct wn_pool_status status;wn_pool_get_status(&p,&status);CHECK(!status.name_reservations&&!status.active_owned&&!p.action);
 quiet(&p,&m,0,1000);CHECK(m.calls[WN_CLEANUP]==cleanup_calls&&m.calls[WN_DESTROY]==destroy_calls);
}
static void unissued_gates(void){
 static struct model m;static struct wn_pool p;model_init(&m);struct wu_config c={1,100,1,1};m.seal_busy=2;
 CHECK(wn_pool_init(&p,&c,&ops,&m,11)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 uint64_t deadline=p.operation_deadline_ns;struct wu_name reserved=p.owned[p.slot_index].name;
 m.invalidate_busy=2;
 CHECK(tick(&p,&m)==WN_WAIT&&!m.issues[WN_BEGIN_FINISH]);CHECK(tick(&p,&m)==WN_WAIT&&!m.issues[WN_BEGIN_FINISH]);
 CHECK(p.operation_deadline_ns==deadline&&wu_name_equal(&reserved,&p.owned[p.slot_index].name));
 quiet(&p,&m,1,1000);CHECK(m.issues[WN_BEGIN_FINISH]==1);
 /* A confirmed human arriving before Begin supersedes an unissued ADD. */
 model_init(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,12)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);add_human(&m,1);
 CHECK(tick(&p,&m)==WN_WAIT&&!m.issues[WN_BEGIN_FINISH]);CHECK(p.phase==WN_POOL_PREPARE_CENSUS);
 quiet(&p,&m,0,1000);CHECK(m.published.H_total==1);
 struct wn_pool_status status;wn_pool_get_status(&p,&status);CHECK(!status.name_reservations&&!p.failed);
}
static void slow_model(struct model *m){
 model_init(m);m->tick_interval_ns=UINT64_C(20000000);m->budget_ns=UINT64_C(1500000);
 m->census_cost_ns=m->admission_cost_ns=UINT64_C(2000000);
}
static void staged_read_progress(void){
 static struct model m;static struct wn_pool p;slow_model(&m);struct wu_config c={2,100,1,1};
 CHECK(wn_pool_init(&p,&c,&ops,&m,21)==WN_OK);
 uint64_t observed_id=0,original_deadline=0;int reached=0;
 for(unsigned i=0;i<1000;i++){
  CHECK(tick(&p,&m)!=WN_DRIFT);
  if(p.action!=WU_NOOP){
   if(p.operation_id!=observed_id){observed_id=p.operation_id;original_deadline=p.operation_deadline_ns;}
   CHECK(p.operation_deadline_ns==original_deadline);
  }
  if(p.action==WU_NOOP&&p.phase==WN_POOL_CENSUS&&active(&p)==2&&m.published.B_actual==2){reached=1;break;}
 }
 CHECK(reached&&m.issues[WN_BEGIN_FINISH]==2&&m.issues[WN_SET_NAME]==2&&m.issues[WN_SET_TEAM]==2);
 CHECK(m.census_cost_ns>m.budget_ns&&m.admission_cost_ns>m.budget_ns);
 CHECK(m.census_calls&&m.admission_calls&&!p.failed);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);quiet(&p,&m,0,1000);
 CHECK(m.issues[WN_DESTROY]==2&&m.published.B_actual==0&&!p.failed);

 /* A 5ms planning lease cannot bridge a real 20ms tick. Keep the completed
  * census while refreshing admission; a 500ms lease then makes progress. */
 slow_model(&m);c.target=1;m.admission_ttl_ns=UINT64_C(5000000);
 CHECK(wn_pool_init(&p,&c,&ops,&m,22)==WN_OK);
 for(unsigned i=0;i<12;i++)CHECK(tick(&p,&m)!=WN_DRIFT);
 CHECK(!m.issues[WN_BEGIN_FINISH]&&!p.failed&&m.admission_calls>1&&m.census_calls==1);
 m.admission_ttl_ns=UINT64_C(500000000);quiet(&p,&m,1,1000);

 /* Admission alone expires after preparation: no UE, no unnecessary repeat
  * of an otherwise valid census, and no reset of the original 30s deadline. */
 slow_model(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,23)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 uint64_t deadline=p.operation_deadline_ns;unsigned census_calls=m.census_calls;
 p.admission.valid_until_ns=m.now+UINT64_C(5000000);
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_ADMISSION&&!m.issues[WN_BEGIN_FINISH]);
 CHECK(m.census_calls==census_calls&&p.operation_deadline_ns==deadline);
 CHECK(tick(&p,&m)==WN_OK&&p.phase==WN_POOL_PREPARE_PLAN&&m.census_calls==census_calls);
 CHECK(p.operation_deadline_ns==deadline);quiet(&p,&m,1,1000);

 /* Both cached proofs expire across a 600ms pause. Return to census rather
  * than sending the already planned first mutation. */
 slow_model(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,24)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 deadline=p.operation_deadline_ns;m.now+=UINT64_C(600000000);m.next_tick_ns=m.now;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_BEGIN_FINISH]);
 CHECK(p.operation_deadline_ns==deadline);quiet(&p,&m,1,1000);

 /* A live queue/J change inside a still valid planning lease is caught by
  * the actual native-style first-step gate and forces a NEW census. */
 slow_model(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,25)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 deadline=p.operation_deadline_ns;m.party_verified=0;m.inflight=1;census_calls=m.census_calls;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_BEGIN_FINISH]);
 CHECK(m.first_step_rejections==1&&p.operation_deadline_ns==deadline);
 for(unsigned i=0;i<50&&p.action!=WU_NOOP;i++)CHECK(tick(&p,&m)!=WN_DRIFT);
 CHECK(p.action==WU_NOOP&&m.census_calls>census_calls&&!m.issues[WN_BEGIN_FINISH]);
 m.inflight=0;m.party_verified=1;quiet(&p,&m,1,1000);

 /* Unknown membership appearing after the saved census never authorizes UE. */
 slow_model(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,26)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 m.unknown=1;m.unknown_team[0]=1;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_BEGIN_FINISH]);
 for(unsigned i=0;i<30;i++)CHECK(tick(&p,&m)!=WN_DRIFT);
 CHECK(!m.issues[WN_BEGIN_FINISH]&&!m.publication_valid&&!p.failed&&p.census.unknown==1);
 m.unknown=m.unknown_team[0]=0;quiet(&p,&m,1,1000);

 /* A real binding contradiction is terminal; it is not a refreshable lease. */
 slow_model(&m);m.corrupt_census=1;CHECK(wn_pool_init(&p,&c,&ops,&m,27)==WN_OK);
 for(unsigned i=0;i<10&&!p.failed;i++)(void)tick(&p,&m);
 CHECK(p.failed&&!m.issues[WN_BEGIN_FINISH]&&!m.publication_valid);
}
static void settlement_reuses_verified_reads(void){
 unsigned normal=0,optimized=0;
 for(int fast=0;fast<2;fast++){
  static struct model m;static struct wn_pool p;model_init(&m);add_human(&m,1);
  struct wu_config c={11,100,1,2};CHECK(wn_pool_init(&p,&c,&ops,&m,1234)==WN_OK);quiet(&p,&m,10,3000);
  unsigned before=m.census_calls;c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);p.round_draining=fast;
  quiet(&p,&m,0,3000);CHECK(m.issues[WN_DESTROY]==10&&m.rpc_count==(fast?10:20)&&!p.failed);
  if(fast)optimized=m.census_calls-before;else normal=m.census_calls-before;
 }
 CHECK(optimized<normal/2);
 /* A stale reused witness must be refreshed, not given a new expiry. */
 static struct model m;static struct wn_pool p;model_init(&m);struct wu_config c={2,100,1,2};
 CHECK(wn_pool_init(&p,&c,&ops,&m,1235)==WN_OK);quiet(&p,&m,2,1000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);p.round_draining=1;reach_step(&p,&m,WN_DETACH);
 m.now=p.census.valid_until_ns;m.next_tick_ns=m.now;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_DETACH]);
 reach_step(&p,&m,WN_DETACH);
 /* Live roster change between reused census and issuing must reject/re-read. */
 add_human(&m,2);unsigned rejected=m.first_step_rejections;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_DETACH]);
 CHECK(m.first_step_rejections==rejected+1);quiet(&p,&m,0,1000);
 CHECK(m.issues[WN_DESTROY]==2&&m.rpc_count==0);
 /* Switching back to a positive target before issuing cancels removal. */
 model_init(&m);c.target=2;CHECK(wn_pool_init(&p,&c,&ops,&m,1236)==WN_OK);quiet(&p,&m,2,1000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);p.round_draining=1;reach_step(&p,&m,WN_DETACH);
 c.target=2;CHECK(wn_pool_set_config(&p,&c)==WN_OK);CHECK(tick(&p,&m)==WN_WAIT&&!m.issues[WN_DETACH]);quiet(&p,&m,2,1000);
 printf("settlement census calls: normal=%u reused=%u\n",normal,optimized);
}
static void bounded_settlement_dispatch(void){
 static struct model m;static struct wn_pool p;struct wu_config c={91,100,1,2};
 model_init(&m);add_human(&m,1);CHECK(wn_pool_init(&p,&c,&ops,&m,800)==WN_OK);quiet(&p,&m,90,10000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);p.round_draining=1;m.drain_batch=1;
 unsigned start=(unsigned)m.tick;quiet(&p,&m,0,2000);unsigned drain_ticks=(unsigned)m.tick-start;
 CHECK(drain_ticks<600&&m.issues[WN_DESTROY]==90&&m.rpc_count==90&&!m.calls[WN_MESSAGE_LEAVE]&&!m.calls[WN_VERIFY_DETACHED]);
 /* A synchronous read exhausting the budget cannot be followed by a write. */
 model_init(&m);c.target=2;CHECK(wn_pool_init(&p,&c,&ops,&m,801)==WN_OK);quiet(&p,&m,2,1000);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);p.round_draining=1;m.drain_batch=1;m.census_cost_ns=m.budget_ns+1;
 CHECK(tick(&p,&m)==WN_OK&&!m.issues[WN_DETACH]&&m.reads_this_tick==1);
 m.census_cost_ns=0;reach_step(&p,&m,WN_DESTROY);
 /* Issued-but-uncertain work still stops, with no loop retry. */
 m.bad_wait_enabled=1;m.bad_wait_step=WN_DESTROY;
 CHECK(tick(&p,&m)==WN_DRIFT&&p.failed&&m.issues[WN_DESTROY]==1);
 for(int i=0;i<10;i++)CHECK(tick(&p,&m)==WN_DRIFT);
 CHECK(m.issues[WN_DESTROY]==1);
 printf("bounded settlement: 90 bots plus one human in %u mock ticks\n",drain_ticks);
}
static void bounded_refill_dispatch(void){
 static struct model m;static struct wn_pool p;struct wu_config c={11,100,1,2};
 model_init(&m);add_human(&m,1);CHECK(wn_pool_init(&p,&c,&ops,&m,901)==WN_OK);quiet(&p,&m,10,10000);unsigned baseline=(unsigned)m.tick;
 model_init(&m);add_human(&m,1);CHECK(wn_pool_init(&p,&c,&ops,&m,901)==WN_OK);
 m.drain_batch=1;unsigned elapsed=0;
 for(;elapsed<baseline;elapsed++){
  ++m.tick;m.next_tick_ns+=m.tick_interval_ns;if(m.now<m.next_tick_ns)m.now=m.next_tick_ns;
  m.steps_this_tick=m.reads_this_tick=0;
  int r=wn_pool_progress_tick(&p,m.budget_ns);CHECK(r!=WN_DRIFT&&r!=WN_ERROR&&m.steps_this_tick<=1&&m.reads_this_tick<=32);
  if(p.action==WU_NOOP&&p.phase==WN_POOL_CENSUS&&active(&p)==10&&m.seals&&m.published.B_actual==10)break;
 }
 CHECK(elapsed<baseline&&m.rpc_count==10&&m.published.H_total==1);

 /* Exhausting the original budget cannot issue a following native call. */
 model_init(&m);m.drain_batch=1;c.target=2;CHECK(wn_pool_init(&p,&c,&ops,&m,902)==WN_OK);
 CHECK(wn_pool_progress_tick(&p,m.budget_ns)==WN_WORLD_CHANGED);
 m.census_cost_ns=m.budget_ns+1;m.steps_this_tick=m.reads_this_tick=0;
 CHECK(wn_pool_progress_tick(&p,m.budget_ns)==WN_OK&&m.steps_this_tick==0&&m.reads_this_tick==1);
 /* Uncertain native completion halts; bounded dispatch must not retry. */
 model_init(&m);c.target=2;CHECK(wn_pool_init(&p,&c,&ops,&m,903)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 m.bad_wait_enabled=1;m.bad_wait_step=WN_BEGIN_FINISH;m.steps_this_tick=m.reads_this_tick=0;
 CHECK(wn_pool_progress_tick(&p,m.budget_ns)==WN_DRIFT&&p.failed&&m.issues[WN_BEGIN_FINISH]==1);
 CHECK(wn_pool_progress_tick(&p,m.budget_ns)==WN_DRIFT&&m.issues[WN_BEGIN_FINISH]==1);
 printf("bounded refill mock: baseline=%u optimized=%u ticks\n",baseline,elapsed+1);
}
static void refill_reused_witness_guards(void){
 static struct model m;static struct wn_pool p;struct wu_config c={2,100,1,2};
 model_init(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,910)==WN_OK);p.refill_fast=1;reach_step(&p,&m,WN_BEGIN_FINISH);
 m.now=p.census.valid_until_ns;m.next_tick_ns=m.now;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_BEGIN_FINISH]);
 reach_step(&p,&m,WN_BEGIN_FINISH);add_human(&m,1);unsigned prior=m.first_step_rejections;
 CHECK(tick(&p,&m)==WN_WAIT&&p.phase==WN_POOL_PREPARE_CENSUS&&!m.issues[WN_BEGIN_FINISH]);
 CHECK(m.first_step_rejections==prior+1);quiet(&p,&m,1,1000);CHECK(m.published.H_total==1);
 model_init(&m);CHECK(wn_pool_init(&p,&c,&ops,&m,911)==WN_OK);p.refill_fast=1;reach_step(&p,&m,WN_BEGIN_FINISH);
 c.target=0;CHECK(wn_pool_set_config(&p,&c)==WN_OK);CHECK(tick(&p,&m)==WN_WAIT&&!m.issues[WN_BEGIN_FINISH]);
 quiet(&p,&m,0,1000);
}
static void bounded_burst_refill(void){
 static struct model m;static struct wn_pool p;struct wu_config c={14,100,1,2};
 model_init(&m);m.burst_mode=1;for(int i=0;i<4;i++)add_human(&m,1);m.drain_batch=1;CHECK(wn_pool_init(&p,&c,&ops,&m,920)==WN_OK);
 unsigned n=0;
 for(;n<1000;n++){
  ++m.tick;m.next_tick_ns+=m.tick_interval_ns;if(m.now<m.next_tick_ns)m.now=m.next_tick_ns;
  m.steps_this_tick=m.reads_this_tick=0;int r=wn_pool_burst_tick(&p,m.budget_ns);
  CHECK(r!=WN_DRIFT&&r!=WN_ERROR&&m.steps_this_tick<=4);
  if(p.action==WU_NOOP&&p.phase==WN_POOL_CENSUS&&active(&p)==10&&m.seals&&m.published.B_actual==10)break;
 }
 CHECK(n<1000&&m.rpc_count==40&&m.published.H_total==4);
 printf("bounded burst: ten bots four humans %u ticks\n",n+1);
 model_init(&m);c.target=2;CHECK(wn_pool_init(&p,&c,&ops,&m,921)==WN_OK);reach_step(&p,&m,WN_BEGIN_FINISH);
 m.bad_wait_enabled=1;m.bad_wait_step=WN_BEGIN_FINISH;m.steps_this_tick=m.reads_this_tick=0;
 CHECK(wn_pool_burst_tick(&p,m.budget_ns)==WN_DRIFT&&m.issues[WN_BEGIN_FINISH]==1);
 CHECK(wn_pool_burst_tick(&p,m.budget_ns)==WN_DRIFT&&m.issues[WN_BEGIN_FINISH]==1);
 model_init(&m);m.drain_batch=1;CHECK(wn_pool_init(&p,&c,&ops,&m,922)==WN_OK);CHECK(wn_pool_burst_tick(&p,m.budget_ns)==WN_WORLD_CHANGED);
 m.census_cost_ns=m.budget_ns+1;m.steps_this_tick=m.reads_this_tick=0;
 CHECK(wn_pool_burst_tick(&p,m.budget_ns)==WN_OK&&m.steps_this_tick==0&&m.reads_this_tick==1);
}
int main(void){
 bounded_burst_refill();
 refill_reused_witness_guards();
 bounded_refill_dispatch();
 bounded_settlement_dispatch();
 settlement_reuses_verified_reads();
 basic_lifecycle();upper_population_lifecycle();recipient_departures();freeze_and_leases();terminal_no_retry();deadline_and_world();unissued_gates();staged_read_progress();
 printf("PASS warmup_pool_adapter: %u checks; mocked ops only, no native UE/live acceptance\n",checks);return 0;
}
