#include "warmup_pool_adapter.h"
#include <limits.h>
#include <stdio.h>
#include <string.h>

static void stage(struct wn_pool *p,const char *text){ (void)snprintf(p->stage,sizeof p->stage,"%s",text); }
static int weak_valid(struct warmup_native_weak_v1 w){ return w.address>=UINT64_C(0x10000)&&w.address<UINT64_C(0x0000800000000000)&&!(w.address&7)&&w.index>=0&&w.index<(1<<27)&&w.serial>0; }
static int weak_same(struct warmup_native_weak_v1 a,struct warmup_native_weak_v1 b){ return a.address==b.address&&a.index==b.index&&a.serial==b.serial; }
static int world_valid(const struct wn_world *w){ return weak_valid(w->world)&&weak_valid(w->game_state)&&weak_valid(w->game_mode)&&weak_valid(w->game_session); }
static int world_same(const struct wn_world *a,const struct wn_world *b){ return weak_same(a->world,b->world)&&weak_same(a->game_state,b->game_state)&&weak_same(a->game_mode,b->game_mode)&&weak_same(a->game_session,b->game_session); }
static int human_valid(const struct wn_human *h){ return weak_valid(h->player_state)&&weak_valid(h->controller)&&weak_valid(h->connection)&&h->team<=2; }
static int human_same(const struct wn_human *a,const struct wn_human *b){ return weak_same(a->player_state,b->player_state)&&weak_same(a->controller,b->controller)&&weak_same(a->connection,b->connection); }

static int halt(struct wn_pool *p,const char *reason){
 p->failed=1;p->phase=WN_POOL_HALTED;stage(p,reason);
 if(p->action!=WU_NOOP&&p->slot_index<WN_MAX_OWNED&&p->owned[p->slot_index].state!=WN_FREE)p->owned[p->slot_index].state=WN_SLOT_FAILED;
 (void)p->ops.publication_invalidate(p->context,p->world_epoch,WARMUP_SNAPSHOT_DRIFT);
 return WN_DRIFT;
}
/* Only the post-removal, read-only reconciliation may outlive the mutation
 * deadline. Slot release proves cleanup AND notification handling completed.
 * Never extend or retry an uncertain engine mutation. Fresh evidence remains
 * mandatory before sealing a snapshot or planning the next operation. */
