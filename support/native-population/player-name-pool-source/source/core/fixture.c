#include "warmup_core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned checks;
#define CHECK(x) do { ++checks; if (!(x)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #x); exit(1); \
} } while (0)

static uint32_t gap(uint32_t a, uint32_t b) { return a > b ? a - b : b - a; }
static struct wu_snapshot snapshot(uint32_t h1, uint32_t h2, uint32_t hu,
                                    uint32_t b1, uint32_t b2) {
    struct wu_snapshot s = {0};
    s.sample_id = 1; s.world_generation = 17; s.baseline_ready = 1;
    s.h1 = h1; s.h2 = h2; s.h_unassigned = hu;
    s.confirmed_h_total = h1 + h2 + hu; s.owned_b1 = b1; s.owned_b2 = b2;
    return s;
}

static void check_plan(const struct wu_config *c, const struct wu_snapshot *s, const struct wu_plan *p) {
    uint32_t desired = c->target > s->confirmed_h_total ? c->target - s->confirmed_h_total : 0;
    CHECK(p->desired == desired);
    uint32_t available = c->capacity - c->reserved_slots;
    uint32_t h_and_inflight = s->confirmed_h_total + s->inflight_slots;
    available = available > h_and_inflight ? available - h_and_inflight : 0;
    uint32_t safe = desired < available ? desired : available;
    CHECK(p->admission_safe_owned_target == safe);
    CHECK(p->target_b1 + p->target_b2 == safe);
    CHECK(p->published_confirmed == s->confirmed_h_total + s->owned_b1 + s->owned_b2);
    CHECK(p->capacity_used == p->published_confirmed + s->unknown + s->inflight_slots);
    /* Independent closed-form lower bound: fill the lower human team first;
     * once the human gap is filled, only parity can prevent equality. */
    uint32_t human_gap = gap(s->h1, s->h2);
    uint32_t minimum = safe < human_gap ? human_gap - safe : (safe - human_gap) % 2;
    CHECK(gap(s->h1 + p->target_b1, s->h2 + p->target_b2) == minimum);
}

static void apply_owned_action(struct wu_snapshot *s, struct wu_action a) {
    uint32_t old_h = s->confirmed_h_total, old_h1 = s->h1, old_h2 = s->h2, old_hu = s->h_unassigned;
    CHECK(a.type != WU_NOOP);
    if (a.type == WU_ADD) {
        CHECK(a.from_team == 0 && (a.to_team == 1 || a.to_team == 2));
        if (a.to_team == 1) ++s->owned_b1; else ++s->owned_b2;
    } else if (a.type == WU_REMOVE) {
        CHECK(a.to_team == 0 && (a.from_team == 1 || a.from_team == 2));
        if (a.from_team == 1) { CHECK(s->owned_b1); --s->owned_b1; }
        else { CHECK(s->owned_b2); --s->owned_b2; }
    } else {
        CHECK(a.type == WU_MOVE && a.from_team + a.to_team == 3);
        if (a.from_team == 1) { CHECK(s->owned_b1); --s->owned_b1; ++s->owned_b2; }
        else { CHECK(s->owned_b2); --s->owned_b2; ++s->owned_b1; }
    }
    CHECK(s->confirmed_h_total == old_h && s->h1 == old_h1 && s->h2 == old_h2 && s->h_unassigned == old_hu);
    ++s->sample_id;
}

static void converge(const struct wu_config *c, struct wu_snapshot *s, const struct wu_snapshot *previous) {
    struct wu_plan p;
    unsigned operations = 0;
    for (;;) {
        CHECK(wu_make_plan(c, s, previous, &p) == WU_OK);
        check_plan(c, s, &p);
        CHECK(p.publication_ready);
        if (p.action.type == WU_NOOP) break;
        CHECK(++operations <= 180);
        apply_owned_action(s, p.action);
        CHECK(s->confirmed_h_total + s->owned_b1 + s->owned_b2 <= c->capacity);
    }
    CHECK(s->owned_b1 + s->owned_b2 == p.desired);
    CHECK(s->owned_b1 == p.target_b1 && s->owned_b2 == p.target_b2);
    struct wu_snapshot later = *s; ++later.sample_id;
    CHECK(wu_make_plan(c, &later, s, &p) == WU_OK && p.action.type == WU_NOOP);
}

