/* Pinned-build, read-only FProperty RepIndex initialization validator.
 * Exact writer: 0x4c31ee3 (66 89 42 40), builder: 0x4c31540.
 * No UE call, allocation, target write, saved-witness update or cache lookup.
 * The caller retains full field semantics / graph double-read / atomic commit.
 * Capture records readiness, including an already-ready valid index0, in the
 * caller's private witness. The transition validator never changes that witness.
 */
struct ue_repindex_sample {
 struct obj declaring,metaclass,package;
 struct slot declaring_slot,metaclass_slot,package_slot;
 struct identity declaring_id,metaclass_id;
 uint32_t class_flags;
 struct array_header reps;
 unsigned char record[16];
};

static int ue_repindex_pointer(up value){
 return value>=UINT64_C(0x10000)&&value<UINT64_C(0x800000000000)&&!(value&7U);
}

static int ue_repindex_object(const struct table *t,up address,struct obj *header,struct slot *slot){
 if(!rd(address,header,sizeof *header))return MESSAGE_WAIT;
 if(header->index<0||header->cls<0x10000||(header->flags&(BAD_OBJECT&~0x10U)))return MESSAGE_DRIFT;
 if(!slot_get(t,header->index,slot))return MESSAGE_WAIT;
 if(slot->object!=address||slot->serial<0||(slot->flags&BAD_SLOT))return MESSAGE_DRIFT;
 return MESSAGE_READY;
}

static int ue_repindex_name(up address,const char *first,const char *second){
 char text[128];
 if(!name(address,text,sizeof text))return MESSAGE_WAIT;
 return !strcmp(text,first)||(second&&!strcmp(text,second))?MESSAGE_READY:MESSAGE_DRIFT;
}

static int ue_repindex_finish_object(const struct table *t,up address,const struct obj *before,
                                    const struct slot *slot_before,const struct identity *middle){
 struct obj after;struct slot slot_after;
 int result=ue_repindex_object(t,address,&after,&slot_after);
 if(result!=MESSAGE_READY)return result;
 if(!message_header_equal(before,&after)||slot_before->object!=slot_after.object)return MESSAGE_DRIFT;
 if(middle&&(middle->address!=address||middle->index!=after.index))return MESSAGE_DRIFT;
 int32_t first=slot_before->serial,mid=middle?middle->serial:first,last=slot_after.serial;
 if(first==mid&&mid==last)return MESSAGE_READY;
 if(first==0&&mid>=0&&last>0&&(mid==0||mid==last))return MESSAGE_WAIT;
 return MESSAGE_DRIFT;
}

static int ue_repindex_descriptor(const struct message_field_witness *saved,const unsigned char *current_raw){
 unsigned char descriptor[0x78];
 if(!rd(saved->field.descriptor,descriptor,saved->bytes))return MESSAGE_WAIT;
 if(!memcmp(descriptor,current_raw,saved->bytes))return MESSAGE_READY;
 uint16_t before,after;memcpy(&before,current_raw+0x40,2);memcpy(&after,descriptor+0x40,2);
 if(!saved->repindex_ready&&!before&&after&&
    !memcmp(descriptor,current_raw,0x40)&&!memcmp(descriptor+0x42,current_raw+0x42,saved->bytes-0x42))return MESSAGE_WAIT;
 return MESSAGE_DRIFT;
}

