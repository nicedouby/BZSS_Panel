/* Dynamic-name transport. Included in UE backend after its strict metadata
 * helpers and ue_message_* live validators. Saved names are independent of PS
 * lifetime. One recipient per phase; pool owns event/recipient deduplication. */
#include "message_contract.generated.h"
struct message_params { struct engine_string message;float color[4],lifetime;uint8_t notification,padding[3]; };
_Static_assert(sizeof(struct message_params)==40,"exact caller parameter buffer");
_Static_assert(__builtin_offsetof(struct message_params,color)==16,"Color offset");
_Static_assert(__builtin_offsetof(struct message_params,lifetime)==32,"Lifetime offset");
_Static_assert(__builtin_offsetof(struct message_params,notification)==36,"Enum offset");
static int message_code_matches(void){
 unsigned char b[2048];
 for(size_t i=0;i<sizeof message_code/sizeof message_code[0];i++){
  const struct message_code_piece *p=&message_code[i];
  if(p->size>sizeof b||!rd(p->address,b,p->size)||memcmp(b,p->bytes,p->size))return 0;
 }
 return 1;
}
static int message_enum_matches(const struct table *t){
 struct identity id=current.notification_enum,after;up names,values;int32_t count;
 if(!stable_metadata(t,id)||!meta_named(t,id.address,"Enum","/Script/Squad","ESQNotificationTypes")||!rd(id.address+0x40,&names,8)||!rd(id.address+0x48,&values,8)||!rd(id.address+0x50,&count,4)||count!=MESSAGE_ENUM_COUNT)return 0;
 names&=~UINT64_C(1);values&=~UINT64_C(1);
 if(names<0x10000||values<0x10000||(names&7)||(values&7))return 0;
 for(int i=0;i<count;i++){
  uint32_t ids[2];int64_t value;char n[192];
  if(!rd(names+8UL*(unsigned)i,ids,8)||!rd(values+8UL*(unsigned)i,&value,8)||!fname(ids[0],ids[1],n,sizeof n)||strcmp(n,message_enum_names[i])||value!=message_enum_values[i])return 0;
 }
 return metadata_identity(t,id.address,&after)&&after.metadata_fingerprint==id.metadata_fingerprint&&after.serial==id.serial;
}
static int message_function(const struct table *t,struct identity *out){
 struct identity id=cached_meta("SQPlayerController","ClientSystemMessage");
 struct obj object,owner;uint32_t flags,struct_size;uint16_t parms,ret;up native;unsigned char header_window[4];
 /* Runtime linked ParmsSize and reported UStruct size are independently
  * exact. They are not inferred from the aligned 40-byte C++ input buffer. */
 if(!stable_metadata(t,id)||!hdr(id.address,&object)||!named(object.cls,"Function")||!named(id.address,"ClientSystemMessage")||!hdr(object.outer,&owner)||!named(owner.cls,"Class")||!named(object.outer,"SQPlayerController")||!named(owner.outer,"/Script/Squad")||!rd(id.address+0x58,&struct_size,4)||struct_size!=MESSAGE_REPORTED_STRUCT_SIZE||!rd(id.address+0x5c,header_window,4)||memcmp(header_window,message_header_window,4)||!rd(id.address+0xb0,&flags,4)||flags!=MESSAGE_RPC_FLAGS||!rd(id.address+0xb6,&parms,2)||parms!=MESSAGE_RUNTIME_PARMS_SIZE||!rd(id.address+0xb8,&ret,2)||ret!=65535||!rd(id.address+0xd8,&native,8)||native!=0xa35f4e0||!fields_match(t,id.address,message_fields,4)||!fresh_struct(t,"LinearColor",16,message_color_fields,4)||!message_enum_matches(t)||!message_code_matches())return 0;
 up f=ptr(id.address+0x50);struct field field,under;up next=0;
 for(int i=0;i<4;i++){
  if(!field_read(f,&field,&next))return 0;
  if(i==3){
   if(strcmp(field.type,"EnumProperty")||ptr(field.descriptor+0x78)!=current.notification_enum.address||!field_read(ptr(field.descriptor+0x70),&under,&next)||strcmp(under.name,message_enum_underlying.name)||strcmp(under.type,message_enum_underlying.type)||under.dim!=1||under.size!=1||under.offset!=message_enum_underlying.offset||under.raw_flags!=message_enum_underlying.flags)return 0;
  }else f=next;
 }
 *out=id;return stable_metadata(t,id);
}
static int ue_message_result(struct wn_receipt *r,int result,const char *stage){
 snprintf(r->stage,sizeof r->stage,"%s",stage);r->finished_ns=mono_ns();return result;
}
static int ue_message_allocator_pinned(void){
 unsigned char b[sizeof engine_new_full];
 return rd(ENGINE_NEW,b,sizeof engine_new_full)&&!memcmp(b,engine_new_full,sizeof engine_new_full)&&
        rd(ENGINE_DELETE,b,sizeof engine_delete_full)&&!memcmp(b,engine_delete_full,sizeof engine_delete_full);
}
static int ue_message_release_input(struct message_params *p,const struct engine_string *original,
                                    const uint16_t *text,size_t units,struct wn_receipt *r){
 uint16_t copy[WU_MESSAGE_MAX_UNITS];
 if(!units||units>WU_MESSAGE_MAX_UNITS||memcmp(&p->message,original,sizeof *original)||
    original->num!=(int32_t)units||original->capacity!=(int32_t)units||!original->data||
    !rd(original->data,copy,units*sizeof(uint16_t))||memcmp(copy,text,units*sizeof(uint16_t))||
    !ue_message_allocator_pinned())return 0;
 typedef void (*delete_fn)(void *);
 r->allocator_calls++;r->engine_calls++;r->subcalls_issued|=4U;
 ((delete_fn)ENGINE_DELETE)((void *)original->data);
 r->input_freed=1;
 return 1;
}
static int warmup_ue_message_step(uint64_t world_epoch,const struct wn_world *bindings,
    const struct wn_owned *owned,int joining,const struct wn_human *recipient,
    const uint16_t *text,size_t units,uint64_t deadline,struct wn_receipt *r){
 if(!r)return WN_ERROR;
 if(r->issued)return ue_message_result(r,WN_DRIFT,"duplicate_message_phase_rejected");
 uint16_t expected[WU_MESSAGE_MAX_UNITS];size_t expected_units=0;
 if(!bindings||!owned||!recipient||!text||(joining!=0&&joining!=1)||
    wu_message_build(&owned->name,joining,expected,WU_MESSAGE_MAX_UNITS,&expected_units)!=WU_OK||
    units!=expected_units||memcmp(text,expected,units*sizeof(uint16_t)))
  return ue_message_result(r,WN_DRIFT,"message_does_not_match_saved_name");
 uint64_t now=mono_ns();
 if(!now||!deadline||now>=deadline)return ue_message_result(r,WN_ERROR,"message_deadline_expired");
 int result=ue_message_world_live(world_epoch,bindings);
 if(result!=WN_OK)return ue_message_result(r,result,"message_world_unavailable");
 struct table t;struct identity function;struct obj controller;
 if(!table_read(&t)||!message_function(&t,&function)||!ue_message_allocator_pinned())
  return ue_message_result(r,WN_WAIT,"message_metadata_unavailable");
 result=ue_message_subject_live(&t,bindings,owned,joining);
 if(result!=WN_OK)return ue_message_result(r,result,"message_subject_not_confirmed");
 result=ue_message_recipient_live(&t,bindings,recipient);
 if(result!=WN_OK)return ue_message_result(r,result,"message_recipient_unavailable");
 if(!hdr(recipient->controller.address,&controller)||ptr(controller.vptr+0x268)!=ACTOR_PROCESS_EVENT)
  return ue_message_result(r,WN_DRIFT,"message_controller_slot_changed");
 r->issued=1;r->started_ns=now;r->subcalls_issued|=1U;
 r->allocator_calls++;r->engine_calls++;
 typedef void *(*new_fn)(size_t);
 void *input=((new_fn)ENGINE_NEW)(units*sizeof(uint16_t));
 if(!input)return ue_message_result(r,WN_ERROR,"message_allocation_failed_no_retry");
 memcpy(input,text,units*sizeof(uint16_t));
 _Alignas(16) struct message_params parameters={
  .message={(up)input,(int32_t)units,(int32_t)units},.color={1,1,1,1},
  .lifetime=120,.notification=0,.padding={0,0,0}};
 const struct engine_string original=parameters.message;
 now=mono_ns();result=ue_message_world_live(world_epoch,bindings);
 if(result==WN_OK&&now&&now<deadline&&table_read(&t)&&message_function(&t,&function)){
  result=ue_message_recipient_live(&t,bindings,recipient);
 }else if(result==WN_OK)result=WN_ERROR;
 if(result!=WN_OK||!hdr(recipient->controller.address,&controller)||ptr(controller.vptr+0x268)!=ACTOR_PROCESS_EVENT){
  int freed=ue_message_release_input(&parameters,&original,text,units,r);
  if(freed&&result==WN_RECIPIENT_GONE){r->returned=1;return ue_message_result(r,WN_RECIPIENT_GONE,"recipient_left_before_rpc_input_freed");}
  return ue_message_result(r,WN_ERROR,freed?"message_pre_rpc_gate_failed_no_retry":"message_pre_rpc_input_ownership_failed");
 }
 /* Allocator calls do not prove delivery; the receipt records the actual PE. */
 r->process_event_calls++;r->engine_calls++;r->subcalls_issued|=2U;
 ((event_fn)ptr(controller.vptr+0x268))((void *)recipient->controller.address,(void *)function.address,&parameters);
 r->returned=1;
 if(!ue_message_release_input(&parameters,&original,text,units,r))
  return ue_message_result(r,WN_ERROR,"message_input_ownership_failed_no_retry");
 result=ue_message_world_live(world_epoch,bindings);
 if(result!=WN_OK)return ue_message_result(r,result,"message_returned_world_changed");
 return ue_message_result(r,WN_OK,joining?"join_rpc_returned_not_display_proof":"leave_rpc_returned_not_display_proof");
}
