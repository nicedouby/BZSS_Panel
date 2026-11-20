#define _GNU_SOURCE
/* Dynamic-pool UE backend, no constructor/thread/code patch/automatic arming. */
#include "warmup_ue_backend.h"
#include "../integration/deployment_target.h"
#include "../publisher/warmup_publish.h"
#include "../admission/queue_guard.h"
#include "warmup_control.h"
#include "sha256.h"
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
#define ENGINE_VPTR ((uintptr_t)0x2337bd8)
#define ENGINE_GLOBAL ((uintptr_t)0xd708078)
#define WORLD_GLOBAL ((uintptr_t)0xd7052c0)
#define TABLE ((uintptr_t)0xd57bcb8)
#define NAMES ((uintptr_t)0xd4c7000)
#define BAD_OBJECT 0x18010U
#define BAD_SLOT UINT64_C(0x1020000000000000)
#define MAX_FUNCTIONS 32
#define MAX_PARAMS 16
#define HEADERS_PER_TICK 128
#define MESSAGE_WITNESS_NODES 96
#define MESSAGE_WITNESS_FIELDS 48
#define BASE_PROCESS_EVENT ((up)0x4d64280)
#define ACTOR_PROCESS_EVENT ((up)0x79f3d40)
#define ENGINE_NEW ((up)0xa78b290)
#define ENGINE_DELETE ((up)0x4985080)
typedef uint64_t up;
typedef void (*event_fn)(void *,void *,void *);


struct obj { up vptr;uint32_t flags;int32_t index;up cls;uint32_t ni,nn;up outer; };

struct slot { up flags,object;int32_t serial,other; };

struct table { up chunks,pre;int32_t max,count,maxchunks,nchunks; };

struct identity { up address;int32_t index,serial;uint64_t metadata_fingerprint; };

struct field { char name[80],type[48];up descriptor,raw_flags,declaring_class;int32_t dim,size,offset; };

struct function { char owner[64],name[80];struct identity id;uint32_t reported_struct_size,function_flags;unsigned char header_bytes_5c[4];uint16_t parms_size,return_offset;int field_count,fields_complete,is_script_struct;struct field fields[MAX_PARAMS]; };

struct metadata_link { up address;struct obj header;int32_t serial; };

struct metadata_snapshot { int complete,count;struct metadata_link links[8]; };

struct observation {
 char reason[64],configured_state_class_name[80];struct identity world,gs,gm,gameplay_cdo,configured_state_class,team_one;
 struct metadata_snapshot configured_class_chain;uint32_t configured_class_flags;int configured_class_flags_read_success;
 int configured_state_derives_sq;
 uint64_t generation,completed_scans;int32_t cursor,object_count;
 uint32_t active_player_states,controllers,pawns,invalid_headers;
 uint32_t completed_player_states,completed_controllers,completed_pawns;
 int required_classes_found,function_count;struct function functions[MAX_FUNCTIONS];struct identity collision_enum,scale_enum,notification_enum;
};

struct native_class { const char *name,*package;struct identity id; };

struct pointer_observation { int read_success;up value; };

struct engine_string { up data;int32_t num,capacity; };

struct fresh_actor { up address;struct obj header;int32_t serial;uint64_t epoch; };

struct message_node { up address;struct obj header;int32_t serial;int is_class;up super,children; };

struct message_field_witness { struct field field;unsigned char raw[0x78];size_t bytes;up type_class;uint32_t type_name[2];up target,inner;int repindex_ready; };

struct message_bytes_witness { up address;size_t size;unsigned char raw[256]; };

/* Private metadata witness, not a reflected/game ABI structure. */
struct message_anchor { uint64_t world_epoch;struct identity roots[4];struct obj headers[4];up links[7];up native_class,package_class; };


struct message_witness { int node_count,field_count,bytes_count;struct message_bytes_witness bytes[8];up engine_package;struct obj engine_package_header;struct message_node nodes[MESSAGE_WITNESS_NODES];struct message_field_witness fields[MESSAGE_WITNESS_FIELDS];struct message_anchor anchor;unsigned char roles[MESSAGE_WITNESS_NODES]; };

struct array_header {up data;int32_t count,capacity;};
_Static_assert(sizeof(struct obj)==40,"pinned UObject header");
_Static_assert(sizeof(struct slot)==24,"pinned object slot");
_Static_assert(sizeof(struct engine_string)==16,"pinned FString header");
static struct native_class classes[]={
 {"World","/Script/Engine",{0}},{"SQGameState","/Script/Squad",{0}},
 {"SQPlayerState","/Script/Squad",{0}},{"SQPlayerController","/Script/Squad",{0}},
 {"Pawn","/Script/Engine",{0}},{"GameplayStatics","/Script/Engine",{0}}
};
static int memfd=-1;static pid_t process_id;
static struct observation current;
static _Atomic int transaction_active,reentry_detected;
static _Atomic unsigned int engine_calls,process_event_calls,allocator_calls;
static _Atomic uint32_t telemetry_classes,telemetry_functions,backend_initialized;
static _Atomic uint64_t telemetry_epoch;
static uint64_t callback_epoch;
static struct {struct identity world,gs,gm,state_class,team;uint64_t generation;} once_binding;
static struct {struct pointer_observation pointers[5];int team_id_read_success;int32_t team_id;} once_result;

static _Atomic(const char *) ue_error="not_initialized";

static _Atomic int32_t telemetry_cursor,telemetry_objects;
static _Atomic uint64_t telemetry_completed_scans;

static unsigned sample_validation_cursor;

static _Atomic int32_t telemetry_failed_slot=-1,telemetry_read_errno;
static _Atomic uint64_t telemetry_read_address,telemetry_read_size;
static _Atomic int64_t telemetry_read_result;
static _Atomic uint64_t telemetry_census_calls,telemetry_census_last_ns;
static _Atomic uint64_t telemetry_probe_calls,telemetry_probe_last_ns,telemetry_probe_max_ns;
static _Atomic uint32_t telemetry_census_checkpoint,telemetry_common_abi_gate;
static _Atomic int32_t telemetry_census_result,telemetry_probe_result;
static int diagnostic_scope,diagnostic_frozen;
static void ue_diagnostic_begin(void){
 if(diagnostic_frozen)return;
 atomic_store(&telemetry_failed_slot,-1);atomic_store(&telemetry_read_errno,0);
 atomic_store(&telemetry_read_address,0);atomic_store(&telemetry_read_size,0);atomic_store(&telemetry_read_result,0);diagnostic_scope=1;
}
static void ue_diagnostic_end(int terminal){diagnostic_scope=0;if(terminal)diagnostic_frozen=1;}


static const unsigned char engine_new_full[58]={0x48,0x83,0xff,0x1,0x48,0x89,0xfe,0x48,0x83,0xd6,0x0,0x31,0xc0,0x48,0x83,0xff,0x9,0xf,0x93,0xc0,0x8d,0x14,0xc5,0x8,0x0,0x0,0x0,0x48,0x8b,0x3d,0x1e,0x88,0xd0,0x2,0x48,0x85,0xff,0x74,0x9,0x48,0x8b,0x7,0x48,0x8b,0x40,0x30,0xff,0xe0,0x48,0x89,0xf7,0x89,0xd6,0xe9,0x86,0x18,0x20,0xfa};
static const unsigned char engine_delete_full[38]={0x48,0x85,0xff,0x74,0x18,0x48,0x89,0xfe,0x48,0x8b,0x3d,0x41,0xea,0xb0,0x8,0x48,0x85,0xff,0x74,0xa,0x48,0x8b,0x7,0x48,0x8b,0x40,0x50,0xff,0xe0,0xc3,0x48,0x89,0xf7,0xe9,0x7a,0x7b,0x0,0x0};
static const unsigned char native_name_exec_full[127]={0x41,0x56,0x53,0x48,0x83,0xec,0x18,0x49,0x89,0xf6,0x48,0x89,0xfb,0xf,0x57,0xc0,0xf,0x29,0x4,0x24,0xe8,0xc7,0x63,0xa0,0xfa,0x49,0x83,0x7e,0x20,0x0,0x74,0x11,0x49,0x8b,0x76,0x18,0x48,0x89,0xe2,0x4c,0x89,0xf7,0xe8,0x81,0x44,0x9f,0xfa,0xeb,0x1d,0x49,0x8b,0x96,0x88,0x0,0x0,0x0,0x48,0x8b,0x42,0x18,0x49,0x89,0x86,0x88,0x0,0x0,0x0,0x48,0x89,0xe6,0x4c,0x89,0xf7,0xe8,0x92,0x44,0x9f,0xfa,0x49,0x8b,0x46,0x20,0x48,0x83,0xf8,0x1,0x48,0x83,0xd8,0xff,0x49,0x89,0x46,0x20,0x48,0x89,0xe6,0x48,0x89,0xdf,0xe8,0xf7,0x47,0xb7,0xfd,0x48,0x8b,0x3c,0x24,0x48,0x85,0xff,0x74,0x5,0xe8,0x9,0x6d,0x61,0xfa,0x48,0x83,0xc4,0x18,0x5b,0x41,0x5e,0xc3};
static const unsigned char actor_process_event_entry32[32]={0x55,0x41,0x57,0x41,0x56,0x53,0x50,0xf6,0x86,0xb1,0x0,0x0,0x0,0x4,0x75,0xa,0x83,0x7e,0x68,0x0,0xf,0x84,0xc3,0x0,0x0,0x0,0xf,0xb6,0x2d,0xd1,0x9d,0xaa};
static const unsigned char uobject_process_event_entry32[32]={0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0xf,0x85,0x26,0x3,0x0,0x0,0x55,0x48,0x89,0xe5,0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x53,0x48,0x81,0xec,0xb8,0x0};
static const unsigned char sq_name_override_full[200]={0x41,0x56,0x53,0x50,0x48,0x89,0xfb,0xe8,0xc4,0xb0,0xd3,0xfd,0x4c,0x8b,0xb3,0x60,0x1,0x0,0x0,0x4d,0x85,0xf6,0x74,0x1e,0xbf,0x1a,0x1,0x0,0x0,0xe8,0x2e,0x5d,0x59,0xfa,0x89,0xc0,0x49,0x39,0xc6,0x74,0xd,0x48,0x89,0xdf,0xe8,0x8f,0x72,0x46,0xfd,0x83,0xf8,0x1,0x75,0xf,0x48,0x8d,0xbb,0x48,0x4,0x0,0x0,0x48,0x89,0xde,0xe8,0xdb,0x96,0x45,0xfd,0x48,0x8b,0xbb,0x78,0x8,0x0,0x0,0x48,0x85,0xff,0x74,0x6f,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x65,0xbe,0x1,0x0,0x0,0x0,0xba,0x1,0x0,0x0,0x0,0xe8,0x26,0xa,0xe3,0xff,0x48,0x8b,0x83,0xa8,0x7,0x0,0x0,0x48,0x85,0xc0,0x74,0x4a,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0x75,0x3f,0x48,0x8b,0xb8,0x60,0x1f,0x0,0x0,0x48,0x85,0xff,0x74,0x33,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x29,0x48,0x8b,0x83,0x88,0x7,0x0,0x0,0x48,0x85,0xc0,0x74,0x1d,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0x75,0x12,0x8b,0xb0,0x40,0x3,0x0,0x0,0x48,0x83,0xc4,0x8,0x5b,0x41,0x5e,0xe9,0x80,0xa9,0xe3,0xff,0x48,0x83,0xc4,0x8,0x5b,0x41,0x5e,0xc3};
static const unsigned char playerstate_setnameinternal_full[130]={0x41,0x57,0x41,0x56,0x53,0x48,0x83,0xec,0x10,0x48,0x8d,0x9f,0x48,0x3,0x0,0x0,0x48,0x39,0xf3,0x74,0x63,0x4c,0x8b,0x36,0x4c,0x63,0x7e,0x8,0x48,0x8d,0x87,0x54,0x3,0x0,0x0,0x8b,0x8f,0x54,0x3,0x0,0x0,0x44,0x89,0xbf,0x50,0x3,0x0,0x0,0x89,0xca,0x44,0x9,0xfa,0x74,0x3b,0x48,0x89,0x4,0x24,0xbf,0x2,0x0,0x0,0x0,0xbe,0x2,0x0,0x0,0x0,0x44,0x89,0xfa,0x49,0x89,0xd8,0x45,0x89,0xf9,0xe8,0xd,0xde,0x61,0xfc,0x45,0x85,0xff,0x74,0x20,0x48,0x8b,0x3b,0x4d,0x1,0xff,0x4c,0x89,0xf6,0x4c,0x89,0xfa,0x48,0x83,0xc4,0x10,0x5b,0x41,0x5e,0x41,0x5f,0xe9,0x7e,0xe,0x8,0x5,0xc7,0x0,0x0,0x0,0x0,0x0,0x48,0x83,0xc4,0x10,0x5b,0x41,0x5e,0x41,0x5f,0xc3};
static const unsigned char strproperty_deepcopy_full[182]={0x55,0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x53,0x48,0x83,0xec,0x18,0x48,0x89,0xd3,0x85,0xc9,0xf,0x9e,0xc0,0x48,0x39,0xd6,0xf,0x94,0xc2,0x8,0xc2,0x74,0xf,0x48,0x83,0xc4,0x18,0x5b,0x41,0x5c,0x41,0x5d,0x41,0x5e,0x41,0x5f,0x5d,0xc3,0x49,0x89,0xf6,0x89,0xc8,0x49,0x83,0xc6,0xc,0x48,0xc1,0xe0,0x4,0x48,0x89,0x44,0x24,0x10,0x31,0xed,0xeb,0x21,0x66,0x66,0x2e,0xf,0x1f,0x84,0x0,0x0,0x0,0x0,0x0,0x41,0xc7,0x6,0x0,0x0,0x0,0x0,0x49,0x83,0xc6,0x10,0x48,0x83,0xc5,0x10,0x48,0x39,0x6c,0x24,0x10,0x74,0xba,0x4c,0x8b,0x3c,0x2b,0x4c,0x63,0x64,0x2b,0x8,0x41,0x8b,0xe,0x45,0x89,0x66,0xfc,0x89,0xc8,0x44,0x9,0xe0,0x74,0xd3,0x4d,0x8d,0x6e,0xf4,0x4c,0x89,0x34,0x24,0xbf,0x2,0x0,0x0,0x0,0xbe,0x2,0x0,0x0,0x0,0x44,0x89,0xe2,0x4d,0x89,0xe8,0x45,0x89,0xe1,0xe8,0xd3,0xc6,0xb6,0xff,0x45,0x85,0xe4,0x74,0xb5,0x49,0x8b,0x7d,0x0,0x4d,0x1,0xe4,0x4c,0x89,0xfe,0x4c,0x89,0xe2,0xe8,0x4c,0xf7,0x5c,0x8,0xeb,0xa1};
static const unsigned char playerstate_setname_entry32[32]={0x41,0x57,0x41,0x56,0x53,0x48,0x83,0xec,0x20,0x48,0x89,0xfb,0x48,0x8b,0x7,0xff,0x90,0xc8,0x7,0x0,0x0,0x4c,0x8b,0xb3,0x60,0x1,0x0,0x0,0x4d,0x85,0xf6,0x74};
static const unsigned char strproperty_copyin_full[136]={0x41,0x57,0x41,0x56,0x53,0x48,0x89,0xd3,0x49,0x89,0xf6,0x49,0x89,0xff,0x48,0x8b,0x7,0xff,0x90,0x80,0x0,0x0,0x0,0x84,0xc0,0x74,0x1a,0x49,0x8b,0x7,0x48,0x8b,0x80,0x98,0x0,0x0,0x0,0x4c,0x89,0xff,0x48,0x89,0xde,0x4c,0x89,0xf2,0x5b,0x41,0x5e,0x41,0x5f,0xff,0xe0,0x49,0x63,0x47,0x44,0x48,0x1,0xc3,0x49,0x39,0xde,0x74,0x25,0x41,0xf6,0x47,0x3b,0x40,0x75,0x24,0x41,0x8b,0x4f,0x2c,0x49,0x8b,0x7,0x48,0x8b,0x80,0xf8,0x0,0x0,0x0,0x4c,0x89,0xff,0x4c,0x89,0xf6,0x48,0x89,0xda,0x5b,0x41,0x5e,0x41,0x5f,0xff,0xe0,0x5b,0x41,0x5e,0x41,0x5f,0xc3,0x49,0x63,0x47,0x30,0x49,0x63,0x57,0x2c,0x48,0xf,0xaf,0xd0,0x4c,0x89,0xf7,0x48,0x89,0xde,0x5b,0x41,0x5e,0x41,0x5f,0xe9,0x48,0x46,0x67,0x8};
static const unsigned char team_exec_full[116]={0x41,0x56,0x53,0x50,0x49,0x89,0xf6,0x48,0x89,0xfb,0x48,0xc7,0x4,0x24,0x0,0x0,0x0,0x0,0xe8,0xd9,0x25,0x99,0xfa,0x49,0x83,0x7e,0x20,0x0,0x74,0x11,0x49,0x8b,0x76,0x18,0x48,0x89,0xe2,0x4c,0x89,0xf7,0xe8,0x53,0xf8,0x9e,0xfa,0xeb,0x1d,0x49,0x8b,0x96,0x88,0x0,0x0,0x0,0x48,0x8b,0x42,0x18,0x49,0x89,0x86,0x88,0x0,0x0,0x0,0x48,0x89,0xe6,0x4c,0x89,0xf7,0xe8,0x64,0xf8,0x9e,0xfa,0x49,0x8b,0x46,0x20,0x48,0x83,0xf8,0x1,0x48,0x83,0xd8,0xff,0x49,0x89,0x46,0x20,0x48,0x8b,0x34,0x24,0x48,0x8b,0x3,0x48,0x89,0xdf,0xff,0x90,0x78,0x9,0x0,0x0,0x48,0x83,0xc4,0x8,0x5b,0x41,0x5e,0xc3};
static const unsigned char team_setter_full[149]={0x53,0x48,0x89,0xfb,0x48,0x8b,0x87,0x80,0x7,0x0,0x0,0x48,0x89,0xb7,0x80,0x7,0x0,0x0,0x48,0x8b,0xf,0x48,0x89,0xc6,0xff,0x91,0xe0,0x8,0x0,0x0,0x48,0x8b,0xbb,0x78,0x8,0x0,0x0,0x48,0x85,0xff,0x74,0x69,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x5f,0xbe,0x1,0x0,0x0,0x0,0xba,0x1,0x0,0x0,0x0,0xe8,0x6d,0xfe,0xe2,0xff,0x48,0x8b,0x83,0xa8,0x7,0x0,0x0,0x48,0x85,0xc0,0x74,0x44,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0x75,0x39,0x48,0x8b,0xb8,0x60,0x1f,0x0,0x0,0x48,0x85,0xff,0x74,0x2d,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x23,0x48,0x8b,0x83,0x88,0x7,0x0,0x0,0x48,0x85,0xc0,0x74,0x17,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0x75,0xc,0x8b,0xb0,0x40,0x3,0x0,0x0,0x5b,0xe9,0xcd,0x9d,0xe3,0xff,0x5b,0xc3};
static const unsigned char team_onrep_full[887]={0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x53,0x48,0x83,0xec,0x10,0x48,0x89,0xf3,0x49,0x89,0xfe,0xc6,0x87,0xf0,0x3,0x0,0x0,0x0,0x48,0x85,0xf6,0x74,0x19,0x8b,0x43,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0xf,0x48,0x8b,0x3,0x48,0x89,0xdf,0x4c,0x89,0xf6,0xff,0x90,0x80,0x7,0x0,0x0,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x48,0x85,0xc0,0xf,0x84,0xb7,0x0,0x0,0x0,0x8b,0x40,0x8,0xa9,0x0,0x0,0x0,0x40,0xf,0x85,0xa9,0x0,0x0,0x0,0x49,0x8b,0xbe,0xa8,0x7,0x0,0x0,0x48,0x85,0xff,0x74,0x76,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x6c,0x48,0x8b,0x7,0xff,0x90,0x58,0x8,0x0,0x0,0x84,0xc0,0x75,0x5f,0x49,0x8b,0xbe,0xa8,0x7,0x0,0x0,0xe8,0x9b,0xd7,0x1c,0x0,0x84,0xc0,0x75,0x4f,0x48,0xc7,0x4,0x24,0x0,0x0,0x0,0x0,0x48,0x89,0xe6,0x48,0x8d,0x54,0x24,0x8,0x4c,0x89,0xf7,0xe8,0x1f,0x72,0xf6,0xff,0x84,0xc0,0x74,0x33,0xbf,0x28,0x4,0x0,0x0,0x48,0x3,0x7c,0x24,0x8,0x49,0x8b,0xb6,0xa8,0x7,0x0,0x0,0xf,0xb6,0x5,0x3b,0x32,0x20,0x3,0x84,0xc0,0xf,0x84,0x70,0x2,0x0,0x0,0x4c,0x8b,0x5,0x24,0x32,0x20,0x3,0xba,0x90,0xea,0x77,0xa,0x31,0xc9,0xe8,0xa8,0x52,0xbb,0xfd,0x49,0x8b,0xbe,0x80,0x7,0x0,0x0,0x48,0x8b,0x7,0x4c,0x89,0xf6,0xff,0x90,0x78,0x7,0x0,0x0,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x8b,0x80,0xe0,0x2,0x0,0x0,0x41,0x89,0x86,0xb0,0x4,0x0,0x0,0x4d,0x8b,0xbe,0x58,0x1,0x0,0x0,0x4d,0x85,0xff,0x74,0x3a,0xe8,0xe0,0x53,0xdb,0xff,0x49,0x8b,0x4f,0x10,0x48,0x63,0x50,0x38,0x3b,0x51,0x38,0x7f,0x28,0x48,0x83,0xc0,0x30,0x48,0x8b,0x49,0x30,0x48,0x39,0x4,0xd1,0x75,0x1a,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x49,0x89,0x87,0x60,0x7,0x0,0x0,0x49,0x8b,0x7,0x4c,0x89,0xff,0xff,0x90,0x90,0x16,0x0,0x0,0x49,0x8b,0xbe,0x78,0x8,0x0,0x0,0x48,0x85,0xff,0x74,0x68,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x5e,0xbe,0x1,0x0,0x0,0x0,0xba,0x1,0x0,0x0,0x0,0xe8,0x96,0x1,0xe3,0xff,0x49,0x8b,0x86,0xa8,0x7,0x0,0x0,0x48,0x85,0xc0,0x74,0x43,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0x75,0x38,0x48,0x8b,0xb8,0x60,0x1f,0x0,0x0,0x48,0x85,0xff,0x74,0x2c,0x8b,0x47,0x8,0xa9,0x0,0x0,0x0,0x40,0x75,0x22,0x49,0x8b,0x86,0x88,0x7,0x0,0x0,0x48,0x85,0xc0,0x74,0x16,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0x75,0xb,0x8b,0xb0,0x40,0x3,0x0,0x0,0xe8,0xf7,0xa0,0xe3,0xff,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x48,0x85,0xc0,0xf,0x84,0x45,0x1,0x0,0x0,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0xf,0x85,0x86,0x0,0x0,0x0,0x49,0x83,0xbe,0xc0,0x7,0x0,0x0,0x0,0x74,0x73,0x49,0x8b,0xbe,0xd0,0x7,0x0,0x0,0x48,0x85,0xff,0x74,0x15,0xe8,0xdd,0xe1,0x99,0xfa,0x49,0x3b,0x86,0xc0,0x7,0x0,0x0,0x74,0x62,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x48,0x63,0x88,0x68,0x4,0x0,0x0,0x48,0x85,0xc9,0x74,0x4f,0x4c,0x8b,0xb8,0x60,0x4,0x0,0x0,0x4c,0x6b,0xe9,0x58,0x45,0x31,0xe4,0xeb,0xa,0x90,0x49,0x83,0xc4,0x58,0x4d,0x39,0xe5,0x74,0x35,0x4b,0x8b,0x44,0x27,0x48,0x48,0x85,0xc0,0x74,0xed,0x48,0x8b,0x78,0x50,0x48,0x85,0xff,0x74,0xe4,0xe8,0x8f,0xe1,0x99,0xfa,0x49,0x3b,0x86,0xc0,0x7,0x0,0x0,0x75,0xd6,0x4b,0x8b,0x44,0x27,0x48,0x48,0x8b,0x40,0x50,0xeb,0x2,0x31,0xc0,0x49,0x89,0x86,0xd0,0x7,0x0,0x0,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x48,0x85,0xc0,0xf,0x84,0xa0,0x0,0x0,0x0,0x8b,0x48,0x8,0xf7,0xc1,0x0,0x0,0x0,0x40,0xf,0x85,0x91,0x0,0x0,0x0,0x49,0x83,0xbe,0xb8,0x7,0x0,0x0,0x0,0x74,0x7e,0x49,0x8b,0xbe,0xc8,0x7,0x0,0x0,0x48,0x85,0xff,0x74,0x15,0xe8,0x38,0xe1,0x99,0xfa,0x49,0x3b,0x86,0xb8,0x7,0x0,0x0,0x74,0x6d,0x49,0x8b,0x86,0x80,0x7,0x0,0x0,0x48,0x63,0x88,0x68,0x4,0x0,0x0,0x48,0x85,0xc9,0x74,0x5a,0x4c,0x8b,0xb8,0x60,0x4,0x0,0x0,0x4c,0x6b,0xe9,0x58,0x45,0x31,0xe4,0xeb,0x15,0x66,0x66,0x66,0x2e,0xf,0x1f,0x84,0x0,0x0,0x0,0x0,0x0,0x49,0x83,0xc4,0x58,0x4d,0x39,0xe5,0x74,0x35,0x4b,0x8b,0x44,0x27,0x48,0x48,0x85,0xc0,0x74,0xed,0x48,0x8b,0x78,0x50,0x48,0x85,0xff,0x74,0xe4,0xe8,0xdf,0xe0,0x99,0xfa,0x49,0x3b,0x86,0xb8,0x7,0x0,0x0,0x75,0xd6,0x4b,0x8b,0x44,0x27,0x48,0x48,0x8b,0x40,0x50,0xeb,0x2,0x31,0xc0,0x49,0x89,0x86,0xc8,0x7,0x0,0x0,0x49,0x8b,0x96,0x80,0x7,0x0,0x0,0x49,0x81,0xc6,0x18,0x4,0x0,0x0,0x4c,0x89,0xf7,0x48,0x89,0xde,0xe8,0xb9,0x8b,0x45,0xfd,0x48,0x83,0xc4,0x10,0x5b,0x41,0x5c,0x41,0x5d,0x41,0x5e,0x41,0x5f,0xc3,0x49,0x89,0xff,0xbf,0xb8,0xa7,0x7a,0xd,0x49,0x89,0xf4,0xe8,0x41,0x83,0xdb,0x2,0x4c,0x89,0xe6,0x4c,0x89,0xff,0x85,0xc0,0xf,0x84,0x72,0xfd,0xff,0xff,0xbf,0xb0,0xa7,0x7a,0xd,0xbe,0xf0,0x17,0x55,0x2,0xe8,0x4e,0x23,0x59,0xfa,0xbf,0xb8,0xa7,0x7a,0xd,0xe8,0x3f,0x84,0xdb,0x2,0x4c,0x89,0xe6,0x4c,0x89,0xff,0xe9,0x4e,0xfd,0xff,0xff};
static const unsigned char team_add_full[156]={0x41,0x57,0x41,0x56,0x53,0x48,0x89,0xf3,0x49,0x89,0xfe,0x48,0x8b,0x8f,0x98,0x3,0x0,0x0,0x48,0x63,0x97,0xa0,0x3,0x0,0x0,0x48,0x85,0xd2,0x74,0x2e,0x48,0x8d,0x34,0xd5,0x0,0x0,0x0,0x0,0x31,0xc0,0xf,0x1f,0x84,0x0,0x0,0x0,0x0,0x0,0x48,0x39,0x1c,0x1,0x74,0xb,0x48,0x83,0xc0,0x8,0x48,0x39,0xc6,0x75,0xf1,0xeb,0xb,0x48,0xf7,0xd0,0x48,0xc1,0xe8,0x3,0x85,0xc0,0x75,0x39,0x89,0xd0,0x41,0x3b,0x96,0xa4,0x3,0x0,0x0,0x75,0x21,0x4d,0x8d,0xbe,0x98,0x3,0x0,0x0,0x49,0x8d,0x96,0xa4,0x3,0x0,0x0,0xbf,0x8,0x8,0x0,0x0,0x4c,0x89,0xfe,0xe8,0xe,0xb2,0x2f,0xfa,0x49,0x8b,0xf,0x48,0x63,0xd0,0xff,0xc0,0x41,0x89,0x86,0xa0,0x3,0x0,0x0,0x48,0x89,0x1c,0xd1,0x49,0x8d,0xbe,0x78,0x3,0x0,0x0,0x4c,0x89,0xf6,0x48,0x89,0xda,0x5b,0x41,0x5e,0x41,0x5f,0xe9,0x64,0xfd,0x3f,0xfd};
static const unsigned char team_remove_full[269]={0x55,0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x53,0x48,0x83,0xec,0x18,0x48,0x89,0xf3,0x48,0x89,0xfe,0x4c,0x63,0xbf,0xa0,0x3,0x0,0x0,0x4d,0x85,0xff,0xf,0x84,0xcc,0x0,0x0,0x0,0x48,0x89,0x74,0x24,0x10,0x4c,0x8b,0xa6,0x98,0x3,0x0,0x0,0x49,0x39,0x1c,0x24,0x41,0xf,0x94,0xc3,0x45,0x31,0xd2,0x45,0x31,0xf6,0xeb,0xc,0x45,0x1,0xea,0x4c,0x39,0xfd,0xf,0x8d,0x98,0x0,0x0,0x0,0x44,0x89,0xda,0x44,0x89,0xf1,0x41,0x80,0xf3,0x1,0x49,0x63,0xc6,0x8d,0x70,0x1,0x41,0x39,0xf7,0x41,0xf,0x4f,0xf7,0x4c,0x8d,0x40,0x1,0x89,0xd7,0x40,0x80,0xe7,0x1,0xf,0x1f,0x0,0x4c,0x89,0xc5,0x4d,0x39,0xf8,0x7d,0x28,0x49,0x39,0x1c,0xec,0x41,0xf,0x94,0xc1,0x41,0xff,0xc6,0x4c,0x8d,0x45,0x1,0x44,0x38,0xcf,0x74,0xe4,0xf6,0xc2,0x1,0x75,0xb2,0xeb,0x15,0x66,0x66,0x66,0x66,0x2e,0xf,0x1f,0x84,0x0,0x0,0x0,0x0,0x0,0x41,0x89,0xf6,0xf6,0xc2,0x1,0x75,0x9b,0x45,0x89,0xf5,0x41,0x29,0xcd,0x41,0x39,0xca,0x74,0x8d,0x49,0x63,0xca,0x49,0x8d,0x3c,0xcc,0x49,0x8d,0x34,0xc4,0x49,0x63,0xd5,0x48,0xc1,0xe2,0x3,0x44,0x89,0x54,0x24,0xc,0x44,0x88,0x5c,0x24,0xb,0xe8,0x7c,0x25,0xd6,0x2,0x44,0xf,0xb6,0x5c,0x24,0xb,0x44,0x8b,0x54,0x24,0xc,0xe9,0x5c,0xff,0xff,0xff,0x48,0x8b,0x74,0x24,0x10,0x44,0x89,0x96,0xa0,0x3,0x0,0x0,0x48,0x8d,0xbe,0x88,0x3,0x0,0x0,0x48,0x89,0xda,0x48,0x83,0xc4,0x18,0x5b,0x41,0x5c,0x41,0x5d,0x41,0x5e,0x41,0x5f,0x5d,0xe9,0x53,0xfc,0x3f,0xfd};


