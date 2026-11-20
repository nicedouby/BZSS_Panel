#ifndef WARMUP_GT_SCHEDULE_H
#define WARMUP_GT_SCHEDULE_H
#include <stdint.h>
enum wc_gt_read_turn { WC_GT_DISCOVERY=1, WC_GT_POOL=2 };
/* Discovery's bounded loops still contain indivisible metadata checks. Give
 * each read class an independent GT turn; neither receives a larger budget.
 * Pool callbacks retain their own full World/metadata/transaction guards. */
static inline enum wc_gt_read_turn wc_gt_read_turn(int armed,uint64_t outer_epoch){
 return !armed || !(outer_epoch&UINT64_C(1)) ? WC_GT_DISCOVERY : WC_GT_POOL;
}
#endif