static int removed_pending_verification(const struct wn_pool *p){
 return p->action==WU_REMOVE&&p->slot_index<WN_MAX_OWNED&&
  p->owned[p->slot_index].state==WN_FREE&&
  (p->phase==WN_POOL_FINAL_CENSUS||p->phase==WN_POOL_FINAL_ADMISSION||p->phase==WN_POOL_FINAL_SEAL);
}
static int operation_expired(struct wn_pool *p,uint64_t now){
 if(p->action==WU_NOOP||now<p->operation_deadline_ns)return 0;
 if(removed_pending_verification(p)){
  stage(p,"removed_waiting_final_verification");return 0;
 }
 return 1;
}
static int before_deadline(struct wn_pool *p,uint64_t gt_deadline){
 uint64_t now=p->ops.clock_ns(p->context);
 if(operation_expired(p,now))return halt(p,"operation_original_deadline_expired");
 if(now&&now<gt_deadline)return WN_OK;
 stage(p,"gt_budget_exhausted_before_phase");return WN_WAIT;
}
static int census_valid(const struct wn_pool *p,const struct wn_census *c,uint64_t now){
 if(!world_same(&c->bindings,&p->bindings)||!c->binding_signature||!c->sample_id||
    !c->captured_ns||now<c->captured_ns||now>=c->valid_until_ns||
    c->valid_until_ns-c->captured_ns>UINT64_C(2000000000)||c->capacity!=p->config.capacity||
    c->human_count>100||c->unknown>100||c->owned_count>99||
    c->human_team[0]>100||c->human_team[1]>100||c->human_unassigned>100||
    c->owned_team[0]>99||c->owned_team[1]>99||c->team_total[0]>100||c->team_total[1]>100||
    c->human_team[0]+c->human_team[1]+c->human_unassigned!=c->human_count||
    c->owned_team[0]+c->owned_team[1]!=c->owned_count||
    c->human_team[0]+c->owned_team[0]>c->team_total[0]||
    c->human_team[1]+c->owned_team[1]>c->team_total[1]||
    (c->team_total[0]-c->human_team[0]-c->owned_team[0])+
     (c->team_total[1]-c->human_team[1]-c->owned_team[1])>c->unknown||
    c->human_count+c->owned_count+c->unknown>c->capacity)return 0;
 uint32_t owned_team[2]={0,0},human_team[3]={0,0,0};
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){
  if(c->owned_present[i]>1||c->owned_observed_team[i]>2)return 0;
  if(p->owned[i].state==WN_ACTIVE){
   if(!c->owned_present[i]||p->owned[i].team<1||p->owned[i].team>2||c->owned_observed_team[i]!=p->owned[i].team)return 0;
   ++owned_team[p->owned[i].team-1];
  }else if(c->owned_present[i])return 0;
 }
 if(owned_team[0]!=c->owned_team[0]||owned_team[1]!=c->owned_team[1])return 0;
 for(uint32_t i=0;i<c->human_count;i++){
  if(!human_valid(&c->humans[i]))return 0;
  ++human_team[c->humans[i].team];
  for(uint32_t j=0;j<i;j++)if(weak_same(c->humans[i].player_state,c->humans[j].player_state)||weak_same(c->humans[i].controller,c->humans[j].controller)||weak_same(c->humans[i].connection,c->humans[j].connection))return 0;
 }
 return human_team[0]==c->human_unassigned&&human_team[1]==c->human_team[0]&&human_team[2]==c->human_team[1];
}
static int read_census(struct wn_pool *p,uint64_t gt_deadline){
 int r=before_deadline(p,gt_deadline);if(r!=WN_OK)return r;
 struct wn_census c;memset(&c,0,sizeof c);
 r=p->ops.census(p->context,p->world_epoch,p->owned,gt_deadline,&c);
 if(r==WN_WAIT)return WN_WAIT;
 if(r==WN_WORLD_CHANGED){p->waiting_world_change=1;return r;}
 if(r!=WN_OK)return halt(p,"census_drift");
 uint64_t now=p->ops.clock_ns(p->context);
 if(c.captured_ns&&now>=c.valid_until_ns)return WN_WAIT;
 if(!census_valid(p,&c,now))return halt(p,"census_shape_or_owned_identity_failed");
 if(c.sample_id<=p->last_census_sample)return WN_WAIT;
 p->census=c;p->last_census_sample=c.sample_id;return WN_OK;
}
static int read_admission(struct wn_pool *p,uint64_t gt_deadline){
 int r=before_deadline(p,gt_deadline);if(r!=WN_OK)return r;
 struct wn_admission a;memset(&a,0,sizeof a);
 uint64_t now=p->ops.clock_ns(p->context);
 r=p->ops.admission(p->context,p->world_epoch,&p->bindings,now,&a);
 if(r==WN_WAIT)return WN_WAIT;
 if(r==WN_WORLD_CHANGED){p->waiting_world_change=1;return r;}
 if(r!=WN_OK)return halt(p,"admission_read_drift");
 now=p->ops.clock_ns(p->context);
 if(!a.valid||!a.lease_generation||a.valid_until_ns<=now||!weak_same(a.world,p->bindings.world)){
  stage(p,"admission_telemetry_not_ready");return WN_WAIT;
 }
 if(a.valid!=1||a.inflight_slots>100||a.team_deficit[0]>100||a.team_deficit[1]>100||
    (a.party_safety_verified!=0&&a.party_safety_verified!=1)||
    (p->admission.valid&&a.lease_generation<p->admission.lease_generation))return halt(p,"admission_shape_or_generation_failed");
 p->admission=a;return WN_OK;
}
static struct wu_snapshot core_snapshot(const struct wn_pool *p){
 struct wu_snapshot s={0};s.sample_id=p->census.sample_id;s.world_generation=p->world_epoch;
 s.confirmed_h_total=p->census.human_count;s.h1=p->census.human_team[0];s.h2=p->census.human_team[1];s.h_unassigned=p->census.human_unassigned;
 s.owned_b1=p->census.owned_team[0];s.owned_b2=p->census.owned_team[1];s.unknown=p->census.unknown;s.inflight_slots=p->admission.inflight_slots;s.baseline_ready=1;return s;
}
static int pool_plan(const struct wn_pool *p,const struct wu_snapshot *s,struct wu_plan *plan,int *lease_remove){
 int r=wu_make_plan(&p->config,s,NULL,plan);*lease_remove=0;if(r!=WU_OK)return r;
 if(!s->baseline_ready||s->unknown)return WU_OK;
 uint32_t d1=p->admission.team_deficit[0],d2=p->admission.team_deficit[1];
 int can1=d1&&s->owned_b1,can2=d2&&s->owned_b2;
 if(can1||can2){
  uint32_t team=can1&&(!can2||d1>=d2)?1u:2u;
  plan->action=(struct wu_action){WU_REMOVE,team,0};plan->reason=WU_REASON_ACTION;*lease_remove=1;
 }else if((d1||d2)&&(plan->action.type==WU_ADD||plan->action.type==WU_MOVE)){
  plan->action=(struct wu_action){WU_NOOP,0,0};plan->reason=WU_REASON_INFLIGHT;
 }
 return WU_OK;
}
static int data_fresh(const struct wn_pool *p,uint64_t now){
 return p->census.captured_ns&&now>=p->census.captured_ns&&now<p->census.valid_until_ns&&p->admission.valid&&now<p->admission.valid_until_ns&&weak_same(p->admission.world,p->bindings.world);
}
static int drain_reuse(const struct wn_pool *p,uint64_t now){
 return p->round_draining&&p->config.target==0&&!p->census.unknown&&
        data_fresh(p,now)&&census_valid(p,&p->census,now);
}
static int refill_reuse(const struct wn_pool *p,uint64_t now){
 return p->refill_fast&&!p->round_draining&&p->config.target>0&&!p->census.unknown&&data_fresh(p,now)&&census_valid(p,&p->census,now);
}
static int seal_or_invalidate(struct wn_pool *p,const struct wu_plan *plan){
 if(!plan->publication_ready)return p->ops.publication_invalidate(p->context,p->world_epoch,WARMUP_SNAPSHOT_MUTATION_INFLIGHT)?WN_OK:WN_WAIT;
 uint64_t now=p->ops.clock_ns(p->context);if(!data_fresh(p,now))return WN_WAIT;
 struct warmup_native_snapshot_v1 s;memset(&s,0,sizeof s);
 s.abi_version=WARMUP_NATIVE_SNAPSHOT_ABI;s.struct_size=sizeof s;s.revision=p->snapshot_revision+1;
 if(!s.revision)return halt(p,"snapshot_revision_exhausted");
 s.world_epoch=p->world_epoch;s.captured_ns=p->census.captured_ns;
 s.valid_until_ns=p->census.valid_until_ns<p->admission.valid_until_ns?p->census.valid_until_ns:p->admission.valid_until_ns;
 s.world=p->bindings.world;s.game_state=p->bindings.game_state;s.game_mode=p->bindings.game_mode;s.game_session=p->bindings.game_session;
 s.H_total=p->census.human_count;s.B_actual=p->census.owned_count;s.unknown=p->census.unknown;s.inflight_slots=p->admission.inflight_slots;
 for(uint32_t i=0;i<2;i++){s.team_total[i]=p->census.team_total[i];s.owned_team[i]=p->census.owned_team[i];s.h_team[i]=p->census.human_team[i];}
 s.h_unassigned=p->census.human_unassigned;s.target=p->config.target;s.desired=plan->desired;s.capacity=p->config.capacity;
 s.flags=WARMUP_SNAPSHOT_VALID|WARMUP_SNAPSHOT_BASELINE_READY;
 if(!p->ops.publication_seal(p->context,&s))return WN_WAIT;
 p->snapshot_revision=s.revision;return WN_OK;
}
static void reset_receipt(struct wn_pool *p){memset(&p->receipt,0,sizeof p->receipt);}
static void next_step(struct wn_pool *p,enum wn_step step){p->step=step;reset_receipt(p);p->phase=WN_POOL_STEP;}
static void release_slot(struct wn_pool *p){memset(&p->owned[p->slot_index],0,sizeof p->owned[p->slot_index]);}
static void finish_operation(struct wn_pool *p){
 wu_controller_resolve(&p->controller);p->action=WU_NOOP;p->operation_deadline_ns=0;
 p->admission_remove=0;
 p->recipient_count=p->recipient_cursor=0;p->phase=WN_POOL_CENSUS;reset_receipt(p);stage(p,"operation_confirmed");
}
static void cancel_unissued(struct wn_pool *p,const char *reason){
 if(p->action==WU_ADD)release_slot(p);
 finish_operation(p);stage(p,reason);
}
static int start_operation(struct wn_pool *p,const struct wu_action *a){
 uint32_t slot=WN_MAX_OWNED;
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){
  if(a->type==WU_ADD?p->owned[i].state==WN_FREE:(p->owned[i].state==WN_ACTIVE&&p->owned[i].team==a->from_team)){slot=i;break;}
 }
 if(slot==WN_MAX_OWNED)return halt(p,"no_owned_slot_for_planned_action");
 uint64_t now=p->ops.clock_ns(p->context);
 if(!now||now>UINT64_MAX-WN_CLEANUP_TIMEOUT_NS||p->next_operation_id==UINT64_MAX)return halt(p,"operation_clock_or_id_exhausted");
 p->slot_index=slot;p->to_team=a->to_team;p->action=a->type;p->operation_id=++p->next_operation_id;
 p->operation_deadline_ns=now+WN_CLEANUP_TIMEOUT_NS;p->recipient_count=p->recipient_cursor=0;
 memset(p->recipient_done,0,sizeof p->recipient_done);
 if(a->type==WU_ADD){
  const struct wu_name *existing[WN_MAX_OWNED];size_t count=0;
  for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(p->owned[i].state!=WN_FREE)existing[count++]=&p->owned[i].name;
  struct wu_name name;
  if(wu_name_generate(WU_STYLE_ANY,&p->rng,existing,count,&name)!=WU_OK)return halt(p,"name_pool_unavailable");
  if(p->next_generation==UINT64_MAX)return halt(p,"owned_generation_exhausted");
  struct wn_owned *owned=&p->owned[slot];memset(owned,0,sizeof *owned);
  owned->slot_index=slot;owned->generation=++p->next_generation;owned->world_epoch=p->world_epoch;
  owned->state=WN_RESERVED;owned->team=a->to_team;owned->name=name;next_step(p,WN_BEGIN_FINISH);
 }else next_step(p,a->type==WU_REMOVE?WN_DETACH:WN_MOVE_TEAM);
 p->phase=((a->type==WU_REMOVE&&drain_reuse(p,now))||(a->type==WU_ADD&&refill_reuse(p,now)))?WN_POOL_PREPARE_PLAN:WN_POOL_PREPARE_CENSUS;
 stage(p,p->admission_remove?"same_team_admission_remove_reserved":"owned_operation_reserved");return WN_OK;
}
static int census_fresh(const struct wn_pool *p,uint64_t now){
 return p->census.captured_ns&&now>=p->census.captured_ns&&now<p->census.valid_until_ns;
}
static int refresh_preparation(struct wn_pool *p,uint64_t now){
 p->phase=census_fresh(p,now)?WN_POOL_PREPARE_ADMISSION:WN_POOL_PREPARE_CENSUS;
 stage(p,"preparation_evidence_expired");return WN_WAIT;
}
/* In-memory validation only. The expensive read callbacks already completed in
 * their own ticks; native step performs its last-moment live witness checks. */