static __attribute__((unused)) uint64_t mono_ns(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000000000ULL+(uint64_t)t.tv_nsec;}

static int rd(up at,void *out,size_t n){
 int valid=at>=0x10000&&at<UINT64_C(0x0000800000000000)&&n<=0x10000;
 ssize_t result=valid?pread(memfd,out,n,(off_t)at):-1;int saved_errno=valid?errno:EINVAL;
 if(result!=(ssize_t)n&&diagnostic_scope&&!diagnostic_frozen&&!atomic_load(&telemetry_read_size)){
  atomic_store(&telemetry_read_address,at);atomic_store(&telemetry_read_result,(int64_t)result);
  atomic_store(&telemetry_read_errno,result<0?saved_errno:0);atomic_store(&telemetry_read_size,n?n:1);
 }
 return valid&&result==(ssize_t)n;
}

static __attribute__((unused)) up ptr(up at){up v=0;rd(at,&v,sizeof v);return v;}

static __attribute__((unused)) int hdr(up at,struct obj *out){return rd(at,out,sizeof *out)&&out->index>=0&&out->cls>=0x10000;}

static __attribute__((unused)) int table_read(struct table *t){return rd(TABLE,t,sizeof *t)&&t->count>100&&t->count<=t->max&&t->max<(1<<27)&&t->nchunks>0&&t->nchunks<=t->maxchunks&&t->maxchunks<=8192&&(t->nchunks-1)*65536<t->count&&t->count<=t->nchunks*65536;}

static __attribute__((unused)) int slot_get(const struct table *t,int i,struct slot *s){return i>=0&&i<t->count&&rd(ptr(t->chunks+8UL*(unsigned)(i/65536))+24UL*(unsigned)(i%65536),s,sizeof *s);}

static __attribute__((unused)) int identity(const struct table *t,up at,struct identity *id){struct obj o;struct slot s;if(!hdr(at,&o)||(o.flags&BAD_OBJECT)||!slot_get(t,o.index,&s)||s.object!=at||s.serial<=0||(s.flags&BAD_SLOT))return 0;*id=(struct identity){.address=at,.index=o.index,.serial=s.serial,.metadata_fingerprint=0};return 1;}

static __attribute__((unused)) uint64_t hash_bytes(uint64_t h,const void *raw,size_t n){const unsigned char *p=raw;for(size_t i=0;i<n;i++){h^=p[i];h*=UINT64_C(1099511628211);}return h;}

static __attribute__((unused)) int metadata_identity(const struct table *t,up at,struct identity *id){
 up seen[8],cursor=at;int count=0;uint64_t fingerprint=UINT64_C(1469598103934665603);struct identity result={0};
 while(cursor&&count<8){
  for(int i=0;i<count;i++)if(seen[i]==cursor)return 0;
  seen[count++]=cursor;struct obj first,second;struct slot before,after;
  if(!hdr(cursor,&first)||(first.flags&(BAD_OBJECT&~0x10U))||!slot_get(t,first.index,&before)||before.object!=cursor||before.serial<0||(before.flags&BAD_SLOT))return 0;
  if(!hdr(cursor,&second)||memcmp(&first,&second,sizeof first)||!slot_get(t,first.index,&after)||after.object!=before.object||after.serial!=before.serial||(after.flags&BAD_SLOT))return 0;
  if(cursor==at)result=(struct identity){.address=at,.index=first.index,.serial=before.serial,.metadata_fingerprint=0};
  fingerprint=hash_bytes(fingerprint,&cursor,sizeof cursor);fingerprint=hash_bytes(fingerprint,&first,sizeof first);fingerprint=hash_bytes(fingerprint,&before.serial,sizeof before.serial);
  cursor=first.outer;
 }
 if(cursor)return 0;
 result.metadata_fingerprint=fingerprint?fingerprint:1;*id=result;return 1;
}

static __attribute__((unused)) int stable_metadata(const struct table *t,struct identity i){struct identity now;return i.address&&i.metadata_fingerprint&&metadata_identity(t,i.address,&now)&&now.index==i.index&&now.serial==i.serial&&now.metadata_fingerprint==i.metadata_fingerprint;}

static __attribute__((unused)) int stable_gameplay(const struct table *t,struct identity i){struct identity now;return i.address&&i.serial>0&&identity(t,i.address,&now)&&now.index==i.index&&now.serial==i.serial;}

static __attribute__((unused)) int same(struct identity a,struct identity b){return a.address==b.address&&a.index==b.index&&a.serial==b.serial;}

static __attribute__((unused)) int fname(uint32_t id,uint32_t number,char *out,size_t cap){
 if((id>>16)>=8192||cap<2)return 0;
 up at=ptr(NAMES+8UL*(id>>16))+2UL*(id&65535);uint16_t h;
 if(!rd(at,&h,2))return 0;
 unsigned n=h>>6;
 if(!n||n>=cap||n>1024||(h&1)||!rd(at+2,out,n))return 0;
 for(unsigned i=0;i<n;i++)if((unsigned char)out[i]<32||(unsigned char)out[i]>126)return 0;
 out[n]=0;if(number){int x=snprintf(out+n,cap-n,"_%u",number-1);if(x<0||(size_t)x>=cap-n)return 0;}return 1;
}

static __attribute__((unused)) int name(up at,char *out,size_t cap){struct obj o;return hdr(at,&o)&&fname(o.ni,o.nn,out,cap);}

static __attribute__((unused)) int named(up at,const char *wanted){char s[128];return name(at,s,sizeof s)&&!strcmp(s,wanted);}

static __attribute__((unused)) int derives(up cls,up wanted){up seen[32];int n=0;while(cls&&n<32){if(cls==wanted)return 1;for(int i=0;i<n;i++)if(seen[i]==cls)return 0;seen[n++]=cls;cls=ptr(cls+0x40);}return 0;}

static __attribute__((unused)) int in_world(up object,up world){up seen[32];int n=0;while(object&&n<32){if(object==world)return 1;for(int i=0;i<n;i++)if(seen[i]==object)return 0;seen[n++]=object;struct obj o;if(!hdr(object,&o))return 0;object=o.outer;}return 0;}

static __attribute__((unused)) int property(up cls,const char *wanted,const char *type,int expected_size,int expected_offset){
 up ancestry[32];int count=0;
 while(cls&&count<32){for(int i=0;i<count;i++)if(ancestry[i]==cls)return 0;ancestry[count++]=cls;
  up at=ptr(cls+0x50);for(int i=0;at&&i<1024;i++){unsigned char raw[0x48];char n[128],kind[64];uint32_t ni,nn;int32_t dim,size,off;up fc,next;
   if(!rd(at,raw,sizeof raw))return 0;
   memcpy(&ni,raw+0x20,4);memcpy(&nn,raw+0x24,4);memcpy(&next,raw+0x18,8);
   if(fname(ni,nn,n,sizeof n)&&!strcmp(n,wanted)){uint32_t ids[2];memcpy(&fc,raw+8,8);memcpy(&dim,raw+0x2c,4);memcpy(&size,raw+0x30,4);memcpy(&off,raw+0x44,4);
    return rd(fc,ids,8)&&fname(ids[0],ids[1],kind,sizeof kind)&&!strcmp(kind,type)&&dim==1&&size==expected_size&&off==expected_offset;}
   at=next;
  }cls=ptr(cls+0x40);
 }return 0;
}

static __attribute__((unused)) int object_property_pointer(up object,up cls,const char *wanted,const char *type,up *out){
 up ancestry[32];int count=0;
 while(cls&&count<32){
  for(int i=0;i<count;i++)if(ancestry[i]==cls)return 0;
  ancestry[count++]=cls;up at=ptr(cls+0x50);
  for(int i=0;at&&i<1024;i++){
   unsigned char raw[0x48];char n[128],kind[64];uint32_t ni,nn,ids[2];int32_t dim,size,off;up fc,next;
   if(!rd(at,raw,sizeof raw))return 0;
   memcpy(&ni,raw+0x20,4);memcpy(&nn,raw+0x24,4);memcpy(&next,raw+0x18,8);
   if(fname(ni,nn,n,sizeof n)&&!strcmp(n,wanted)){
    memcpy(&fc,raw+8,8);memcpy(&dim,raw+0x2c,4);memcpy(&size,raw+0x30,4);memcpy(&off,raw+0x44,4);
    if(!rd(fc,ids,8)||!fname(ids[0],ids[1],kind,sizeof kind)||strcmp(kind,type)||dim!=1||size!=8||off<0||off>1048576)return 0;
    return rd(object+(unsigned)off,out,8);
   }
   at=next;
  }
  cls=ptr(cls+0x40);
 }
 return 0;
}

static __attribute__((unused)) up active_world(void){up e=ptr(ENGINE_GLOBAL),array,ctx,w;int32_t n,cap;
 if(!e||ptr(e)!=ENGINE_VPTR||!rd(e+0x11a0,&n,4)||!rd(e+0x11a4,&cap,4)||n!=1||cap<n||cap>32)return 0;
 array=ptr(e+0x1198);ctx=ptr(array);w=ptr(ctx+0x2c0);return w&&ptr(WORLD_GLOBAL)==w?w:0;
}

static __attribute__((unused)) int graph(const struct table *t,struct identity *world,struct identity *gs,struct identity *gm){
 up w=active_world();struct obj wo,go,mo;
 if(!w||!identity(t,w,world)||!hdr(w,&wo)||wo.cls!=classes[0].id.address)return 0;
 if(!property(wo.cls,"GameState","ObjectProperty",8,0x1e0)||!property(wo.cls,"AuthorityGameMode","ObjectProperty",8,0x1d8)||!property(wo.cls,"PersistentLevel","ObjectProperty",8,0x30))return 0;
 up g=ptr(w+0x1e0),m=ptr(w+0x1d8),level=ptr(w+0x30);
 if(!identity(t,g,gs)||!identity(t,m,gm)||!hdr(g,&go)||!hdr(m,&mo)||!derives(go.cls,classes[1].id.address)||go.outer!=level||mo.outer!=level||ptr(level+32)!=w)return 0;
 return property(go.cls,"AuthorityGameMode","ObjectProperty",8,0x2c0)&&property(mo.cls,"GameState","ObjectProperty",8,0x318)&&ptr(g+0x2c0)==m&&ptr(m+0x318)==g;
}

static __attribute__((unused)) int function_allowed(const char *owner,const char *method){
 static const char *const allow[][2]={
  {"GameplayStatics","BeginDeferredActorSpawnFromClass"},{"GameplayStatics","FinishSpawningActor"},
  {"Actor","K2_DestroyActor"},{"SQPlayerState","BlueprintSetPlayerName"},{"SQPlayerController","BlueprintSetPlayerName"},
  {"SQPlayerController","ClientSystemMessage"},{"SQPlayerState","SetTeamState"},{"SQPlayerState","OnRep_UniqueId"},{"SQPlayerController","ClientPlayerJoined"},{"SQPlayerController","ClientPlayerLeft"},
  {"SQTeamState","AddPlayerState"},{"SQTeamState","RemovePlayerState"},{"SQSquadState","AddPlayerState"},{"SQSquadState","RemovePlayerState"},
  {"SQGameState","AddPlayerState"},{"SQGameState","RemovePlayerState"},
  {"GameStateBase","AddPlayerState"},{"GameStateBase","RemovePlayerState"},
  {"GameModeBase","SpawnPlayerController"},{"GameModeBase","GetNumPlayers"},{"GameMode","GetNumPlayers"},
  {"GameModeBase","HandleStartingNewPlayer"},{"GameModeBase","K2_PostLogin"}
 };
 for(size_t i=0;i<sizeof allow/sizeof allow[0];i++)if(!strcmp(owner,allow[i][0])&&!strcmp(method,allow[i][1]))return 1;
 return 0;
}

