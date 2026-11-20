#include "warmup_control_config.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#define GOOD "{\"schema\":1,\"revision\":1,\"target\":80,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n"
#define GOOD_MAX "{\"schema\":1,\"revision\":1,\"target\":99,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n"
int main(void){
 struct wc_config c;struct wc_arm a;
 assert(wc_parse_config(GOOD,strlen(GOOD),&c)&&c.values.target==80&&c.revision==1&&c.enabled);
 assert(wc_parse_config(GOOD_MAX,strlen(GOOD_MAX),&c)&&c.values.target==99&&c.values.reserved_slots==1);
 const char *bad[]={
  "{\"schema\":1,\"revision\":18446744073709551616,\"target\":80,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":-1,\"target\":80,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":01,\"target\":80,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":1,\"target\":100,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":1,\"target\":99,\"capacity\":99,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":1,\"target\":80,\"capacity\":80,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":1,\"target\":80,\"capacity\":100,\"reserved_slots\":0,\"settle_samples\":2,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":1,\"target\":80,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":0,\"enabled\":1}\n",
  "{\"schema\":1,\"revision\":1,\"target\":80,\"capacity\":100,\"reserved_slots\":1,\"settle_samples\":2,\"enabled\":2}\n"};
 for(size_t i=0;i<sizeof bad/sizeof bad[0];i++)assert(!wc_parse_config(bad[i],strlen(bad[i]),&c));
 assert(!wc_parse_config(GOOD,strlen(GOOD)-1,&c));
 char embedded[sizeof GOOD];memcpy(embedded,GOOD,sizeof GOOD);embedded[20]=0;
 assert(!wc_parse_config(embedded,sizeof GOOD-1,&c));
 const char *good_arm="{\"schema\":1,\"pid\":100,\"start_ticks\":20,\"nonce\":\"0123456789abcdef0123456789abcdef\",\"expires_ns\":300,\"config_revision\":1}\n";
 assert(wc_parse_arm(good_arm,strlen(good_arm),&a)&&a.pid==100&&a.config_revision==1);
 assert(!wc_parse_arm(good_arm,strlen(good_arm)-1,&a));
 char wrong[512];snprintf(wrong,sizeof wrong,"%s",good_arm);strchr(wrong,'a')[0]='X';
 assert(!wc_parse_arm(wrong,strlen(wrong),&a));
 memset(wrong,'9',sizeof wrong);assert(!wc_parse_config(wrong,sizeof wrong,&c));
 puts("control schema: valid config/arm, overflow, malformed and bounds cases passed");return 0;
}