static int validate_prepared_plan(struct wn_pool *p){
 uint64_t now=p->ops.clock_ns(p->context);
 if(!data_fresh(p,now))return refresh_preparation(p,now);
 if(!census_valid(p,&p->census,now))return halt(p,"prepared_census_or_owned_identity_failed");
 struct wu_snapshot snapshot=core_snapshot(p);struct wu_plan plan;int lease_remove=0;
 if(pool_plan(p,&snapshot,&plan,&lease_remove)!=WU_OK)return halt(p,"fresh_plan_invalid");
 int same=plan.action.type==p->action;
 if(p->admission_remove&&!lease_remove)same=0;
 if(p->action==WU_REMOVE||p->action==WU_MOVE)same=same&&plan.action.from_team==p->owned[p->slot_index].team;
 if((p->action==WU_ADD||p->action==WU_MOVE)&&!p->admission.party_safety_verified)same=0;
 if(!same){cancel_unissued(p,"unissued_action_superseded");return WN_WAIT;}
 if(p->action==WU_ADD){p->to_team=plan.action.to_team;p->owned[p->slot_index].team=p->to_team;}
 if(p->action==WU_MOVE&&plan.action.to_team!=p->to_team){cancel_unissued(p,"unissued_move_superseded");return WN_WAIT;}
 p->last_plan=plan;return WN_OK;
}
static int mutation(enum wn_step s){return s!=WN_VERIFY_ACTIVE&&s!=WN_VERIFY_DETACHED&&s!=WN_CLEANUP;}
static int run_step(struct wn_pool *p,uint64_t gt_deadline){
 int r=before_deadline(p,gt_deadline);if(r!=WN_OK)return r;
 if(p->receipt.issued)return halt(p,"issued_step_cannot_be_reentered");
 int first=p->step==WN_BEGIN_FINISH||p->step==WN_MOVE_TEAM||p->step==WN_DETACH;
 if(first){
  r=validate_prepared_plan(p);if(r!=WN_OK)return r;
 }
 r=before_deadline(p,gt_deadline);if(r!=WN_OK)return r;
 if(mutation(p->step)&&!p->ops.publication_invalidate(p->context,p->world_epoch,WARMUP_SNAPSHOT_MUTATION_INFLIGHT))return WN_WAIT;
 if(!p->receipt.started_ns){
  if(p->next_operation_id==UINT64_MAX)return halt(p,"receipt_id_exhausted");
  p->receipt.operation_id=++p->next_operation_id;p->receipt.started_ns=p->ops.clock_ns(p->context);
 }
 const struct wn_human *recipient=NULL;const uint16_t *message=NULL;size_t units=0;
 if(p->step==WN_MESSAGE_JOIN||p->step==WN_MESSAGE_LEAVE){recipient=&p->recipients[p->recipient_cursor];message=p->message;units=p->message_units;}
 r=p->ops.step(p->context,p->world_epoch,&p->bindings,&p->owned[p->slot_index],p->step,p->to_team,recipient,message,units,p->operation_deadline_ns,&p->receipt);
 p->last_receipt=p->receipt;
 if((!p->receipt.issued&&p->receipt.engine_calls)||(!mutation(p->step)&&p->receipt.issued))return halt(p,"receipt_engine_issuance_contradiction");
 if(r==WN_WAIT){
  if(p->receipt.issued)return halt(p,"wait_after_issued_is_uncertain");
  if(first){
   /* A native live check can observe changes after our cross-tick evidence.
    * Rebuild that evidence rather than retrying with the same rejected census. */
   p->phase=WN_POOL_PREPARE_CENSUS;p->receipt.stage[0]=0;
   stage(p,"first_step_wait_rebuild_census");
  }
  return WN_WAIT;
 }
 if(r==WN_WORLD_CHANGED){
  if(p->receipt.issued)return halt(p,"world_changed_after_issued_is_uncertain");
  p->waiting_world_change=1;return WN_WORLD_CHANGED;
 }
 if(r==WN_RECIPIENT_GONE&&(p->step==WN_MESSAGE_JOIN||p->step==WN_MESSAGE_LEAVE)){
  int safely_unissued=!p->receipt.issued;
  int safely_freed=p->receipt.issued&&p->receipt.returned&&p->receipt.input_freed&&!p->receipt.process_event_calls;
  if(!safely_unissued&&!safely_freed)return halt(p,"recipient_gone_with_uncertain_input");
 }else{
  if(r!=WN_OK)return halt(p,"step_failed_no_retry");
  if(mutation(p->step)&&(!p->receipt.issued||!p->receipt.returned))return halt(p,"mutation_return_unconfirmed");
  if((p->step==WN_SET_NAME||p->step==WN_MESSAGE_JOIN||p->step==WN_MESSAGE_LEAVE)&&!p->receipt.input_freed)return halt(p,"input_ownership_release_unconfirmed");
 }
 struct wn_owned *owned=&p->owned[p->slot_index];
 switch(p->step){
  case WN_BEGIN_FINISH:
   if(!weak_valid(p->receipt.actor))return halt(p,"spawn_positive_identity_unconfirmed");
   owned->actor=p->receipt.actor;memcpy(owned->actor_header,p->receipt.actor_header,sizeof owned->actor_header);
   owned->state=WN_SPAWNED;next_step(p,WN_SET_NAME);break;
  case WN_SET_NAME:owned->state=WN_NAMED;next_step(p,WN_SET_TEAM);break;
  case WN_SET_TEAM:case WN_MOVE_TEAM:next_step(p,WN_VERIFY_ACTIVE);break;
  case WN_VERIFY_ACTIVE:owned->state=WN_ACTIVE;owned->team=p->to_team;p->phase=WN_POOL_EVENT_CENSUS;reset_receipt(p);break;
  /* Native DETACH verifies its postcondition; DESTROY independently verifies
     detached identity/links before issuing. No extra verification-only tick
     is needed in settlement draining. Normal operation stays unchanged. */
  case WN_DETACH:owned->state=WN_DETACHED;next_step(p,p->round_draining&&p->config.target==0?WN_DESTROY:WN_VERIFY_DETACHED);break;
  case WN_VERIFY_DETACHED:next_step(p,WN_DESTROY);break;
  case WN_DESTROY:owned->state=WN_DESTROYED_PENDING;next_step(p,WN_CLEANUP);break;
  case WN_CLEANUP:owned->state=WN_REMOVED_NOTIFY;p->phase=WN_POOL_EVENT_CENSUS;reset_receipt(p);break;
  case WN_MESSAGE_JOIN:case WN_MESSAGE_LEAVE:
   p->recipient_done[p->recipient_cursor]=1;++p->recipient_cursor;reset_receipt(p);p->phase=WN_POOL_MESSAGES;break;
  default:return halt(p,"unknown_step");
 }
 return WN_OK;
}
static int capture_event(struct wn_pool *p){
 p->recipient_count=p->recipient_cursor=0;memset(p->recipient_done,0,sizeof p->recipient_done);
 /* User policy: settlement cleanup is silent. Ordinary departures retain
    their per-player notifications and tombstone ownership. */
 if(p->action==WU_REMOVE&&p->round_draining&&p->config.target==0){
  release_slot(p);
  p->phase=drain_reuse(p,p->ops.clock_ns(p->context))?WN_POOL_FINAL_ADMISSION:WN_POOL_FINAL_CENSUS;
  return WN_OK;
 }
 if(p->action==WU_MOVE){p->phase=WN_POOL_FINAL_CENSUS;return WN_OK;}
 for(uint32_t i=0;i<p->census.human_count;i++){
  int duplicate=0;for(uint32_t j=0;j<p->recipient_count;j++)if(human_same(&p->census.humans[i],&p->recipients[j]))duplicate=1;
  if(!duplicate)p->recipients[p->recipient_count++]=p->census.humans[i];
 }
 if(wu_message_build(&p->owned[p->slot_index].name,p->action==WU_ADD,p->message,WU_MESSAGE_MAX_UNITS,&p->message_units)!=WU_OK)return halt(p,"message_utf16_capacity_failed");
 p->phase=WN_POOL_MESSAGES;return WN_OK;
}
int wn_pool_init(struct wn_pool *p,const struct wu_config *config,const struct warmup_native_ops *ops,void *context,uint64_t seed){
 if(!p||wu_config_validate(config)!=WU_OK||!ops||!ops->clock_ns||!ops->probe_world||!ops->world_reset||!ops->census||!ops->admission||!ops->step||!ops->publication_invalidate||!ops->publication_seal)return WN_ERROR;
 memset(p,0,sizeof *p);p->config=*config;p->ops=*ops;p->context=context;p->initialized=1;p->phase=WN_POOL_CENSUS;
 wu_rng_seed(&p->rng,seed);stage(p,"initialized_not_bound");return WN_OK;
}
int wn_pool_set_config(struct wn_pool *p,const struct wu_config *config){
 if(!p||!p->initialized||p->failed||wu_config_validate(config)!=WU_OK)return WN_ERROR;
 p->config=*config;p->controller.stable_samples=0;return WN_OK;
}
static int bind_world(struct wn_pool *p,const struct wn_world *bindings){
 if(p->world_epoch==UINT64_MAX)return halt(p,"world_epoch_exhausted");
 uint64_t old=p->world_epoch,next=old+1;
 if(!p->ops.publication_invalidate(p->context,next,WARMUP_SNAPSHOT_WORLD_RESET))return WN_WAIT;
 p->ops.world_reset(p->context,old,next,bindings);p->bindings=*bindings;p->world_epoch=next;
 memset(p->owned,0,sizeof p->owned);memset(&p->census,0,sizeof p->census);memset(&p->admission,0,sizeof p->admission);
 memset(p->recipients,0,sizeof p->recipients);memset(p->recipient_done,0,sizeof p->recipient_done);
 p->action=WU_NOOP;p->admission_remove=0;p->operation_deadline_ns=0;p->recipient_count=p->recipient_cursor=0;p->last_census_sample=0;
 p->waiting_world_change=0;p->phase=WN_POOL_CENSUS;wu_controller_reset(&p->controller);reset_receipt(p);
 stage(p,"world_bound_old_refs_discarded");return WN_WORLD_CHANGED;
}
static int pool_tick_until(struct wn_pool *p,uint64_t gt_deadline){
 if(!p||!p->initialized||!gt_deadline)return WN_ERROR;
 if(p->failed){(void)p->ops.publication_invalidate(p->context,p->world_epoch,WARMUP_SNAPSHOT_DRIFT);return WN_DRIFT;}
 uint64_t now=p->ops.clock_ns(p->context);if(!now)return halt(p,"invalid_gt_clock_budget");
 if(now>=gt_deadline)return WN_WAIT;
 if(operation_expired(p,now))return halt(p,"operation_original_deadline_expired");
 struct wn_world bindings;memset(&bindings,0,sizeof bindings);
 int r=p->ops.probe_world(p->context,&bindings);
 if(r==WN_WAIT)return WN_WAIT;
 if(r!=WN_OK||!world_valid(&bindings))return halt(p,"world_probe_drift");
 if(!p->world_epoch||!world_same(&p->bindings,&bindings))return bind_world(p,&bindings);
 if(p->waiting_world_change){stage(p,"waiting_confirmed_world_replacement");return WN_WAIT;}
 switch(p->phase){
  case WN_POOL_CENSUS:
   r=read_census(p,gt_deadline);if(r==WN_OK){p->phase=WN_POOL_ADMISSION;stage(p,"census_confirmed");}return r;
  case WN_POOL_ADMISSION:
   if(now>=p->census.valid_until_ns){p->phase=WN_POOL_CENSUS;return WN_WAIT;}
   r=read_admission(p,gt_deadline);if(r==WN_OK)p->phase=WN_POOL_PLAN;return r;
  case WN_POOL_PLAN:{
   if(!data_fresh(p,now)){p->phase=census_fresh(p,now)?WN_POOL_ADMISSION:WN_POOL_CENSUS;return WN_WAIT;}
   struct wu_snapshot snapshot=core_snapshot(p);struct wu_plan plan;int lease_remove=0;
   if(pool_plan(p,&snapshot,&plan,&lease_remove)!=WU_OK)return halt(p,"core_snapshot_rejected");
   r=seal_or_invalidate(p,&plan);if(r!=WN_OK)return r;
   if((plan.action.type==WU_ADD||plan.action.type==WU_MOVE)&&!p->admission.party_safety_verified){
    p->last_plan=plan;p->last_plan.action=(struct wu_action){WU_NOOP,0,0};p->controller.stable_samples=0;
    p->phase=WN_POOL_CENSUS;stage(p,"party_safety_not_verified_no_add_move");return WN_WAIT;
   }
   if(lease_remove||(plan.action.type==WU_REMOVE&&drain_reuse(p,now))){
    p->last_plan=plan;p->admission_remove=lease_remove;p->controller.awaiting_resolution=1;
    p->controller.emitted_sample_id=snapshot.sample_id;p->controller.stable_samples=0;
   }else{
    p->admission_remove=0;
    if(wu_controller_next(&p->controller,&p->config,&snapshot,&p->last_plan)!=WU_OK)return halt(p,"controller_rejected");
   }
   if(p->last_plan.action.type==WU_NOOP){p->phase=WN_POOL_CENSUS;stage(p,wu_reason_name(p->last_plan.reason));return WN_OK;}
   return start_operation(p,&p->last_plan.action);
  }
  case WN_POOL_STEP:return run_step(p,gt_deadline);
  case WN_POOL_PREPARE_CENSUS:
   r=read_census(p,gt_deadline);
   if(r==WN_OK){p->phase=WN_POOL_PREPARE_ADMISSION;stage(p,"preparation_census_confirmed");}
   return r;
  case WN_POOL_PREPARE_ADMISSION:
   if(!census_fresh(p,now)){p->phase=WN_POOL_PREPARE_CENSUS;return WN_WAIT;}
   r=read_admission(p,gt_deadline);
   if(r==WN_OK){p->phase=WN_POOL_PREPARE_PLAN;stage(p,"preparation_admission_confirmed");}
   return r;
  case WN_POOL_PREPARE_PLAN:
   r=validate_prepared_plan(p);
   if(r==WN_OK){p->phase=WN_POOL_STEP;stage(p,"preparation_plan_confirmed");}
   return r;
  case WN_POOL_EVENT_CENSUS:
   r=read_census(p,gt_deadline);return r==WN_OK?capture_event(p):r;
  case WN_POOL_MESSAGES:
   if(p->recipient_cursor>=p->recipient_count){
    if(p->action==WU_REMOVE)release_slot(p);
    /* Event census already observed cleanup. Reuse it only within its original
       validity window; never manufacture or extend a snapshot. */
    p->phase=((p->action==WU_REMOVE&&drain_reuse(p,now))||(p->action==WU_ADD&&refill_reuse(p,now)))?WN_POOL_FINAL_ADMISSION:WN_POOL_FINAL_CENSUS;return WN_OK;
   }
   if(p->recipient_done[p->recipient_cursor])return halt(p,"duplicate_recipient_dispatch_rejected");
   p->step=p->action==WU_ADD?WN_MESSAGE_JOIN:WN_MESSAGE_LEAVE;p->phase=WN_POOL_STEP;
   return run_step(p,gt_deadline);
  case WN_POOL_FINAL_CENSUS:
   r=read_census(p,gt_deadline);
   if(r==WN_OK){p->phase=WN_POOL_FINAL_ADMISSION;stage(p,"final_census_confirmed");}
   return r;
  case WN_POOL_FINAL_ADMISSION:
   if(!census_fresh(p,now)){p->phase=WN_POOL_FINAL_CENSUS;return WN_WAIT;}
   r=read_admission(p,gt_deadline);
   if(r==WN_OK){p->phase=WN_POOL_FINAL_SEAL;stage(p,"final_admission_confirmed");}
   return r;
  case WN_POOL_FINAL_SEAL:{
   if(!data_fresh(p,now)){
    p->phase=census_fresh(p,now)?WN_POOL_FINAL_ADMISSION:WN_POOL_FINAL_CENSUS;
    stage(p,"final_evidence_expired");return WN_WAIT;
   }
   if(!census_valid(p,&p->census,now))return halt(p,"final_census_or_owned_identity_failed");
   struct wu_snapshot snapshot=core_snapshot(p);struct wu_plan plan;
   if(wu_make_plan(&p->config,&snapshot,NULL,&plan)!=WU_OK)return halt(p,"final_snapshot_rejected");
   r=seal_or_invalidate(p,&plan);if(r!=WN_OK)return r;
   int reuse=p->action==WU_REMOVE&&p->census.owned_count>0&&drain_reuse(p,now);
   p->last_plan=plan;finish_operation(p);
   if(reuse)p->phase=WN_POOL_PLAN;
   return WN_OK;
  }
  case WN_POOL_HALTED:return WN_DRIFT;
  default:return halt(p,"unknown_pool_phase");
 }
}
int wn_pool_tick(struct wn_pool *p,uint64_t budget){
 if(!p||!p->initialized||!budget)return WN_ERROR;
 uint64_t now=p->ops.clock_ns(p->context);
 if(!now||now>UINT64_MAX-budget)return halt(p,"invalid_gt_clock_budget");
 return pool_tick_until(p,now+budget);
}
int wn_pool_progress_tick(struct wn_pool *p,uint64_t budget){
 if(!p||!p->initialized||!budget)return WN_ERROR;
 p->refill_fast=1;
 uint64_t now=p->ops.clock_ns(p->context);
 if(!now||now>UINT64_MAX-budget)return halt(p,"invalid_gt_clock_budget");
 const uint64_t deadline=now+budget;int result=WN_WAIT;
 for(unsigned turn=0;turn<32;turn++){
  if(p->ops.clock_ns(p->context)>=deadline)break;
  enum wn_pool_phase before=p->phase;
  int native_step=before==WN_POOL_STEP||(before==WN_POOL_MESSAGES&&p->recipient_cursor<p->recipient_count);
  result=pool_tick_until(p,deadline);
  if(result<0||result==WN_WORLD_CHANGED||native_step)break;
  if(result==WN_WAIT&&p->phase==before)break;
  if(p->phase==WN_POOL_CENSUS&&p->action==WU_NOOP)break;
 }
 return result;
}
/* Up to four verified steps within ONE original deadline. Never extend it. */
int wn_pool_burst_tick(struct wn_pool *p,uint64_t budget){
 if(!p||!p->initialized||!budget)return WN_ERROR;
 uint64_t start=p->ops.clock_ns(p->context);
 if(!start||start>UINT64_MAX-budget)return halt(p,"invalid_gt_clock_budget");
 uint64_t deadline=start+budget;int r=WN_WAIT;
 for(unsigned i=0;i<4;i++){
  uint64_t now=p->ops.clock_ns(p->context);if(now>=deadline)break;
  r=wn_pool_progress_tick(p,deadline-now);
  if(r!=WN_OK||p->round_draining||(p->phase==WN_POOL_CENSUS&&p->action==WU_NOOP))break;
 }
 return r;
}
int wn_pool_drain_tick(struct wn_pool *p,uint64_t budget){
 if(!p||!p->initialized||!budget)return WN_ERROR;
 if(!p->round_draining||p->config.target)return wn_pool_tick(p,budget);
 return wn_pool_progress_tick(p,budget);
}
void wn_pool_get_status(const struct wn_pool *p,struct wn_pool_status *out){
 if(!p||!out)return;
 memset(out,0,sizeof *out);
 out->world_epoch=p->world_epoch;out->operation_id=p->operation_id;out->operation_deadline_ns=p->operation_deadline_ns;out->snapshot_revision=p->snapshot_revision;
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){if(p->owned[i].state==WN_ACTIVE)++out->active_owned;if(p->owned[i].state!=WN_FREE)++out->name_reservations;}
 out->recipient_count=p->recipient_count;out->recipient_cursor=p->recipient_cursor;out->phase=p->phase;out->step=p->step;out->failed=p->failed;out->waiting_world_change=p->waiting_world_change;out->party_safety_verified=p->admission.party_safety_verified;
 out->H_total=p->census.human_count;out->B_actual=p->census.owned_count;out->unknown=p->census.unknown;out->inflight_slots=p->admission.inflight_slots;out->admission_remove=p->admission_remove;
 for(uint32_t i=0;i<2;i++){out->team_total[i]=p->census.team_total[i];out->owned_team[i]=p->census.owned_team[i];out->team_deficit[i]=p->admission.team_deficit[i];}
 out->plan=p->last_plan;out->last_receipt=p->last_receipt;(void)snprintf(out->stage,sizeof out->stage,"%s",p->stage);
}
