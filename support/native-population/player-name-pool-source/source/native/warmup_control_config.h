#ifndef WARMUP_CONTROL_CONFIG_H
#define WARMUP_CONTROL_CONFIG_H
#include "../core/warmup_core.h"
#include <stddef.h>
#include <stdint.h>
struct wc_config { uint64_t revision; struct wu_config values; int enabled; };
struct wc_arm { long pid; uint64_t start_ticks,expires_ns,config_revision; char nonce[33]; };
int wc_parse_config(const char *body,size_t bytes,struct wc_config *out);
int wc_parse_arm(const char *body,size_t bytes,struct wc_arm *out);
#endif