static __attribute__((unused)) void inspect_function(const struct table *t,up at,const struct obj *o,uint64_t until,int script_struct){
 char owner[64],method[80];struct obj cls;struct identity fid;
 if(!fname(o->ni,o->nn,method,sizeof method)||!metadata_identity(t,at,&fid))return;
 if(script_struct){
  if(strcmp(method,"Transform")&&strcmp(method,"Quat")&&strcmp(method,"Vector")&&strcmp(method,"LinearColor"))return;
  if(!named(o->outer,"/Script/CoreUObject"))return;
  strcpy(owner,"/Script/CoreUObject");
 }else{
  if(!name(o->outer,owner,sizeof owner)||!function_allowed(owner,method)||!hdr(o->outer,&cls)||!named(cls.cls,"Class"))return;
  const char *pkg=!strncmp(owner,"SQ",2)?"/Script/Squad":"/Script/Engine";if(!named(cls.outer,pkg))return;
 }
 int i;for(i=0;i<current.function_count;i++)if(!strcmp(current.functions[i].owner,owner)&&!strcmp(current.functions[i].name,method))break;
 if(i==MAX_FUNCTIONS)return;
 struct function f;memset(&f,0,sizeof f);snprintf(f.owner,sizeof f.owner,"%s",owner);snprintf(f.name,sizeof f.name,"%s",method);f.id=fid;f.is_script_struct=script_struct;
 if(!rd(at+0x58,&f.reported_struct_size,4)||f.reported_struct_size>65536||!rd(at+0x5c,f.header_bytes_5c,sizeof f.header_bytes_5c))return;
 if(!script_struct&&(!rd(at+0xb0,&f.function_flags,4)||!rd(at+0xb6,&f.parms_size,2)||!rd(at+0xb8,&f.return_offset,2)))return;
 up p=ptr(at+0x50),seen[MAX_PARAMS];int n=0;
 while(p&&n<MAX_PARAMS){
  if(mono_ns()>until)break;
  for(int j=0;j<n;j++)if(seen[j]==p)return;
  seen[n]=p;
  unsigned char raw[0x48];uint32_t ids[2];up fc,next;struct field *field=&f.fields[n];
  if(!rd(p,raw,sizeof raw))return;
  memcpy(&fc,raw+8,8);memcpy(&next,raw+0x18,8);memcpy(ids,raw+0x20,8);
  if(!fname(ids[0],ids[1],field->name,sizeof field->name)||!rd(fc,ids,8)||!fname(ids[0],ids[1],field->type,sizeof field->type))return;
  memcpy(&field->dim,raw+0x2c,4);memcpy(&field->size,raw+0x30,4);memcpy(&field->raw_flags,raw+0x38,8);memcpy(&field->offset,raw+0x44,4);field->descriptor=p;
  if(field->dim<1||field->dim>1024||field->size<1||field->size>65536||field->offset<0||field->offset>65536||(uint64_t)field->dim*(uint64_t)field->size>65536)return;
  n++;p=next;
 }
 f.field_count=n;f.fields_complete=p==0;
 if(!stable_metadata(t,fid))return;
 /* Budget exhaustion must not erase a complete observation of the same
  * metadata object. A changed identity can still replace the old entry.
  */
 if(i<current.function_count&&current.functions[i].fields_complete&&!f.fields_complete&&same(current.functions[i].id,fid)&&current.functions[i].id.metadata_fingerprint==fid.metadata_fingerprint)return;
 current.functions[i]=f;if(i==current.function_count)current.function_count++;
}

static __attribute__((unused)) void reset_census(struct identity world,struct identity gs,struct identity gm){
 current.world=world;current.gs=gs;current.gm=gm;current.generation++;current.cursor=0;
 current.active_player_states=current.controllers=current.pawns=current.invalid_headers=0;
 current.completed_player_states=current.completed_controllers=current.completed_pawns=0;current.completed_scans=0;
}

static void metadata_snapshot(const struct table *,up,struct metadata_snapshot *);

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

struct expected_field { const char *name,*type,*target;int offset,size;uint64_t flags; };
/* Absent until exact live RPC/Color/enum metadata and frozen ELF bytes pass generation. */
#include "message_contract.generated.h"
static const struct expected_field begin_fields[]={
 {"WorldContextObject","ObjectProperty","Object",0,8,UINT64_C(0x18001000000282)},
 {"ActorClass","ClassProperty","Class",8,8,UINT64_C(0x1c001000000280)},
 {"SpawnTransform","StructProperty","Transform",16,96,UINT64_C(0x18001048000182)},
 {"CollisionHandlingOverride","EnumProperty","ESpawnActorCollisionHandlingMethod",112,1,UINT64_C(0x18001040000280)},
 {"Owner","ObjectProperty","Actor",120,8,UINT64_C(0x18001000000280)},
 {"TransformScaleMethod","EnumProperty","ESpawnActorScaleMethod",128,1,UINT64_C(0x18001040000280)},
 {"ReturnValue","ObjectProperty","Actor",136,8,UINT64_C(0x18001000000780)}
};
static const struct expected_field finish_fields[]={
 {"Actor","ObjectProperty","Actor",0,8,UINT64_C(0x18001000000280)},
 {"SpawnTransform","StructProperty","Transform",16,96,UINT64_C(0x18001048000182)},
 {"TransformScaleMethod","EnumProperty","ESpawnActorScaleMethod",112,1,UINT64_C(0x18001040000280)},
 {"ReturnValue","ObjectProperty","Actor",120,8,UINT64_C(0x18001000000780)}
};
static const struct expected_field team_fields[]={
 {"NewTeamState","ObjectProperty","SQTeamState",0,8,UINT64_C(0x18001000000280)}
};
static const struct expected_field name_fields[]={
 {"Name","StrProperty",NULL,0,16,UINT64_C(0x18000000000280)}
};
static const struct expected_field vector_fields[]={
 {"X","DoubleProperty",NULL,0,8,UINT64_C(0x18001041000205)},
 {"Y","DoubleProperty",NULL,8,8,UINT64_C(0x18001041000205)},
 {"Z","DoubleProperty",NULL,16,8,UINT64_C(0x18001041000205)}
};
static const struct expected_field quat_fields[]={
 {"X","DoubleProperty",NULL,0,8,UINT64_C(0x18001041000205)},
 {"Y","DoubleProperty",NULL,8,8,UINT64_C(0x18001041000205)},
 {"Z","DoubleProperty",NULL,16,8,UINT64_C(0x18001041000205)},
 {"W","DoubleProperty",NULL,24,8,UINT64_C(0x18001041000205)}
};
static const struct expected_field transform_fields[]={
 {"Rotation","StructProperty","Quat",0,32,UINT64_C(0x18001041000005)},
 {"Translation","StructProperty","Vector",32,24,UINT64_C(0x18001041000205)},
 {"Scale3D","StructProperty","Vector",64,24,UINT64_C(0x18001041000205)}
};


static __attribute__((unused)) int meta_named(const struct table *t,up at,const char *kind,const char *pkg,const char *n){
 struct identity id;struct obj o;
 return metadata_identity(t,at,&id)&&hdr(at,&o)&&named(o.cls,kind)&&named(o.outer,pkg)&&named(at,n)&&stable_metadata(t,id);
}

static __attribute__((unused)) int field_read(up at,struct field *f,up *next){
 unsigned char a[0x48],b[0x48];uint32_t ids[2];up fc;
 if(!rd(at,a,sizeof a)||!rd(at,b,sizeof b)||memcmp(a,b,sizeof a))return 0;
 memcpy(&fc,a+8,8);memcpy(next,a+0x18,8);memcpy(ids,a+0x20,8);
 memset(f,0,sizeof *f);f->descriptor=at;
 if(!fname(ids[0],ids[1],f->name,sizeof f->name)||!rd(fc,ids,8)||!fname(ids[0],ids[1],f->type,sizeof f->type))return 0;
 memcpy(&f->dim,a+0x2c,4);memcpy(&f->size,a+0x30,4);memcpy(&f->raw_flags,a+0x38,8);memcpy(&f->offset,a+0x44,4);
 return f->dim==1&&f->size>0&&f->size<=65536&&f->offset>=0&&f->offset<=65536;
}

static __attribute__((unused)) int target_matches(const struct table *t,const struct field *f,const char *target){
 if(!target)return 1;
 if(!strcmp(f->type,"StructProperty"))return meta_named(t,ptr(f->descriptor+0x70),"ScriptStruct","/Script/CoreUObject",target);
 if(!strcmp(f->type,"EnumProperty")){
  struct field inner;up next=0;
  return meta_named(t,ptr(f->descriptor+0x78),"Enum",!strcmp(target,"ESQNotificationTypes")?"/Script/Squad":"/Script/Engine",target)&&field_read(ptr(f->descriptor+0x70),&inner,&next)&&!strcmp(inner.type,"ByteProperty")&&inner.size==1;
 }
 if(!strcmp(f->type,"ObjectProperty")||!strcmp(f->type,"ClassProperty")){
  const char *pkg=(!strcmp(target,"Object")||!strcmp(target,"Class"))?"/Script/CoreUObject":(!strncmp(target,"SQ",2)?"/Script/Squad":"/Script/Engine");
  if(!meta_named(t,ptr(f->descriptor+0x70),"Class",pkg,target))return 0;
  return strcmp(f->type,"ClassProperty")||meta_named(t,ptr(f->descriptor+0x78),"Class","/Script/Engine","Actor");
 }
 return 0;
}

static __attribute__((unused)) int fields_match(const struct table *t,up object,const struct expected_field *expected,size_t count){
 up cursor=0,seen[MAX_PARAMS];
 if(count>MAX_PARAMS||!rd(object+0x50,&cursor,sizeof cursor))return 0;
 for(size_t i=0;i<count;i++){
  struct field f;up next=0;
  if(!cursor)return 0;
  for(size_t j=0;j<i;j++)if(seen[j]==cursor)return 0;
  seen[i]=cursor;
  if(!field_read(cursor,&f,&next)||strcmp(f.name,expected[i].name)||strcmp(f.type,expected[i].type)||f.offset!=expected[i].offset||f.size!=expected[i].size||f.raw_flags!=expected[i].flags||!target_matches(t,&f,expected[i].target))return 0;
  cursor=next;
 }
 return cursor==0;
}

static __attribute__((unused)) struct identity cached_meta(const char *owner,const char *method){
 for(int i=0;i<current.function_count;i++)if(!strcmp(current.functions[i].owner,owner)&&!strcmp(current.functions[i].name,method))return current.functions[i].id;
 return (struct identity){0};
}

static __attribute__((unused)) int fresh_function(const struct table *t,struct identity id,const char *owner,const char *method,uint32_t flags,uint16_t bytes,uint16_t ret,up exec,const struct expected_field *fields,size_t n){
 struct obj o,c;uint32_t actual_flags,size;uint16_t actual_bytes,actual_ret;up actual_exec;
 const char *package=!strncmp(owner,"SQ",2)?"/Script/Squad":"/Script/Engine";
 if(!stable_metadata(t,id)||!hdr(id.address,&o)||!named(o.cls,"Function")||!named(id.address,method)||!hdr(o.outer,&c)||!named(c.cls,"Class")||!named(o.outer,owner)||!named(c.outer,package))return 0;
 if(!rd(id.address+0x58,&size,4)||size!=bytes||!rd(id.address+0xb0,&actual_flags,4)||actual_flags!=flags||!rd(id.address+0xb6,&actual_bytes,2)||actual_bytes!=bytes||!rd(id.address+0xb8,&actual_ret,2)||actual_ret!=ret||!rd(id.address+0xd8,&actual_exec,8)||actual_exec!=exec)return 0;
 return fields_match(t,id.address,fields,n)&&stable_metadata(t,id);
}

static __attribute__((unused)) int fresh_struct(const struct table *t,const char *n,uint32_t bytes,const struct expected_field *fields,size_t count){
 struct identity id=cached_meta("/Script/CoreUObject",n);uint32_t size;
 return stable_metadata(t,id)&&meta_named(t,id.address,"ScriptStruct","/Script/CoreUObject",n)&&rd(id.address+0x58,&size,4)&&size==bytes&&fields_match(t,id.address,fields,count)&&stable_metadata(t,id);
}

static __attribute__((unused)) int enum_values(const struct table *t,struct identity id,const char *enum_name,const char *const *suffix,size_t count){
 up names,values;int32_t n;struct identity after;
 if(!stable_metadata(t,id)||!meta_named(t,id.address,"Enum","/Script/Engine",enum_name)||!rd(id.address+0x40,&names,8)||!rd(id.address+0x48,&values,8)||!rd(id.address+0x50,&n,4)||n!=(int32_t)count||count>32)return 0;
 names&=~UINT64_C(1);values&=~UINT64_C(1);
 if(names<0x10000||values<0x10000||(names&7)||(values&7))return 0;
 for(size_t i=0;i<count;i++){
  uint32_t fn[2];int64_t value;char actual[192],expected[192];
  if(!rd(names+8*i,fn,8)||!rd(values+8*i,&value,8)||value!=(int64_t)i||!fname(fn[0],fn[1],actual,sizeof actual))return 0;
  int len=snprintf(expected,sizeof expected,"%s::%s",enum_name,suffix[i]);
  if(len<0||(size_t)len>=sizeof expected||strcmp(actual,expected))return 0;
 }
 return metadata_identity(t,id.address,&after)&&after.metadata_fingerprint==id.metadata_fingerprint&&after.serial==id.serial;
}

static __attribute__((unused)) int uclass_metaclass(const struct table *t,up cls){
 struct identity world_class=classes[0].id,object_id,chain[32];struct obj world_header,object_header;
 if(!stable_metadata(t,world_class)||!hdr(world_class.address,&world_header)||!named(world_class.address,"World")||!named(world_header.outer,"/Script/Engine"))return 0;
 up native_class=world_header.cls;
 if(!meta_named(t,native_class,"Class","/Script/CoreUObject","Class")||!metadata_identity(t,cls,&object_id)||!hdr(cls,&object_header))return 0;
 up cursor=object_header.cls;int count=0,found=0;
 while(cursor&&count<32){
  for(int i=0;i<count;i++)if(chain[i].address==cursor)return 0;
  struct obj h;
  if(!metadata_identity(t,cursor,&chain[count])||!hdr(cursor,&h)||h.cls!=native_class)return 0;
  count++;
  if(cursor==native_class){found=1;break;}
  cursor=ptr(cursor+0x40);
 }
 if(!found||!stable_metadata(t,object_id)||!stable_metadata(t,world_class))return 0;
 for(int i=0;i<count;i++)if(!stable_metadata(t,chain[i]))return 0;
 return 1;
}

static __attribute__((unused)) int find_property(const struct table *t,up cls,const char *wanted,const char *type,int size,int offset,const char *target,struct field *out){
 up ancestors[32];int count=0;
 while(cls&&count<32){
  for(int i=0;i<count;i++)if(ancestors[i]==cls)return 0;
  ancestors[count++]=cls;struct identity cid;
  if(!metadata_identity(t,cls,&cid)||!uclass_metaclass(t,cls))return 0;
  up at=ptr(cls+0x50),seen[1024];int fields=0;
  while(at&&fields<1024){
   for(int i=0;i<fields;i++)if(seen[i]==at)return 0;
   seen[fields++]=at;struct field f;up next;
   if(!field_read(at,&f,&next))return 0;
   if(!strcmp(f.name,wanted)){
    if(strcmp(f.type,type)||f.size!=size||f.offset!=offset||!target_matches(t,&f,target)||!stable_metadata(t,cid))return 0;
    f.declaring_class=cls;*out=f;return 1;
   }
   at=next;
  }
  if(at)return 0;
  cls=ptr(cls+0x40);
 }
 return 0;
}

static __attribute__((unused)) int player_array(const struct table *t,up gs,up actor,uint32_t *count,int *occurrences){
 struct obj o;struct field f,inner;up next=0;struct array_header a,b;
 if(!hdr(gs,&o)||!find_property(t,o.cls,"PlayerArray","ArrayProperty",16,0x2d0,NULL,&f)||!field_read(ptr(f.descriptor+0x78),&inner,&next)||strcmp(inner.type,"ObjectProperty")||inner.size!=8||!target_matches(t,&inner,"PlayerState"))return 0;
 if(!rd(gs+0x2d0,&a,sizeof a)||a.count<0||a.count>256||a.capacity<a.count||a.capacity>4096||(a.count&&(!a.data||(a.data&7))))return 0;
 int found=0;
 for(int i=0;i<a.count;i++){
  up item;if(!rd(a.data+8UL*(unsigned)i,&item,8))return 0;
  if(item==actor&&actor)found++;
 }
 if(!rd(gs+0x2d0,&b,sizeof b)||memcmp(&a,&b,sizeof a))return 0;
 *count=(uint32_t)a.count;*occurrences=found;return 1;
}

static __attribute__((unused)) int reflected_array(const struct table *t,up owner,const char *field,const char *declaring,int offset,const char *target,up needle,uint32_t *count,int *occurrences,int selected_index,up *selected){
 struct obj o;struct field f,inner;up next=0,inner_address=0;struct array_header a,b;
 if(!hdr(owner,&o)||!find_property(t,o.cls,field,"ArrayProperty",16,offset,NULL,&f)||!meta_named(t,f.declaring_class,"Class","/Script/Squad",declaring)||!rd(f.descriptor+0x78,&inner_address,8)||!field_read(inner_address,&inner,&next)||strcmp(inner.type,"ObjectProperty")||inner.size!=8||!target_matches(t,&inner,target))return 0;
 if(!rd(owner+(unsigned)f.offset,&a,sizeof a)||a.count<0||a.count>256||a.capacity<a.count||a.capacity>4096||(a.count&&(!a.data||(a.data&7)))||(selected_index>=0&&selected_index>=a.count))return 0;
 int found=0;up picked=0;
 for(int i=0;i<a.count;i++){
  up item=0;if(!rd(a.data+8UL*(unsigned)i,&item,8))return 0;
  if(needle&&item==needle)found++;
  if(i==selected_index)picked=item;
 }
 if(!rd(owner+(unsigned)f.offset,&b,sizeof b)||memcmp(&a,&b,sizeof a))return 0;
 *count=(uint32_t)a.count;*occurrences=found;if(selected)*selected=picked;return 1;
}

static __attribute__((unused)) int team_player_array(const struct table *t,up team,up actor,uint32_t *count,int *occurrences){
 return reflected_array(t,team,"PlayerStates","SQTeamState",0x398,"SQPlayerState",actor,count,occurrences,-1,NULL);
}

static __attribute__((unused)) int passive_class_fields(const struct table *t,up cls){
 struct field f;
 return find_property(t,cls,"Owner","ObjectProperty",8,0x158,"Actor",&f)&&find_property(t,cls,"PawnPrivate","ObjectProperty",8,0x330,"Pawn",&f)&&find_property(t,cls,"CurrentPawn","ObjectProperty",8,0x7b0,"Pawn",&f)&&find_property(t,cls,"TeamState","ObjectProperty",8,0x780,"SQTeamState",&f)&&find_property(t,cls,"SquadState","ObjectProperty",8,0x788,"SQSquadState",&f)&&find_property(t,cls,"TeamId","IntProperty",4,0x4b0,NULL,&f)&&find_property(t,cls,"PlayerNamePrivate","StrProperty",16,0x348,NULL,&f);
}

static __attribute__((unused)) int passive_actor_fields(const struct table *t,up actor,up expected_team,int expected_team_id){
 struct obj o;static const unsigned offsets[5]={0x158,0x330,0x7b0,0x780,0x788};int okay=1;
 memset(once_result.pointers,0,sizeof once_result.pointers);once_result.team_id_read_success=0;
 if(!hdr(actor,&o)||!passive_class_fields(t,o.cls))return 0;
 for(int i=0;i<5;i++){
  struct pointer_observation *p=&once_result.pointers[i];p->read_success=rd(actor+offsets[i],&p->value,8);
  if(!p->read_success||p->value!=(i==3?expected_team:0))okay=0;
 }
 once_result.team_id_read_success=rd(actor+0x4b0,&once_result.team_id,4);
 return okay&&once_result.team_id_read_success&&(expected_team_id<0||once_result.team_id==expected_team_id);
}

static __attribute__((unused)) int naming_code_matches(void){
 unsigned char bytes[200];
 return rd(ENGINE_NEW,bytes,sizeof engine_new_full)&&!memcmp(bytes,engine_new_full,sizeof engine_new_full)&&rd(ENGINE_DELETE,bytes,sizeof engine_delete_full)&&!memcmp(bytes,engine_delete_full,sizeof engine_delete_full)&&rd(0xa36e300,bytes,sizeof native_name_exec_full)&&!memcmp(bytes,native_name_exec_full,sizeof native_name_exec_full)&&rd(ACTOR_PROCESS_EVENT,bytes,sizeof actor_process_event_entry32)&&!memcmp(bytes,actor_process_event_entry32,sizeof actor_process_event_entry32)&&rd(BASE_PROCESS_EVENT,bytes,sizeof uobject_process_event_entry32)&&!memcmp(bytes,uobject_process_event_entry32,sizeof uobject_process_event_entry32)&&rd(0xa5a6d30,bytes,sizeof sq_name_override_full)&&!memcmp(bytes,sq_name_override_full,sizeof sq_name_override_full)&&rd(0x82e1d70,bytes,sizeof playerstate_setnameinternal_full)&&!memcmp(bytes,playerstate_setnameinternal_full,sizeof playerstate_setnameinternal_full)&&rd(0x4d93460,bytes,sizeof strproperty_deepcopy_full)&&!memcmp(bytes,strproperty_deepcopy_full,sizeof strproperty_deepcopy_full)&&rd(0x82e1e00,bytes,sizeof playerstate_setname_entry32)&&!memcmp(bytes,playerstate_setname_entry32,sizeof playerstate_setname_entry32)&&rd(0x4cee590,bytes,sizeof strproperty_copyin_full)&&!memcmp(bytes,strproperty_copyin_full,sizeof strproperty_copyin_full);
}

static __attribute__((unused)) int fresh_actor_read(const struct table *t,up at,struct obj *o,struct slot *s){
 struct obj b;struct slot after;
 return hdr(at,o)&&!(o->flags&BAD_OBJECT)&&slot_get(t,o->index,s)&&s->object==at&&s->serial>=0&&!(s->flags&BAD_SLOT)&&hdr(at,&b)&&!memcmp(o,&b,sizeof b)&&slot_get(t,o->index,&after)&&after.object==s->object&&after.serial==s->serial&&!(after.flags&BAD_SLOT);
}

static __attribute__((unused)) int fresh_actor_capture(const struct table *t,up at,up cls,up level,struct fresh_actor *actor){
 struct obj o;struct slot s;
 if(!atomic_load(&transaction_active)||atomic_load(&reentry_detected)||!fresh_actor_read(t,at,&o,&s)||o.cls!=cls||o.outer!=level||ptr(o.vptr+0x268)!=ACTOR_PROCESS_EVENT)return 0;
 *actor=(struct fresh_actor){at,o,s.serial,callback_epoch};return 1;
}

static __attribute__((unused)) int fresh_actor_same(const struct table *t,struct fresh_actor *actor){
 struct obj o;struct slot s;
 if(!atomic_load(&transaction_active)||atomic_load(&reentry_detected)||actor->epoch!=callback_epoch||!fresh_actor_read(t,actor->address,&o,&s)||memcmp(&o,&actor->header,sizeof o)||ptr(o.vptr+0x268)!=ACTOR_PROCESS_EVENT)return 0;
 if(actor->serial>0&&s.serial!=actor->serial)return 0;
 actor->serial=s.serial;return 1;
}

