/* Integrated dynamic backend: current World only; no registry from names. */
struct ue_owned_state {int present;uint64_t epoch,generation;struct fresh_actor fresh;struct wu_name name;uint32_t team,state;};
struct ue_census_work {int active;uint32_t cursor,count;up players[100],team_items[2][100];uint32_t team_count[2];struct wn_census result;};
struct ue_context {
 uint64_t epoch,sample_id;struct wn_world bindings;struct identity teams[2],session_class;
 struct ue_owned_state owned[WN_MAX_OWNED];struct ue_census_work scan;
 int guard_ready;struct message_witness guard;
};
static struct ue_context ue;
static int message_function(const struct table *,struct identity *);
static int ue_note(int result,const char *stage){atomic_store(&ue_error,stage);return result;}
static struct identity ue_id(struct warmup_native_weak_v1 i){return (struct identity){i.address,i.index,i.serial,0};}
static struct warmup_native_weak_v1 ue_weak(struct identity i){return (struct warmup_native_weak_v1){i.address,i.index,i.serial};}
static int ue_same_weak(struct warmup_native_weak_v1 a,struct warmup_native_weak_v1 b){return a.address==b.address&&a.index==b.index&&a.serial==b.serial;}
static int ue_same_world(const struct wn_world *a,const struct wn_world *b){return ue_same_weak(a->world,b->world)&&ue_same_weak(a->game_state,b->game_state)&&ue_same_weak(a->game_mode,b->game_mode)&&ue_same_weak(a->game_session,b->game_session);}
static int ue_main(void){return process_id>0&&(long)syscall(SYS_gettid)==(long)process_id;}
static int ue_property(const struct table *t,up cls,const char *name,int offset,const char *owner,const char *target,struct field *out){
 return cleanup_find_field(t,cls,name,"ObjectProperty",8,offset,out)&&meta_named(t,out->declaring_class,"Class","/Script/Engine",owner)&&target_matches(t,out,target);
}
static int ue_probe(void *context,struct wn_world *out){
 (void)context;if(!ue_main()||!out||!atomic_load(&backend_initialized))return WN_ERROR;
 struct table t;struct identity w,g,m,s;struct obj wh,gh,mh,sh;up world=active_world(),gs,gm,session,level,back;
 if(!world||!table_read(&t)||!identity(&t,world,&w)||!hdr(world,&wh)||!meta_named(&t,wh.cls,"Class","/Script/Engine","World"))return WN_WAIT;
 if(!rd(world+0x1e0,&gs,8)||!rd(world+0x1d8,&gm,8)||!rd(world+0x30,&level,8)||!identity(&t,gs,&g)||!identity(&t,gm,&m)||!hdr(gs,&gh)||!hdr(gm,&mh)||gh.outer!=level||mh.outer!=level||!rd(level+0x20,&back,8)||back!=world||!rd(gs+0x2c0,&back,8)||back!=gm||!rd(gm+0x318,&back,8)||back!=gs||!rd(gm+0x310,&session,8)||!identity(&t,session,&s)||!hdr(session,&sh)||!in_world(session,world))return WN_WAIT;
 *out=(struct wn_world){ue_weak(w),ue_weak(g),ue_weak(m),ue_weak(s)};return WN_OK;
}
static int ue_world_live(uint64_t epoch,const struct wn_world *bindings){
 struct wn_world now;if(!ue_main()||warmup_control_failed()||!epoch||epoch!=ue.epoch||!bindings||!ue_same_world(bindings,&ue.bindings))return WN_DRIFT;
 int r=ue_probe(NULL,&now);if(r!=WN_OK)return r;
 if(!ue_same_weak(now.world,bindings->world))return WN_WORLD_CHANGED;
 return ue_same_world(&now,bindings)?WN_OK:WN_DRIFT;
}
static int ue_message_world_live(uint64_t epoch,const struct wn_world *bindings){
 if(!ue_main()||warmup_control_failed()||!callback_epoch||!atomic_load(&transaction_active)||atomic_load(&reentry_detected))return WN_DRIFT;
 return ue_world_live(epoch,bindings);
}
static int ue_snapshot_live(const struct warmup_native_snapshot_v1 *s){
 if(!s||!ue_main()||atomic_load(&transaction_active)||atomic_load(&reentry_detected)||s->world_epoch!=ue.epoch)return 0;
 struct wn_world expected={s->world,s->game_state,s->game_mode,s->game_session},now;
 return ue_probe(NULL,&now)==WN_OK&&ue_same_world(&expected,&now);
}
static void ue_reset(void *context,uint64_t old_epoch,uint64_t new_epoch,const struct wn_world *bindings){
 (void)context;(void)old_epoch;if(!ue_main()||!bindings||new_epoch<=ue.epoch)return;
 /* Discard pure memory only. No old actor/World is dereferenced or destroyed. */
 memset(&ue,0,sizeof ue);ue.epoch=new_epoch;ue.bindings=*bindings;
 once_binding.world=ue_id(bindings->world);once_binding.gs=ue_id(bindings->game_state);once_binding.gm=ue_id(bindings->game_mode);once_binding.state_class=(struct identity){0};once_binding.team=(struct identity){0};
}
static int ue_read_array(up owner,unsigned offset,up *items,uint32_t *count){
 struct array_header a,b;up second[100];
 if(!rd(owner+offset,&a,sizeof a)||a.count<0||a.count>100||a.capacity<a.count||a.capacity>4096||(a.count&&(!a.data||(a.data&7))))return WN_DRIFT;
 size_t bytes=8UL*(unsigned)a.count;
 if(bytes&&(!rd(a.data,items,bytes)||!rd(a.data,second,bytes)||memcmp(items,second,bytes)))return WN_WAIT;
 if(!rd(owner+offset,&b,sizeof b)||memcmp(&a,&b,sizeof a))return WN_WAIT;
 for(int i=0;i<a.count;i++){if(!items[i])return WN_DRIFT;for(int j=0;j<i;j++)if(items[i]==items[j])return WN_DRIFT;}
 *count=(uint32_t)a.count;return WN_OK;
}
static int ue_occurrences(const up *items,uint32_t count,up needle){int found=0;for(uint32_t i=0;i<count;i++)if(items[i]==needle)found++;return found;}
static int ue_bind_runtime(const struct table *t,uint32_t *capacity){
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!stable_metadata(t,classes[i].id))return ue_note(WN_WAIT,"metadata_named_class_cache_unavailable");
 struct obj gm,session;struct field f;up configured,session_pointer;int32_t maxplayers;
 if(!hdr(ue.bindings.game_mode.address,&gm)||!ue_property(t,gm.cls,"GameSession",0x310,"GameModeBase","GameSession",&f)||!rd(ue.bindings.game_mode.address+(unsigned)f.offset,&session_pointer,8)||session_pointer!=ue.bindings.game_session.address||!hdr(session_pointer,&session)||!derives(session.cls,ptr(f.descriptor+0x70)))return ue_note(WN_DRIFT,"game_session_property_or_live_link_gate");
 if(!object_property_pointer(ue.bindings.game_mode.address,gm.cls,"PlayerStateClass","ClassProperty",&configured)||!metadata_identity(t,configured,&once_binding.state_class)||!meta_named(t,configured,"Class","/Script/Squad","SQPlayerState")||!derives(configured,classes[2].id.address))return ue_note(WN_WAIT,"configured_player_state_class_gate");
 uint32_t flags;if(!rd(configured+0xd4,&flags,4)||(flags!=0x30d002a4U&&flags!=0x30d00aa4U)||(flags&0x02000001U)||!passive_class_fields(t,configured))return ue_note(WN_DRIFT,"configured_state_flags_or_passive_properties");
 if(!resolve_team(t,ue.bindings.game_state.address,ue.bindings.world.address,1,&ue.teams[0])||!resolve_team(t,ue.bindings.game_state.address,ue.bindings.world.address,2,&ue.teams[1]))return ue_note(WN_WAIT,"team_states_or_typed_arrays_unavailable");
 once_binding.team=ue.teams[0];
 if(!cleanup_find_field(t,session.cls,"MaxPlayers","IntProperty",4,-1,&f)||!meta_named(t,f.declaring_class,"Class","/Script/Engine","GameSession")||!rd(session_pointer+(unsigned)f.offset,&maxplayers,4)||maxplayers<1||maxplayers>100)return ue_note(WN_DRIFT,"native_max_players_property_gate");
 *capacity=(uint32_t)maxplayers;return ue_note(WN_OK,"runtime_bindings_confirmed");
}
static struct identity ue_fresh_meta(const struct table *t,const char *owner,const char *name){struct identity cached=cached_meta(owner,name),fresh={0};if(cached.address)metadata_identity(t,cached.address,&fresh);return fresh;}
static int ue_common_abi(const struct table *t){
 struct identity begin=ue_fresh_meta(t,"GameplayStatics","BeginDeferredActorSpawnFromClass"),finish=ue_fresh_meta(t,"GameplayStatics","FinishSpawningActor"),destroy=ue_fresh_meta(t,"Actor","K2_DestroyActor"),name=ue_fresh_meta(t,"SQPlayerState","BlueprintSetPlayerName"),team=ue_fresh_meta(t,"SQPlayerState","SetTeamState");
 struct identity collision_id={0},scale_id={0};
 if(!metadata_identity(t,current.collision_enum.address,&collision_id)||!metadata_identity(t,current.scale_enum.address,&scale_id))return ue_note(WN_WAIT,"spawn_enum_metadata_unavailable");
 static const char *const collision[]={"Undefined","AlwaysSpawn","AdjustIfPossibleButAlwaysSpawn","AdjustIfPossibleButDontSpawnIfColliding","DontSpawnIfColliding","ESpawnActorCollisionHandlingMethod_MAX"};
 static const char *const scale[]={"OverrideRootScale","MultiplyWithRoot","SelectDefaultAtRuntime","ESpawnActorScaleMethod_MAX"};
 if(!begin.address||!finish.address||!destroy.address||!name.address||!team.address)return WN_WAIT;
 if(!fresh_function(t,begin,"GameplayStatics","BeginDeferredActorSpawnFromClass",79832067U,144,136,0x7ec8720,begin_fields,7)||!fresh_function(t,finish,"GameplayStatics","FinishSpawningActor",79832067U,128,120,0x7ece0d0,finish_fields,4)||!fresh_function(t,destroy,"Actor","K2_DestroyActor",67240962U,0,65535,0x7a068e0,NULL,0)||!fresh_name_function(t,name)||!fresh_team_function(t,team,0)||!fresh_struct(t,"Vector",24,vector_fields,3)||!fresh_struct(t,"Quat",32,quat_fields,4)||!fresh_struct(t,"Transform",96,transform_fields,3)||!enum_values(t,collision_id,"ESpawnActorCollisionHandlingMethod",collision,6)||!enum_values(t,scale_id,"ESpawnActorScaleMethod",scale,4)||!naming_code_matches())return WN_WAIT;
 struct identity cdo;struct obj h;if(!metadata_identity(t,current.gameplay_cdo.address,&cdo)||!hdr(cdo.address,&h)||h.cls!=classes[5].id.address||!(h.flags&0x10U)||!named(cdo.address,"Default__GameplayStatics")||!named(h.outer,"/Script/Engine")||ptr(h.vptr+0x268)!=BASE_PROCESS_EVENT)return WN_WAIT;
 struct identity message;if(!message_function(t,&message))return WN_WAIT;
 return WN_OK;
}
static int ue_guard_property(const struct table *t,up cls,const char *name,const char *kind,int width,int offset,struct message_witness *w){
 struct field f;up next;
 if(!cleanup_find_field(t,cls,name,kind,width,offset,&f)||!message_add_field(t,&f,0,w))return 0;
 if(!strcmp(kind,"ArrayProperty")){struct field inner;up at;if(!rd(f.descriptor+0x78,&at,8)||!field_read(at,&inner,&next)||strcmp(inner.type,"ObjectProperty")||inner.size!=8||!message_add_field(t,&inner,0,w))return 0;}
 return 1;
}
static int ue_guard_bytes(up at,size_t bytes,struct message_witness *w){
 if(!bytes||bytes>256||w->bytes_count>=8)return 0;
 struct message_bytes_witness value={.address=at,.size=bytes};unsigned char after[256];
 if(!rd(at,value.raw,bytes)||!rd(at,after,bytes)||memcmp(value.raw,after,bytes))return 0;
 w->bytes[w->bytes_count++]=value;return 1;
}
static int ue_guard_rpc(const struct table *t,struct message_witness *w){
 struct identity fn=cached_meta("SQPlayerController","ClientSystemMessage"),color=cached_meta("/Script/CoreUObject","LinearColor"),enumeration=current.notification_enum;
 if(!stable_metadata(t,fn)||!stable_metadata(t,color)||!stable_metadata(t,enumeration))return 0;
 if(!ue_guard_bytes(fn.address+0x50,16,w)||!ue_guard_bytes(fn.address+0xb0,10,w)||!ue_guard_bytes(fn.address+0xd8,8,w)||!ue_guard_bytes(color.address+0x50,8,w)||!ue_guard_bytes(color.address+0x58,4,w)||!ue_guard_bytes(enumeration.address+0x40,20,w))return 0;
 up names,values,at;int32_t count;
 if(!rd(enumeration.address+0x40,&names,8)||!rd(enumeration.address+0x48,&values,8)||!rd(enumeration.address+0x50,&count,4)||count!=MESSAGE_ENUM_COUNT||count<1||count>32)return 0;
 names&=~UINT64_C(1);values&=~UINT64_C(1);
 if(!ue_guard_bytes(names,8UL*(unsigned)count,w)||!ue_guard_bytes(values,8UL*(unsigned)count,w)||!rd(fn.address+0x50,&at,8))return 0;
 for(int i=0;i<4;i++){
  struct field f;up next;if(!at||!field_read(at,&f,&next)||!message_add_field(t,&f,0,w))return 0;
  if(i==3){struct field inner;up underlying,unused;if(!rd(at+0x70,&underlying,8)||!field_read(underlying,&inner,&unused)||!message_add_field(t,&inner,0,w))return 0;}
  at=next;
 }
 if(at||!rd(color.address+0x50,&at,8))return 0;
 for(int i=0;i<4;i++){struct field f;up next;if(!at||!field_read(at,&f,&next)||!message_add_field(t,&f,0,w))return 0;at=next;}
 return at==0;
}
static int ue_metadata_anchor_gate(const struct table *t,const struct message_witness *w){
 if(!ue_main()||warmup_control_failed()||!w||w->anchor.world_epoch!=ue.epoch)return MESSAGE_DRIFT;
 const struct warmup_native_weak_v1 current_roots[4]={ue.bindings.world,ue.bindings.game_state,ue.bindings.game_mode,ue.bindings.game_session};
 for(int i=0;i<4;i++)if(current_roots[i].address!=w->anchor.roots[i].address||current_roots[i].index!=w->anchor.roots[i].index||current_roots[i].serial!=w->anchor.roots[i].serial)return MESSAGE_DRIFT;
 up world=active_world();if(!world)return MESSAGE_WAIT;
 return ue_metadata_anchor_validate(t,&w->anchor,ue.epoch,world);
}
static int ue_guard_anchor_ready(const struct table *t,const struct message_witness *w){
 int r=ue_metadata_anchor_gate(t,w);
 return r==MESSAGE_READY?WN_OK:ue_note(r==MESSAGE_WAIT?WN_WAIT:WN_DRIFT,"world_metadata_current_root_anchor_failed");
}
static int ue_guard_capture(const struct table *t){
 struct message_witness w={0};struct obj world,gs,gm,session,team;struct identity fn;
 if(!hdr(ue.bindings.world.address,&world)||!hdr(ue.bindings.game_state.address,&gs)||!hdr(ue.bindings.game_mode.address,&gm)||!hdr(ue.bindings.game_session.address,&session)||!hdr(ue.teams[0].address,&team))return WN_WAIT;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!message_add_class(t,classes[i].id.address,&w))return WN_WAIT;
 if(!message_add_class(t,world.cls,&w)||!message_add_class(t,gs.cls,&w)||!message_add_class(t,gm.cls,&w)||!message_add_class(t,session.cls,&w)||!message_add_class(t,team.cls,&w)||!message_add_class(t,once_binding.state_class.address,&w)||!message_add_chain(t,current.gameplay_cdo.address,&w)||!message_add_chain(t,current.collision_enum.address,&w)||!message_add_chain(t,current.scale_enum.address,&w))return ue_note(WN_WAIT,"world_class_cdo_enum_witness_capture");
 for(int i=0;i<current.function_count;i++)if(!message_add_chain(t,current.functions[i].id.address,&w))return WN_WAIT;
 if(!ue_guard_property(t,world.cls,"GameState","ObjectProperty",8,0x1e0,&w)||!ue_guard_property(t,world.cls,"AuthorityGameMode","ObjectProperty",8,0x1d8,&w)||!ue_guard_property(t,world.cls,"PersistentLevel","ObjectProperty",8,0x30,&w)||!ue_guard_property(t,gs.cls,"AuthorityGameMode","ObjectProperty",8,0x2c0,&w)||!ue_guard_property(t,gm.cls,"GameState","ObjectProperty",8,0x318,&w)||!ue_guard_property(t,gm.cls,"PlayerStateClass","ClassProperty",8,-1,&w)||!ue_guard_property(t,gm.cls,"GameSession","ObjectProperty",8,0x310,&w)||!ue_guard_property(t,session.cls,"MaxPlayers","IntProperty",4,-1,&w)||!ue_guard_property(t,gs.cls,"PlayerArray","ArrayProperty",16,0x2d0,&w)||!ue_guard_property(t,gs.cls,"IndexedTeamStates","ArrayProperty",16,0x3c8,&w)||!ue_guard_property(t,gs.cls,"TeamStates","ArrayProperty",16,0x3b8,&w)||!ue_guard_property(t,team.cls,"PlayerStates","ArrayProperty",16,0x398,&w)||!ue_guard_property(t,team.cls,"ID","IntProperty",4,0x2e0,&w))return WN_WAIT;
 struct field relations[4];
 if(!ue_property(t,classes[2].id.address,"Owner",0x158,"Actor","Actor",&relations[0])||!ue_property(t,classes[3].id.address,"PlayerState",0x2c0,"Controller","PlayerState",&relations[1])||!ue_property(t,classes[3].id.address,"Player",0x358,"PlayerController","Player",&relations[2])||!ue_property(t,classes[3].id.address,"NetConnection",0x530,"PlayerController","NetConnection",&relations[3]))return WN_WAIT;
 for(int i=0;i<4;i++)if(!message_add_field(t,&relations[i],1,&w))return WN_WAIT;
 if(!ue_guard_property(t,once_binding.state_class.address,"Owner","ObjectProperty",8,0x158,&w)||!ue_guard_property(t,once_binding.state_class.address,"PawnPrivate","ObjectProperty",8,0x330,&w)||!ue_guard_property(t,once_binding.state_class.address,"CurrentPawn","ObjectProperty",8,0x7b0,&w)||!ue_guard_property(t,once_binding.state_class.address,"TeamState","ObjectProperty",8,0x780,&w)||!ue_guard_property(t,once_binding.state_class.address,"SquadState","ObjectProperty",8,0x788,&w)||!ue_guard_property(t,once_binding.state_class.address,"TeamId","IntProperty",4,0x4b0,&w)||!ue_guard_property(t,once_binding.state_class.address,"PlayerNamePrivate","StrProperty",16,0x348,&w))return WN_WAIT;
 if(!message_function(t,&fn)||!message_add_chain(t,current.notification_enum.address,&w)||!ue_guard_rpc(t,&w))return WN_WAIT;
 /* Every type-class and complete outer chain is itself pinned, including
  * Package/Function metadata types, before any serial may later be promoted. */
 for(int i=0;i<w.node_count;i++)if(!message_add_class(t,w.nodes[i].header.cls,&w))return WN_WAIT;
 struct identity roots[4]={ue_id(ue.bindings.world),ue_id(ue.bindings.game_state),ue_id(ue.bindings.game_mode),ue_id(ue.bindings.game_session)};
 if(ue_metadata_anchor_capture(t,ue.epoch,roots,&w.anchor)!=MESSAGE_READY)return ue_note(WN_WAIT,"metadata_current_root_capture_wait");
 const struct message_node *world_class=ue_metadata_node_at(&w,w.anchor.headers[0].cls),*engine_package=ue_metadata_node_at(&w,w.engine_package);
 if(!world_class||!engine_package||!uclass_metaclass(t,w.anchor.headers[1].cls)||!uclass_metaclass(t,w.anchor.headers[2].cls))return ue_note(WN_WAIT,"metadata_anchor_typed_root_classes_wait");
 w.anchor.native_class=world_class->header.cls;w.anchor.package_class=engine_package->header.cls;
 if(!meta_named(t,w.anchor.native_class,"Class","/Script/CoreUObject","Class")||!meta_named(t,w.anchor.package_class,"Class","/Script/CoreUObject","Package")||ue_metadata_roles_build(&w,w.roles)!=MESSAGE_READY)return ue_note(WN_WAIT,"metadata_anchor_class_package_roles_wait");
 struct message_witness second;if(!w.engine_package||message_witness_double(t,&w,0,&second)!=MESSAGE_READY)return WN_WAIT;
 ue.guard=second;ue.guard_ready=1;return WN_OK;
}
static int ue_cache_identity(const struct table *t,const struct message_witness *w,up address,struct identity *out){
 const struct message_node *n=ue_metadata_node_at(w,address);struct identity fresh;
 if(!n||!metadata_identity(t,address,&fresh))return WN_WAIT;
 if(fresh.address!=n->address||fresh.index!=n->header.index)return WN_DRIFT;
 if(fresh.serial!=n->serial)return n->serial==0&&fresh.serial>0?WN_WAIT:WN_DRIFT;
 *out=fresh;return WN_OK;
}
static int ue_cache_matches_witness(const struct message_witness *w,struct identity id){
 if(!id.address||!id.metadata_fingerprint)return 0;
 uint64_t fingerprint=UINT64_C(1469598103934665603);up at=id.address,seen[8];int count=0;
 while(at&&count<8){
  for(int i=0;i<count;i++)if(seen[i]==at)return 0;
  seen[count++]=at;const struct message_node *n=ue_metadata_node_at(w,at);if(!n)return 0;
  if(at==id.address&&(id.index!=n->header.index||id.serial!=n->serial))return 0;
  fingerprint=hash_bytes(fingerprint,&at,sizeof at);fingerprint=hash_bytes(fingerprint,&n->header,sizeof n->header);fingerprint=hash_bytes(fingerprint,&n->serial,sizeof n->serial);at=n->header.outer;
 }
 return !at&&id.metadata_fingerprint==(fingerprint?fingerprint:1);
}
static int ue_guard_live(const struct table *t){
 if(!ue.guard_ready){int capture=ue_guard_capture(t);if(capture!=WN_OK)atomic_store(&ue_error,"world_metadata_witness_capture_wait");return capture;}
 struct message_witness candidate,confirm;int r=message_witness_double(t,&ue.guard,1,&candidate);
 if(r==MESSAGE_DRIFT)return ue_note(WN_DRIFT,"world_metadata_witness_structure_or_serial_drift");
 if(r==MESSAGE_WAIT)return ue_note(WN_WAIT,"world_metadata_witness_read_unavailable");
 int cache_present=1;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!ue_cache_matches_witness(&candidate,classes[i].id))cache_present=0;
 if(current.function_count<0||current.function_count>MAX_FUNCTIONS)return WN_DRIFT;
 for(int i=0;i<current.function_count;i++)if(!ue_cache_matches_witness(&candidate,current.functions[i].id))cache_present=0;
 struct identity *special_old[5]={&current.gameplay_cdo,&current.collision_enum,&current.scale_enum,&current.notification_enum,&once_binding.state_class};
 for(int i=0;i<5;i++)if(!ue_cache_matches_witness(&candidate,*special_old[i]))cache_present=0;
 if(cache_present&&message_witness_equal(&ue.guard,&candidate)){
  r=ue_world_live(ue.epoch,&ue.bindings);return r==WN_OK?ue_guard_anchor_ready(t,&candidate):r;
 }
 struct identity class_ids[6],function_ids[MAX_FUNCTIONS],special[5];
 if(current.function_count<0||current.function_count>MAX_FUNCTIONS)return WN_DRIFT;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++){
  up at=classes[i].id.address;
  if(!at){for(int j=0;j<candidate.node_count;j++)if(named(candidate.nodes[j].address,classes[i].name)&&named(candidate.nodes[j].header.outer,classes[i].package)&&named(candidate.nodes[j].header.cls,"Class")){if(at)return WN_DRIFT;at=candidate.nodes[j].address;}}
  r=ue_cache_identity(t,&candidate,at,&class_ids[i]);if(r!=WN_OK)return r;
 }
 for(int i=0;i<current.function_count;i++){r=ue_cache_identity(t,&candidate,current.functions[i].id.address,&function_ids[i]);if(r!=WN_OK)return r;}
 for(int i=0;i<5;i++){r=ue_cache_identity(t,&candidate,special_old[i]->address,&special[i]);if(r!=WN_OK)return r;}
 r=message_witness_double(t,&candidate,0,&confirm);
 if(r!=MESSAGE_READY)return ue_note(r==MESSAGE_DRIFT?WN_DRIFT:WN_WAIT,"metadata_changed_during_cache_candidate");
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_WORLD_CHANGED;
 r=ue_guard_anchor_ready(t,&confirm);if(r!=WN_OK)return r;
 /* All graph and cache candidates are complete. No main state is changed
  * before these checks; gameplay weak references are never rebound here. */
 ue.guard=confirm;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)classes[i].id=class_ids[i];
 for(int i=0;i<current.function_count;i++)current.functions[i].id=function_ids[i];
 for(int i=0;i<5;i++)*special_old[i]=special[i];
 return WN_OK;
}
static int ue_metadata_cache_barrier(const struct table *t){
 if(!ue.guard_ready)return WN_OK;
 int r=ue_guard_anchor_ready(t,&ue.guard);if(r!=WN_OK)return r;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!stable_metadata(t,classes[i].id))return ue_guard_live(t);
 return WN_OK;
}
static int ue_own_name(const struct ue_owned_state *state){
 if(!state||!state->name.unit_count||state->name.unit_count>WU_NAME_STORAGE_UNITS||state->name.units[state->name.unit_count-1])return 0;
 struct engine_string a,b;uint16_t units[WU_NAME_STORAGE_UNITS];
 return rd(state->fresh.address+0x348,&a,sizeof a)&&a.num==(int32_t)state->name.unit_count&&a.capacity>=a.num&&a.capacity<=1024&&a.data>=0x10000&&!(a.data&1)&&rd(a.data,units,state->name.unit_count*2)&&!memcmp(units,state->name.units,state->name.unit_count*2)&&rd(state->fresh.address+0x348,&b,sizeof b)&&!memcmp(&a,&b,sizeof a);
}
static int ue_own_verify(const struct table *t,const struct wn_owned *owned,int expected_team){
 if(!owned||owned->slot_index>=WN_MAX_OWNED||expected_team<0||expected_team>2)return ue_note(WN_DRIFT,"own_slot_or_expected_team_invalid");
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->epoch!=ue.epoch||s->generation!=owned->generation)return ue_note(WN_DRIFT,"own_registry_generation_mismatch");
 if(!ue_same_weak(owned->actor,ue_weak((struct identity){s->fresh.address,s->fresh.header.index,s->fresh.serial,0})))return ue_note(WN_DRIFT,"own_registry_positiveweak_mismatch");
 if(!held_actor_same(t,&s->fresh))return ue_note(WN_DRIFT,"own_live_positiveweak_or_header_mismatch");
 if(!wu_name_equal(&s->name,&owned->name))return ue_note(WN_DRIFT,"own_registry_name_snapshot_mismatch");
 if(!ue_own_name(s))return ue_note(WN_DRIFT,"own_live_fstring_mismatch_or_read_failed");
 up expected=expected_team>0?ue.teams[(unsigned)expected_team-1].address:0;
 if(!passive_class_fields(t,s->fresh.header.cls))return ue_note(WN_DRIFT,"own_passive_typed_metadata_failed");
 if(!passive_actor_fields(t,s->fresh.address,expected,expected_team>0?expected_team:(int)s->team))return ue_note(WN_DRIFT,"own_passive_live_links_or_team_failed");
 uint32_t count;int occurrences;
 if(!player_array(t,ue.bindings.game_state.address,s->fresh.address,&count,&occurrences))return ue_note(WN_DRIFT,"own_gs_typed_array_or_read_failed");
 if(occurrences!=1)return ue_note(WN_DRIFT,"own_gs_membership_mismatch");
 for(int i=0;i<2;i++){
  if(!team_player_array(t,ue.teams[i].address,s->fresh.address,&count,&occurrences))return ue_note(WN_DRIFT,"own_team_typed_array_or_read_failed");
  if(occurrences!=(expected_team==i+1?1:0))return ue_note(WN_DRIFT,"own_team_membership_mismatch");
 }
 return WN_OK;
}
static int ue_human_read(const struct table *t,up ps,struct wn_human *out){
 struct identity p,c,n;struct obj ph,ch,nh;struct field f;up pc,back,player,net;
 if(!identity(t,ps,&p)||!hdr(ps,&ph)||!derives(ph.cls,classes[2].id.address)||!in_world(ps,ue.bindings.world.address)||!ue_property(t,ph.cls,"Owner",0x158,"Actor","Actor",&f)||!rd(ps+0x158,&pc,8)||!pc)return WN_WAIT;
 if(!identity(t,pc,&c)||!hdr(pc,&ch)||!derives(ch.cls,classes[3].id.address)||!in_world(pc,ue.bindings.world.address)||!ue_property(t,ch.cls,"PlayerState",0x2c0,"Controller","PlayerState",&f)||!rd(pc+0x2c0,&back,8)||back!=ps||!ue_property(t,ch.cls,"Player",0x358,"PlayerController","Player",&f)||!rd(pc+0x358,&player,8)||!ue_property(t,ch.cls,"NetConnection",0x530,"PlayerController","NetConnection",&f)||!rd(pc+0x530,&net,8)||!net||net!=player||!identity(t,net,&n)||!hdr(net,&nh)||!derives(nh.cls,ptr(f.descriptor+0x70)))return WN_WAIT;
 memset(out,0,sizeof *out);out->player_state=ue_weak(p);out->controller=ue_weak(c);out->connection=ue_weak(n);memcpy(out->headers[0],&ph,40);memcpy(out->headers[1],&ch,40);memcpy(out->headers[2],&nh,40);return WN_OK;
}
static int ue_human_current(const struct table *t,const struct wn_human *h){
 struct warmup_native_weak_v1 ids[3]={h->player_state,h->controller,h->connection};
 for(int i=0;i<3;i++){struct identity now;struct obj header;if(!identity(t,ids[i].address,&now)||!same(now,ue_id(ids[i])))return WN_RECIPIENT_GONE;if(!hdr(now.address,&header))return WN_WAIT;if(memcmp(&header,h->headers[i],40))return (header.flags&BAD_OBJECT)?WN_RECIPIENT_GONE:WN_DRIFT;}
 up owner,back,player,net;
 if(!rd(h->player_state.address+0x158,&owner,8)||!rd(h->controller.address+0x2c0,&back,8)||!rd(h->controller.address+0x358,&player,8)||!rd(h->controller.address+0x530,&net,8))return WN_WAIT;
 return owner==h->controller.address&&back==h->player_state.address&&player==h->connection.address&&net==player&&in_world(h->player_state.address,ue.bindings.world.address)&&in_world(h->controller.address,ue.bindings.world.address)?WN_OK:WN_RECIPIENT_GONE;
}
static int ue_message_recipient_live(const struct table *t,const struct wn_world *bindings,const struct wn_human *h){
 if(!bindings||!h||!ue_same_world(bindings,&ue.bindings))return WN_DRIFT;
 int r=ue_guard_live(t);if(r!=WN_OK)return r;r=ue_human_current(t,h);if(r!=WN_OK)return r;
 up items[100];uint32_t count;if(ue_read_array(bindings->game_state.address,0x2d0,items,&count)!=WN_OK)return WN_WAIT;
 return ue_occurrences(items,count,h->player_state.address)==1?WN_OK:WN_RECIPIENT_GONE;
}
static int ue_message_subject_live(const struct table *t,const struct wn_world *bindings,const struct wn_owned *owned,int joining){
 if(!bindings||!owned||!ue_same_world(bindings,&ue.bindings))return WN_DRIFT;
 if(joining)return ue_own_verify(t,owned,(int)owned->team);
 /* No dead ownPS header or slot is read on the leave path. */
 up items[100];uint32_t count;
 if(ue_read_array(bindings->game_state.address,0x2d0,items,&count)!=WN_OK)return WN_WAIT;
 if(ue_occurrences(items,count,owned->actor.address))return WN_WAIT;
 for(int i=0;i<2;i++){if(ue_read_array(ue.teams[i].address,0x398,items,&count)!=WN_OK)return WN_WAIT;if(ue_occurrences(items,count,owned->actor.address))return WN_WAIT;}
 return WN_OK;
}
#include "warmup_ue_messages.inc"
static int ue_census(void *context,uint64_t epoch,const struct wn_owned owned[WN_MAX_OWNED],uint64_t deadline,struct wn_census *out){
 (void)context;if(!owned||!out||!ue_main()||epoch!=ue.epoch||atomic_load(&reentry_detected))return WN_DRIFT;
 if(atomic_exchange(&transaction_active,1)){atomic_store(&reentry_detected,1);return WN_DRIFT;}
 int result=WN_WAIT;struct table t;uint32_t capacity;int failed_slot=-1;ue_diagnostic_begin();
 if(ue_world_live(epoch,&ue.bindings)!=WN_OK){result=WN_WORLD_CHANGED;goto done;}
 if(!table_read(&t))goto done;
 result=ue_metadata_cache_barrier(&t);if(result!=WN_OK)goto done;
 if(!ue.scan.active||ue.scan.cursor>=ue.scan.count){
  if(ue.guard_ready){result=ue_guard_live(&t);if(result!=WN_OK)goto done;}
  result=ue_bind_runtime(&t,&capacity);if(result!=WN_OK)goto done;
  result=ue_guard_live(&t);if(result!=WN_OK)goto done;
  result=ue_common_abi(&t);if(result!=WN_OK)goto done;
 }else capacity=ue.scan.result.capacity;
 if(!ue.scan.active){
  memset(&ue.scan,0,sizeof ue.scan);ue.scan.result.bindings=ue.bindings;ue.scan.result.capacity=capacity;
  result=ue_read_array(ue.bindings.game_state.address,0x2d0,ue.scan.players,&ue.scan.count);if(result!=WN_OK)goto done;
  for(int team=0;team<2;team++){result=ue_read_array(ue.teams[team].address,0x398,ue.scan.team_items[team],&ue.scan.team_count[team]);if(result!=WN_OK)goto done;ue.scan.result.team_total[team]=ue.scan.team_count[team];}
  ue.scan.active=1;
 }
 if(ue.scan.result.capacity!=capacity){ue.scan.active=0;result=WN_WAIT;goto done;}
 if(ue.scan.cursor<ue.scan.count){
  if(mono_ns()>=deadline){result=WN_WAIT;goto done;}
  up ps=ue.scan.players[ue.scan.cursor++];int found=-1;
  for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(owned[i].state!=WN_FREE&&owned[i].state!=WN_REMOVED_NOTIFY&&owned[i].actor.address==ps){if(found>=0){result=WN_DRIFT;goto done;}found=(int)i;}
  if(found>=0){
   const struct wn_owned *slot=&owned[found];
   if(slot->state==WN_DESTROYED_PENDING||slot->state!=WN_ACTIVE){ue.scan.result.unknown++;result=WN_WAIT;goto done;}
   failed_slot=found;result=ue_own_verify(&t,slot,(int)slot->team);if(result!=WN_OK)goto done;
   ue.scan.result.owned_count++;ue.scan.result.owned_team[slot->team-1]++;ue.scan.result.owned_present[found]=1;ue.scan.result.owned_observed_team[found]=(uint8_t)slot->team;
  }else{
   struct wn_human human;result=ue_human_read(&t,ps,&human);
   if(result!=WN_OK){ue.scan.result.unknown++;result=WN_WAIT;goto done;}
   int first=ue_occurrences(ue.scan.team_items[0],ue.scan.team_count[0],ps),second=ue_occurrences(ue.scan.team_items[1],ue.scan.team_count[1],ps);
   if(first+second>1){result=WN_DRIFT;goto done;}human.team=first?1U:second?2U:0U;
   for(uint32_t i=0;i<ue.scan.result.human_count;i++)if(ue_same_weak(human.controller,ue.scan.result.humans[i].controller)||ue_same_weak(human.connection,ue.scan.result.humans[i].connection)){result=WN_DRIFT;goto done;}
   if(ue.scan.result.human_count>=WN_MAX_HUMANS){result=WN_DRIFT;goto done;}
   ue.scan.result.humans[ue.scan.result.human_count++]=human;
   if(human.team)ue.scan.result.human_team[human.team-1]++;else ue.scan.result.human_unassigned++;
  }
  result=WN_WAIT;goto done;
 }
 /* Bounded final verification: cheap positive slots/relations + fixed bytes,
  * not N full metadata walks. All typed descriptors are in the World witness. */
 for(uint32_t i=0;i<ue.scan.result.human_count;i++){result=ue_human_current(&t,&ue.scan.result.humans[i]);if(result!=WN_OK){ue.scan.active=0;result=result==WN_DRIFT?WN_DRIFT:WN_WAIT;goto done;}}
 for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(ue.scan.result.owned_present[i]){
  struct ue_owned_state *state=&ue.owned[i];up values[5];int32_t team_id;
  if(!held_actor_same(&t,&state->fresh)||!ue_own_name(state)||!rd(state->fresh.address+0x158,&values[0],8)||!rd(state->fresh.address+0x330,&values[1],8)||!rd(state->fresh.address+0x7b0,&values[2],8)||!rd(state->fresh.address+0x780,&values[3],8)||!rd(state->fresh.address+0x788,&values[4],8)||!rd(state->fresh.address+0x4b0,&team_id,4)||values[0]||values[1]||values[2]||values[4]||values[3]!=ue.teams[state->team-1].address||team_id!=(int32_t)state->team){result=WN_DRIFT;goto done;}
 }
 up current_players[100];uint32_t count;
 result=ue_read_array(ue.bindings.game_state.address,0x2d0,current_players,&count);
 if(result!=WN_OK||count!=ue.scan.count||memcmp(current_players,ue.scan.players,8UL*count)){ue.scan.active=0;result=WN_WAIT;goto done;}
 for(int team=0;team<2;team++){
  result=ue_read_array(ue.teams[team].address,0x398,current_players,&count);
  if(result!=WN_OK||count!=ue.scan.team_count[team]||memcmp(current_players,ue.scan.team_items[team],8UL*count)){ue.scan.active=0;result=WN_WAIT;goto done;}
 }
 result=ue_guard_live(&t);if(result!=WN_OK)goto done;
 if(ue_world_live(epoch,&ue.bindings)!=WN_OK){result=WN_WORLD_CHANGED;goto done;}
 ue.scan.result.captured_ns=mono_ns();ue.scan.result.valid_until_ns=ue.scan.result.captured_ns+UINT64_C(2000000000);ue.scan.result.sample_id=++ue.sample_id;
 uint64_t hash=message_hash_u64(UINT64_C(1469598103934665603),epoch);
 for(uint32_t i=0;i<ue.scan.result.human_count;i++){const struct wn_human *h=&ue.scan.result.humans[i];hash=message_hash_u64(hash,h->player_state.address);hash=message_hash_u32(hash,(uint32_t)h->player_state.serial);hash=message_hash_u64(hash,h->controller.address);hash=message_hash_u32(hash,(uint32_t)h->controller.serial);hash=message_hash_u64(hash,h->connection.address);hash=message_hash_u32(hash,(uint32_t)h->connection.serial);hash=message_hash_u32(hash,h->team);}
 for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(ue.scan.result.owned_present[i]){hash=message_hash_u64(hash,owned[i].actor.address);hash=message_hash_u32(hash,(uint32_t)owned[i].actor.serial);hash=message_hash_u32(hash,owned[i].team);}
 ue.scan.result.binding_signature=hash;*out=ue.scan.result;ue.scan.active=0;result=WN_OK;
done:
 if(result==WN_DRIFT||result==WN_WORLD_CHANGED)ue.scan.active=0;
 if(result==WN_DRIFT)atomic_store(&telemetry_failed_slot,failed_slot);
 ue_diagnostic_end(result==WN_DRIFT||result==WN_WORLD_CHANGED);
 atomic_store(&transaction_active,0);return result;
}
static int ue_receipt_result(struct wn_receipt *r,int result,const char *stage){snprintf(r->stage,sizeof r->stage,"%s",stage);r->finished_ns=mono_ns();return result;}
static int ue_begin_finish(const struct table *t,const struct wn_owned *owned,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED||ue.owned[owned->slot_index].present)return WN_DRIFT;
 up players[100];uint32_t count,capacity;int result=ue_bind_runtime(t,&capacity);if(result!=WN_OK)return result;
 if(ue_read_array(ue.bindings.game_state.address,0x2d0,players,&count)!=WN_OK||(uint64_t)count+1>=capacity)return WN_WAIT;
 struct identity begin=ue_fresh_meta(t,"GameplayStatics","BeginDeferredActorSpawnFromClass"),finish=ue_fresh_meta(t,"GameplayStatics","FinishSpawningActor");
 _Alignas(16) unsigned char bp[144]={0},fp[128]={0};double one=1;up w=ue.bindings.world.address,cls=once_binding.state_class.address,actor_address=0;
 memcpy(bp,&w,8);memcpy(bp+8,&cls,8);memcpy(bp+16+24,&one,8);for(int i=0;i<3;i++)memcpy(bp+16+64+8*i,&one,8);bp[112]=1;bp[128]=0;
 event_fn event=(event_fn)BASE_PROCESS_EVENT;r->issued=1;r->started_ns=mono_ns();r->subcalls_issued|=1;record_event();event((void *)current.gameplay_cdo.address,(void *)begin.address,bp);memcpy(&actor_address,bp+136,8);
 struct table fresh=*t;struct fresh_actor actor;up level;
 if(!table_read(&fresh)||!rd(w+0x30,&level,8)||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!fresh_actor_capture(&fresh,actor_address,cls,level,&actor))return WN_DRIFT;
 r->actor=(struct warmup_native_weak_v1){actor.address,actor.header.index,actor.serial};memcpy(r->actor_header,&actor.header,40);
 memcpy(fp,&actor.address,8);memcpy(fp+16,bp+16,96);fp[112]=0;
 if(!fresh_actor_same(&fresh,&actor)||!fresh_function(&fresh,finish,"GameplayStatics","FinishSpawningActor",79832067U,128,120,0x7ece0d0,finish_fields,4))return WN_DRIFT;
 r->subcalls_issued|=2;record_event();event((void *)current.gameplay_cdo.address,(void *)finish.address,fp);up returned;memcpy(&returned,fp+120,8);r->returned=1;
 int occurrences;uint32_t after;
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!table_read(&fresh)||returned!=actor.address||!fresh_actor_same(&fresh,&actor)||actor.serial<=0||!passive_actor_fields(&fresh,actor.address,0,-1)||!player_array(&fresh,ue.bindings.game_state.address,actor.address,&after,&occurrences)||occurrences!=1||after!=count+1||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_DRIFT;
 struct ue_owned_state *state=&ue.owned[owned->slot_index];memset(state,0,sizeof *state);state->present=1;state->epoch=ue.epoch;state->generation=owned->generation;state->fresh=actor;state->state=WN_SPAWNED;
 r->actor=ue_weak((struct identity){actor.address,actor.header.index,actor.serial,0});memcpy(r->actor_header,&actor.header,40);return WN_OK;
}
static int ue_name_step(const struct table *t,const struct wn_owned *owned,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED)return WN_DRIFT;
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->generation!=owned->generation||s->state!=WN_SPAWNED||!held_actor_same(t,&s->fresh)||!passive_actor_fields(t,s->fresh.address,0,-1))return WN_DRIFT;
 struct wu_name checked;size_t bytes=strnlen(owned->name.utf8,sizeof owned->name.utf8);if(bytes>=sizeof owned->name.utf8||wu_name_from_utf8(owned->name.utf8,bytes,&checked)!=WU_OK||!wu_name_equal(&checked,&owned->name))return WN_DRIFT;
 struct identity name=ue_fresh_meta(t,"SQPlayerState","BlueprintSetPlayerName");if(!fresh_name_function(t,name)||!name_actor_slots(s->fresh.header.vptr)||!naming_code_matches())return WN_WAIT;
 typedef void *(*new_fn)(size_t);typedef void (*delete_fn)(void *);size_t input_bytes=owned->name.unit_count*2;
 r->issued=1;r->started_ns=mono_ns();r->subcalls_issued|=1;record_allocator();void *allocation=((new_fn)ENGINE_NEW)(input_bytes);if(!allocation)return WN_ERROR;
 memcpy(allocation,owned->name.units,input_bytes);struct engine_string input={(up)allocation,(int32_t)owned->name.unit_count,(int32_t)owned->name.unit_count},original=input;
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!held_actor_same(t,&s->fresh)||!fresh_name_function(t,name)||!naming_code_matches())return WN_DRIFT;
 r->subcalls_issued|=2;record_event();((event_fn)ACTOR_PROCESS_EVENT)((void *)s->fresh.address,(void *)name.address,&input);r->returned=1;
 uint16_t bytes_after[WU_NAME_STORAGE_UNITS];struct engine_string own_header;s->name=owned->name;
 if(memcmp(&input,&original,sizeof input)||!rd(original.data,bytes_after,input_bytes)||memcmp(bytes_after,owned->name.units,input_bytes)||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!held_actor_same(t,&s->fresh)||!ue_own_name(s)||!rd(s->fresh.address+0x348,&own_header,sizeof own_header)||own_header.data==(up)allocation||!naming_code_matches())return WN_DRIFT;
 r->subcalls_issued|=4;record_allocator();((delete_fn)ENGINE_DELETE)(allocation);r->input_freed=1;s->state=WN_NAMED;return WN_OK;
}
static int ue_team_step(const struct table *t,const struct wn_owned *owned,enum wn_step step,uint32_t to_team,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED||to_team>2)return WN_DRIFT;
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->generation!=owned->generation||s->epoch!=ue.epoch||!held_actor_same(t,&s->fresh)||!ue_own_name(s))return WN_DRIFT;
 if(step==WN_SET_TEAM&&s->state!=WN_NAMED)return WN_DRIFT;
 if((step==WN_MOVE_TEAM||step==WN_DETACH)&&(s->state!=WN_ACTIVE||ue_own_verify(t,owned,(int)s->team)!=WN_OK))return WN_DRIFT;
 struct identity function=ue_fresh_meta(t,"SQPlayerState","SetTeamState");if(!fresh_team_function(t,function,s->fresh.header.vptr))return WN_WAIT;
 up target=to_team?ue.teams[to_team-1].address:0;r->issued=1;r->started_ns=mono_ns();record_event();((event_fn)ACTOR_PROCESS_EVENT)((void *)s->fresh.address,(void *)function.address,&target);r->returned=1;
 struct wn_owned check=*owned;check.actor=ue_weak((struct identity){s->fresh.address,s->fresh.header.index,s->fresh.serial,0});check.name=s->name;check.team=to_team;
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_DRIFT;
 int result=ue_own_verify(t,&check,(int)to_team);if(result!=WN_OK)return result;
 if(to_team){s->team=to_team;s->state=WN_ACTIVE;}else s->state=WN_DETACHED;return WN_OK;
}
static int ue_destroy_step(const struct table *t,const struct wn_owned *owned,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED)return WN_DRIFT;
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->state!=WN_DETACHED||s->generation!=owned->generation||ue_own_verify(t,owned,0)!=WN_OK)return WN_DRIFT;
 struct identity function=ue_fresh_meta(t,"Actor","K2_DestroyActor");if(!fresh_function(t,function,"Actor","K2_DestroyActor",67240962U,0,65535,0x7a068e0,NULL,0))return WN_WAIT;
 r->issued=1;r->started_ns=mono_ns();record_event();((event_fn)ACTOR_PROCESS_EVENT)((void *)s->fresh.address,(void *)function.address,NULL);r->returned=1;s->state=WN_DESTROYED_PENDING;return WN_OK;
}
/* Reconcile a retained cross-GT planning witness immediately before the
 * first write. Current rosters are always reread; classification never borrows
 * an old H count when the underlying object set/relations have changed. */
