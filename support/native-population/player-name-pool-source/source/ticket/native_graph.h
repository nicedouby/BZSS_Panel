#ifndef NATIVE_GRAPH_H
#define NATIVE_GRAPH_H
#include <stdint.h>
struct nt_snapshot {
    int available;
    char epoch[161];
    char map[257];
    int32_t tickets[2];
    char reason[65];
    double observed_at;
};
/* Only the verified engine callback thread may call these functions. */
int nt_graph_init(void);
void nt_graph_tick(const char session[33], struct nt_snapshot *out);
int nt_graph_apply(const char *expected_epoch, int team1, int team2,
                   struct nt_snapshot *before, struct nt_snapshot *after,
                   char reason[65]);
#endif