static void population_fixture(void) {
    struct wu_config c = {80, 100, 1, 2};
    struct wu_snapshot s = snapshot(0, 0, 0, 0, 0);
    converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 40 && s.owned_b2 == 40);
    unsigned checkpoints = 1;
    /* Confirm every human event separately. This preserves actual capacity,
     * unlike teleporting 79 humans into an already full placeholder pool. */
    for (uint32_t h = 1; h <= 81; ++h) {
        struct wu_snapshot old = s;
        ++s.sample_id; s.h1 = h / 2; s.h2 = h - s.h1; s.confirmed_h_total = h;
        struct wu_plan before;
        CHECK(wu_make_plan(&c, &s, &old, &before) == WU_OK);
        CHECK(before.published_confirmed == h + old.owned_b1 + old.owned_b2);
        if (h <= 80) CHECK(before.action.type == WU_REMOVE);
        converge(&c, &s, &old);
        CHECK(s.owned_b1 + s.owned_b2 == (h < 80 ? 80 - h : 0));
        if (h == 1 || h == 79 || h == 80 || h == 81) ++checkpoints;
    }
    for (int h = 80; h >= 0; --h) {
        struct wu_snapshot old = s;
        ++s.sample_id; s.h1 = (uint32_t)h / 2; s.h2 = (uint32_t)h - s.h1; s.confirmed_h_total = (uint32_t)h;
        converge(&c, &s, &old);
        CHECK(s.owned_b1 + s.owned_b2 == (h < 80 ? 80u - (uint32_t)h : 0));
    }
    CHECK(checkpoints == 5);
    s = snapshot(0, 0, 10, 0, 0); converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 35 && s.owned_b2 == 35 && s.h_unassigned == 10);
    s = snapshot(70, 0, 0, 0, 0); converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 0 && s.owned_b2 == 10);
    s = snapshot(0, 79, 0, 0, 0); converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 1 && s.owned_b2 == 0);
    s = snapshot(5, 5, 0, 40, 30);
    struct wu_plan p;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK && p.action.type == WU_MOVE);
    converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 35 && s.owned_b2 == 35);
    c.target = 0;
    converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 0 && s.owned_b2 == 0 && s.confirmed_h_total == 10);

    /* Both teams have excess owned placeholders: prefer the arriving human's
     * team without ever choosing a human as the removal target. */
    c.target = 20;
    struct wu_snapshot old = snapshot(10, 0, 0, 20, 20);
    s = old; ++s.sample_id; ++s.h2; ++s.confirmed_h_total;
    CHECK(wu_make_plan(&c, &s, &old, &p) == WU_OK);
    CHECK(p.action.type == WU_REMOVE && p.action.from_team == 2);

    /* Existing odd balanced distribution is retained, avoiding parity moves. */
    c.target = 1; s = snapshot(0, 0, 0, 1, 0);
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK && p.action.type == WU_NOOP);
    CHECK(p.target_b1 == 1 && p.target_b2 == 0);
}