static int ue_repindex_sample(const struct table *t,const struct message_field_witness *saved,
                             const unsigned char *current_raw,uint16_t index,
                             int require_ready,struct ue_repindex_sample *out){
 struct ue_repindex_sample candidate={0};
 up declaring=saved->field.declaring_class;
 int result=ue_repindex_object(t,declaring,&candidate.declaring,&candidate.declaring_slot);
 if(result!=MESSAGE_READY)return result;
 /* The exact native UClass vptr excludes BlueprintGeneratedClass derivatives. */
 if(candidate.declaring.vptr!=UINT64_C(0x1419ba8))return MESSAGE_DRIFT;
 result=ue_repindex_object(t,candidate.declaring.cls,&candidate.metaclass,&candidate.metaclass_slot);
 if(result!=MESSAGE_READY)return result;
 if(candidate.metaclass.vptr!=UINT64_C(0x1419ba8)||candidate.metaclass.cls!=candidate.declaring.cls)return MESSAGE_DRIFT;
 result=ue_repindex_name(candidate.declaring.cls,"Class",NULL);
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_name(candidate.metaclass.outer,"/Script/CoreUObject",NULL);
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_object(t,candidate.declaring.outer,&candidate.package,&candidate.package_slot);
 if(result!=MESSAGE_READY)return result;
 if(candidate.package.outer)return MESSAGE_DRIFT;
 result=ue_repindex_name(candidate.declaring.outer,"/Script/Engine","/Script/Squad");
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_name(candidate.package.cls,"Package",NULL);
 if(result!=MESSAGE_READY)return result;
 if(!rd(declaring+0xd4,&candidate.class_flags,sizeof candidate.class_flags))return MESSAGE_WAIT;
 if(!(candidate.class_flags&0x80U))return MESSAGE_DRIFT; /* CLASS_Native */
 result=ue_repindex_descriptor(saved,current_raw);
 if(result!=MESSAGE_READY)return result;
 if(!(candidate.class_flags&0x800U)&&(require_ready||index!=0))return MESSAGE_WAIT;
 if(candidate.class_flags&0x800U){ /* d5 bit08: runtime replication data ready */
  if(!rd(declaring+0xf0,&candidate.reps,sizeof candidate.reps))return MESSAGE_WAIT;
  if(candidate.reps.count<1||candidate.reps.count>65536||candidate.reps.capacity<candidate.reps.count||
     candidate.reps.capacity>65536||(uint32_t)index>=(uint32_t)candidate.reps.count||
     !ue_repindex_pointer(candidate.reps.data))return MESSAGE_DRIFT;
  up record_address=candidate.reps.data+16U*(up)index;
  if(record_address<candidate.reps.data||record_address>UINT64_C(0x800000000000)-sizeof candidate.record)return MESSAGE_DRIFT;
  if(!rd(record_address,candidate.record,sizeof candidate.record))return MESSAGE_WAIT;
  up property;int32_t array_index;
  memcpy(&property,candidate.record,8);memcpy(&array_index,candidate.record+8,4);
  if(property!=saved->field.descriptor||array_index!=0)return MESSAGE_DRIFT;
 }
 result=ue_repindex_descriptor(saved,current_raw);
 if(result!=MESSAGE_READY)return result;
 int declaring_meta_ok=metadata_identity(t,declaring,&candidate.declaring_id);
 int metaclass_meta_ok=metadata_identity(t,candidate.declaring.cls,&candidate.metaclass_id);
 int declaring_finish=ue_repindex_finish_object(t,declaring,&candidate.declaring,&candidate.declaring_slot,
                                               declaring_meta_ok?&candidate.declaring_id:NULL);
 int meta_finish=ue_repindex_finish_object(t,candidate.declaring.cls,&candidate.metaclass,&candidate.metaclass_slot,
                                         metaclass_meta_ok?&candidate.metaclass_id:NULL);
 int package_finish=ue_repindex_finish_object(t,candidate.declaring.outer,&candidate.package,&candidate.package_slot,NULL);
 if(declaring_finish==MESSAGE_DRIFT||meta_finish==MESSAGE_DRIFT||package_finish==MESSAGE_DRIFT)return MESSAGE_DRIFT;
 if(!declaring_meta_ok||!metaclass_meta_ok||declaring_finish!=MESSAGE_READY||meta_finish!=MESSAGE_READY||package_finish!=MESSAGE_READY)return MESSAGE_WAIT;
 *out=candidate;return MESSAGE_READY;
}

