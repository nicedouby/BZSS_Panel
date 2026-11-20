/* Metadata discovery only. Live World/human/owned state has its own bounded
 * pool probe/census/step gates. No graph/Team/config work may precede or erase
 * this scan, and no deadline is extended to compensate for work already spent. */
static void sample_tick(uint64_t until){
 struct table t;if(!table_read(&t)){strcpy(current.reason,"metadata_object_table_unavailable");return;}
 int invalidated=0;
 /* Cache maintenance is one class per callback, never six complete outer
  * walks ahead of the discovery budget. UE operations independently recheck
  * every required class/World/metadata witness before they can act. */
 size_t validate=(size_t)(sample_validation_cursor++%(unsigned)(sizeof classes/sizeof classes[0]));
 if(classes[validate].id.address&&!stable_metadata(&t,classes[validate].id)){classes[validate].id=(struct identity){0};invalidated=1;}
 if(invalidated)current.cursor=0;
 int class_count=0;
 for(size_t j=0;j<sizeof classes/sizeof classes[0];j++)if(classes[j].id.address)class_count++;
 current.required_classes_found=class_count;current.object_count=t.count;
 if(current.cursor<0||current.cursor>t.count)current.cursor=0;
 strcpy(current.reason,"metadata_scan_only");
 int checked=0;
 while(checked<HEADERS_PER_TICK&&current.cursor<t.count&&mono_ns()<until){
  int index=current.cursor++;checked++;struct slot sl;struct obj o;
  if(!slot_get(&t,index,&sl)||!sl.object||(sl.flags&BAD_SLOT)||!hdr(sl.object,&o)||o.index!=index||(o.flags&(BAD_OBJECT&~0x10U))){current.invalid_headers++;continue;}
  if(named(o.cls,"Class")){
   char n[80];if(!fname(o.ni,o.nn,n,sizeof n))continue;
   for(size_t j=0;j<sizeof classes/sizeof classes[0];j++)if(!classes[j].id.address&&!strcmp(n,classes[j].name)&&named(o.outer,classes[j].package))metadata_identity(&t,sl.object,&classes[j].id);
  }
  if(named(o.cls,"Function"))inspect_function(&t,sl.object,&o,until,0);
  if(named(o.cls,"ScriptStruct"))inspect_function(&t,sl.object,&o,until,1);
  if(named(o.cls,"Enum")&&named(o.outer,"/Script/Engine")){
   if(named(sl.object,"ESpawnActorCollisionHandlingMethod"))metadata_identity(&t,sl.object,&current.collision_enum);
   if(named(sl.object,"ESpawnActorScaleMethod"))metadata_identity(&t,sl.object,&current.scale_enum);
  }
  if(named(o.cls,"Enum")&&named(o.outer,"/Script/Squad")&&named(sl.object,"ESQNotificationTypes"))metadata_identity(&t,sl.object,&current.notification_enum);
  if((o.flags&0x10U)&&classes[5].id.address&&o.cls==classes[5].id.address&&named(sl.object,"Default__GameplayStatics")&&named(o.outer,"/Script/Engine"))metadata_identity(&t,sl.object,&current.gameplay_cdo);
 }
 /* This counter is an object-table metadata pass, never a gameplay census or
  * a World epoch. Preserve cursor progress between callbacks. */
 if(current.cursor>=t.count){current.completed_scans++;current.cursor=0;current.invalid_headers=0;}
 class_count=0;
 for(size_t j=0;j<sizeof classes/sizeof classes[0];j++)if(classes[j].id.address)class_count++;
 current.required_classes_found=class_count;
}