static void invalid_and_freeze_fixture(void) {
    struct wu_config good = {80, 100, 1, 2}, c = good;
    struct wu_snapshot s = snapshot(1, 0, 0, 0, 0);
    struct wu_plan p;
    CHECK(wu_config_validate(&good) == WU_OK);
    c.target = 81; CHECK(wu_config_validate(&c) == WU_OK);
    c.target = 99; CHECK(wu_config_validate(&c) == WU_OK);
    c.target = 100; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c.target = 99; c.reserved_slots = 2;
    CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.capacity = 101; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.capacity = 0; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.reserved_slots = 0; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.reserved_slots = 101; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.capacity = 80; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.capacity = 81; CHECK(wu_config_validate(&c) == WU_OK);
    c = good; c.settle_samples = 0; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    c = good; c.settle_samples = 1001; CHECK(wu_config_validate(&c) == WU_ERR_CONFIG);
    CHECK(wu_config_validate(NULL) == WU_ERR_ARGUMENT);
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_ERR_CONFIG && !p.publication_ready);
    s.confirmed_h_total = 2;
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_ERR_SNAPSHOT && !p.publication_ready);
    s = snapshot(0, 0, 0, 101, 0);
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_ERR_SNAPSHOT);
    s = snapshot(60, 40, 0, 1, 0);
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_ERR_SNAPSHOT);
    s = snapshot(1, 0, 0, 10, 10); s.baseline_ready = 0;
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_OK);
    CHECK(p.reason == WU_REASON_BASELINE && p.action.type == WU_NOOP && !p.publication_ready);
    s.baseline_ready = 1; s.unknown = 3;
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_OK);
    CHECK(p.reason == WU_REASON_UNKNOWN && p.action.type == WU_NOOP && !p.publication_ready);
    CHECK(p.published_confirmed == 21 && p.capacity_used == 24 && p.desired == 79);
    s.unknown = 0; s.inflight_slots = 4;
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_OK);
    CHECK(p.reason == WU_REASON_INFLIGHT && p.action.type == WU_NOOP && !p.publication_ready);
    CHECK(p.published_confirmed == 21 && p.capacity_used == 25 && p.desired == 79);
    s = snapshot(100, 0, 0, 0, 0);
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_OK && p.desired == 0 && p.published_confirmed == 100);
    s.world_generation = 0;
    CHECK(wu_make_plan(&good, &s, NULL, &p) == WU_ERR_SNAPSHOT);
}

static void max99_population_fixture(void) {
    struct wu_config c = {99, 100, 1, 2};
    struct wu_snapshot s = snapshot(0, 0, 0, 0, 0);
    struct wu_plan p;
    converge(&c, &s, NULL);
    CHECK(s.owned_b1 + s.owned_b2 == 99 && gap(s.owned_b1, s.owned_b2) == 1);

    /* The one reserved position admits a confirmed human at actual 100;
     * remove an owned member of that human's team, without moving the human. */
    struct wu_snapshot old = s;
    ++s.sample_id; s.h2 = s.confirmed_h_total = 1;
    CHECK(wu_make_plan(&c, &s, &old, &p) == WU_OK);
    CHECK(p.published_confirmed == 100 && p.desired == 98);
    CHECK(p.action.type == WU_REMOVE && p.action.from_team == 2);
    converge(&c, &s, &old);
    CHECK(s.owned_b1 + s.owned_b2 == 98 && s.h2 == 1 && s.confirmed_h_total == 1);

    old = s; ++s.sample_id; s.h2 = s.confirmed_h_total = 0;
    converge(&c, &s, &old);
    CHECK(s.owned_b1 + s.owned_b2 == 99);
    c.target = 0; converge(&c, &s, NULL);
    CHECK(!s.owned_b1 && !s.owned_b2 && !s.confirmed_h_total);

    c.target = 99; s = snapshot(0, 0, 0, 49, 50); s.inflight_slots = 1;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK);
    check_plan(&c, &s, &p);
    CHECK(p.desired == 99 && p.admission_safe_owned_target == 98 && p.capacity_used == 100);
    CHECK(p.action.type == WU_REMOVE && !p.publication_ready);
    s = snapshot(0, 0, 0, 50, 50);
    /* Observed actual occupancy remains distinct from the allowed target:
     * preserve the planner's existing excess-occupancy removal behavior. */
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK);
    CHECK(p.published_confirmed == 100 && p.desired == 99 && p.action.type == WU_REMOVE);
}