static int ue_repindex_double(const struct table *t,const struct message_field_witness *saved,
                             const unsigned char *current_raw,size_t bytes,int require_ready,int *ready){
 if(!t||!saved||!current_raw||bytes!=saved->bytes||bytes<0x48||bytes>sizeof saved->raw)return MESSAGE_DRIFT;
 if(memcmp(saved->raw,current_raw,0x40)||memcmp(saved->raw+0x42,current_raw+0x42,bytes-0x42))return MESSAGE_DRIFT;
 uint16_t index;int32_t dim;up flags,owner;
 memcpy(&index,current_raw+0x40,2);
 memcpy(&dim,current_raw+0x2c,4);memcpy(&flags,current_raw+0x38,8);memcpy(&owner,current_raw+0x10,8);
 if(dim!=1||saved->field.dim!=1||!(flags&UINT64_C(0x20))||flags!=saved->field.raw_flags||
    !ue_repindex_pointer(saved->field.descriptor)||!ue_repindex_pointer(saved->field.declaring_class)||
    owner!=(saved->field.declaring_class|UINT64_C(1)))return MESSAGE_DRIFT;
 struct ue_repindex_sample first,second;
 int result=ue_repindex_sample(t,saved,current_raw,index,require_ready,&first);
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_sample(t,saved,current_raw,index,require_ready,&second);
 if(result!=MESSAGE_READY)return result;
 if(!message_header_equal(&first.declaring,&second.declaring)||
    !message_header_equal(&first.metaclass,&second.metaclass)||
    !message_header_equal(&first.package,&second.package)||
    first.declaring_slot.object!=second.declaring_slot.object||
    first.metaclass_slot.object!=second.metaclass_slot.object||
    first.package_slot.object!=second.package_slot.object)return MESSAGE_DRIFT;
 const struct slot *before[3]={&first.declaring_slot,&first.metaclass_slot,&first.package_slot};
 const struct slot *after[3]={&second.declaring_slot,&second.metaclass_slot,&second.package_slot};
 for(int i=0;i<3;i++)if(before[i]->serial!=after[i]->serial){
  if(before[i]->serial==0&&after[i]->serial>0)return MESSAGE_WAIT;
  return MESSAGE_DRIFT;
 }
 if(((first.class_flags^second.class_flags)&~0x800U)!=0)return MESSAGE_DRIFT;
 if((first.class_flags^second.class_flags)&0x800U)return MESSAGE_WAIT;
 if(memcmp(&first.reps,&second.reps,sizeof first.reps)||memcmp(first.record,second.record,sizeof first.record))return MESSAGE_DRIFT;
 if(first.declaring_id.metadata_fingerprint!=second.declaring_id.metadata_fingerprint||
    first.metaclass_id.metadata_fingerprint!=second.metaclass_id.metadata_fingerprint)return MESSAGE_WAIT;
 if(ready)*ready=(second.class_flags&0x800U)!=0;
 return MESSAGE_READY;
}

/* Mapping proof only: unlike transition(), this may validate a ready index0. */
static int ue_repindex_current_mapping(const struct table *t,const struct message_field_witness *saved,
                                      const unsigned char *current_raw,size_t bytes){
 return ue_repindex_double(t,saved,current_raw,bytes,1,NULL);
}

static int ue_repindex_capture(const struct table *t,const struct message_field_witness *saved,int *ready){
 if(!t||!saved||!ready||saved->bytes<0x48||saved->bytes>sizeof saved->raw)return MESSAGE_DRIFT;
 up flags;memcpy(&flags,saved->raw+0x38,8);
 if(!(flags&UINT64_C(0x20))||!saved->field.declaring_class){*ready=0;return MESSAGE_READY;}
 int candidate_ready=0;
 int result=ue_repindex_double(t,saved,saved->raw,saved->bytes,0,&candidate_ready);
 if(result!=MESSAGE_READY)return result;
 *ready=candidate_ready;return MESSAGE_READY;
}

static int ue_repindex_transition(const struct table *t,const struct message_field_witness *saved,
                                 const unsigned char *current_raw,size_t bytes){
 if(!t||!saved||!current_raw||bytes!=saved->bytes||bytes<0x48||bytes>sizeof saved->raw)return MESSAGE_DRIFT;
 if(!memcmp(saved->raw,current_raw,bytes))return MESSAGE_READY;
 if(saved->repindex_ready)return MESSAGE_DRIFT;
 uint16_t before,after;
 memcpy(&before,saved->raw+0x40,2);memcpy(&after,current_raw+0x40,2);
 if(before||!after)return MESSAGE_DRIFT;
 return ue_repindex_current_mapping(t,saved,current_raw,bytes);
}
