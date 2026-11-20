#include "warmup_publish.h"
#include <assert.h>
#include <stdio.h>
int main(void){
 unsigned checks=0;
 for(uint32_t target=0;target<=99;target++)for(int64_t raw=0;raw<=100;raw++){
  struct wp_display_input v={.raw_count=raw,.target=target,.capacity=100,.config_valid=1,.enabled=1,.callsite_valid=1};
  struct wp_decision d=warmup_display_decide(&v);assert(d.replace&&d.count==target&&d.reason==WP_CONFIGURED_TARGET);checks++;
  v.enabled=0;d=warmup_display_decide(&v);assert(!d.replace&&d.count==raw&&d.reason==WP_DISPLAY_DISABLED);checks++;
  v.enabled=1;v.config_valid=0;d=warmup_display_decide(&v);assert(!d.replace&&d.count==raw&&d.reason==WP_DISPLAY_UNAVAILABLE);checks++;
  v.config_valid=1;v.callsite_valid=0;d=warmup_display_decide(&v);assert(!d.replace&&d.count==raw&&d.reason==WP_CALLSITE_MISMATCH);checks++;
 }
 struct wp_display_input bad={.raw_count=13,.target=100,.capacity=100,.config_valid=1,.enabled=1,.callsite_valid=1};
 assert(warmup_display_decide(&bad).reason==WP_INVALID_COUNT);checks++;
 bad.target=60;bad.capacity=60;assert(warmup_display_decide(&bad).reason==WP_INVALID_COUNT);checks++;
 bad.capacity=101;assert(warmup_display_decide(&bad).reason==WP_INVALID_COUNT);checks++;
 assert(!warmup_display_decide(NULL).replace);checks++;
 printf("PASS fixed display policy: %u checks; exact target even raw>target; no census input\n",checks);return 0;
}