static void controller_fixture(void) {
    struct wu_config c = {80, 100, 1, 3};
    struct wu_snapshot s = snapshot(39, 40, 0, 0, 0);
    struct wu_controller state; wu_controller_reset(&state);
    struct wu_plan p;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_SETTLING);
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_STALE_SAMPLE);
    CHECK(state.stable_samples == 1 && !p.publication_ready);
    ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_NOOP);
    ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_ADD);
    CHECK(p.action.to_team == 1 && state.awaiting_resolution);
    struct wu_action issued = p.action;
    ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_PENDING);
    CHECK(p.action.type == WU_NOOP); /* no guessed retry when inflight=0 */
    apply_owned_action(&s, issued); wu_controller_resolve(&state);
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_NOOP);
    CHECK(p.published_confirmed == 80);
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_STALE_SAMPLE);

    /* Alternating confirmed human states never pass a three-sample window. */
    wu_controller_reset(&state); s = snapshot(0, 0, 0, 0, 0);
    for (uint32_t i = 1; i <= 20; ++i) {
        s.sample_id = i; s.h1 = i % 2; s.confirmed_h_total = s.h1;
        CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_NOOP);
        CHECK(!state.awaiting_resolution);
    }
    c.settle_samples = 1; ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_ADD);
    ++s.world_generation; s.sample_id = 1;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_ADD);
    CHECK(state.emitted_sample_id == 1); /* old World latch invalidated in memory */
    wu_controller_resolve(&state);
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_STALE_SAMPLE);

    /* Arrival preference survives the debounce window. */
    c = (struct wu_config){20, 100, 1, 2};
    wu_controller_reset(&state); s = snapshot(10, 0, 0, 20, 20);
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK);
    ++s.sample_id; ++s.h2; ++s.confirmed_h_total;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_NOOP);
    ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_REMOVE && p.action.from_team == 2);
}

static void inflight_headroom_fixture(void) {
    struct wu_config c = {80, 100, 1, 3};
    struct wu_snapshot s = snapshot(0, 0, 0, 40, 40);
    s.inflight_slots = 25; /* already reserved party pressure exceeds capacity */
    struct wu_plan p;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK);
    check_plan(&c, &s, &p);
    CHECK(p.desired == 80 && p.admission_safe_owned_target == 74);
    CHECK(p.capacity_used == 105 && p.published_confirmed == 80);
    CHECK(p.action.type == WU_REMOVE && p.reason == WU_REASON_INFLIGHT_HEADROOM && !p.publication_ready);
    struct wu_controller state; wu_controller_reset(&state);
    unsigned removed = 0;
    for (;;) {
        CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK);
        check_plan(&c, &s, &p);
        CHECK(!p.publication_ready && p.desired == 80);
        if (p.action.type == WU_NOOP) { CHECK(p.reason == WU_REASON_INFLIGHT); break; }
        CHECK(p.action.type == WU_REMOVE && p.reason == WU_REASON_INFLIGHT_HEADROOM);
        struct wu_action action = p.action;
        ++s.sample_id;
        CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_PENDING);
        CHECK(p.action.type == WU_NOOP); /* pressure never bypasses the latch */
        apply_owned_action(&s, action);
        wu_controller_resolve(&state);
        ++removed; CHECK(removed <= 6);
    }
    CHECK(removed == 6 && s.owned_b1 == 37 && s.owned_b2 == 37);
    CHECK(p.capacity_used == 99 && p.published_confirmed == 74);
    /* Reservation release must use stable confirmed samples before adding. */
    s.inflight_slots = 0; ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.reason == WU_REASON_SETTLING);
    ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_NOOP);
    ++s.sample_id;
    CHECK(wu_controller_next(&state, &c, &s, &p) == WU_OK && p.action.type == WU_ADD);
    converge(&c, &s, NULL);
    CHECK(s.owned_b1 == 40 && s.owned_b2 == 40);

    s = snapshot(0, 0, 0, 40, 40); s.inflight_slots = 25; s.unknown = 1;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK && p.reason == WU_REASON_UNKNOWN);
    CHECK(p.action.type == WU_NOOP && !p.publication_ready && p.capacity_used == 106);
    /* Once no owned objects remain, core cannot make an oversized lease safe.
     * It never changes H or calls this an admission approval. */
    s = snapshot(90, 0, 0, 0, 0); s.inflight_slots = 20;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK);
    CHECK(p.desired == 0 && p.admission_safe_owned_target == 0 && p.capacity_used == 110);
    CHECK(p.action.type == WU_NOOP && p.reason == WU_REASON_INFLIGHT && !p.publication_ready);
    /* Pending joiners cannot trigger ADD or MOVE even below the safe target. */
    s = snapshot(0, 0, 0, 0, 0); s.inflight_slots = 1;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK && p.action.type == WU_NOOP);
    s = snapshot(0, 0, 0, 50, 30); s.inflight_slots = 1;
    CHECK(wu_make_plan(&c, &s, NULL, &p) == WU_OK && p.action.type == WU_NOOP);
}

