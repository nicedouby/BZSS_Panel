/* R4: only already captured static metadata can receive its first weak serial.
 * All changes are staged; whole witness + current gameplay roots gate commit. */
static const struct message_node *ue_metadata_node_at(const struct message_witness *w,up address){
 for(int i=0;i<w->node_count;i++)if(w->nodes[i].address==address)return &w->nodes[i];
 return NULL;
}
static int ue_metadata_script_package(const struct message_node *n){
 return n&&!n->header.outer&&named(n->header.cls,"Package")&&(named(n->address,"/Script/Engine")||named(n->address,"/Script/CoreUObject")||named(n->address,"/Script/Squad"));
}
static int ue_metadata_static_node(const struct message_witness *w,const struct message_node *n){
 if(!n||!ue_metadata_node_at(w,n->header.cls))return 0;
 int is_class=named(n->header.cls,"Class");
 int typed=is_class||named(n->header.cls,"Function")||named(n->header.cls,"ScriptStruct")||named(n->header.cls,"Enum")||named(n->header.cls,"Package");
 if(!typed){
  if(!(n->header.flags&0x10U)||!named(n->address,"Default__GameplayStatics")||!named(n->header.cls,"GameplayStatics"))return 0;
 }
 if(is_class){uint32_t flags;if(n->header.vptr!=0x1419ba8||!rd(n->address+0xd4,&flags,4)||!(flags&0x80U))return 0;}
 const struct message_node *cursor=n;up seen[8];int count=0;
 while(cursor&&count<8){
  for(int i=0;i<count;i++)if(seen[i]==cursor->address)return 0;
  seen[count++]=cursor->address;
  if(!cursor->header.outer)return ue_metadata_script_package(cursor);
  cursor=ue_metadata_node_at(w,cursor->header.outer);
 }
 return 0;
}
static int ue_metadata_node_structure_equal(const struct message_node *a,const struct message_node *b){
 return a->address==b->address&&message_header_equal(&a->header,&b->header)&&a->is_class==b->is_class&&a->super==b->super&&a->children==b->children;
}
/* WARMUP_R5_ANCHOR_HELPERS */
static int message_node_read(const struct table *t,up at,int is_class,struct message_node *out){
 struct message_node n={0};struct obj after;struct slot a,b;
 if(!rd(at,&n.header,sizeof n.header))return MESSAGE_WAIT;
 if(n.header.index<0||n.header.cls<0x10000||(n.header.flags&(BAD_OBJECT&~0x10U)))return MESSAGE_DRIFT;
 if(!slot_get(t,n.header.index,&a))return MESSAGE_WAIT;
 if(a.object!=at||a.serial<0||(a.flags&BAD_SLOT))return MESSAGE_DRIFT;
 if(!rd(at,&after,sizeof after)||!slot_get(t,n.header.index,&b))return MESSAGE_WAIT;
 if(!message_header_equal(&n.header,&after)||a.object!=b.object||b.serial<0||(b.flags&BAD_SLOT))return MESSAGE_DRIFT;
 /* A serial allocated between these two reads is not a stable observation.
  * Eligibility is decided by the saved whole graph on the next attempt. */
 if(a.serial!=b.serial)return a.serial==0&&b.serial>0?MESSAGE_WAIT:MESSAGE_DRIFT;
 n.address=at;n.serial=a.serial;n.is_class=is_class;
 if(is_class&&(!rd(at+0x40,&n.super,8)||!rd(at+0x50,&n.children,8)))return MESSAGE_WAIT;
 *out=n;return MESSAGE_READY;
}
static int ue_message_field_read(const struct table *t,const struct message_field_witness *saved,struct message_field_witness *out){
 struct message_field_witness f={0};up next=0;f.bytes=saved->bytes;
 if(f.bytes<0x48||f.bytes>sizeof f.raw)return MESSAGE_DRIFT;
 if(!rd(saved->field.descriptor,f.raw,f.bytes))return MESSAGE_WAIT;
 int r=ue_repindex_transition(t,saved,f.raw,f.bytes);if(r!=MESSAGE_READY)return r;
 memcpy(&f.type_class,f.raw+8,8);
 if(!rd(f.type_class,f.type_name,8))return MESSAGE_WAIT;
 if(memcmp(f.type_name,saved->type_name,8))return MESSAGE_DRIFT;
 if(!field_read(saved->field.descriptor,&f.field,&next))return MESSAGE_WAIT;
 f.field.declaring_class=saved->field.declaring_class;
 if(!message_field_semantic_equal(&f.field,&saved->field))return MESSAGE_DRIFT;
 if(!strcmp(f.field.type,"ObjectProperty")||!strcmp(f.field.type,"ClassProperty")||!strcmp(f.field.type,"StructProperty")){
  if(!rd(f.field.descriptor+0x70,&f.target,8))return MESSAGE_WAIT;
 }
 if(!strcmp(f.field.type,"ClassProperty")||!strcmp(f.field.type,"ArrayProperty")){
  if(!rd(f.field.descriptor+0x78,&f.inner,8))return MESSAGE_WAIT;
 }
 if(!strcmp(f.field.type,"EnumProperty")){
  if(!rd(f.field.descriptor+0x78,&f.target,8)||!rd(f.field.descriptor+0x70,&f.inner,8))return MESSAGE_WAIT;
 }
 if(f.target!=saved->target||f.inner!=saved->inner)return MESSAGE_DRIFT;
 r=ue_repindex_capture(t,&f,&f.repindex_ready);if(r!=MESSAGE_READY)return r;
 if(saved->repindex_ready&&!f.repindex_ready)return MESSAGE_DRIFT;
 *out=f;return MESSAGE_READY;
}
static int message_witness_observe(const struct table *t,const struct message_witness *saved,int permit_promotion,struct message_witness *out){
 if(!message_witness_bounds(saved))return MESSAGE_DRIFT;
 int anchor=ue_metadata_anchor_gate(t,saved);if(anchor!=MESSAGE_READY)return anchor;
 unsigned char roles[MESSAGE_WITNESS_NODES];if(ue_metadata_roles_build(saved,roles)!=MESSAGE_READY||memcmp(roles,saved->roles,sizeof roles))return MESSAGE_DRIFT;
 struct message_witness candidate=*saved;
 for(int i=0;i<saved->bytes_count;i++){
  const struct message_bytes_witness *old=&saved->bytes[i];
  if(!old->size||old->size>sizeof old->raw)return MESSAGE_DRIFT;
  if(!rd(old->address,candidate.bytes[i].raw,old->size))return MESSAGE_WAIT;
  if(memcmp(old->raw,candidate.bytes[i].raw,old->size))return MESSAGE_DRIFT;
 }
 for(int i=0;i<saved->node_count;i++){
  const struct message_node *old=&saved->nodes[i];struct message_node now;
  int r=message_node_read(t,old->address,old->is_class,&now);if(r!=MESSAGE_READY)return r;
  if(!ue_metadata_node_structure_equal(old,&now))return MESSAGE_DRIFT;
  if(now.serial!=old->serial){
   if(old->serial!=0||now.serial<=0||!(ue_metadata_static_node(saved,old)||ue_metadata_anchor_node(saved,old)))return MESSAGE_DRIFT;
   if(!permit_promotion)return MESSAGE_WAIT;
  }
  candidate.nodes[i]=now;
 }
 for(int i=0;i<saved->field_count;i++){
  int r=ue_message_field_read(t,&saved->fields[i],&candidate.fields[i]);if(r!=MESSAGE_READY)return r;
  if(!permit_promotion&&!message_field_witness_equal(&saved->fields[i],&candidate.fields[i]))return MESSAGE_WAIT;
 }
 anchor=ue_metadata_anchor_gate(t,saved);if(anchor!=MESSAGE_READY)return anchor;
 *out=candidate;return MESSAGE_READY;
}
static int ue_metadata_batch_initialization_only(const struct table *t,const struct message_witness *a,const struct message_witness *b){
 struct message_witness adjusted=*a;
 for(int i=0;i<a->node_count;i++){
  if(message_node_equal(&a->nodes[i],&b->nodes[i]))continue;
  if(!ue_metadata_node_structure_equal(&a->nodes[i],&b->nodes[i])||a->nodes[i].serial!=0||b->nodes[i].serial<=0||!(ue_metadata_static_node(a,&a->nodes[i])||ue_metadata_anchor_node(a,&a->nodes[i])))return 0;
  adjusted.nodes[i]=b->nodes[i];
 }
 for(int i=0;i<a->field_count;i++){
  if(message_field_witness_equal(&a->fields[i],&b->fields[i]))continue;
  struct message_field_witness f=a->fields[i];
  if(ue_repindex_transition(t,&f,b->fields[i].raw,b->fields[i].bytes)!=MESSAGE_READY||f.repindex_ready>b->fields[i].repindex_ready)return 0;
  memcpy(f.raw,b->fields[i].raw,sizeof f.raw);f.repindex_ready=b->fields[i].repindex_ready;
  if(!message_field_witness_equal(&f,&b->fields[i]))return 0;
  adjusted.fields[i]=f;
 }
 return message_witness_equal(&adjusted,b);
}
static int message_witness_double(const struct table *t,const struct message_witness *saved,int permit_promotion,struct message_witness *out){
 struct message_witness first,second;
 int r=message_witness_observe(t,saved,permit_promotion,&first);if(r!=MESSAGE_READY)return r;
 r=message_witness_observe(t,saved,permit_promotion,&second);if(r!=MESSAGE_READY)return r;
 if(!message_witness_equal(&first,&second))return ue_metadata_batch_initialization_only(t,&first,&second)?MESSAGE_WAIT:MESSAGE_DRIFT;
 *out=second;return MESSAGE_READY;
}