static __attribute__((unused)) int held_actor_same(const struct table *t,const struct fresh_actor *actor){
 struct slot before,after;struct obj a,b;
 if(!atomic_load(&transaction_active)||atomic_load(&reentry_detected)||actor->serial<=0||!slot_get(t,actor->header.index,&before)||before.object!=actor->address||before.serial!=actor->serial||(before.flags&BAD_SLOT))return 0;
 /* Resolve the saved positive weak identity before reading the old address. */
 if(!hdr(actor->address,&a)||(a.flags&BAD_OBJECT)||memcmp(&a,&actor->header,sizeof a)||!hdr(actor->address,&b)||memcmp(&a,&b,sizeof a)||!slot_get(t,actor->header.index,&after)||after.object!=before.object||after.serial!=before.serial||(after.flags&BAD_SLOT))return 0;
 return ptr(a.vptr+0x268)==ACTOR_PROCESS_EVENT;
}

static __attribute__((unused)) void metadata_snapshot(const struct table *t,up at,struct metadata_snapshot *out){
 struct metadata_snapshot snapshot={0};up cursor=at;
 while(cursor&&snapshot.count<8){
  for(int i=0;i<snapshot.count;i++)if(snapshot.links[i].address==cursor){*out=snapshot;return;}
  struct obj a,b;struct slot before,after;
  if(!hdr(cursor,&a)||!slot_get(t,a.index,&before)||before.object!=cursor||!hdr(cursor,&b)||memcmp(&a,&b,sizeof a)||!slot_get(t,a.index,&after)||after.object!=before.object||after.serial!=before.serial){*out=snapshot;return;}
  snapshot.links[snapshot.count++]=(struct metadata_link){cursor,a,before.serial};cursor=a.outer;
 }
 snapshot.complete=cursor==0;*out=snapshot;
}

static __attribute__((unused)) int fresh_name_function(const struct table *t,struct identity id){
 struct field f,own;up next=0;
 if(!fresh_function(t,id,"SQPlayerState","BlueprintSetPlayerName",67240961U,16,65535,0xa36e300,name_fields,1)||!field_read(ptr(id.address+0x50),&f,&next)||next||!(f.raw_flags&0x80U)||(f.raw_flags&UINT64_C(0x8000102))||ptr(f.descriptor)!=0x143bd38||ptr(0x143bd38+0xf8)!=0x4d93460||ptr(0x143bd38+0x118)!=0x4cee590)return 0;
 return find_property(t,once_binding.state_class.address,"PlayerNamePrivate","StrProperty",16,0x348,NULL,&own)&&ptr(own.descriptor)==0x143bd38;
}

static __attribute__((unused)) int team_code_matches(void){
 unsigned char bytes[887];
 return rd(0xa372f30,bytes,sizeof team_exec_full)&&!memcmp(bytes,team_exec_full,sizeof team_exec_full)&&rd(0xa5a7910,bytes,sizeof team_setter_full)&&!memcmp(bytes,team_setter_full,sizeof team_setter_full)&&rd(0xa5a74c0,bytes,sizeof team_onrep_full)&&!memcmp(bytes,team_onrep_full,sizeof team_onrep_full)&&rd(0xa6005a0,bytes,sizeof team_add_full)&&!memcmp(bytes,team_add_full,sizeof team_add_full)&&rd(0xa600640,bytes,sizeof team_remove_full)&&!memcmp(bytes,team_remove_full,sizeof team_remove_full);
}

static __attribute__((unused)) int fresh_team_function(const struct table *t,struct identity id,up actor_vptr){
 return fresh_function(t,id,"SQPlayerState","SetTeamState",UINT32_C(0x04020400),8,65535,0xa372f30,team_fields,1)&&(!actor_vptr||(ptr(actor_vptr+0x978)==0xa5a7910&&ptr(actor_vptr+0x8e0)==0xa5a74c0))&&team_code_matches();
}

static __attribute__((unused)) int name_actor_slots(up vptr){return ptr(vptr+0x268)==ACTOR_PROCESS_EVENT&&ptr(vptr+0x7c0)==0xa5a6d30&&ptr(vptr+0x7c8)==0x82e1d70;}

static __attribute__((unused)) void record_event(void){atomic_fetch_add(&engine_calls,1);atomic_fetch_add(&process_event_calls,1);}

static __attribute__((unused)) void record_allocator(void){atomic_fetch_add(&engine_calls,1);atomic_fetch_add(&allocator_calls,1);}

static __attribute__((unused)) int resolve_team(const struct table *t,up gs,up world,int expected_id,struct identity *out){
 if(expected_id!=1&&expected_id!=2)return 0;
 up team=0,inner_address=0,team_class=0,next=0;uint32_t count=0;int occurrences=0;struct obj o,gso;struct field id,indexed,inner;struct identity candidate;int32_t team_id=0;
 if(!hdr(gs,&gso)||!find_property(t,gso.cls,"IndexedTeamStates","ArrayProperty",16,0x3c8,NULL,&indexed)||!meta_named(t,indexed.declaring_class,"Class","/Script/Squad","SQGameState")||!rd(indexed.descriptor+0x78,&inner_address,8)||!field_read(inner_address,&inner,&next)||!target_matches(t,&inner,"SQTeamState")||!rd(inner.descriptor+0x70,&team_class,8)||!meta_named(t,team_class,"Class","/Script/Squad","SQTeamState"))return 0;
 if(!reflected_array(t,gs,"IndexedTeamStates","SQGameState",0x3c8,"SQTeamState",0,&count,&occurrences,expected_id,&team)||!team||!identity(t,team,&candidate)||!hdr(team,&o)||o.cls!=team_class||o.vptr!=0x2559768||!uclass_metaclass(t,o.cls)||!in_world(team,world)||!find_property(t,o.cls,"ID","IntProperty",4,0x2e0,NULL,&id)||!meta_named(t,id.declaring_class,"Class","/Script/Squad","SQTeamState")||!rd(team+(unsigned)id.offset,&team_id,4)||team_id!=expected_id||ptr(o.vptr+0x778)!=0xa6005a0||ptr(o.vptr+0x780)!=0xa600640)return 0;
 if(!reflected_array(t,gs,"TeamStates","SQGameState",0x3b8,"SQTeamState",team,&count,&occurrences,-1,NULL)||occurrences!=1||!stable_gameplay(t,candidate))return 0;
 *out=candidate;return 1;
}

enum message_check { MESSAGE_DRIFT=-1,MESSAGE_WAIT=0,MESSAGE_READY=1 };

static __attribute__((unused)) int message_header_equal(const struct obj *a,const struct obj *b){
 return a->vptr==b->vptr&&a->flags==b->flags&&a->index==b->index&&a->cls==b->cls&&a->ni==b->ni&&a->nn==b->nn&&a->outer==b->outer;
}

static __attribute__((unused)) int message_field_semantic_equal(const struct field *a,const struct field *b){
 return !memcmp(a->name,b->name,sizeof a->name)&&!memcmp(a->type,b->type,sizeof a->type)&&a->descriptor==b->descriptor&&a->raw_flags==b->raw_flags&&a->declaring_class==b->declaring_class&&a->dim==b->dim&&a->size==b->size&&a->offset==b->offset;
}

static __attribute__((unused)) int message_field_witness_equal(const struct message_field_witness *a,const struct message_field_witness *b){
 return a->repindex_ready==b->repindex_ready&&message_field_semantic_equal(&a->field,&b->field)&&a->bytes==b->bytes&&!memcmp(a->raw,b->raw,sizeof a->raw)&&a->type_class==b->type_class&&!memcmp(a->type_name,b->type_name,sizeof a->type_name)&&a->target==b->target&&a->inner==b->inner;
}

static __attribute__((unused)) int message_node_equal(const struct message_node *a,const struct message_node *b){
 return a->address==b->address&&message_header_equal(&a->header,&b->header)&&a->serial==b->serial&&a->is_class==b->is_class&&a->super==b->super&&a->children==b->children;
}

static __attribute__((unused)) int message_witness_bounds(const struct message_witness *w){
 return w->node_count>=0&&w->node_count<=MESSAGE_WITNESS_NODES&&w->field_count>=0&&w->field_count<=MESSAGE_WITNESS_FIELDS&&w->bytes_count>=0&&w->bytes_count<=8;
}

static __attribute__((unused)) int message_witness_equal(const struct message_witness *a,const struct message_witness *b){
 if(a->anchor.world_epoch!=b->anchor.world_epoch||a->anchor.native_class!=b->anchor.native_class||a->anchor.package_class!=b->anchor.package_class||memcmp(a->anchor.links,b->anchor.links,sizeof a->anchor.links)||memcmp(a->roles,b->roles,sizeof a->roles))return 0;
 for(int i=0;i<4;i++)if(a->anchor.roots[i].address!=b->anchor.roots[i].address||a->anchor.roots[i].index!=b->anchor.roots[i].index||a->anchor.roots[i].serial!=b->anchor.roots[i].serial||a->anchor.roots[i].metadata_fingerprint!=b->anchor.roots[i].metadata_fingerprint||!message_header_equal(&a->anchor.headers[i],&b->anchor.headers[i]))return 0;
 if(!message_witness_bounds(a)||!message_witness_bounds(b)||a->node_count!=b->node_count||a->field_count!=b->field_count||a->bytes_count!=b->bytes_count||a->engine_package!=b->engine_package||!message_header_equal(&a->engine_package_header,&b->engine_package_header))return 0;
 for(int i=0;i<MESSAGE_WITNESS_NODES;i++)if(!message_node_equal(&a->nodes[i],&b->nodes[i]))return 0;
 for(int i=0;i<MESSAGE_WITNESS_FIELDS;i++)if(!message_field_witness_equal(&a->fields[i],&b->fields[i]))return 0;
 for(int i=0;i<8;i++)if(a->bytes[i].address!=b->bytes[i].address||a->bytes[i].size!=b->bytes[i].size||memcmp(a->bytes[i].raw,b->bytes[i].raw,sizeof a->bytes[i].raw))return 0;
 return 1;
}

static __attribute__((unused)) uint64_t message_hash_u32(uint64_t h,uint32_t value){unsigned char bytes[4];for(unsigned i=0;i<4;i++)bytes[i]=(unsigned char)(value>>(8*i));return hash_bytes(h,bytes,sizeof bytes);}

static __attribute__((unused)) uint64_t message_hash_u64(uint64_t h,uint64_t value){unsigned char bytes[8];for(unsigned i=0;i<8;i++)bytes[i]=(unsigned char)(value>>(8*i));return hash_bytes(h,bytes,sizeof bytes);}

static __attribute__((unused)) uint64_t message_hash_header(uint64_t h,const struct obj *o){
 h=message_hash_u64(h,o->vptr);h=message_hash_u32(h,o->flags);h=message_hash_u32(h,(uint32_t)o->index);h=message_hash_u64(h,o->cls);h=message_hash_u32(h,o->ni);h=message_hash_u32(h,o->nn);return message_hash_u64(h,o->outer);
}

static __attribute__((unused)) uint64_t message_hash_field(uint64_t h,const struct field *f){
 h=hash_bytes(h,f->name,sizeof f->name);h=hash_bytes(h,f->type,sizeof f->type);h=message_hash_u64(h,f->descriptor);h=message_hash_u64(h,f->raw_flags);h=message_hash_u64(h,f->declaring_class);h=message_hash_u32(h,(uint32_t)f->dim);h=message_hash_u32(h,(uint32_t)f->size);return message_hash_u32(h,(uint32_t)f->offset);
}

static __attribute__((unused)) uint64_t message_witness_fingerprint(const struct message_witness *w){
 if(!message_witness_bounds(w))return 0;
 uint64_t h=UINT64_C(1469598103934665603);
 h=message_hash_u32(h,(uint32_t)w->node_count);h=message_hash_u32(h,(uint32_t)w->field_count);h=message_hash_u32(h,(uint32_t)w->bytes_count);h=message_hash_u64(h,w->engine_package);h=message_hash_header(h,&w->engine_package_header);
 for(int i=0;i<MESSAGE_WITNESS_NODES;i++){
  const struct message_node *n=&w->nodes[i];h=message_hash_u64(h,n->address);h=message_hash_header(h,&n->header);h=message_hash_u32(h,(uint32_t)n->serial);h=message_hash_u32(h,(uint32_t)n->is_class);h=message_hash_u64(h,n->super);h=message_hash_u64(h,n->children);
 }
 for(int i=0;i<MESSAGE_WITNESS_FIELDS;i++){
  const struct message_field_witness *f=&w->fields[i];h=message_hash_field(h,&f->field);h=hash_bytes(h,f->raw,sizeof f->raw);h=message_hash_u64(h,f->bytes);h=message_hash_u64(h,f->type_class);h=message_hash_u32(h,f->type_name[0]);h=message_hash_u32(h,f->type_name[1]);h=message_hash_u64(h,f->target);h=message_hash_u64(h,f->inner);h=message_hash_u32(h,(uint32_t)f->repindex_ready);
 }
 for(int i=0;i<8;i++){h=message_hash_u64(h,w->bytes[i].address);h=message_hash_u64(h,w->bytes[i].size);h=hash_bytes(h,w->bytes[i].raw,sizeof w->bytes[i].raw);}
 h=message_hash_u64(h,w->anchor.world_epoch);h=message_hash_u64(h,w->anchor.native_class);h=message_hash_u64(h,w->anchor.package_class);
 for(int i=0;i<4;i++){h=message_hash_u64(h,w->anchor.roots[i].address);h=message_hash_u32(h,(uint32_t)w->anchor.roots[i].index);h=message_hash_u32(h,(uint32_t)w->anchor.roots[i].serial);h=message_hash_u64(h,w->anchor.roots[i].metadata_fingerprint);h=message_hash_header(h,&w->anchor.headers[i]);}
 for(int i=0;i<7;i++)h=message_hash_u64(h,w->anchor.links[i]);
 h=hash_bytes(h,w->roles,sizeof w->roles);
 return h?h:1;
}

/* Pinned-build, read-only FProperty RepIndex initialization validator.
 * Exact writer: 0x4c31ee3 (66 89 42 40), builder: 0x4c31540.
 * No UE call, allocation, target write, saved-witness update or cache lookup.
 * The caller retains full field semantics / graph double-read / atomic commit.
 * Capture records readiness, including an already-ready valid index0, in the
 * caller's private witness. The transition validator never changes that witness.
 */
struct ue_repindex_sample {
 struct obj declaring,metaclass,package;
 struct slot declaring_slot,metaclass_slot,package_slot;
 struct identity declaring_id,metaclass_id;
 uint32_t class_flags;
 struct array_header reps;
 unsigned char record[16];
};

static int ue_repindex_pointer(up value){
 return value>=UINT64_C(0x10000)&&value<UINT64_C(0x800000000000)&&!(value&7U);
}

static int ue_repindex_object(const struct table *t,up address,struct obj *header,struct slot *slot){
 if(!rd(address,header,sizeof *header))return MESSAGE_WAIT;
 if(header->index<0||header->cls<0x10000||(header->flags&(BAD_OBJECT&~0x10U)))return MESSAGE_DRIFT;
 if(!slot_get(t,header->index,slot))return MESSAGE_WAIT;
 if(slot->object!=address||slot->serial<0||(slot->flags&BAD_SLOT))return MESSAGE_DRIFT;
 return MESSAGE_READY;
}

static int ue_repindex_name(up address,const char *first,const char *second){
 char text[128];
 if(!name(address,text,sizeof text))return MESSAGE_WAIT;
 return !strcmp(text,first)||(second&&!strcmp(text,second))?MESSAGE_READY:MESSAGE_DRIFT;
}

static int ue_repindex_finish_object(const struct table *t,up address,const struct obj *before,
                                    const struct slot *slot_before,const struct identity *middle){
 struct obj after;struct slot slot_after;
 int result=ue_repindex_object(t,address,&after,&slot_after);
 if(result!=MESSAGE_READY)return result;
 if(!message_header_equal(before,&after)||slot_before->object!=slot_after.object)return MESSAGE_DRIFT;
 if(middle&&(middle->address!=address||middle->index!=after.index))return MESSAGE_DRIFT;
 int32_t first=slot_before->serial,mid=middle?middle->serial:first,last=slot_after.serial;
 if(first==mid&&mid==last)return MESSAGE_READY;
 if(first==0&&mid>=0&&last>0&&(mid==0||mid==last))return MESSAGE_WAIT;
 return MESSAGE_DRIFT;
}

static int ue_repindex_descriptor(const struct message_field_witness *saved,const unsigned char *current_raw){
 unsigned char descriptor[0x78];
 if(!rd(saved->field.descriptor,descriptor,saved->bytes))return MESSAGE_WAIT;
 if(!memcmp(descriptor,current_raw,saved->bytes))return MESSAGE_READY;
 uint16_t before,after;memcpy(&before,current_raw+0x40,2);memcpy(&after,descriptor+0x40,2);
 if(!saved->repindex_ready&&!before&&after&&
    !memcmp(descriptor,current_raw,0x40)&&!memcmp(descriptor+0x42,current_raw+0x42,saved->bytes-0x42))return MESSAGE_WAIT;
 return MESSAGE_DRIFT;
}

static int ue_repindex_sample(const struct table *t,const struct message_field_witness *saved,
                             const unsigned char *current_raw,uint16_t index,
                             int require_ready,struct ue_repindex_sample *out){
 struct ue_repindex_sample candidate={0};
 up declaring=saved->field.declaring_class;
 int result=ue_repindex_object(t,declaring,&candidate.declaring,&candidate.declaring_slot);
 if(result!=MESSAGE_READY)return result;
 /* The exact native UClass vptr excludes BlueprintGeneratedClass derivatives. */
 if(candidate.declaring.vptr!=UINT64_C(0x1419ba8))return MESSAGE_DRIFT;
 result=ue_repindex_object(t,candidate.declaring.cls,&candidate.metaclass,&candidate.metaclass_slot);
 if(result!=MESSAGE_READY)return result;
 if(candidate.metaclass.vptr!=UINT64_C(0x1419ba8)||candidate.metaclass.cls!=candidate.declaring.cls)return MESSAGE_DRIFT;
 result=ue_repindex_name(candidate.declaring.cls,"Class",NULL);
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_name(candidate.metaclass.outer,"/Script/CoreUObject",NULL);
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_object(t,candidate.declaring.outer,&candidate.package,&candidate.package_slot);
 if(result!=MESSAGE_READY)return result;
 if(candidate.package.outer)return MESSAGE_DRIFT;
 result=ue_repindex_name(candidate.declaring.outer,"/Script/Engine","/Script/Squad");
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_name(candidate.package.cls,"Package",NULL);
 if(result!=MESSAGE_READY)return result;
 if(!rd(declaring+0xd4,&candidate.class_flags,sizeof candidate.class_flags))return MESSAGE_WAIT;
 if(!(candidate.class_flags&0x80U))return MESSAGE_DRIFT; /* CLASS_Native */
 result=ue_repindex_descriptor(saved,current_raw);
 if(result!=MESSAGE_READY)return result;
 if(!(candidate.class_flags&0x800U)&&(require_ready||index!=0))return MESSAGE_WAIT;
 if(candidate.class_flags&0x800U){ /* d5 bit08: runtime replication data ready */
  if(!rd(declaring+0xf0,&candidate.reps,sizeof candidate.reps))return MESSAGE_WAIT;
  if(candidate.reps.count<1||candidate.reps.count>65536||candidate.reps.capacity<candidate.reps.count||
     candidate.reps.capacity>65536||(uint32_t)index>=(uint32_t)candidate.reps.count||
     !ue_repindex_pointer(candidate.reps.data))return MESSAGE_DRIFT;
  up record_address=candidate.reps.data+16U*(up)index;
  if(record_address<candidate.reps.data||record_address>UINT64_C(0x800000000000)-sizeof candidate.record)return MESSAGE_DRIFT;
  if(!rd(record_address,candidate.record,sizeof candidate.record))return MESSAGE_WAIT;
  up property;int32_t array_index;
  memcpy(&property,candidate.record,8);memcpy(&array_index,candidate.record+8,4);
  if(property!=saved->field.descriptor||array_index!=0)return MESSAGE_DRIFT;
 }
 result=ue_repindex_descriptor(saved,current_raw);
 if(result!=MESSAGE_READY)return result;
 int declaring_meta_ok=metadata_identity(t,declaring,&candidate.declaring_id);
 int metaclass_meta_ok=metadata_identity(t,candidate.declaring.cls,&candidate.metaclass_id);
 int declaring_finish=ue_repindex_finish_object(t,declaring,&candidate.declaring,&candidate.declaring_slot,
                                               declaring_meta_ok?&candidate.declaring_id:NULL);
 int meta_finish=ue_repindex_finish_object(t,candidate.declaring.cls,&candidate.metaclass,&candidate.metaclass_slot,
                                         metaclass_meta_ok?&candidate.metaclass_id:NULL);
 int package_finish=ue_repindex_finish_object(t,candidate.declaring.outer,&candidate.package,&candidate.package_slot,NULL);
 if(declaring_finish==MESSAGE_DRIFT||meta_finish==MESSAGE_DRIFT||package_finish==MESSAGE_DRIFT)return MESSAGE_DRIFT;
 if(!declaring_meta_ok||!metaclass_meta_ok||declaring_finish!=MESSAGE_READY||meta_finish!=MESSAGE_READY||package_finish!=MESSAGE_READY)return MESSAGE_WAIT;
 *out=candidate;return MESSAGE_READY;
}