static uint64_t constant_entropy(void *context) { ++*(unsigned *)context; return 0; }

static void unicode_fixture(void) {
    struct wu_name name, saved;
    CHECK(wu_name_from_utf8("晚风Fox", strlen("晚风Fox"), &name) == WU_OK);
    CHECK(name.unit_count == 6 && name.units[0] == 0x665a && name.units[1] == 0x98ce);
    CHECK(!strcmp(name.utf8, "晚风Fox"));
    const char paw[] = "\xf0\x9f\x90\xbe";
    CHECK(wu_name_from_utf8(paw, 4, &name) == WU_OK);
    CHECK(name.unit_count == 3 && name.units[0] == 0xd83d && name.units[1] == 0xdc3e);
    const char *bad[] = {"\xc0\x80", "\xed\xa0\x80", "\xf4\x90\x80\x80", "\xe4\xb8", "\x80", "A\nB", "A\tB", "\xe2\x80\xa8", "   "};
    saved = name;
    for (size_t i = 0; i < sizeof bad / sizeof bad[0]; ++i) {
        CHECK(wu_name_from_utf8(bad[i], strlen(bad[i]), &name) == WU_ERR_UTF8);
        CHECK(!memcmp(&saved, &name, sizeof name));
    }
    const char nul[] = {'A', 0, 'B'};
    CHECK(wu_name_from_utf8(nul, sizeof nul, &name) == WU_ERR_UTF8);
    char maximum[66];
    for (size_t i = 0; i < 16; ++i) memcpy(maximum + i * 4, paw, 4);
    maximum[64] = 0;
    CHECK(wu_name_from_utf8(maximum, 64, &name) == WU_OK && name.unit_count == 33);
    maximum[64] = 'A'; maximum[65] = 0;
    CHECK(wu_name_from_utf8(maximum, 65, &saved) == WU_ERR_NAME_TOO_LONG);
    char ascii[34]; memset(ascii, 'a', 33); ascii[33] = 0;
    CHECK(wu_name_from_utf8(ascii, 32, &saved) == WU_OK && saved.unit_count == 33);
    CHECK(wu_name_from_utf8(ascii, 33, &saved) == WU_ERR_NAME_TOO_LONG);
    uint16_t message[WU_MESSAGE_MAX_UNITS], short_buffer[WU_MESSAGE_MAX_UNITS];
    for (size_t i = 0; i < WU_MESSAGE_MAX_UNITS; ++i) message[i] = short_buffer[i] = 0xbeef;
    size_t units = 0;
    CHECK(wu_message_build(&name, 0, NULL, 0, &units) == WU_ERR_BUFFER && units == 51);
    CHECK(wu_message_build(&name, 0, short_buffer, 50, &units) == WU_ERR_BUFFER);
    for (size_t i = 0; i < WU_MESSAGE_MAX_UNITS; ++i) CHECK(short_buffer[i] == 0xbeef);
    saved = name;
    CHECK(wu_message_build(&name, 0, message, WU_MESSAGE_MAX_UNITS, &units) == WU_OK);
    CHECK(units == 51 && message[50] == 0 && message[31] == 0xdc3e && message[32] == ' ');
    CHECK(!memcmp(&saved, &name, sizeof name));
    CHECK(wu_message_build(&name, 1, message, WU_MESSAGE_MAX_UNITS, &units) == WU_OK && units == 48);
    CHECK(wu_message_build(&name, 2, message, WU_MESSAGE_MAX_UNITS, &units) == WU_ERR_ARGUMENT);
    name.units[31] = 0xd800;
    CHECK(wu_message_build(&name, 1, message, WU_MESSAGE_MAX_UNITS, &units) == WU_ERR_ARGUMENT);
}

