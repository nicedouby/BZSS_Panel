/* Role eligibility is derived from immutable current-World capture anchors,
 * never a Blueprint name, asset path prefix, or a newly observed candidate. */
static int ue_metadata_anchor_gate(const struct table *,const struct message_witness *);
static int ue_anchor_root_read(const struct table *t,struct identity expected,struct obj *out){
 struct obj a,b;struct slot first,second;
 if(!expected.address||expected.serial<=0||expected.index<0)return MESSAGE_DRIFT;
 if(!rd(expected.address,&a,sizeof a)||!slot_get(t,expected.index,&first))return MESSAGE_WAIT;
 if(a.index!=expected.index||a.cls<0x10000||(a.flags&BAD_OBJECT)||first.object!=expected.address||first.serial!=expected.serial||(first.flags&BAD_SLOT))return MESSAGE_DRIFT;
 if(!rd(expected.address,&b,sizeof b)||!slot_get(t,expected.index,&second))return MESSAGE_WAIT;
 if(!message_header_equal(&a,&b)||second.object!=expected.address||second.serial!=expected.serial||(second.flags&BAD_SLOT))return MESSAGE_DRIFT;
 *out=b;return MESSAGE_READY;
}
static int ue_anchor_graph_read(const struct message_anchor *a,up out[7]){
 const up *p[7]={&a->roots[0].address,&a->roots[0].address,&a->roots[0].address,&a->roots[1].address,&a->roots[2].address,&a->roots[2].address,NULL};
 const unsigned off[7]={0x1e0,0x1d8,0x30,0x2c0,0x318,0x310,0x20};
 for(int i=0;i<6;i++)if(!rd(*p[i]+off[i],&out[i],8))return MESSAGE_WAIT;
 if(out[0]!=a->roots[1].address||out[1]!=a->roots[2].address||!out[2]||out[2]!=a->headers[1].outer||out[2]!=a->headers[2].outer||out[3]!=a->roots[2].address||out[4]!=a->roots[1].address||out[5]!=a->roots[3].address)return MESSAGE_DRIFT;
 if(!rd(out[2]+off[6],&out[6],8))return MESSAGE_WAIT;
 return out[6]==a->roots[0].address?MESSAGE_READY:MESSAGE_DRIFT;
}
static int ue_metadata_anchor_validate(const struct table *t,const struct message_anchor *a,uint64_t epoch,up active){
 if(!a->world_epoch||a->world_epoch!=epoch||active!=a->roots[0].address)return MESSAGE_DRIFT;
 for(int i=0;i<4;i++){struct obj now;int r=ue_anchor_root_read(t,a->roots[i],&now);if(r!=MESSAGE_READY)return r;if(!message_header_equal(&now,&a->headers[i]))return MESSAGE_DRIFT;}
 up links[7];int r=ue_anchor_graph_read(a,links);if(r!=MESSAGE_READY)return r;
 return !memcmp(links,a->links,sizeof links)?MESSAGE_READY:MESSAGE_DRIFT;
}
static int ue_metadata_anchor_capture(const struct table *t,uint64_t epoch,const struct identity roots[4],struct message_anchor *out){
 struct message_anchor a={0};if(!epoch||!roots||!out)return MESSAGE_DRIFT;a.world_epoch=epoch;
 for(int i=0;i<4;i++){a.roots[i]=roots[i];a.roots[i].metadata_fingerprint=0;int r=ue_anchor_root_read(t,a.roots[i],&a.headers[i]);if(r!=MESSAGE_READY)return r;}
 int r=ue_anchor_graph_read(&a,a.links);if(r!=MESSAGE_READY)return r;
 *out=a;return MESSAGE_READY;
}
static int ue_anchor_class_qualified(const struct message_witness *w,up cls){
 const struct message_node *n=ue_metadata_node_at(w,cls);if(!n||!n->is_class)return 0;
 up meta=n->header.cls,seen[32];int count=0;
 while(meta&&count<32){
  for(int i=0;i<count;i++)if(seen[i]==meta)return 0;
  seen[count++]=meta;const struct message_node *m=ue_metadata_node_at(w,meta);
  if(!m||!m->is_class||m->header.cls!=w->anchor.native_class)return 0;
  if(meta==w->anchor.native_class)return m->header.cls==meta;
  meta=m->super;
 }
 return 0;
}
static int ue_anchor_role_package(const struct message_witness *w,const struct message_node *start,int *index){
 const struct message_node *n=start;up seen[8];int count=0;
 while(n&&count<8){
  for(int i=0;i<count;i++)if(seen[i]==n->address)return 0;
  seen[count++]=n->address;
  if(!n->header.outer){
   if(n->header.cls!=w->anchor.package_class||!ue_anchor_class_qualified(w,w->anchor.package_class))return 0;
   *index=(int)(n-w->nodes);return 1;
  }
  n=ue_metadata_node_at(w,n->header.outer);
 }
 return 0;
}
static int ue_metadata_roles_build(const struct message_witness *w,unsigned char out[MESSAGE_WITNESS_NODES]){
 unsigned char roles[MESSAGE_WITNESS_NODES]={0};
 const struct message_node *world_cls=ue_metadata_node_at(w,w->anchor.headers[0].cls),*meta=ue_metadata_node_at(w,w->anchor.native_class),*pkgcls=ue_metadata_node_at(w,w->anchor.package_class);
 if(!world_cls||world_cls->header.cls!=w->anchor.native_class||!meta||!meta->is_class||meta->header.cls!=meta->address||!pkgcls||!ue_anchor_class_qualified(w,w->anchor.package_class))return MESSAGE_DRIFT;
 for(int root=1;root<=2;root++){
  up cls=w->anchor.headers[root].cls,seen[32];int count=0;
  while(cls&&count<32){
   for(int i=0;i<count;i++)if(seen[i]==cls)return MESSAGE_DRIFT;
   seen[count++]=cls;const struct message_node *n=ue_metadata_node_at(w,cls);int package_index;
   if(!n||!ue_anchor_class_qualified(w,cls)||!ue_anchor_role_package(w,n,&package_index))return MESSAGE_DRIFT;
   roles[(size_t)(n-w->nodes)]|=(unsigned char)(root==1?1:2);roles[package_index]|=(unsigned char)(root==1?4:8);cls=n->super;
  }
  if(cls||!count)return MESSAGE_DRIFT;
 }
 memcpy(out,roles,sizeof roles);return MESSAGE_READY;
}
static int ue_metadata_anchor_node(const struct message_witness *w,const struct message_node *n){
 if(!n)return 0;
 int index=-1;
 for(int i=0;i<w->node_count;i++)if(n==&w->nodes[i]){index=i;break;}
 if(index<0)return 0;
 unsigned role=w->roles[index];
 if(role&3U)return n->is_class&&ue_anchor_class_qualified(w,n->address);
 return (role&12U)&&!n->header.outer&&n->header.cls==w->anchor.package_class&&ue_anchor_class_qualified(w,w->anchor.package_class);
}