static int ue_repindex_double(const struct table *t,const struct message_field_witness *saved,
                             const unsigned char *current_raw,size_t bytes,int require_ready,int *ready){
 if(!t||!saved||!current_raw||bytes!=saved->bytes||bytes<0x48||bytes>sizeof saved->raw)return MESSAGE_DRIFT;
 if(memcmp(saved->raw,current_raw,0x40)||memcmp(saved->raw+0x42,current_raw+0x42,bytes-0x42))return MESSAGE_DRIFT;
 uint16_t index;int32_t dim;up flags,owner;
 memcpy(&index,current_raw+0x40,2);
 memcpy(&dim,current_raw+0x2c,4);memcpy(&flags,current_raw+0x38,8);memcpy(&owner,current_raw+0x10,8);
 if(dim!=1||saved->field.dim!=1||!(flags&UINT64_C(0x20))||flags!=saved->field.raw_flags||
    !ue_repindex_pointer(saved->field.descriptor)||!ue_repindex_pointer(saved->field.declaring_class)||
    owner!=(saved->field.declaring_class|UINT64_C(1)))return MESSAGE_DRIFT;
 struct ue_repindex_sample first,second;
 int result=ue_repindex_sample(t,saved,current_raw,index,require_ready,&first);
 if(result!=MESSAGE_READY)return result;
 result=ue_repindex_sample(t,saved,current_raw,index,require_ready,&second);
 if(result!=MESSAGE_READY)return result;
 if(!message_header_equal(&first.declaring,&second.declaring)||
    !message_header_equal(&first.metaclass,&second.metaclass)||
    !message_header_equal(&first.package,&second.package)||
    first.declaring_slot.object!=second.declaring_slot.object||
    first.metaclass_slot.object!=second.metaclass_slot.object||
    first.package_slot.object!=second.package_slot.object)return MESSAGE_DRIFT;
 const struct slot *before[3]={&first.declaring_slot,&first.metaclass_slot,&first.package_slot};
 const struct slot *after[3]={&second.declaring_slot,&second.metaclass_slot,&second.package_slot};
 for(int i=0;i<3;i++)if(before[i]->serial!=after[i]->serial){
  if(before[i]->serial==0&&after[i]->serial>0)return MESSAGE_WAIT;
  return MESSAGE_DRIFT;
 }
 if(((first.class_flags^second.class_flags)&~0x800U)!=0)return MESSAGE_DRIFT;
 if((first.class_flags^second.class_flags)&0x800U)return MESSAGE_WAIT;
 if(memcmp(&first.reps,&second.reps,sizeof first.reps)||memcmp(first.record,second.record,sizeof first.record))return MESSAGE_DRIFT;
 if(first.declaring_id.metadata_fingerprint!=second.declaring_id.metadata_fingerprint||
    first.metaclass_id.metadata_fingerprint!=second.metaclass_id.metadata_fingerprint)return MESSAGE_WAIT;
 if(ready)*ready=(second.class_flags&0x800U)!=0;
 return MESSAGE_READY;
}

/* Mapping proof only: unlike transition(), this may validate a ready index0. */
static int ue_repindex_current_mapping(const struct table *t,const struct message_field_witness *saved,
                                      const unsigned char *current_raw,size_t bytes){
 return ue_repindex_double(t,saved,current_raw,bytes,1,NULL);
}

static int ue_repindex_capture(const struct table *t,const struct message_field_witness *saved,int *ready){
 if(!t||!saved||!ready||saved->bytes<0x48||saved->bytes>sizeof saved->raw)return MESSAGE_DRIFT;
 up flags;memcpy(&flags,saved->raw+0x38,8);
 if(!(flags&UINT64_C(0x20))||!saved->field.declaring_class){*ready=0;return MESSAGE_READY;}
 int candidate_ready=0;
 int result=ue_repindex_double(t,saved,saved->raw,saved->bytes,0,&candidate_ready);
 if(result!=MESSAGE_READY)return result;
 *ready=candidate_ready;return MESSAGE_READY;
}

static int ue_repindex_transition(const struct table *t,const struct message_field_witness *saved,
                                 const unsigned char *current_raw,size_t bytes){
 if(!t||!saved||!current_raw||bytes!=saved->bytes||bytes<0x48||bytes>sizeof saved->raw)return MESSAGE_DRIFT;
 if(!memcmp(saved->raw,current_raw,bytes))return MESSAGE_READY;
 if(saved->repindex_ready)return MESSAGE_DRIFT;
 uint16_t before,after;
 memcpy(&before,saved->raw+0x40,2);memcpy(&after,current_raw+0x40,2);
 if(before||!after)return MESSAGE_DRIFT;
 return ue_repindex_current_mapping(t,saved,current_raw,bytes);
}


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


static __attribute__((unused)) int message_add_node(const struct table *t,up at,int is_class,struct message_witness *w){
 struct message_node n;int result=message_node_read(t,at,is_class,&n);if(result!=MESSAGE_READY)return 0;
 for(int i=0;i<w->node_count;i++)if(w->nodes[i].address==at){
  struct message_node old=w->nodes[i];
  if(memcmp(&old.header,&n.header,sizeof n.header)||old.serial!=n.serial)return 0;
  if(old.is_class&&is_class&&(old.super!=n.super||old.children!=n.children))return 0;
  if(is_class){w->nodes[i]=n;}return 1;
 }
 if(w->node_count>=MESSAGE_WITNESS_NODES)return 0;
 w->nodes[w->node_count++]=n;
 if(!n.header.outer&&named(at,"/Script/Engine")&&named(n.header.cls,"Package")){
  if(w->engine_package&&w->engine_package!=at)return 0;
  w->engine_package=at;w->engine_package_header=n.header;
 }
 return 1;
}

static __attribute__((unused)) int message_add_chain(const struct table *t,up at,struct message_witness *w){
 up seen[8];int count=0;
 while(at&&count<8){
  for(int i=0;i<count;i++)if(seen[i]==at)return 0;
  seen[count++]=at;
  struct obj o;if(!message_add_node(t,at,0,w)||!hdr(at,&o))return 0;at=o.outer;
 }
 return at==0;
}

static __attribute__((unused)) int message_add_class(const struct table *t,up cls,struct message_witness *w){
 up seen[32];int count=0;
 while(cls&&count<32){
  for(int i=0;i<count;i++)if(seen[i]==cls)return 0;
  seen[count++]=cls;
  struct obj o;up parent;
  if(!message_add_chain(t,cls,w)||!message_add_node(t,cls,1,w)||!hdr(cls,&o)||!message_add_chain(t,o.cls,w)||!rd(cls+0x40,&parent,8))return 0;
  up meta=o.cls,meta_seen[32];int meta_count=0;
  while(meta&&meta_count<32){
   for(int i=0;i<meta_count;i++)if(meta_seen[i]==meta)return 0;
  meta_seen[meta_count++]=meta;
   up next;if(!message_add_chain(t,meta,w)||!message_add_node(t,meta,1,w)||!rd(meta+0x40,&next,8))return 0;meta=next;
  }
  if(meta)return 0;
  cls=parent;
 }
 return cls==0;
}

static __attribute__((unused)) int message_field_read(const struct message_field_witness *saved,struct message_field_witness *out){
 struct message_field_witness f={0};up next=0;
 f.repindex_ready=saved->repindex_ready;f.bytes=saved->bytes;if(f.bytes<0x48||f.bytes>sizeof f.raw)return MESSAGE_DRIFT;
 if(!rd(saved->field.descriptor,f.raw,f.bytes))return MESSAGE_WAIT;
 if(memcmp(f.raw,saved->raw,f.bytes))return MESSAGE_DRIFT;
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
 *out=f;return MESSAGE_READY;
}

static __attribute__((unused)) int message_add_field(const struct table *t,const struct field *field,int plain_object,struct message_witness *w){
 if(w->field_count>=MESSAGE_WITNESS_FIELDS)return 0;
 struct message_field_witness f={0};f.field=*field;f.bytes=!strcmp(field->type,"ObjectProperty")?0x78:0x48;
 if(!rd(field->descriptor,f.raw,f.bytes))return 0;
 if(plain_object&&ptr(field->descriptor)!=0x14328b8)return 0;
 memcpy(&f.type_class,f.raw+8,8);if(!rd(f.type_class,f.type_name,8))return 0;
 if(!strcmp(field->type,"ObjectProperty")||!strcmp(field->type,"ClassProperty")||!strcmp(field->type,"StructProperty")){if(!rd(field->descriptor+0x70,&f.target,8))return 0;}
 if(!strcmp(field->type,"ClassProperty")||!strcmp(field->type,"ArrayProperty")){if(!rd(field->descriptor+0x78,&f.inner,8))return 0;}
 if(!strcmp(field->type,"EnumProperty")){if(!rd(field->descriptor+0x78,&f.target,8)||!rd(field->descriptor+0x70,&f.inner,8))return 0;}
 if(ue_repindex_capture(t,&f,&f.repindex_ready)!=MESSAGE_READY)return 0;
 struct message_field_witness second;if(message_field_read(&f,&second)!=MESSAGE_READY||!message_field_witness_equal(&f,&second))return 0;
 if(field->declaring_class&&!message_add_class(t,field->declaring_class,w))return 0;
 if(f.target&&!message_add_chain(t,f.target,w))return 0;
 if(!strcmp(field->type,"ClassProperty")&&f.inner&&!message_add_class(t,f.inner,w))return 0;
 w->fields[w->field_count++]=f;return 1;
}

static __attribute__((unused)) int cleanup_find_field(const struct table *t,up cls,const char *wanted,const char *kind,int size,int offset,struct field *out){
 /* Only this cleanup lookup may traverse unrelated fixed-array fields.
  * A matching property still passes the unchanged strict field_read gate. */
 up ancestors[32];int count=0;
 while(cls&&count<32){
  for(int i=0;i<count;i++)if(ancestors[i]==cls)return 0;
  ancestors[count++]=cls;struct identity cid;up at;
  if(!metadata_identity(t,cls,&cid)||!uclass_metaclass(t,cls)||!rd(cls+0x50,&at,8))return 0;
  up seen[1024];int fields=0;
  while(at&&fields<1024){
   for(int i=0;i<fields;i++)if(seen[i]==at)return 0;
   seen[fields++]=at;
   unsigned char raw[0x48],again[0x48];uint32_t ids[2];up next;int32_t dim,width,position;char name[128];
   if(!rd(at,raw,sizeof raw)||!rd(at,again,sizeof again)||memcmp(raw,again,sizeof raw))return 0;
   memcpy(ids,raw+0x20,8);memcpy(&next,raw+0x18,8);memcpy(&dim,raw+0x2c,4);memcpy(&width,raw+0x30,4);memcpy(&position,raw+0x44,4);
   if(!fname(ids[0],ids[1],name,sizeof name)||dim<1||dim>1024||width<1||width>65536||position<0||position>65536||(uint64_t)(uint32_t)dim*(uint64_t)(uint32_t)width>65536)return 0;
   if(!strcmp(name,wanted)){
    struct field f;up verified_next;
    if(!field_read(at,&f,&verified_next)||verified_next!=next||strcmp(f.name,wanted)||strcmp(f.type,kind)||f.size!=size||(offset>=0&&f.offset!=offset)||!stable_metadata(t,cid))return 0;
    f.declaring_class=cls;*out=f;return 1;
   }
   at=next;
  }
  if(at||!stable_metadata(t,cid)||!rd(cls+0x40,&cls,8))return 0;
 }
 return 0;
}

static __attribute__((unused)) int cleanup_raw_array(up owner,unsigned offset,up needle,uint32_t *count,int *occurrences,int selected_index,up *selected){
 struct array_header a,b;up first[256],second[256];
 if(!rd(owner+offset,&a,sizeof a)||a.count<0||a.count>256||a.capacity<a.count||a.capacity>4096||(a.count&&(!a.data||(a.data&7)))||(selected_index>=0&&selected_index>=a.count))return MESSAGE_DRIFT;
 size_t bytes=8UL*(unsigned)a.count;
 if(bytes&&(!rd(a.data,first,bytes)||!rd(a.data,second,bytes)||memcmp(first,second,bytes)))return MESSAGE_DRIFT;
 if(!rd(owner+offset,&b,sizeof b)||memcmp(&a,&b,sizeof a))return MESSAGE_DRIFT;
 int found=0;for(int i=0;i<a.count;i++)if(needle&&first[i]==needle)found++;
 *count=(uint32_t)a.count;*occurrences=found;if(selected)*selected=selected_index>=0?first[selected_index]:0;return MESSAGE_READY;
}

/* Integrated dynamic backend: current World only; no registry from names. */
struct ue_owned_state {int present;uint64_t epoch,generation;struct fresh_actor fresh;struct wu_name name;uint32_t team,state;};
struct ue_census_work {int active;uint32_t cursor,count;up players[100],team_items[2][100];uint32_t team_count[2];struct wn_census result;};
struct ue_context {
 uint64_t epoch,sample_id;struct wn_world bindings;struct identity teams[2],session_class;
 struct ue_owned_state owned[WN_MAX_OWNED];struct ue_census_work scan;
 int guard_ready;struct message_witness guard;
};
static struct ue_context ue;
static int message_function(const struct table *,struct identity *);
static int ue_note(int result,const char *stage){atomic_store(&ue_error,stage);return result;}
static struct identity ue_id(struct warmup_native_weak_v1 i){return (struct identity){i.address,i.index,i.serial,0};}
static struct warmup_native_weak_v1 ue_weak(struct identity i){return (struct warmup_native_weak_v1){i.address,i.index,i.serial};}
static int ue_same_weak(struct warmup_native_weak_v1 a,struct warmup_native_weak_v1 b){return a.address==b.address&&a.index==b.index&&a.serial==b.serial;}
static int ue_same_world(const struct wn_world *a,const struct wn_world *b){return ue_same_weak(a->world,b->world)&&ue_same_weak(a->game_state,b->game_state)&&ue_same_weak(a->game_mode,b->game_mode)&&ue_same_weak(a->game_session,b->game_session);}
static int ue_main(void){return process_id>0&&(long)syscall(SYS_gettid)==(long)process_id;}
static int ue_property(const struct table *t,up cls,const char *name,int offset,const char *owner,const char *target,struct field *out){
 return cleanup_find_field(t,cls,name,"ObjectProperty",8,offset,out)&&meta_named(t,out->declaring_class,"Class","/Script/Engine",owner)&&target_matches(t,out,target);
}
static int ue_probe(void *context,struct wn_world *out){
 (void)context;if(!ue_main()||!out||!atomic_load(&backend_initialized))return WN_ERROR;
 struct table t;struct identity w,g,m,s;struct obj wh,gh,mh,sh;up world=active_world(),gs,gm,session,level,back;
 if(!world||!table_read(&t)||!identity(&t,world,&w)||!hdr(world,&wh)||!meta_named(&t,wh.cls,"Class","/Script/Engine","World"))return WN_WAIT;
 if(!rd(world+0x1e0,&gs,8)||!rd(world+0x1d8,&gm,8)||!rd(world+0x30,&level,8)||!identity(&t,gs,&g)||!identity(&t,gm,&m)||!hdr(gs,&gh)||!hdr(gm,&mh)||gh.outer!=level||mh.outer!=level||!rd(level+0x20,&back,8)||back!=world||!rd(gs+0x2c0,&back,8)||back!=gm||!rd(gm+0x318,&back,8)||back!=gs||!rd(gm+0x310,&session,8)||!identity(&t,session,&s)||!hdr(session,&sh)||!in_world(session,world))return WN_WAIT;
 *out=(struct wn_world){ue_weak(w),ue_weak(g),ue_weak(m),ue_weak(s)};return WN_OK;
}
/* Only the pool's mandatory first probe is measured here. Recursive World
 * checks and queue-provider probes retain their original call path. */