static void names_fixture(void) {
    struct wu_rng rng, repeat;
    struct wu_name names[WU_MAX_TARGET + 1u], first, second;
    const struct wu_name *existing[WU_MAX_CAPACITY];
    wu_rng_seed(&rng, 42); wu_rng_seed(&repeat, 42);
    CHECK(wu_name_generate(WU_STYLE_ANY, &rng, NULL, 0, &first) == WU_OK);
    CHECK(wu_name_generate(WU_STYLE_ANY, &repeat, NULL, 0, &second) == WU_OK);
    CHECK(wu_name_equal(&first, &second));
    wu_rng_seed(&rng, 919);
    uint32_t styles = 0;
    for (size_t i = 0; i < WU_MAX_TARGET; ++i) {
        CHECK(wu_name_generate(WU_STYLE_ANY, &rng, existing, i, &names[i]) == WU_OK);
        styles |= names[i].style;
        for (size_t j = 0; j < i; ++j) CHECK(!wu_name_equal(&names[i], &names[j]));
        existing[i] = &names[i];
    }
    CHECK(styles == WU_STYLE_ANY);
    CHECK(wu_name_generate(WU_STYLE_ANY, &rng, existing, WU_MAX_TARGET, &second) == WU_OK);
    for (size_t i = 0; i < WU_MAX_TARGET; ++i) CHECK(!wu_name_equal(&second, &names[i]));
    /* Even repeated caller entropy cannot create duplicate names or hang. */
    unsigned entropy_calls = 0;
    wu_rng_seed(&rng, 1); rng.entropy = constant_entropy; rng.context = &entropy_calls;
    for (size_t i = 0; i < WU_MAX_TARGET; ++i) {
        CHECK(wu_name_generate(WU_STYLE_CHINESE, &rng, existing, i, &names[i]) == WU_OK);
        CHECK(names[i].style == WU_STYLE_CHINESE);
        existing[i] = &names[i];
        for (size_t j = 0; j < i; ++j) CHECK(!wu_name_equal(&names[i], &names[j]));
    }
    CHECK(entropy_calls == WU_MAX_TARGET);
    CHECK(wu_name_generate(WU_STYLE_ENGLISH, &rng, NULL, 0, &first) == WU_OK && first.style == WU_STYLE_ENGLISH);
    CHECK(wu_name_generate(WU_STYLE_MIXED, &rng, NULL, 0, &first) == WU_OK && first.style == WU_STYLE_MIXED);
    CHECK(wu_name_generate(8, &rng, NULL, 0, &first) == WU_ERR_ARGUMENT);
    const char *pool[] = {"Moss", "Moss", "晚风", "bad\n"};
    CHECK(wu_name_from_utf8("Moss", 4, &first) == WU_OK);
    const struct wu_name *assigned[] = {&first, &second};
    CHECK(wu_name_select(pool, 4, &rng, assigned, 1, &second) == WU_OK);
    CHECK(!strcmp(second.utf8, "晚风"));
    struct wu_name before = names[0];
    CHECK(wu_name_select(pool, 4, &rng, assigned, 2, &names[0]) == WU_ERR_NAME_EXHAUSTED);
    CHECK(!memcmp(&before, &names[0], sizeof before));
    CHECK(wu_name_select(pool, 0, &rng, NULL, 0, &names[0]) == WU_ERR_ARGUMENT);
    CHECK(wu_name_generate(WU_STYLE_ANY, &rng, NULL, 1, &names[0]) == WU_ERR_ARGUMENT);
    CHECK(wu_name_generate(WU_STYLE_ANY, &rng, existing, 101, &names[0]) == WU_ERR_ARGUMENT);
}

int main(void) {
    population_fixture(); invalid_and_freeze_fixture(); max99_population_fixture(); controller_fixture(); inflight_headroom_fixture();
    unicode_fixture(); names_fixture();
    printf("PASS warmup_core: %u checks; planner/controller/Unicode/names; local pure fixture only\n", checks);
    return 0;
}