static int ue_last_census_live(const struct table *t){
 uint64_t now=mono_ns();
 if(ue.scan.active||!ue.scan.result.sample_id||ue.scan.result.unknown||!now||now<ue.scan.result.captured_ns||now>=ue.scan.result.valid_until_ns||!ue_same_world(&ue.scan.result.bindings,&ue.bindings))return WN_WAIT;
 up players[100],teams[2][100];uint32_t count,team_count[2];
 int result=ue_read_array(ue.bindings.game_state.address,0x2d0,players,&count);
 if(result!=WN_OK||count!=ue.scan.count||memcmp(players,ue.scan.players,8UL*count))return WN_WAIT;
 for(int team=0;team<2;team++){
  result=ue_read_array(ue.teams[team].address,0x398,teams[team],&team_count[team]);
  if(result!=WN_OK||team_count[team]!=ue.scan.team_count[team]||memcmp(teams[team],ue.scan.team_items[team],8UL*team_count[team]))return WN_WAIT;
 }
 for(uint32_t i=0;i<ue.scan.result.human_count;i++){
  result=ue_human_current(t,&ue.scan.result.humans[i]);
  if(result!=WN_OK)return result==WN_DRIFT?WN_DRIFT:WN_WAIT;
 }
 uint32_t seen=0;
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){
  struct ue_owned_state *state=&ue.owned[i];
  if(!ue.scan.result.owned_present[i]){
   if(state->present&&state->epoch==ue.epoch&&state->state==WN_ACTIVE)return WN_WAIT;
   continue;
  }
  if(!state->present||state->epoch!=ue.epoch||state->state!=WN_ACTIVE||state->team<1||state->team>2||state->team!=ue.scan.result.owned_observed_team[i])return WN_DRIFT;
  if(!held_actor_same(t,&state->fresh)||!ue_own_name(state))return WN_DRIFT;
  up owner,pawn,current_pawn,team_pointer,squad;int32_t team_id;
  if(!rd(state->fresh.address+0x158,&owner,8)||!rd(state->fresh.address+0x330,&pawn,8)||!rd(state->fresh.address+0x7b0,&current_pawn,8)||!rd(state->fresh.address+0x780,&team_pointer,8)||!rd(state->fresh.address+0x788,&squad,8)||!rd(state->fresh.address+0x4b0,&team_id,4))return WN_WAIT;
  if(owner||pawn||current_pawn||squad||team_pointer!=ue.teams[state->team-1].address||team_id!=(int32_t)state->team)return WN_DRIFT;
  if(ue_occurrences(players,count,state->fresh.address)!=1)return WN_WAIT;
  for(int team=0;team<2;team++)if(ue_occurrences(teams[team],team_count[team],state->fresh.address)!=(state->team==(uint32_t)team+1?1:0))return WN_WAIT;
  seen++;
 }
 if(seen!=ue.scan.result.owned_count||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_WAIT;
 return WN_OK;
}
static int ue_step(void *context,uint64_t epoch,const struct wn_world *bindings,const struct wn_owned *owned,enum wn_step step,uint32_t to_team,const struct wn_human *recipient,const uint16_t *message,size_t units,uint64_t deadline,struct wn_receipt *r){
 (void)context;if(!owned||!r||!ue_main()||warmup_control_failed()||step>=WN_STEP_COUNT||owned->world_epoch!=epoch)return WN_DRIFT;
 if(r->issued)return ue_receipt_result(r,WN_DRIFT,"duplicate_native_phase_rejected");
 if(!deadline||!mono_ns()||mono_ns()>=deadline)return ue_receipt_result(r,WN_ERROR,"phase_deadline_expired");
 uint64_t admission_until=UINT64_MAX;
 if(step==WN_BEGIN_FINISH||step==WN_MOVE_TEAM){
  struct wn_admission admission;memset(&admission,0,sizeof admission);uint64_t now=mono_ns();
  if(warmup_queue_guard_admission(NULL,epoch,bindings,now,&admission)!=WN_OK||!admission.valid||!ue_same_weak(admission.world,bindings->world)||!admission.party_safety_verified||admission.inflight_slots||admission.team_deficit[0]||admission.team_deficit[1]||now>=admission.valid_until_ns)return ue_receipt_result(r,WN_WAIT,"fresh_admission_not_available_before_transaction");
  admission_until=admission.valid_until_ns;
 }
 if(atomic_exchange(&transaction_active,1)){atomic_store(&reentry_detected,1);return WN_DRIFT;}
 ue_diagnostic_begin();
 unsigned before_engine=atomic_load(&engine_calls),before_event=atomic_load(&process_event_calls),before_allocator=atomic_load(&allocator_calls);
 int result=ue_world_live(epoch,bindings);struct table t;
 if(result!=WN_OK)goto done;
 if(!table_read(&t)){result=WN_WAIT;goto done;}
 uint32_t capacity;if(ue.guard_ready){result=ue_guard_live(&t);if(result!=WN_OK)goto done;}result=ue_bind_runtime(&t,&capacity);if(result!=WN_OK)goto done;result=ue_guard_live(&t);if(result!=WN_OK)goto done;result=ue_common_abi(&t);if(result!=WN_OK)goto done;
 if(step==WN_MESSAGE_JOIN||step==WN_MESSAGE_LEAVE){
  result=warmup_ue_message_step(epoch,bindings,owned,step==WN_MESSAGE_JOIN,recipient,message,units,deadline,r);
  atomic_fetch_add(&engine_calls,r->engine_calls);atomic_fetch_add(&process_event_calls,r->process_event_calls);atomic_fetch_add(&allocator_calls,r->allocator_calls);goto done;
 }
 if(step==WN_BEGIN_FINISH||step==WN_MOVE_TEAM||step==WN_DETACH){
  result=ue_last_census_live(&t);
  if(result!=WN_OK){snprintf(r->stage,sizeof r->stage,"%s",result==WN_WAIT?"last_census_changed_before_mutation":"last_census_owned_or_header_drift");goto done;}
 }
 if(mono_ns()>=admission_until){result=WN_WAIT;goto done;}
 if(step==WN_BEGIN_FINISH)result=ue_begin_finish(&t,owned,r);
 else if(step==WN_SET_NAME)result=ue_name_step(&t,owned,r);
 else if(step==WN_SET_TEAM||step==WN_MOVE_TEAM)result=ue_team_step(&t,owned,step,to_team,r);
 else if(step==WN_DETACH)result=ue_team_step(&t,owned,step,0,r);
 else if(step==WN_DESTROY)result=ue_destroy_step(&t,owned,r);
 else if(step==WN_VERIFY_ACTIVE)result=ue_own_verify(&t,owned,(int)(to_team?to_team:owned->team));
 else if(step==WN_VERIFY_DETACHED)result=ue_own_verify(&t,owned,0);
 else if(step==WN_CLEANUP){
  result=ue_message_subject_live(&t,bindings,owned,0);
  if(result==WN_OK&&owned->slot_index<WN_MAX_OWNED){ue.owned[owned->slot_index].state=WN_REMOVED_NOTIFY;ue.owned[owned->slot_index].present=0;warmup_queue_owned_departed();}
 }else result=WN_ERROR;
done:
 if(atomic_load(&reentry_detected)||warmup_control_failed())result=WN_DRIFT;
 if(r->issued&&result==WN_WAIT)result=WN_DRIFT;
 r->engine_calls=atomic_load(&engine_calls)-before_engine;r->process_event_calls=atomic_load(&process_event_calls)-before_event;r->allocator_calls=atomic_load(&allocator_calls)-before_allocator;
 ue_diagnostic_end(result==WN_DRIFT||result==WN_ERROR||result==WN_WORLD_CHANGED);
 r->finished_ns=mono_ns();if(!r->stage[0])snprintf(r->stage,sizeof r->stage,"native_step_%u_result_%d",(unsigned)step,result);
 atomic_store(&transaction_active,0);return result;
}
static uint64_t ue_clock(void *context){(void)context;return mono_ns();}
static __attribute__((unused)) int ue_no_admission(void *context,uint64_t epoch,const struct wn_world *bindings,uint64_t now,struct wn_admission *out){(void)context;(void)epoch;(void)bindings;(void)now;if(out)memset(out,0,sizeof *out);return WN_WAIT;}
static int ue_invalidate(void *context,uint64_t epoch,uint32_t flags){(void)context;return warmup_native_snapshot_invalidate(epoch,flags);}
static int ue_seal(void *context,const struct warmup_native_snapshot_v1 *s){(void)context;return warmup_native_snapshot_seal(s);}
int warmup_ue_backend_gt_enter(void){
 if(!ue_main()||!atomic_load(&backend_initialized))return 0;
 if(atomic_load(&transaction_active)){atomic_store(&reentry_detected,1);return 0;}
 if(callback_epoch==UINT64_MAX)return 0;
 callback_epoch++;atomic_store(&telemetry_epoch,callback_epoch);return 1;
}
void warmup_ue_backend_sample(uint64_t deadline){
 if(!ue_main()||!atomic_load(&backend_initialized)||atomic_load(&transaction_active)||atomic_load(&reentry_detected))return;
 sample_tick(deadline);atomic_store(&telemetry_classes,(uint32_t)current.required_classes_found);atomic_store(&telemetry_functions,(uint32_t)current.function_count);atomic_store(&telemetry_cursor,current.cursor);atomic_store(&telemetry_objects,current.object_count);atomic_store(&telemetry_completed_scans,current.completed_scans);
}
void warmup_ue_backend_telemetry(struct warmup_ue_telemetry *out){if(out)*out=(struct warmup_ue_telemetry){atomic_load(&engine_calls),atomic_load(&process_event_calls),atomic_load(&allocator_calls),atomic_load(&telemetry_epoch),atomic_load(&telemetry_classes),atomic_load(&telemetry_functions),(uint32_t)atomic_load(&reentry_detected),atomic_load(&backend_initialized),atomic_load(&telemetry_cursor),atomic_load(&telemetry_objects),atomic_load(&telemetry_completed_scans),atomic_load(&telemetry_failed_slot),atomic_load(&telemetry_read_errno),atomic_load(&telemetry_read_address),atomic_load(&telemetry_read_size),atomic_load(&telemetry_read_result)};}
int warmup_ue_backend_init(struct warmup_native_ops *out,void **context,char *error,size_t error_capacity){
 const char *failure="invalid_init_arguments";char hostname[128]={0};struct stat marker_stat;char marker[96]={0};int marker_fd=-1;
 if(!out||!context||!error||!error_capacity)goto fail;
 error[0]=0;if(!warmup_bootstrap_ready()){failure="bootstrap_not_ready";goto fail;}
 const char *enabled=getenv("WARMUP_INTEGRATED_ENABLE");if(!enabled||strcmp(enabled,"1")){failure="integrated_env_disabled";goto fail;}
 if(gethostname(hostname,sizeof hostname-1)||strcmp(hostname,WARMUP_TARGET_HOSTNAME)||geteuid()!=WARMUP_TARGET_UID||getegid()!=WARMUP_TARGET_GID){failure="wrong_hostname";goto fail;}
 marker_fd=open(WARMUP_TARGET_MARKER,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 if(marker_fd<0||fstat(marker_fd,&marker_stat)||!S_ISREG(marker_stat.st_mode)||marker_stat.st_uid||marker_stat.st_mode&0022||marker_stat.st_size!=(off_t)strlen(WARMUP_TARGET_MARKER_TEXT)||pread(marker_fd,marker,(size_t)marker_stat.st_size,0)!=marker_stat.st_size||memcmp(marker,WARMUP_TARGET_MARKER_TEXT,(size_t)marker_stat.st_size)){failure="marker_gate_failed";goto fail;}
 close(marker_fd);marker_fd=-1;process_id=getpid();if(!ue_main()||atomic_load(&backend_initialized)){failure="nonmain_or_duplicate_init";goto fail;}
 memfd=open("/proc/self/mem",O_RDONLY|O_CLOEXEC);up tick;
 if(memfd<0||!rd(WARMUP_UE_TICK_CELL,&tick,8)||tick!=WARMUP_UE_ORIGINAL_TICK){failure="tick_preimage_or_readonly_mem_failed";goto fail;}
 if(!warmup_native_snapshot_bind_validator(ue_snapshot_live)){failure="snapshot_validator_bind_failed";goto fail;}
 atomic_store(&ue_error,"backend_initialized_waiting_metadata");
 *out=(struct warmup_native_ops){ue_clock,ue_probe,ue_reset,ue_census,warmup_queue_guard_admission,ue_step,ue_invalidate,ue_seal};*context=&ue;atomic_store(&backend_initialized,1);return 1;
fail:
 if(marker_fd>=0)close(marker_fd);
 if(memfd>=0&&!atomic_load(&backend_initialized)){close(memfd);memfd=-1;}if(error&&error_capacity)snprintf(error,error_capacity,"%s",failure);
 atomic_store(&ue_error,failure);return 0;
}

const char *warmup_ue_backend_error(void){return atomic_load(&ue_error);}
/* Metadata lookup by an ELF-proven offset, without inventing an FProperty
 * name. Target still requires dim1/ObjectProperty/8/owner+target Class. */
static int ue_object_property_at(const struct table *t,up cls,int offset,const char *target,struct field *out){
 up ancestors[32];int depth=0;
 while(cls&&depth<32){
  for(int i=0;i<depth;i++)if(ancestors[i]==cls)return 0;
  ancestors[depth++]=cls;struct identity id;up at;
  if(!metadata_identity(t,cls,&id)||!uclass_metaclass(t,cls)||!rd(cls+0x50,&at,8))return 0;
  up seen[1024];int count=0;
  while(at&&count<1024){
   for(int i=0;i<count;i++)if(seen[i]==at)return 0;
   seen[count++]=at;unsigned char a[0x48],b[0x48];up next;int32_t off;
   if(!rd(at,a,sizeof a)||!rd(at,b,sizeof b)||memcmp(a,b,sizeof a))return 0;
   memcpy(&next,a+0x18,8);memcpy(&off,a+0x44,4);
   if(off==offset){struct field f;up verified;if(!field_read(at,&f,&verified)||verified!=next||strcmp(f.type,"ObjectProperty")||f.size!=8||!target_matches(t,&f,target)||!stable_metadata(t,id))return 0;f.declaring_class=cls;*out=f;return 1;}
   at=next;
  }
  if(at||!stable_metadata(t,id)||!rd(cls+0x40,&cls,8))return 0;
 }
 return 0;
}
int warmup_ue_queue_snapshot(struct warmup_ue_queue_view *out){
 if(!out||!ue_main()||warmup_control_failed()||!atomic_load(&backend_initialized)||!ue.epoch||atomic_load(&transaction_active)||atomic_load(&reentry_detected))return ue_note(0,"queue_provider_transaction_reentry_or_unready");
 struct wn_world now;struct table t;uint32_t capacity;
 if(ue_probe(NULL,&now)!=WN_OK||!ue_same_world(&now,&ue.bindings)||!table_read(&t)||(ue.guard_ready&&ue_guard_live(&t)!=WN_OK)||ue_bind_runtime(&t,&capacity)!=WN_OK||ue_guard_live(&t)!=WN_OK)return ue_note(0,"queue_provider_world_or_metadata_unavailable");
 struct obj wh,gih,hosth;struct field gi_field,host_field;up gi,host;
 struct identity gi_id,host_id;
 if(!hdr(now.world.address,&wh)||!ue_object_property_at(&t,wh.cls,0x258,"GameInstance",&gi_field)||!meta_named(&t,gi_field.declaring_class,"Class","/Script/Engine","World")||!rd(now.world.address+0x258,&gi,8)||!identity(&t,gi,&gi_id)||!hdr(gi,&gih)||!derives(gih.cls,ptr(gi_field.descriptor+0x70)))return ue_note(0,"queue_world_game_instance_property_or_positiveweak");
 if(!ue_object_property_at(&t,gih.cls,0x1e0,"SQJoinBeaconHost",&host_field)||!meta_named(&t,host_field.declaring_class,"Class","/Script/Squad","SQGameInstance")||!rd(gi+0x1e0,&host,8)||!identity(&t,host,&host_id)||!hdr(host,&hosth)||!derives(hosth.cls,ptr(host_field.descriptor+0x70))||!in_world(host,now.world.address))return ue_note(0,"queue_current_gi_host_property_or_positiveweak");
 struct warmup_ue_queue_view view={0};view.abi_version=WARMUP_QUEUE_VIEW_ABI;view.struct_size=sizeof view;view.world_epoch=ue.epoch;view.outer_gt_epoch=warmup_control_outer_epoch();view.bindings=now;view.host=ue_weak(host_id);view.capacity=capacity;view.native_g=-1;
 up gs_items[100],team_items[2][100];uint32_t count;
 if(ue_read_array(now.game_state.address,0x2d0,gs_items,&view.actual_gs_count)!=WN_OK)return ue_note(0,"queue_current_gs_array_unavailable");
 for(int team=0;team<2;team++)if(ue_read_array(ue.teams[team].address,0x398,team_items[team],&view.team_total[team])!=WN_OK)return ue_note(0,"queue_current_team_arrays_unavailable");
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){
  struct ue_owned_state *state=&ue.owned[i];if(!state->present||state->epoch!=ue.epoch||state->state!=WN_ACTIVE||ue_occurrences(gs_items,view.actual_gs_count,state->fresh.address)!=1)continue;
  struct identity current_id;struct obj h;if(!identity(&t,state->fresh.address,&current_id)||current_id.index!=state->fresh.header.index||current_id.serial!=state->fresh.serial||!hdr(current_id.address,&h)||memcmp(&h,&state->fresh.header,40)||!ue_own_name(state))return 0;
  int first=ue_occurrences(team_items[0],view.team_total[0],state->fresh.address),second=ue_occurrences(team_items[1],view.team_total[1],state->fresh.address);
  if(first+second>1)return 0;
  if(first)view.removable_owned_team[0]++;else if(second)view.removable_owned_team[1]++;else view.removable_owned_unassigned++;
 }
 /* Exact native a420600 / +808 D semantics. Wrong reads stay unknown/fail;
  * only native NULL/badflag branches yield known zero. No guessed G value. */
 up engine,settings;uint32_t flags;int32_t allowance=0;
 if(!rd(ENGINE_GLOBAL,&engine,8)||!engine||ptr(engine)!=ENGINE_VPTR||!rd(engine+8,&flags,4))return ue_note(0,"queue_native_settings_engine_unavailable");
 if(!(flags&UINT32_C(0x40000000))){
  if(!rd(engine+0x12f0,&settings,8))return ue_note(0,"queue_native_settings_pointer_unavailable");
  if(settings){if(!rd(settings+8,&flags,4))return ue_note(0,"queue_native_settings_flags_unavailable");if(!(flags&UINT32_C(0x40000000))&&!rd(settings+0x60,&allowance,4))return ue_note(0,"queue_native_team_allowance_read_unavailable");}
 }
 view.native_team_allowance=allowance>0?allowance:0;view.native_team_allowance_known=1;
 up final_items[100];if(ue_read_array(now.game_state.address,0x2d0,final_items,&count)!=WN_OK||count!=view.actual_gs_count||memcmp(final_items,gs_items,count*8UL)||ue_world_live(ue.epoch,&now)!=WN_OK)return 0;
 for(int team=0;team<2;team++)if(ue_read_array(ue.teams[team].address,0x398,final_items,&count)!=WN_OK||count!=view.team_total[team]||memcmp(final_items,team_items[team],count*8UL))return 0;
 view.captured_ns=mono_ns();if(!view.captured_ns||!view.outer_gt_epoch)return ue_note(0,"queue_outer_epoch_or_clock_unavailable");*out=view;return ue_note(1,"queue_view_confirmed");
}