static int ue_pool_probe(void *context,struct wn_world *out){
 uint64_t started=mono_ns();atomic_fetch_add(&telemetry_probe_calls,1);
 int result=ue_probe(context,out);uint64_t finished=mono_ns();
 uint64_t elapsed=started&&finished>=started?finished-started:0;
 atomic_store(&telemetry_probe_last_ns,elapsed);atomic_store(&telemetry_probe_result,result);
 uint64_t old=atomic_load(&telemetry_probe_max_ns);
 while(elapsed>old&&!atomic_compare_exchange_weak(&telemetry_probe_max_ns,&old,elapsed)){}
 return result;
}
static int ue_world_live(uint64_t epoch,const struct wn_world *bindings){
 struct wn_world now;if(!ue_main()||warmup_control_failed()||!epoch||epoch!=ue.epoch||!bindings||!ue_same_world(bindings,&ue.bindings))return WN_DRIFT;
 int r=ue_probe(NULL,&now);if(r!=WN_OK)return r;
 if(!ue_same_weak(now.world,bindings->world))return WN_WORLD_CHANGED;
 return ue_same_world(&now,bindings)?WN_OK:WN_DRIFT;
}
static int ue_message_world_live(uint64_t epoch,const struct wn_world *bindings){
 if(!ue_main()||warmup_control_failed()||!callback_epoch||!atomic_load(&transaction_active)||atomic_load(&reentry_detected))return WN_DRIFT;
 return ue_world_live(epoch,bindings);
}
static int ue_snapshot_live(const struct warmup_native_snapshot_v1 *s){
 if(!s||!ue_main()||atomic_load(&transaction_active)||atomic_load(&reentry_detected)||s->world_epoch!=ue.epoch)return 0;
 struct wn_world expected={s->world,s->game_state,s->game_mode,s->game_session},now;
 return ue_probe(NULL,&now)==WN_OK&&ue_same_world(&expected,&now);
}
static void ue_reset(void *context,uint64_t old_epoch,uint64_t new_epoch,const struct wn_world *bindings){
 (void)context;(void)old_epoch;if(!ue_main()||!bindings||new_epoch<=ue.epoch)return;
 /* Discard pure memory only. No old actor/World is dereferenced or destroyed. */
 memset(&ue,0,sizeof ue);ue.epoch=new_epoch;ue.bindings=*bindings;
 once_binding.world=ue_id(bindings->world);once_binding.gs=ue_id(bindings->game_state);once_binding.gm=ue_id(bindings->game_mode);once_binding.state_class=(struct identity){0};once_binding.team=(struct identity){0};
}
static int ue_read_array(up owner,unsigned offset,up *items,uint32_t *count){
 struct array_header a,b;up second[100];
 if(!rd(owner+offset,&a,sizeof a)||a.count<0||a.count>100||a.capacity<a.count||a.capacity>4096||(a.count&&(!a.data||(a.data&7))))return WN_DRIFT;
 size_t bytes=8UL*(unsigned)a.count;
 if(bytes&&(!rd(a.data,items,bytes)||!rd(a.data,second,bytes)||memcmp(items,second,bytes)))return WN_WAIT;
 if(!rd(owner+offset,&b,sizeof b)||memcmp(&a,&b,sizeof a))return WN_WAIT;
 for(int i=0;i<a.count;i++){if(!items[i])return WN_DRIFT;for(int j=0;j<i;j++)if(items[i]==items[j])return WN_DRIFT;}
 *count=(uint32_t)a.count;return WN_OK;
}
static int ue_occurrences(const up *items,uint32_t count,up needle){int found=0;for(uint32_t i=0;i<count;i++)if(items[i]==needle)found++;return found;}
static int ue_bind_runtime(const struct table *t,uint32_t *capacity){
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!stable_metadata(t,classes[i].id))return ue_note(WN_WAIT,"metadata_named_class_cache_unavailable");
 struct obj gm,session;struct field f;up configured,session_pointer;int32_t maxplayers;
 if(!hdr(ue.bindings.game_mode.address,&gm)||!ue_property(t,gm.cls,"GameSession",0x310,"GameModeBase","GameSession",&f)||!rd(ue.bindings.game_mode.address+(unsigned)f.offset,&session_pointer,8)||session_pointer!=ue.bindings.game_session.address||!hdr(session_pointer,&session)||!derives(session.cls,ptr(f.descriptor+0x70)))return ue_note(WN_DRIFT,"game_session_property_or_live_link_gate");
 if(!object_property_pointer(ue.bindings.game_mode.address,gm.cls,"PlayerStateClass","ClassProperty",&configured)||!metadata_identity(t,configured,&once_binding.state_class)||!meta_named(t,configured,"Class","/Script/Squad","SQPlayerState")||!derives(configured,classes[2].id.address))return ue_note(WN_WAIT,"configured_player_state_class_gate");
 uint32_t flags;if(!rd(configured+0xd4,&flags,4)||(flags!=0x30d002a4U&&flags!=0x30d00aa4U)||(flags&0x02000001U)||!passive_class_fields(t,configured))return ue_note(WN_DRIFT,"configured_state_flags_or_passive_properties");
 if(!resolve_team(t,ue.bindings.game_state.address,ue.bindings.world.address,1,&ue.teams[0])||!resolve_team(t,ue.bindings.game_state.address,ue.bindings.world.address,2,&ue.teams[1]))return ue_note(WN_WAIT,"team_states_or_typed_arrays_unavailable");
 once_binding.team=ue.teams[0];
 if(!cleanup_find_field(t,session.cls,"MaxPlayers","IntProperty",4,-1,&f)||!meta_named(t,f.declaring_class,"Class","/Script/Engine","GameSession")||!rd(session_pointer+(unsigned)f.offset,&maxplayers,4)||maxplayers<1||maxplayers>100)return ue_note(WN_DRIFT,"native_max_players_property_gate");
 *capacity=(uint32_t)maxplayers;return ue_note(WN_OK,"runtime_bindings_confirmed");
}
static struct identity ue_fresh_meta(const struct table *t,const char *owner,const char *name){struct identity cached=cached_meta(owner,name),fresh={0};if(cached.address)metadata_identity(t,cached.address,&fresh);return fresh;}
static int ue_common_abi(const struct table *t){
 struct identity begin=ue_fresh_meta(t,"GameplayStatics","BeginDeferredActorSpawnFromClass"),finish=ue_fresh_meta(t,"GameplayStatics","FinishSpawningActor"),destroy=ue_fresh_meta(t,"Actor","K2_DestroyActor"),name=ue_fresh_meta(t,"SQPlayerState","BlueprintSetPlayerName"),team=ue_fresh_meta(t,"SQPlayerState","SetTeamState");
 struct identity collision_id={0},scale_id={0};
 atomic_store(&telemetry_common_abi_gate,WUE_ABI_COLLISION_IDENTITY);
 if(!metadata_identity(t,current.collision_enum.address,&collision_id))return ue_note(WN_WAIT,"spawn_enum_metadata_unavailable");
 atomic_store(&telemetry_common_abi_gate,WUE_ABI_SCALE_IDENTITY);
 if(!metadata_identity(t,current.scale_enum.address,&scale_id))return ue_note(WN_WAIT,"spawn_enum_metadata_unavailable");
 static const char *const collision[]={"Undefined","AlwaysSpawn","AdjustIfPossibleButAlwaysSpawn","AdjustIfPossibleButDontSpawnIfColliding","DontSpawnIfColliding","ESpawnActorCollisionHandlingMethod_MAX"};
 static const char *const scale[]={"OverrideRootScale","MultiplyWithRoot","SelectDefaultAtRuntime","ESpawnActorScaleMethod_MAX"};
#define ABI_REQUIRE(gate,condition) do{atomic_store(&telemetry_common_abi_gate,(gate));if(!(condition))return WN_WAIT;}while(0)
 ABI_REQUIRE(WUE_ABI_MISSING_BEGIN,begin.address);
 ABI_REQUIRE(WUE_ABI_MISSING_FINISH,finish.address);
 ABI_REQUIRE(WUE_ABI_MISSING_DESTROY,destroy.address);
 ABI_REQUIRE(WUE_ABI_MISSING_NAME,name.address);
 ABI_REQUIRE(WUE_ABI_MISSING_TEAM,team.address);
 ABI_REQUIRE(WUE_ABI_FRESH_BEGIN,fresh_function(t,begin,"GameplayStatics","BeginDeferredActorSpawnFromClass",79832067U,144,136,0x7ec8720,begin_fields,7));
 ABI_REQUIRE(WUE_ABI_FRESH_FINISH,fresh_function(t,finish,"GameplayStatics","FinishSpawningActor",79832067U,128,120,0x7ece0d0,finish_fields,4));
 ABI_REQUIRE(WUE_ABI_FRESH_DESTROY,fresh_function(t,destroy,"Actor","K2_DestroyActor",67240962U,0,65535,0x7a068e0,NULL,0));
 ABI_REQUIRE(WUE_ABI_FRESH_NAME,fresh_name_function(t,name));
 ABI_REQUIRE(WUE_ABI_FRESH_TEAM,fresh_team_function(t,team,0));
 ABI_REQUIRE(WUE_ABI_VECTOR,fresh_struct(t,"Vector",24,vector_fields,3));
 ABI_REQUIRE(WUE_ABI_QUAT,fresh_struct(t,"Quat",32,quat_fields,4));
 ABI_REQUIRE(WUE_ABI_TRANSFORM,fresh_struct(t,"Transform",96,transform_fields,3));
 ABI_REQUIRE(WUE_ABI_COLLISION_VALUES,enum_values(t,collision_id,"ESpawnActorCollisionHandlingMethod",collision,6));
 ABI_REQUIRE(WUE_ABI_SCALE_VALUES,enum_values(t,scale_id,"ESpawnActorScaleMethod",scale,4));
 ABI_REQUIRE(WUE_ABI_NAMING_CODE,naming_code_matches());
 struct identity cdo;struct obj h;
 ABI_REQUIRE(WUE_ABI_CDO_IDENTITY,metadata_identity(t,current.gameplay_cdo.address,&cdo));
 ABI_REQUIRE(WUE_ABI_CDO_HEADER,hdr(cdo.address,&h));
 ABI_REQUIRE(WUE_ABI_CDO_CLASS,h.cls==classes[5].id.address);
 ABI_REQUIRE(WUE_ABI_CDO_FLAGS,h.flags&0x10U);
 ABI_REQUIRE(WUE_ABI_CDO_NAME,named(cdo.address,"Default__GameplayStatics"));
 ABI_REQUIRE(WUE_ABI_CDO_PACKAGE,named(h.outer,"/Script/Engine"));
 ABI_REQUIRE(WUE_ABI_CDO_PROCESS_EVENT,ptr(h.vptr+0x268)==BASE_PROCESS_EVENT);
 struct identity message;ABI_REQUIRE(WUE_ABI_MESSAGE,message_function(t,&message));
#undef ABI_REQUIRE
 atomic_store(&telemetry_common_abi_gate,WUE_ABI_READY);
 return WN_OK;
}
static int ue_guard_property(const struct table *t,up cls,const char *name,const char *kind,int width,int offset,struct message_witness *w){
 struct field f;up next;
 if(!cleanup_find_field(t,cls,name,kind,width,offset,&f)||!message_add_field(t,&f,0,w))return 0;
 if(!strcmp(kind,"ArrayProperty")){struct field inner;up at;if(!rd(f.descriptor+0x78,&at,8)||!field_read(at,&inner,&next)||strcmp(inner.type,"ObjectProperty")||inner.size!=8||!message_add_field(t,&inner,0,w))return 0;}
 return 1;
}
static int ue_guard_bytes(up at,size_t bytes,struct message_witness *w){
 if(!bytes||bytes>256||w->bytes_count>=8)return 0;
 struct message_bytes_witness value={.address=at,.size=bytes};unsigned char after[256];
 if(!rd(at,value.raw,bytes)||!rd(at,after,bytes)||memcmp(value.raw,after,bytes))return 0;
 w->bytes[w->bytes_count++]=value;return 1;
}
static int ue_guard_rpc(const struct table *t,struct message_witness *w){
 struct identity fn=cached_meta("SQPlayerController","ClientSystemMessage"),color=cached_meta("/Script/CoreUObject","LinearColor"),enumeration=current.notification_enum;
 if(!stable_metadata(t,fn)||!stable_metadata(t,color)||!stable_metadata(t,enumeration))return 0;
 if(!ue_guard_bytes(fn.address+0x50,16,w)||!ue_guard_bytes(fn.address+0xb0,10,w)||!ue_guard_bytes(fn.address+0xd8,8,w)||!ue_guard_bytes(color.address+0x50,8,w)||!ue_guard_bytes(color.address+0x58,4,w)||!ue_guard_bytes(enumeration.address+0x40,20,w))return 0;
 up names,values,at;int32_t count;
 if(!rd(enumeration.address+0x40,&names,8)||!rd(enumeration.address+0x48,&values,8)||!rd(enumeration.address+0x50,&count,4)||count!=MESSAGE_ENUM_COUNT||count<1||count>32)return 0;
 names&=~UINT64_C(1);values&=~UINT64_C(1);
 if(!ue_guard_bytes(names,8UL*(unsigned)count,w)||!ue_guard_bytes(values,8UL*(unsigned)count,w)||!rd(fn.address+0x50,&at,8))return 0;
 for(int i=0;i<4;i++){
  struct field f;up next;if(!at||!field_read(at,&f,&next)||!message_add_field(t,&f,0,w))return 0;
  if(i==3){struct field inner;up underlying,unused;if(!rd(at+0x70,&underlying,8)||!field_read(underlying,&inner,&unused)||!message_add_field(t,&inner,0,w))return 0;}
  at=next;
 }
 if(at||!rd(color.address+0x50,&at,8))return 0;
 for(int i=0;i<4;i++){struct field f;up next;if(!at||!field_read(at,&f,&next)||!message_add_field(t,&f,0,w))return 0;at=next;}
 return at==0;
}
static int ue_metadata_anchor_gate(const struct table *t,const struct message_witness *w){
 if(!ue_main()||warmup_control_failed()||!w||w->anchor.world_epoch!=ue.epoch)return MESSAGE_DRIFT;
 const struct warmup_native_weak_v1 current_roots[4]={ue.bindings.world,ue.bindings.game_state,ue.bindings.game_mode,ue.bindings.game_session};
 for(int i=0;i<4;i++)if(current_roots[i].address!=w->anchor.roots[i].address||current_roots[i].index!=w->anchor.roots[i].index||current_roots[i].serial!=w->anchor.roots[i].serial)return MESSAGE_DRIFT;
 up world=active_world();if(!world)return MESSAGE_WAIT;
 return ue_metadata_anchor_validate(t,&w->anchor,ue.epoch,world);
}
static int ue_guard_anchor_ready(const struct table *t,const struct message_witness *w){
 int r=ue_metadata_anchor_gate(t,w);
 return r==MESSAGE_READY?WN_OK:ue_note(r==MESSAGE_WAIT?WN_WAIT:WN_DRIFT,"world_metadata_current_root_anchor_failed");
}
static int ue_guard_capture(const struct table *t){
 struct message_witness w={0};struct obj world,gs,gm,session,team;struct identity fn;
 if(!hdr(ue.bindings.world.address,&world)||!hdr(ue.bindings.game_state.address,&gs)||!hdr(ue.bindings.game_mode.address,&gm)||!hdr(ue.bindings.game_session.address,&session)||!hdr(ue.teams[0].address,&team))return WN_WAIT;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!message_add_class(t,classes[i].id.address,&w))return WN_WAIT;
 if(!message_add_class(t,world.cls,&w)||!message_add_class(t,gs.cls,&w)||!message_add_class(t,gm.cls,&w)||!message_add_class(t,session.cls,&w)||!message_add_class(t,team.cls,&w)||!message_add_class(t,once_binding.state_class.address,&w)||!message_add_chain(t,current.gameplay_cdo.address,&w)||!message_add_chain(t,current.collision_enum.address,&w)||!message_add_chain(t,current.scale_enum.address,&w))return ue_note(WN_WAIT,"world_class_cdo_enum_witness_capture");
 for(int i=0;i<current.function_count;i++)if(!message_add_chain(t,current.functions[i].id.address,&w))return WN_WAIT;
 if(!ue_guard_property(t,world.cls,"GameState","ObjectProperty",8,0x1e0,&w)||!ue_guard_property(t,world.cls,"AuthorityGameMode","ObjectProperty",8,0x1d8,&w)||!ue_guard_property(t,world.cls,"PersistentLevel","ObjectProperty",8,0x30,&w)||!ue_guard_property(t,gs.cls,"AuthorityGameMode","ObjectProperty",8,0x2c0,&w)||!ue_guard_property(t,gm.cls,"GameState","ObjectProperty",8,0x318,&w)||!ue_guard_property(t,gm.cls,"PlayerStateClass","ClassProperty",8,-1,&w)||!ue_guard_property(t,gm.cls,"GameSession","ObjectProperty",8,0x310,&w)||!ue_guard_property(t,session.cls,"MaxPlayers","IntProperty",4,-1,&w)||!ue_guard_property(t,gs.cls,"PlayerArray","ArrayProperty",16,0x2d0,&w)||!ue_guard_property(t,gs.cls,"IndexedTeamStates","ArrayProperty",16,0x3c8,&w)||!ue_guard_property(t,gs.cls,"TeamStates","ArrayProperty",16,0x3b8,&w)||!ue_guard_property(t,team.cls,"PlayerStates","ArrayProperty",16,0x398,&w)||!ue_guard_property(t,team.cls,"ID","IntProperty",4,0x2e0,&w))return WN_WAIT;
 struct field relations[4];
 if(!ue_property(t,classes[2].id.address,"Owner",0x158,"Actor","Actor",&relations[0])||!ue_property(t,classes[3].id.address,"PlayerState",0x2c0,"Controller","PlayerState",&relations[1])||!ue_property(t,classes[3].id.address,"Player",0x358,"PlayerController","Player",&relations[2])||!ue_property(t,classes[3].id.address,"NetConnection",0x530,"PlayerController","NetConnection",&relations[3]))return WN_WAIT;
 for(int i=0;i<4;i++)if(!message_add_field(t,&relations[i],1,&w))return WN_WAIT;
 if(!ue_guard_property(t,once_binding.state_class.address,"Owner","ObjectProperty",8,0x158,&w)||!ue_guard_property(t,once_binding.state_class.address,"PawnPrivate","ObjectProperty",8,0x330,&w)||!ue_guard_property(t,once_binding.state_class.address,"CurrentPawn","ObjectProperty",8,0x7b0,&w)||!ue_guard_property(t,once_binding.state_class.address,"TeamState","ObjectProperty",8,0x780,&w)||!ue_guard_property(t,once_binding.state_class.address,"SquadState","ObjectProperty",8,0x788,&w)||!ue_guard_property(t,once_binding.state_class.address,"TeamId","IntProperty",4,0x4b0,&w)||!ue_guard_property(t,once_binding.state_class.address,"PlayerNamePrivate","StrProperty",16,0x348,&w))return WN_WAIT;
 if(!message_function(t,&fn)||!message_add_chain(t,current.notification_enum.address,&w)||!ue_guard_rpc(t,&w))return WN_WAIT;
 /* Every type-class and complete outer chain is itself pinned, including
  * Package/Function metadata types, before any serial may later be promoted. */
 for(int i=0;i<w.node_count;i++)if(!message_add_class(t,w.nodes[i].header.cls,&w))return WN_WAIT;
 struct identity roots[4]={ue_id(ue.bindings.world),ue_id(ue.bindings.game_state),ue_id(ue.bindings.game_mode),ue_id(ue.bindings.game_session)};
 if(ue_metadata_anchor_capture(t,ue.epoch,roots,&w.anchor)!=MESSAGE_READY)return ue_note(WN_WAIT,"metadata_current_root_capture_wait");
 const struct message_node *world_class=ue_metadata_node_at(&w,w.anchor.headers[0].cls),*engine_package=ue_metadata_node_at(&w,w.engine_package);
 if(!world_class||!engine_package||!uclass_metaclass(t,w.anchor.headers[1].cls)||!uclass_metaclass(t,w.anchor.headers[2].cls))return ue_note(WN_WAIT,"metadata_anchor_typed_root_classes_wait");
 w.anchor.native_class=world_class->header.cls;w.anchor.package_class=engine_package->header.cls;
 if(!meta_named(t,w.anchor.native_class,"Class","/Script/CoreUObject","Class")||!meta_named(t,w.anchor.package_class,"Class","/Script/CoreUObject","Package")||ue_metadata_roles_build(&w,w.roles)!=MESSAGE_READY)return ue_note(WN_WAIT,"metadata_anchor_class_package_roles_wait");
 struct message_witness second;if(!w.engine_package||message_witness_double(t,&w,0,&second)!=MESSAGE_READY)return WN_WAIT;
 ue.guard=second;ue.guard_ready=1;return WN_OK;
}
static int ue_cache_identity(const struct table *t,const struct message_witness *w,up address,struct identity *out){
 const struct message_node *n=ue_metadata_node_at(w,address);struct identity fresh;
 if(!n||!metadata_identity(t,address,&fresh))return WN_WAIT;
 if(fresh.address!=n->address||fresh.index!=n->header.index)return WN_DRIFT;
 if(fresh.serial!=n->serial)return n->serial==0&&fresh.serial>0?WN_WAIT:WN_DRIFT;
 *out=fresh;return WN_OK;
}
static int ue_cache_matches_witness(const struct message_witness *w,struct identity id){
 if(!id.address||!id.metadata_fingerprint)return 0;
 uint64_t fingerprint=UINT64_C(1469598103934665603);up at=id.address,seen[8];int count=0;
 while(at&&count<8){
  for(int i=0;i<count;i++)if(seen[i]==at)return 0;
  seen[count++]=at;const struct message_node *n=ue_metadata_node_at(w,at);if(!n)return 0;
  if(at==id.address&&(id.index!=n->header.index||id.serial!=n->serial))return 0;
  fingerprint=hash_bytes(fingerprint,&at,sizeof at);fingerprint=hash_bytes(fingerprint,&n->header,sizeof n->header);fingerprint=hash_bytes(fingerprint,&n->serial,sizeof n->serial);at=n->header.outer;
 }
 return !at&&id.metadata_fingerprint==(fingerprint?fingerprint:1);
}
static int ue_guard_live(const struct table *t){
 if(!ue.guard_ready){int capture=ue_guard_capture(t);if(capture!=WN_OK)atomic_store(&ue_error,"world_metadata_witness_capture_wait");return capture;}
 struct message_witness candidate,confirm;int r=message_witness_double(t,&ue.guard,1,&candidate);
 if(r==MESSAGE_DRIFT)return ue_note(WN_DRIFT,"world_metadata_witness_structure_or_serial_drift");
 if(r==MESSAGE_WAIT)return ue_note(WN_WAIT,"world_metadata_witness_read_unavailable");
 int cache_present=1;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!ue_cache_matches_witness(&candidate,classes[i].id))cache_present=0;
 if(current.function_count<0||current.function_count>MAX_FUNCTIONS)return WN_DRIFT;
 for(int i=0;i<current.function_count;i++)if(!ue_cache_matches_witness(&candidate,current.functions[i].id))cache_present=0;
 struct identity *special_old[5]={&current.gameplay_cdo,&current.collision_enum,&current.scale_enum,&current.notification_enum,&once_binding.state_class};
 for(int i=0;i<5;i++)if(!ue_cache_matches_witness(&candidate,*special_old[i]))cache_present=0;
 if(cache_present&&message_witness_equal(&ue.guard,&candidate)){
  r=ue_world_live(ue.epoch,&ue.bindings);return r==WN_OK?ue_guard_anchor_ready(t,&candidate):r;
 }
 struct identity class_ids[6],function_ids[MAX_FUNCTIONS],special[5];
 if(current.function_count<0||current.function_count>MAX_FUNCTIONS)return WN_DRIFT;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++){
  up at=classes[i].id.address;
  if(!at){for(int j=0;j<candidate.node_count;j++)if(named(candidate.nodes[j].address,classes[i].name)&&named(candidate.nodes[j].header.outer,classes[i].package)&&named(candidate.nodes[j].header.cls,"Class")){if(at)return WN_DRIFT;at=candidate.nodes[j].address;}}
  r=ue_cache_identity(t,&candidate,at,&class_ids[i]);if(r!=WN_OK)return r;
 }
 for(int i=0;i<current.function_count;i++){r=ue_cache_identity(t,&candidate,current.functions[i].id.address,&function_ids[i]);if(r!=WN_OK)return r;}
 for(int i=0;i<5;i++){r=ue_cache_identity(t,&candidate,special_old[i]->address,&special[i]);if(r!=WN_OK)return r;}
 r=message_witness_double(t,&candidate,0,&confirm);
 if(r!=MESSAGE_READY)return ue_note(r==MESSAGE_DRIFT?WN_DRIFT:WN_WAIT,"metadata_changed_during_cache_candidate");
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_WORLD_CHANGED;
 r=ue_guard_anchor_ready(t,&confirm);if(r!=WN_OK)return r;
 /* All graph and cache candidates are complete. No main state is changed
  * before these checks; gameplay weak references are never rebound here. */
 ue.guard=confirm;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)classes[i].id=class_ids[i];
 for(int i=0;i<current.function_count;i++)current.functions[i].id=function_ids[i];
 for(int i=0;i<5;i++)*special_old[i]=special[i];
 return WN_OK;
}
static int ue_metadata_cache_barrier(const struct table *t){
 if(!ue.guard_ready)return WN_OK;
 int r=ue_guard_anchor_ready(t,&ue.guard);if(r!=WN_OK)return r;
 for(size_t i=0;i<sizeof classes/sizeof classes[0];i++)if(!stable_metadata(t,classes[i].id))return ue_guard_live(t);
 return WN_OK;
}
static int ue_own_name(const struct ue_owned_state *state){
 if(!state||!state->name.unit_count||state->name.unit_count>WU_NAME_STORAGE_UNITS||state->name.units[state->name.unit_count-1])return 0;
 struct engine_string a,b;uint16_t units[WU_NAME_STORAGE_UNITS];
 return rd(state->fresh.address+0x348,&a,sizeof a)&&a.num==(int32_t)state->name.unit_count&&a.capacity>=a.num&&a.capacity<=1024&&a.data>=0x10000&&!(a.data&1)&&rd(a.data,units,state->name.unit_count*2)&&!memcmp(units,state->name.units,state->name.unit_count*2)&&rd(state->fresh.address+0x348,&b,sizeof b)&&!memcmp(&a,&b,sizeof a);
}
static int ue_own_verify(const struct table *t,const struct wn_owned *owned,int expected_team){
 if(!owned||owned->slot_index>=WN_MAX_OWNED||expected_team<0||expected_team>2)return ue_note(WN_DRIFT,"own_slot_or_expected_team_invalid");
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->epoch!=ue.epoch||s->generation!=owned->generation)return ue_note(WN_DRIFT,"own_registry_generation_mismatch");
 if(!ue_same_weak(owned->actor,ue_weak((struct identity){s->fresh.address,s->fresh.header.index,s->fresh.serial,0})))return ue_note(WN_DRIFT,"own_registry_positiveweak_mismatch");
 if(!held_actor_same(t,&s->fresh))return ue_note(WN_DRIFT,"own_live_positiveweak_or_header_mismatch");
 if(!wu_name_equal(&s->name,&owned->name))return ue_note(WN_DRIFT,"own_registry_name_snapshot_mismatch");
 if(!ue_own_name(s))return ue_note(WN_DRIFT,"own_live_fstring_mismatch_or_read_failed");
 up expected=expected_team>0?ue.teams[(unsigned)expected_team-1].address:0;
 if(!passive_class_fields(t,s->fresh.header.cls))return ue_note(WN_DRIFT,"own_passive_typed_metadata_failed");
 if(!passive_actor_fields(t,s->fresh.address,expected,expected_team>0?expected_team:(int)s->team))return ue_note(WN_DRIFT,"own_passive_live_links_or_team_failed");
 uint32_t count;int occurrences;
 if(!player_array(t,ue.bindings.game_state.address,s->fresh.address,&count,&occurrences))return ue_note(WN_DRIFT,"own_gs_typed_array_or_read_failed");
 if(occurrences!=1)return ue_note(WN_DRIFT,"own_gs_membership_mismatch");
 for(int i=0;i<2;i++){
  if(!team_player_array(t,ue.teams[i].address,s->fresh.address,&count,&occurrences))return ue_note(WN_DRIFT,"own_team_typed_array_or_read_failed");
  if(occurrences!=(expected_team==i+1?1:0))return ue_note(WN_DRIFT,"own_team_membership_mismatch");
 }
 return WN_OK;
}
/* Census only: typed descriptors are verified by bind/guard at the start and
 * end of this scan. Check live owned identities and values against that witness
 * without re-walking identical class properties for every row. Mutations and
 * message subjects still use the full ue_own_verify path above. */
