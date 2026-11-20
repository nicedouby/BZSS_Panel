#ifndef WARMUP_REFRESH_CADENCE_H
#define WARMUP_REFRESH_CADENCE_H

/* Startup only: call once, after the existing full executable/code verifier
 * succeeds, before worker creation or engine execution. verified_elf_sha must
 * identify that verification, not merely a configured filename.
 *
 * WARMUP_REFRESH_CADENCE unset or "30" leaves memory unchanged; "2" redirects
 * the producer's private load and changes only the manager send duration.
 * Every non-NULL return is terminal: the caller MUST exit, including when
 * instruction writes have already occurred. There is no runtime rollback,
 * retry, active producer call, or promise of a two-second browser update. */
#if defined(__GNUC__)
#define WRC_HIDDEN __attribute__((visibility("hidden")))
#else
#define WRC_HIDDEN
#endif
WRC_HIDDEN const char *warmup_refresh_cadence_install(const char *verified_elf_sha);
/* 0 before successful installation; otherwise requested seconds, 2 or 30. */
WRC_HIDDEN int warmup_refresh_cadence_seconds(void);

#endif
