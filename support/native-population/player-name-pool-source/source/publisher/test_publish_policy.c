#include "warmup_publish.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
    struct wp_input v={.now_ns=100,.captured_ns=90,.valid_until_ns=110,
        .human_count=1,.owned_count=79,.capacity=100,.raw_count=1,
        .snapshot_valid=1,.identities_match=1,.callsite_valid=1};
    struct wp_decision d=warmup_publish_decide(&v);
    assert(d.replace && d.count==80);
    v.owned_count=3; d=warmup_publish_decide(&v); assert(d.replace && d.count==4);
    v.raw_count=2; d=warmup_publish_decide(&v); assert(!d.replace && d.count==2 && d.reason==WP_COUNT_MISMATCH);
    v.raw_count=1;v.human_count=0;d=warmup_publish_decide(&v);assert(!d.replace && d.count==1);
    v.human_count=1;v.unknown_count=1;d=warmup_publish_decide(&v);assert(!d.replace && d.reason==WP_UNKNOWN);
    v.unknown_count=0;v.mutation_inflight=1;assert(!warmup_publish_decide(&v).replace);
    v.mutation_inflight=0;v.identities_match=0;assert(warmup_publish_decide(&v).reason==WP_WRONG_WORLD);
    v.identities_match=1;v.now_ns=111;assert(warmup_publish_decide(&v).reason==WP_STALE);
    v.now_ns=89;assert(warmup_publish_decide(&v).reason==WP_STALE);
    v.now_ns=100;v.valid_until_ns=UINT64_C(2000000091);assert(warmup_publish_decide(&v).reason==WP_STALE);
    v.valid_until_ns=110;v.snapshot_valid=0;assert(warmup_publish_decide(&v).reason==WP_NO_SNAPSHOT);
    v.snapshot_valid=1;v.callsite_valid=0;assert(warmup_publish_decide(&v).reason==WP_CALLSITE_MISMATCH);
    v.callsite_valid=1;v.raw_count=-1;assert(warmup_publish_decide(&v).reason==WP_INVALID_COUNT);
    v.raw_count=81;v.human_count=81;v.owned_count=0;d=warmup_publish_decide(&v);assert(d.replace && d.count==81);
    v.owned_count=20;assert(warmup_publish_decide(&v).reason==WP_INVALID_COUNT);
    v.raw_count=0;v.human_count=0;v.owned_count=80;d=warmup_publish_decide(&v);assert(d.replace && d.count==80);
    v.owned_count=99;d=warmup_publish_decide(&v);assert(d.replace && d.count==99 && d.reason==WP_CONFIRMED);
    v.owned_count=100;d=warmup_publish_decide(&v);assert(!d.replace && d.count==0 && d.reason==WP_INVALID_COUNT);
    v.raw_count=1;v.human_count=1;v.owned_count=99;d=warmup_publish_decide(&v);assert(d.replace && d.count==100);
    v.raw_count=2;v.human_count=2;d=warmup_publish_decide(&v);assert(!d.replace && d.count==2 && d.reason==WP_INVALID_COUNT);
    v.raw_count=0;v.human_count=0;
    v.owned_count=0;d=warmup_publish_decide(&v);assert(d.replace && d.count==0);
    assert(!warmup_publish_decide(NULL).replace);
    puts("publisher policy: 80/99/100 bounds and fallback checks passed");
    return 0;
}