static int ue_census_owned(const struct table *t,const struct wn_owned *owned){
 if(!ue.scan.active||!ue.guard_ready||ue.guard.anchor.world_epoch!=ue.epoch||!owned||owned->slot_index>=WN_MAX_OWNED||owned->team<1||owned->team>2)return WN_DRIFT;
 const struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->epoch!=ue.epoch||s->generation!=owned->generation||s->team!=owned->team||s->fresh.header.cls!=once_binding.state_class.address)return WN_DRIFT;
 if(!ue_same_weak(owned->actor,ue_weak((struct identity){s->fresh.address,s->fresh.header.index,s->fresh.serial,0}))||!held_actor_same(t,&s->fresh)||!wu_name_equal(&s->name,&owned->name)||!ue_own_name(s))return WN_DRIFT;
 static const unsigned offsets[5]={0x158,0x330,0x7b0,0x780,0x788};
 for(int i=0;i<5;i++){up value;if(!rd(s->fresh.address+offsets[i],&value,8)||value!=(i==3?ue.teams[owned->team-1].address:0))return WN_DRIFT;}
 int32_t team_id;if(!rd(s->fresh.address+0x4b0,&team_id,4)||team_id!=(int32_t)owned->team)return WN_DRIFT;
 if(ue_occurrences(ue.scan.players,ue.scan.count,s->fresh.address)!=1)return WN_DRIFT;
 for(int i=0;i<2;i++)if(ue_occurrences(ue.scan.team_items[i],ue.scan.team_count[i],s->fresh.address)!=(owned->team==(uint32_t)i+1?1:0))return WN_DRIFT;
 return WN_OK;
}
static int ue_human_read(const struct table *t,up ps,struct wn_human *out){
 struct identity p,c,n;struct obj ph,ch,nh;struct field f;up pc,back,player,net;
 if(!identity(t,ps,&p)||!hdr(ps,&ph)||!derives(ph.cls,classes[2].id.address)||!in_world(ps,ue.bindings.world.address)||!ue_property(t,ph.cls,"Owner",0x158,"Actor","Actor",&f)||!rd(ps+0x158,&pc,8)||!pc)return WN_WAIT;
 if(!identity(t,pc,&c)||!hdr(pc,&ch)||!derives(ch.cls,classes[3].id.address)||!in_world(pc,ue.bindings.world.address)||!ue_property(t,ch.cls,"PlayerState",0x2c0,"Controller","PlayerState",&f)||!rd(pc+0x2c0,&back,8)||back!=ps||!ue_property(t,ch.cls,"Player",0x358,"PlayerController","Player",&f)||!rd(pc+0x358,&player,8)||!ue_property(t,ch.cls,"NetConnection",0x530,"PlayerController","NetConnection",&f)||!rd(pc+0x530,&net,8)||!net||net!=player||!identity(t,net,&n)||!hdr(net,&nh)||!derives(nh.cls,ptr(f.descriptor+0x70)))return WN_WAIT;
 memset(out,0,sizeof *out);out->player_state=ue_weak(p);out->controller=ue_weak(c);out->connection=ue_weak(n);memcpy(out->headers[0],&ph,40);memcpy(out->headers[1],&ch,40);memcpy(out->headers[2],&nh,40);return WN_OK;
}
static int ue_human_current(const struct table *t,const struct wn_human *h){
 struct warmup_native_weak_v1 ids[3]={h->player_state,h->controller,h->connection};
 for(int i=0;i<3;i++){struct identity now;struct obj header;if(!identity(t,ids[i].address,&now)||!same(now,ue_id(ids[i])))return WN_RECIPIENT_GONE;if(!hdr(now.address,&header))return WN_WAIT;if(memcmp(&header,h->headers[i],40))return (header.flags&BAD_OBJECT)?WN_RECIPIENT_GONE:WN_DRIFT;}
 up owner,back,player,net;
 if(!rd(h->player_state.address+0x158,&owner,8)||!rd(h->controller.address+0x2c0,&back,8)||!rd(h->controller.address+0x358,&player,8)||!rd(h->controller.address+0x530,&net,8))return WN_WAIT;
 return owner==h->controller.address&&back==h->player_state.address&&player==h->connection.address&&net==player&&in_world(h->player_state.address,ue.bindings.world.address)&&in_world(h->controller.address,ue.bindings.world.address)?WN_OK:WN_RECIPIENT_GONE;
}
static int ue_message_recipient_live(const struct table *t,const struct wn_world *bindings,const struct wn_human *h){
 if(!bindings||!h||!ue_same_world(bindings,&ue.bindings))return WN_DRIFT;
 int r=ue_guard_live(t);if(r!=WN_OK)return r;r=ue_human_current(t,h);if(r!=WN_OK)return r;
 up items[100];uint32_t count;if(ue_read_array(bindings->game_state.address,0x2d0,items,&count)!=WN_OK)return WN_WAIT;
 return ue_occurrences(items,count,h->player_state.address)==1?WN_OK:WN_RECIPIENT_GONE;
}
static int ue_message_subject_live(const struct table *t,const struct wn_world *bindings,const struct wn_owned *owned,int joining){
 if(!bindings||!owned||!ue_same_world(bindings,&ue.bindings))return WN_DRIFT;
 if(joining)return ue_own_verify(t,owned,(int)owned->team);
 /* No dead ownPS header or slot is read on the leave path. */
 up items[100];uint32_t count;
 if(ue_read_array(bindings->game_state.address,0x2d0,items,&count)!=WN_OK)return WN_WAIT;
 if(ue_occurrences(items,count,owned->actor.address))return WN_WAIT;
 for(int i=0;i<2;i++){if(ue_read_array(ue.teams[i].address,0x398,items,&count)!=WN_OK)return WN_WAIT;if(ue_occurrences(items,count,owned->actor.address))return WN_WAIT;}
 return WN_OK;
}
#include "warmup_ue_messages.inc"
static int ue_census_trace_result(int result,uint64_t started){
 uint64_t finished=mono_ns();
 atomic_store(&telemetry_census_last_ns,started&&finished>=started?finished-started:0);
 atomic_store(&telemetry_census_result,result);return result;
}
static int ue_census(void *context,uint64_t epoch,const struct wn_owned owned[WN_MAX_OWNED],uint64_t deadline,struct wn_census *out){
 (void)context;uint64_t started=mono_ns();atomic_fetch_add(&telemetry_census_calls,1);
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_ENTRY);
 if(!owned||!out||!ue_main()||epoch!=ue.epoch||atomic_load(&reentry_detected))return ue_census_trace_result(WN_DRIFT,started);
 if(atomic_exchange(&transaction_active,1)){atomic_store(&reentry_detected,1);return ue_census_trace_result(WN_DRIFT,started);}
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_TRANSACTION);
 int result=WN_WAIT;struct table t;uint32_t capacity;int failed_slot=-1;ue_diagnostic_begin();
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_WORLD);
 if(ue_world_live(epoch,&ue.bindings)!=WN_OK){result=WN_WORLD_CHANGED;goto done;}
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_TABLE);
 if(!table_read(&t))goto done;
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_METADATA_BARRIER);
 result=ue_metadata_cache_barrier(&t);if(result!=WN_OK)goto done;
 if(!ue.scan.active||ue.scan.cursor>=ue.scan.count){
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_GUARD_BEFORE_BIND);
  if(ue.guard_ready){result=ue_guard_live(&t);if(result!=WN_OK)goto done;}
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_BIND_RUNTIME);
  result=ue_bind_runtime(&t,&capacity);if(result!=WN_OK)goto done;
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_GUARD_AFTER_BIND);
  result=ue_guard_live(&t);if(result!=WN_OK)goto done;
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_COMMON_ABI);
  result=ue_common_abi(&t);if(result!=WN_OK)goto done;
 }else capacity=ue.scan.result.capacity;
 if(!ue.scan.active){
  memset(&ue.scan,0,sizeof ue.scan);ue.scan.result.bindings=ue.bindings;ue.scan.result.capacity=capacity;
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_INIT_GS_ARRAY);
  result=ue_read_array(ue.bindings.game_state.address,0x2d0,ue.scan.players,&ue.scan.count);if(result!=WN_OK)goto done;
  for(int team=0;team<2;team++){atomic_store(&telemetry_census_checkpoint,(uint32_t)WUE_CENSUS_INIT_TEAM_A+(uint32_t)team);result=ue_read_array(ue.teams[team].address,0x398,ue.scan.team_items[team],&ue.scan.team_count[team]);if(result!=WN_OK)goto done;ue.scan.result.team_total[team]=ue.scan.team_count[team];}
  ue.scan.active=1;
 }
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_CAPACITY);
 if(ue.scan.result.capacity!=capacity){ue.scan.active=0;result=WN_WAIT;goto done;}
 /* Read-only bounded batch; preserve the per-row deadline and every identity
    check. Final array/world verification remains on a separate turn. */
 int scanned_rows=0;
 int row_limit=100; /* Same per-row deadline; do not spread cheap reads across frames. */
 while(ue.scan.cursor<ue.scan.count&&scanned_rows<row_limit){
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_ROSTER_BUDGET);
  if(mono_ns()>=deadline){result=WN_WAIT;goto done;}
  up ps=ue.scan.players[ue.scan.cursor++];int found=-1;
  for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(owned[i].state!=WN_FREE&&owned[i].state!=WN_REMOVED_NOTIFY&&owned[i].actor.address==ps){if(found>=0){result=WN_DRIFT;goto done;}found=(int)i;}
  if(found>=0){
   const struct wn_owned *slot=&owned[found];
   atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_OWNED_STATE);
   if(slot->state==WN_DESTROYED_PENDING||slot->state!=WN_ACTIVE){ue.scan.result.unknown++;result=WN_WAIT;goto done;}
   atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_OWNED_VERIFY);
   failed_slot=found;result=ue_census_owned(&t,slot);if(result!=WN_OK)goto done;
   ue.scan.result.owned_count++;ue.scan.result.owned_team[slot->team-1]++;ue.scan.result.owned_present[found]=1;ue.scan.result.owned_observed_team[found]=(uint8_t)slot->team;
  }else{
   atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_HUMAN_READ);
   struct wn_human human;result=ue_human_read(&t,ps,&human);
   if(result!=WN_OK){ue.scan.result.unknown++;result=WN_WAIT;goto done;}
   atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_TEAM_DUPLICATE);
   int first=ue_occurrences(ue.scan.team_items[0],ue.scan.team_count[0],ps),second=ue_occurrences(ue.scan.team_items[1],ue.scan.team_count[1],ps);
   if(first+second>1){result=WN_DRIFT;goto done;}human.team=first?1U:second?2U:0U;
   atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_HUMAN_DUPLICATE);
   for(uint32_t i=0;i<ue.scan.result.human_count;i++)if(ue_same_weak(human.controller,ue.scan.result.humans[i].controller)||ue_same_weak(human.connection,ue.scan.result.humans[i].connection)){result=WN_DRIFT;goto done;}
   atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_HUMAN_LIMIT);
   if(ue.scan.result.human_count>=WN_MAX_HUMANS){result=WN_DRIFT;goto done;}
   ue.scan.result.humans[ue.scan.result.human_count++]=human;
   if(human.team)ue.scan.result.human_team[human.team-1]++;else ue.scan.result.human_unassigned++;
  }
  atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_ROW_YIELD);
  ++scanned_rows;
 }
 if(scanned_rows||ue.scan.cursor<ue.scan.count){result=WN_WAIT;goto done;}
 /* Bounded final verification: cheap positive slots/relations + fixed bytes,
  * not N full metadata walks. All typed descriptors are in the World witness. */
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_FINAL_HUMAN);
 for(uint32_t i=0;i<ue.scan.result.human_count;i++){result=ue_human_current(&t,&ue.scan.result.humans[i]);if(result!=WN_OK){ue.scan.active=0;result=result==WN_DRIFT?WN_DRIFT:WN_WAIT;goto done;}}
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_FINAL_OWNED);
 for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(ue.scan.result.owned_present[i]){
  struct ue_owned_state *state=&ue.owned[i];up values[5];int32_t team_id;
  if(!held_actor_same(&t,&state->fresh)||!ue_own_name(state)||!rd(state->fresh.address+0x158,&values[0],8)||!rd(state->fresh.address+0x330,&values[1],8)||!rd(state->fresh.address+0x7b0,&values[2],8)||!rd(state->fresh.address+0x780,&values[3],8)||!rd(state->fresh.address+0x788,&values[4],8)||!rd(state->fresh.address+0x4b0,&team_id,4)||values[0]||values[1]||values[2]||values[4]||values[3]!=ue.teams[state->team-1].address||team_id!=(int32_t)state->team){result=WN_DRIFT;goto done;}
 }
 up current_players[100];uint32_t count;
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_FINAL_GS_ARRAY);
 result=ue_read_array(ue.bindings.game_state.address,0x2d0,current_players,&count);
 if(result!=WN_OK||count!=ue.scan.count||memcmp(current_players,ue.scan.players,8UL*count)){ue.scan.active=0;result=WN_WAIT;goto done;}
 for(int team=0;team<2;team++){
  atomic_store(&telemetry_census_checkpoint,(uint32_t)WUE_CENSUS_FINAL_TEAM_A+(uint32_t)team);
  result=ue_read_array(ue.teams[team].address,0x398,current_players,&count);
  if(result!=WN_OK||count!=ue.scan.team_count[team]||memcmp(current_players,ue.scan.team_items[team],8UL*count)){ue.scan.active=0;result=WN_WAIT;goto done;}
 }
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_FINAL_GUARD);
 result=ue_guard_live(&t);if(result!=WN_OK)goto done;
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_FINAL_WORLD);
 if(ue_world_live(epoch,&ue.bindings)!=WN_OK){result=WN_WORLD_CHANGED;goto done;}
 atomic_store(&telemetry_census_checkpoint,WUE_CENSUS_CAPTURED);
 ue.scan.result.captured_ns=mono_ns();ue.scan.result.valid_until_ns=ue.scan.result.captured_ns+UINT64_C(2000000000);ue.scan.result.sample_id=++ue.sample_id;
 uint64_t hash=message_hash_u64(UINT64_C(1469598103934665603),epoch);
 for(uint32_t i=0;i<ue.scan.result.human_count;i++){const struct wn_human *h=&ue.scan.result.humans[i];hash=message_hash_u64(hash,h->player_state.address);hash=message_hash_u32(hash,(uint32_t)h->player_state.serial);hash=message_hash_u64(hash,h->controller.address);hash=message_hash_u32(hash,(uint32_t)h->controller.serial);hash=message_hash_u64(hash,h->connection.address);hash=message_hash_u32(hash,(uint32_t)h->connection.serial);hash=message_hash_u32(hash,h->team);}
 for(uint32_t i=0;i<WN_MAX_OWNED;i++)if(ue.scan.result.owned_present[i]){hash=message_hash_u64(hash,owned[i].actor.address);hash=message_hash_u32(hash,(uint32_t)owned[i].actor.serial);hash=message_hash_u32(hash,owned[i].team);}
 ue.scan.result.binding_signature=hash;*out=ue.scan.result;ue.scan.active=0;result=WN_OK;
done:
 if(result==WN_DRIFT||result==WN_WORLD_CHANGED)ue.scan.active=0;
 if(result==WN_DRIFT)atomic_store(&telemetry_failed_slot,failed_slot);
 ue_diagnostic_end(result==WN_DRIFT||result==WN_WORLD_CHANGED);
 atomic_store(&transaction_active,0);return ue_census_trace_result(result,started);
}
static int ue_receipt_result(struct wn_receipt *r,int result,const char *stage){snprintf(r->stage,sizeof r->stage,"%s",stage);r->finished_ns=mono_ns();return result;}
static int ue_begin_finish(const struct table *t,const struct wn_owned *owned,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED||ue.owned[owned->slot_index].present)return WN_DRIFT;
 up players[100];uint32_t count,capacity;int result=ue_bind_runtime(t,&capacity);if(result!=WN_OK)return result;
 if(ue_read_array(ue.bindings.game_state.address,0x2d0,players,&count)!=WN_OK||(uint64_t)count+1>=capacity)return WN_WAIT;
 struct identity begin=ue_fresh_meta(t,"GameplayStatics","BeginDeferredActorSpawnFromClass"),finish=ue_fresh_meta(t,"GameplayStatics","FinishSpawningActor");
 _Alignas(16) unsigned char bp[144]={0},fp[128]={0};double one=1;up w=ue.bindings.world.address,cls=once_binding.state_class.address,actor_address=0;
 memcpy(bp,&w,8);memcpy(bp+8,&cls,8);memcpy(bp+16+24,&one,8);for(int i=0;i<3;i++)memcpy(bp+16+64+8*i,&one,8);bp[112]=1;bp[128]=0;
 event_fn event=(event_fn)BASE_PROCESS_EVENT;r->issued=1;r->started_ns=mono_ns();r->subcalls_issued|=1;record_event();event((void *)current.gameplay_cdo.address,(void *)begin.address,bp);memcpy(&actor_address,bp+136,8);
 struct table fresh=*t;struct fresh_actor actor;up level;
 if(!table_read(&fresh)||!rd(w+0x30,&level,8)||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!fresh_actor_capture(&fresh,actor_address,cls,level,&actor))return WN_DRIFT;
 r->actor=(struct warmup_native_weak_v1){actor.address,actor.header.index,actor.serial};memcpy(r->actor_header,&actor.header,40);
 memcpy(fp,&actor.address,8);memcpy(fp+16,bp+16,96);fp[112]=0;
 if(!fresh_actor_same(&fresh,&actor)||!fresh_function(&fresh,finish,"GameplayStatics","FinishSpawningActor",79832067U,128,120,0x7ece0d0,finish_fields,4))return WN_DRIFT;
 r->subcalls_issued|=2;record_event();event((void *)current.gameplay_cdo.address,(void *)finish.address,fp);up returned;memcpy(&returned,fp+120,8);r->returned=1;
 int occurrences;uint32_t after;
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!table_read(&fresh)||returned!=actor.address||!fresh_actor_same(&fresh,&actor)||actor.serial<=0||!passive_actor_fields(&fresh,actor.address,0,-1)||!player_array(&fresh,ue.bindings.game_state.address,actor.address,&after,&occurrences)||occurrences!=1||after!=count+1||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_DRIFT;
 struct ue_owned_state *state=&ue.owned[owned->slot_index];memset(state,0,sizeof *state);state->present=1;state->epoch=ue.epoch;state->generation=owned->generation;state->fresh=actor;state->state=WN_SPAWNED;
 r->actor=ue_weak((struct identity){actor.address,actor.header.index,actor.serial,0});memcpy(r->actor_header,&actor.header,40);return WN_OK;
}
static int ue_name_step(const struct table *t,const struct wn_owned *owned,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED)return WN_DRIFT;
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->generation!=owned->generation||s->state!=WN_SPAWNED||!held_actor_same(t,&s->fresh)||!passive_actor_fields(t,s->fresh.address,0,-1))return WN_DRIFT;
 struct wu_name checked;size_t bytes=strnlen(owned->name.utf8,sizeof owned->name.utf8);if(bytes>=sizeof owned->name.utf8||wu_name_from_utf8(owned->name.utf8,bytes,&checked)!=WU_OK||!wu_name_equal(&checked,&owned->name))return WN_DRIFT;
 struct identity name=ue_fresh_meta(t,"SQPlayerState","BlueprintSetPlayerName");if(!fresh_name_function(t,name)||!name_actor_slots(s->fresh.header.vptr)||!naming_code_matches())return WN_WAIT;
 typedef void *(*new_fn)(size_t);typedef void (*delete_fn)(void *);size_t input_bytes=owned->name.unit_count*2;
 r->issued=1;r->started_ns=mono_ns();r->subcalls_issued|=1;record_allocator();void *allocation=((new_fn)ENGINE_NEW)(input_bytes);if(!allocation)return WN_ERROR;
 memcpy(allocation,owned->name.units,input_bytes);struct engine_string input={(up)allocation,(int32_t)owned->name.unit_count,(int32_t)owned->name.unit_count},original=input;
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!held_actor_same(t,&s->fresh)||!fresh_name_function(t,name)||!naming_code_matches())return WN_DRIFT;
 r->subcalls_issued|=2;record_event();((event_fn)ACTOR_PROCESS_EVENT)((void *)s->fresh.address,(void *)name.address,&input);r->returned=1;
 uint16_t bytes_after[WU_NAME_STORAGE_UNITS];struct engine_string own_header;s->name=owned->name;
 if(memcmp(&input,&original,sizeof input)||!rd(original.data,bytes_after,input_bytes)||memcmp(bytes_after,owned->name.units,input_bytes)||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK||!held_actor_same(t,&s->fresh)||!ue_own_name(s)||!rd(s->fresh.address+0x348,&own_header,sizeof own_header)||own_header.data==(up)allocation||!naming_code_matches())return WN_DRIFT;
 r->subcalls_issued|=4;record_allocator();((delete_fn)ENGINE_DELETE)(allocation);r->input_freed=1;s->state=WN_NAMED;return WN_OK;
}
static int ue_team_step(const struct table *t,const struct wn_owned *owned,enum wn_step step,uint32_t to_team,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED||to_team>2)return WN_DRIFT;
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->generation!=owned->generation||s->epoch!=ue.epoch||!held_actor_same(t,&s->fresh)||!ue_own_name(s))return WN_DRIFT;
 if(step==WN_SET_TEAM&&s->state!=WN_NAMED)return WN_DRIFT;
 if((step==WN_MOVE_TEAM||step==WN_DETACH)&&(s->state!=WN_ACTIVE||ue_own_verify(t,owned,(int)s->team)!=WN_OK))return WN_DRIFT;
 struct identity function=ue_fresh_meta(t,"SQPlayerState","SetTeamState");if(!fresh_team_function(t,function,s->fresh.header.vptr))return WN_WAIT;
 up target=to_team?ue.teams[to_team-1].address:0;r->issued=1;r->started_ns=mono_ns();record_event();((event_fn)ACTOR_PROCESS_EVENT)((void *)s->fresh.address,(void *)function.address,&target);r->returned=1;
 struct wn_owned check=*owned;check.actor=ue_weak((struct identity){s->fresh.address,s->fresh.header.index,s->fresh.serial,0});check.name=s->name;check.team=to_team;
 if(ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_DRIFT;
 int result=ue_own_verify(t,&check,(int)to_team);if(result!=WN_OK)return result;
 if(to_team){s->team=to_team;s->state=WN_ACTIVE;}else s->state=WN_DETACHED;return WN_OK;
}
static int ue_destroy_step(const struct table *t,const struct wn_owned *owned,struct wn_receipt *r){
 if(owned->slot_index>=WN_MAX_OWNED)return WN_DRIFT;
 struct ue_owned_state *s=&ue.owned[owned->slot_index];
 if(!s->present||s->state!=WN_DETACHED||s->generation!=owned->generation||ue_own_verify(t,owned,0)!=WN_OK)return WN_DRIFT;
 struct identity function=ue_fresh_meta(t,"Actor","K2_DestroyActor");if(!fresh_function(t,function,"Actor","K2_DestroyActor",67240962U,0,65535,0x7a068e0,NULL,0))return WN_WAIT;
 r->issued=1;r->started_ns=mono_ns();record_event();((event_fn)ACTOR_PROCESS_EVENT)((void *)s->fresh.address,(void *)function.address,NULL);r->returned=1;s->state=WN_DESTROYED_PENDING;return WN_OK;
}
/* Reconcile a retained cross-GT planning witness immediately before the
 * first write. Current rosters are always reread; classification never borrows
 * an old H count when the underlying object set/relations have changed. */
