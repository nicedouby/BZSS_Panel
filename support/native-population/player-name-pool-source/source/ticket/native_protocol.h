#ifndef NT_NATIVE_PROTOCOL_H
#define NT_NATIVE_PROTOCOL_H
#include "native_graph.h"
#include <stddef.h>
#define NT_BUILD_SHA "86770cae6d030e37ab9e435e753e7e76ff59e6853190671627af771e02c148d5"
#define NT_MAX_BODY 16384
#define NT_REPLY_MAX 2048
struct nt_request { int is_set; char operation_id[33]; char expected_epoch[161]; int team1,team2; };
int nt_parse_request(const char *body,size_t size,struct nt_request *out);
void nt_request_fingerprint(const struct nt_request *request,char out[65]);
int nt_format_status(char *out,size_t cap,const char session[33],const struct nt_snapshot *snapshot);
int nt_format_result(char *out,size_t cap,const struct nt_request *request,const char *outcome,const struct nt_snapshot *before,const struct nt_snapshot *after,const char *reason);
int nt_hex_string(const char *text,size_t size);
#endif