static int ue_last_census_live(const struct table *t){
 uint64_t now=mono_ns();
 if(ue.scan.active||!ue.scan.result.sample_id||ue.scan.result.unknown||!now||now<ue.scan.result.captured_ns||now>=ue.scan.result.valid_until_ns||!ue_same_world(&ue.scan.result.bindings,&ue.bindings))return WN_WAIT;
 up players[100],teams[2][100];uint32_t count,team_count[2];
 int result=ue_read_array(ue.bindings.game_state.address,0x2d0,players,&count);
 if(result!=WN_OK||count!=ue.scan.count||memcmp(players,ue.scan.players,8UL*count))return WN_WAIT;
 for(int team=0;team<2;team++){
  result=ue_read_array(ue.teams[team].address,0x398,teams[team],&team_count[team]);
  if(result!=WN_OK||team_count[team]!=ue.scan.team_count[team]||memcmp(teams[team],ue.scan.team_items[team],8UL*team_count[team]))return WN_WAIT;
 }
 for(uint32_t i=0;i<ue.scan.result.human_count;i++){
  result=ue_human_current(t,&ue.scan.result.humans[i]);
  if(result!=WN_OK)return result==WN_DRIFT?WN_DRIFT:WN_WAIT;
 }
 uint32_t seen=0;
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){
  struct ue_owned_state *state=&ue.owned[i];
  if(!ue.scan.result.owned_present[i]){
   if(state->present&&state->epoch==ue.epoch&&state->state==WN_ACTIVE)return WN_WAIT;
   continue;
  }
  if(!state->present||state->epoch!=ue.epoch||state->state!=WN_ACTIVE||state->team<1||state->team>2||state->team!=ue.scan.result.owned_observed_team[i])return WN_DRIFT;
  if(!held_actor_same(t,&state->fresh)||!ue_own_name(state))return WN_DRIFT;
  up owner,pawn,current_pawn,team_pointer,squad;int32_t team_id;
  if(!rd(state->fresh.address+0x158,&owner,8)||!rd(state->fresh.address+0x330,&pawn,8)||!rd(state->fresh.address+0x7b0,&current_pawn,8)||!rd(state->fresh.address+0x780,&team_pointer,8)||!rd(state->fresh.address+0x788,&squad,8)||!rd(state->fresh.address+0x4b0,&team_id,4))return WN_WAIT;
  if(owner||pawn||current_pawn||squad||team_pointer!=ue.teams[state->team-1].address||team_id!=(int32_t)state->team)return WN_DRIFT;
  if(ue_occurrences(players,count,state->fresh.address)!=1)return WN_WAIT;
  for(int team=0;team<2;team++)if(ue_occurrences(teams[team],team_count[team],state->fresh.address)!=(state->team==(uint32_t)team+1?1:0))return WN_WAIT;
  seen++;
 }
 if(seen!=ue.scan.result.owned_count||ue_world_live(ue.epoch,&ue.bindings)!=WN_OK)return WN_WAIT;
 return WN_OK;
}
static int ue_step(void *context,uint64_t epoch,const struct wn_world *bindings,const struct wn_owned *owned,enum wn_step step,uint32_t to_team,const struct wn_human *recipient,const uint16_t *message,size_t units,uint64_t deadline,struct wn_receipt *r){
 (void)context;if(!owned||!r||!ue_main()||warmup_control_failed()||step>=WN_STEP_COUNT||owned->world_epoch!=epoch)return WN_DRIFT;
 if(r->issued)return ue_receipt_result(r,WN_DRIFT,"duplicate_native_phase_rejected");
 if(!deadline||!mono_ns()||mono_ns()>=deadline)return ue_receipt_result(r,WN_ERROR,"phase_deadline_expired");
 uint64_t admission_until=UINT64_MAX;
 if(step==WN_BEGIN_FINISH||step==WN_MOVE_TEAM){
  struct wn_admission admission;memset(&admission,0,sizeof admission);uint64_t now=mono_ns();
  if(warmup_queue_guard_admission(NULL,epoch,bindings,now,&admission)!=WN_OK||!admission.valid||!ue_same_weak(admission.world,bindings->world)||!admission.party_safety_verified||admission.inflight_slots||admission.team_deficit[0]||admission.team_deficit[1]||now>=admission.valid_until_ns)return ue_receipt_result(r,WN_WAIT,"fresh_admission_not_available_before_transaction");
  admission_until=admission.valid_until_ns;
 }
 if(atomic_exchange(&transaction_active,1)){atomic_store(&reentry_detected,1);return WN_DRIFT;}
 ue_diagnostic_begin();
 unsigned before_engine=atomic_load(&engine_calls),before_event=atomic_load(&process_event_calls),before_allocator=atomic_load(&allocator_calls);
 int result=ue_world_live(epoch,bindings);struct table t;
 if(result!=WN_OK)goto done;
 if(!table_read(&t)){result=WN_WAIT;goto done;}
 uint32_t capacity;if(ue.guard_ready){result=ue_guard_live(&t);if(result!=WN_OK)goto done;}result=ue_bind_runtime(&t,&capacity);if(result!=WN_OK)goto done;result=ue_guard_live(&t);if(result!=WN_OK)goto done;result=ue_common_abi(&t);if(result!=WN_OK)goto done;
 if(step==WN_MESSAGE_JOIN||step==WN_MESSAGE_LEAVE){
  result=warmup_ue_message_step(epoch,bindings,owned,step==WN_MESSAGE_JOIN,recipient,message,units,deadline,r);
  atomic_fetch_add(&engine_calls,r->engine_calls);atomic_fetch_add(&process_event_calls,r->process_event_calls);atomic_fetch_add(&allocator_calls,r->allocator_calls);goto done;
 }
 if(step==WN_BEGIN_FINISH||step==WN_MOVE_TEAM||step==WN_DETACH){
  result=ue_last_census_live(&t);
  if(result!=WN_OK){snprintf(r->stage,sizeof r->stage,"%s",result==WN_WAIT?"last_census_changed_before_mutation":"last_census_owned_or_header_drift");goto done;}
 }
 if(mono_ns()>=admission_until){result=WN_WAIT;goto done;}
 if(step==WN_BEGIN_FINISH)result=ue_begin_finish(&t,owned,r);
 else if(step==WN_SET_NAME)result=ue_name_step(&t,owned,r);
 else if(step==WN_SET_TEAM||step==WN_MOVE_TEAM)result=ue_team_step(&t,owned,step,to_team,r);
 else if(step==WN_DETACH)result=ue_team_step(&t,owned,step,0,r);
 else if(step==WN_DESTROY)result=ue_destroy_step(&t,owned,r);
 else if(step==WN_VERIFY_ACTIVE)result=ue_own_verify(&t,owned,(int)(to_team?to_team:owned->team));
 else if(step==WN_VERIFY_DETACHED)result=ue_own_verify(&t,owned,0);
 else if(step==WN_CLEANUP){
  result=ue_message_subject_live(&t,bindings,owned,0);
  if(result==WN_OK&&owned->slot_index<WN_MAX_OWNED){ue.owned[owned->slot_index].state=WN_REMOVED_NOTIFY;ue.owned[owned->slot_index].present=0;warmup_queue_owned_departed();}
 }else result=WN_ERROR;
done:
 if(atomic_load(&reentry_detected)||warmup_control_failed())result=WN_DRIFT;
 if(r->issued&&result==WN_WAIT)result=WN_DRIFT;
 r->engine_calls=atomic_load(&engine_calls)-before_engine;r->process_event_calls=atomic_load(&process_event_calls)-before_event;r->allocator_calls=atomic_load(&allocator_calls)-before_allocator;
 ue_diagnostic_end(result==WN_DRIFT||result==WN_ERROR||result==WN_WORLD_CHANGED);
 r->finished_ns=mono_ns();if(!r->stage[0])snprintf(r->stage,sizeof r->stage,"native_step_%u_result_%d",(unsigned)step,result);
 atomic_store(&transaction_active,0);return result;
}
static uint64_t ue_clock(void *context){(void)context;return mono_ns();}
static __attribute__((unused)) int ue_no_admission(void *context,uint64_t epoch,const struct wn_world *bindings,uint64_t now,struct wn_admission *out){(void)context;(void)epoch;(void)bindings;(void)now;if(out)memset(out,0,sizeof *out);return WN_WAIT;}
static int ue_invalidate(void *context,uint64_t epoch,uint32_t flags){(void)context;return warmup_native_snapshot_invalidate(epoch,flags);}
static int ue_seal(void *context,const struct warmup_native_snapshot_v1 *s){(void)context;return warmup_native_snapshot_seal(s);}
int warmup_ue_backend_gt_enter(void){
 if(!ue_main()||!atomic_load(&backend_initialized))return 0;
 if(atomic_load(&transaction_active)){atomic_store(&reentry_detected,1);return 0;}
 if(callback_epoch==UINT64_MAX)return 0;
 callback_epoch++;atomic_store(&telemetry_epoch,callback_epoch);return 1;
}
void warmup_ue_backend_sample(uint64_t deadline){
 if(!ue_main()||!atomic_load(&backend_initialized)||atomic_load(&transaction_active)||atomic_load(&reentry_detected))return;
 sample_tick(deadline);atomic_store(&telemetry_classes,(uint32_t)current.required_classes_found);atomic_store(&telemetry_functions,(uint32_t)current.function_count);atomic_store(&telemetry_cursor,current.cursor);atomic_store(&telemetry_objects,current.object_count);atomic_store(&telemetry_completed_scans,current.completed_scans);
}
void warmup_ue_backend_telemetry(struct warmup_ue_telemetry *out){
 if(out)*out=(struct warmup_ue_telemetry){
  .engine_calls=atomic_load(&engine_calls),
  .process_event_calls=atomic_load(&process_event_calls),
  .allocator_calls=atomic_load(&allocator_calls),
  .gt_epoch=atomic_load(&telemetry_epoch),
  .metadata_classes=atomic_load(&telemetry_classes),
  .metadata_functions=atomic_load(&telemetry_functions),
  .reentry_detected=atomic_load(&reentry_detected),
  .initialized=atomic_load(&backend_initialized),
  .metadata_cursor=atomic_load(&telemetry_cursor),
  .object_count=atomic_load(&telemetry_objects),
  .completed_scans=atomic_load(&telemetry_completed_scans),
  .census_failed_slot=atomic_load(&telemetry_failed_slot),
  .read_error_errno=atomic_load(&telemetry_read_errno),
  .read_error_address=atomic_load(&telemetry_read_address),
  .read_error_size=atomic_load(&telemetry_read_size),
  .read_error_result=atomic_load(&telemetry_read_result),
  .census_calls=atomic_load(&telemetry_census_calls),
  .census_last_ns=atomic_load(&telemetry_census_last_ns),
  .probe_calls=atomic_load(&telemetry_probe_calls),
  .probe_last_ns=atomic_load(&telemetry_probe_last_ns),
  .probe_max_ns=atomic_load(&telemetry_probe_max_ns),
  .census_checkpoint=atomic_load(&telemetry_census_checkpoint),
  .common_abi_gate=atomic_load(&telemetry_common_abi_gate),
  .census_result=atomic_load(&telemetry_census_result),
  .probe_result=atomic_load(&telemetry_probe_result),
 };
}
int warmup_ue_backend_init(struct warmup_native_ops *out,void **context,char *error,size_t error_capacity){
 const char *failure="invalid_init_arguments";char hostname[128]={0};struct stat marker_stat;char marker[96]={0};int marker_fd=-1;
 if(!out||!context||!error||!error_capacity)goto fail;
 error[0]=0;if(!warmup_bootstrap_ready()){failure="bootstrap_not_ready";goto fail;}
 const char *enabled=getenv("WARMUP_INTEGRATED_ENABLE");if(!enabled||strcmp(enabled,"1")){failure="integrated_env_disabled";goto fail;}
 if(gethostname(hostname,sizeof hostname-1)||strcmp(hostname,WARMUP_TARGET_HOSTNAME)||geteuid()!=WARMUP_TARGET_UID||getegid()!=WARMUP_TARGET_GID){failure="wrong_hostname";goto fail;}
 marker_fd=open(WARMUP_TARGET_MARKER,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 if(marker_fd<0||fstat(marker_fd,&marker_stat)||!S_ISREG(marker_stat.st_mode)||marker_stat.st_uid||marker_stat.st_mode&0022||marker_stat.st_size!=(off_t)strlen(WARMUP_TARGET_MARKER_TEXT)||pread(marker_fd,marker,(size_t)marker_stat.st_size,0)!=marker_stat.st_size||memcmp(marker,WARMUP_TARGET_MARKER_TEXT,(size_t)marker_stat.st_size)){failure="marker_gate_failed";goto fail;}
 close(marker_fd);marker_fd=-1;process_id=getpid();if(!ue_main()||atomic_load(&backend_initialized)){failure="nonmain_or_duplicate_init";goto fail;}
 memfd=open("/proc/self/mem",O_RDONLY|O_CLOEXEC);up tick;
 if(memfd<0||!rd(WARMUP_UE_TICK_CELL,&tick,8)||tick!=WARMUP_UE_ORIGINAL_TICK){failure="tick_preimage_or_readonly_mem_failed";goto fail;}
 if(!warmup_native_snapshot_bind_validator(ue_snapshot_live)){failure="snapshot_validator_bind_failed";goto fail;}
 atomic_store(&ue_error,"backend_initialized_waiting_metadata");
 *out=(struct warmup_native_ops){ue_clock,ue_pool_probe,ue_reset,ue_census,warmup_queue_guard_admission,ue_step,ue_invalidate,ue_seal};*context=&ue;atomic_store(&backend_initialized,1);return 1;
fail:
 if(marker_fd>=0)close(marker_fd);
 if(memfd>=0&&!atomic_load(&backend_initialized)){close(memfd);memfd=-1;}if(error&&error_capacity)snprintf(error,error_capacity,"%s",failure);
 atomic_store(&ue_error,failure);return 0;
}

const char *warmup_ue_backend_error(void){return atomic_load(&ue_error);}
/* Metadata lookup by an ELF-proven offset, without inventing an FProperty
 * name. Target still requires dim1/ObjectProperty/8/owner+target Class. */
static int ue_object_property_at(const struct table *t,up cls,int offset,const char *target,struct field *out){
 up ancestors[32];int depth=0;
 while(cls&&depth<32){
  for(int i=0;i<depth;i++)if(ancestors[i]==cls)return 0;
  ancestors[depth++]=cls;struct identity id;up at;
  if(!metadata_identity(t,cls,&id)||!uclass_metaclass(t,cls)||!rd(cls+0x50,&at,8))return 0;
  up seen[1024];int count=0;
  while(at&&count<1024){
   for(int i=0;i<count;i++)if(seen[i]==at)return 0;
   seen[count++]=at;unsigned char a[0x48],b[0x48];up next;int32_t off;
   if(!rd(at,a,sizeof a)||!rd(at,b,sizeof b)||memcmp(a,b,sizeof a))return 0;
   memcpy(&next,a+0x18,8);memcpy(&off,a+0x44,4);
   if(off==offset){struct field f;up verified;if(!field_read(at,&f,&verified)||verified!=next||strcmp(f.type,"ObjectProperty")||f.size!=8||!target_matches(t,&f,target)||!stable_metadata(t,id))return 0;f.declaring_class=cls;*out=f;return 1;}
   at=next;
  }
  if(at||!stable_metadata(t,id)||!rd(cls+0x40,&cls,8))return 0;
 }
 return 0;
}
int warmup_ue_queue_snapshot(struct warmup_ue_queue_view *out){
 if(!out||!ue_main()||warmup_control_failed()||!atomic_load(&backend_initialized)||!ue.epoch||atomic_load(&transaction_active)||atomic_load(&reentry_detected))return ue_note(0,"queue_provider_transaction_reentry_or_unready");
 struct wn_world now;struct table t;uint32_t capacity;
 if(ue_probe(NULL,&now)!=WN_OK||!ue_same_world(&now,&ue.bindings)||!table_read(&t)||(ue.guard_ready&&ue_guard_live(&t)!=WN_OK)||ue_bind_runtime(&t,&capacity)!=WN_OK||ue_guard_live(&t)!=WN_OK)return ue_note(0,"queue_provider_world_or_metadata_unavailable");
 struct obj wh,gih,hosth;struct field gi_field,host_field;up gi,host;
 struct identity gi_id,host_id;
 if(!hdr(now.world.address,&wh)||!ue_object_property_at(&t,wh.cls,0x258,"GameInstance",&gi_field)||!meta_named(&t,gi_field.declaring_class,"Class","/Script/Engine","World")||!rd(now.world.address+0x258,&gi,8)||!identity(&t,gi,&gi_id)||!hdr(gi,&gih)||!derives(gih.cls,ptr(gi_field.descriptor+0x70)))return ue_note(0,"queue_world_game_instance_property_or_positiveweak");
 if(!ue_object_property_at(&t,gih.cls,0x1e0,"SQJoinBeaconHost",&host_field)||!meta_named(&t,host_field.declaring_class,"Class","/Script/Squad","SQGameInstance")||!rd(gi+0x1e0,&host,8)||!identity(&t,host,&host_id)||!hdr(host,&hosth)||!derives(hosth.cls,ptr(host_field.descriptor+0x70))||!in_world(host,now.world.address))return ue_note(0,"queue_current_gi_host_property_or_positiveweak");
 struct warmup_ue_queue_view view={0};view.abi_version=WARMUP_QUEUE_VIEW_ABI;view.struct_size=sizeof view;view.world_epoch=ue.epoch;view.outer_gt_epoch=warmup_control_outer_epoch();view.bindings=now;view.host=ue_weak(host_id);view.capacity=capacity;view.native_g=-1;
 up gs_items[100],team_items[2][100];uint32_t count;
 if(ue_read_array(now.game_state.address,0x2d0,gs_items,&view.actual_gs_count)!=WN_OK)return ue_note(0,"queue_current_gs_array_unavailable");
 for(int team=0;team<2;team++)if(ue_read_array(ue.teams[team].address,0x398,team_items[team],&view.team_total[team])!=WN_OK)return ue_note(0,"queue_current_team_arrays_unavailable");
 for(uint32_t i=0;i<WN_MAX_OWNED;i++){
  struct ue_owned_state *state=&ue.owned[i];if(!state->present||state->epoch!=ue.epoch||state->state!=WN_ACTIVE||ue_occurrences(gs_items,view.actual_gs_count,state->fresh.address)!=1)continue;
  struct identity current_id;struct obj h;if(!identity(&t,state->fresh.address,&current_id)||current_id.index!=state->fresh.header.index||current_id.serial!=state->fresh.serial||!hdr(current_id.address,&h)||memcmp(&h,&state->fresh.header,40)||!ue_own_name(state))return 0;
  int first=ue_occurrences(team_items[0],view.team_total[0],state->fresh.address),second=ue_occurrences(team_items[1],view.team_total[1],state->fresh.address);
  if(first+second>1)return 0;
  if(first)view.removable_owned_team[0]++;else if(second)view.removable_owned_team[1]++;else view.removable_owned_unassigned++;
 }
 /* Exact native a420600 / +808 D semantics. Wrong reads stay unknown/fail;
  * only native NULL/badflag branches yield known zero. No guessed G value. */
 up engine,settings;uint32_t flags;int32_t allowance=0;
 if(!rd(ENGINE_GLOBAL,&engine,8)||!engine||ptr(engine)!=ENGINE_VPTR||!rd(engine+8,&flags,4))return ue_note(0,"queue_native_settings_engine_unavailable");
 if(!(flags&UINT32_C(0x40000000))){
  if(!rd(engine+0x12f0,&settings,8))return ue_note(0,"queue_native_settings_pointer_unavailable");
  if(settings){if(!rd(settings+8,&flags,4))return ue_note(0,"queue_native_settings_flags_unavailable");if(!(flags&UINT32_C(0x40000000))&&!rd(settings+0x60,&allowance,4))return ue_note(0,"queue_native_team_allowance_read_unavailable");}
 }
 view.native_team_allowance=allowance>0?allowance:0;view.native_team_allowance_known=1;
 up final_items[100];if(ue_read_array(now.game_state.address,0x2d0,final_items,&count)!=WN_OK||count!=view.actual_gs_count||memcmp(final_items,gs_items,count*8UL)||ue_world_live(ue.epoch,&now)!=WN_OK)return 0;
 for(int team=0;team<2;team++)if(ue_read_array(ue.teams[team].address,0x398,final_items,&count)!=WN_OK||count!=view.team_total[team]||memcmp(final_items,team_items[team],count*8UL))return 0;
 view.captured_ns=mono_ns();if(!view.captured_ns||!view.outer_gt_epoch)return ue_note(0,"queue_outer_epoch_or_clock_unavailable");*out=view;return ue_note(1,"queue_view_confirmed");
}


/* Read-only round observation on the game thread. Never calls engine methods. */
int warmup_ue_round_state(char *state,size_t capacity,uint64_t *world_token){
 if(!state||capacity<48||!world_token||!ue_main()||atomic_load(&transaction_active)||atomic_load(&reentry_detected))return 0;
 struct wn_world a,b;struct table t;struct obj gs;struct field f;uint32_t ids[2],again[2];
 if(ue_probe(NULL,&a)!=WN_OK||!table_read(&t)||!hdr(a.game_state.address,&gs)||
    !cleanup_find_field(&t,gs.cls,"MatchState","NameProperty",8,0x30c,&f)||
    !meta_named(&t,f.declaring_class,"Class","/Script/Engine","GameState")||
    !rd(a.game_state.address+0x30c,ids,8)||!fname(ids[0],ids[1],state,capacity))return 0;
 for(size_t i=0;state[i];i++)if(!((state[i]>='a'&&state[i]<='z')||(state[i]>='A'&&state[i]<='Z')||(state[i]>='0'&&state[i]<='9')||state[i]=='_'))return 0;
 if(!rd(a.game_state.address+0x30c,again,8)||memcmp(ids,again,8)||ue_probe(NULL,&b)!=WN_OK||!ue_same_world(&a,&b))return 0;
 *world_token=((uint64_t)(uint32_t)a.world.serial<<32)|(uint32_t)a.world.index;return 1;
}

#include "identity_recovery.inc"
