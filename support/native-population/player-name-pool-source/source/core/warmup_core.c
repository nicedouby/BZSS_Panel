#include "warmup_core.h"

#include <limits.h>
#include <string.h>

static uint32_t difference(uint32_t a, uint32_t b) { return a > b ? a - b : b - a; }

int wu_config_validate(const struct wu_config *c) {
    if (!c) return WU_ERR_ARGUMENT;
    if (c->target > WU_MAX_TARGET || !c->capacity || c->capacity > WU_MAX_CAPACITY ||
        !c->reserved_slots || c->reserved_slots > c->capacity ||
        c->target > c->capacity - c->reserved_slots ||
        !c->settle_samples || c->settle_samples > 1000u) return WU_ERR_CONFIG;
    return WU_OK;
}

static int snapshot_valid(const struct wu_snapshot *s, uint32_t capacity) {
    if (!s || s->confirmed_h_total > WU_MAX_CAPACITY || s->h1 > WU_MAX_CAPACITY ||
        s->h2 > WU_MAX_CAPACITY || s->h_unassigned > WU_MAX_CAPACITY ||
        s->owned_b1 > WU_MAX_CAPACITY || s->owned_b2 > WU_MAX_CAPACITY ||
        s->unknown > WU_MAX_CAPACITY || s->inflight_slots > WU_MAX_CAPACITY ||
        s->h1 + s->h2 + s->h_unassigned != s->confirmed_h_total ||
        s->confirmed_h_total + s->owned_b1 + s->owned_b2 + s->unknown > capacity ||
        (s->baseline_ready != 0 && s->baseline_ready != 1) ||
        (s->baseline_ready && (!s->sample_id || !s->world_generation))) return 0;
    return 1;
}

static uint32_t arrival_team(const struct wu_snapshot *s, const struct wu_snapshot *p) {
    if (!p || p->world_generation != s->world_generation || p->sample_id >= s->sample_id ||
        !snapshot_valid(p, WU_MAX_CAPACITY) || s->confirmed_h_total <= p->confirmed_h_total) return 0;
    uint32_t d1 = s->h1 > p->h1 ? s->h1 - p->h1 : 0;
    uint32_t d2 = s->h2 > p->h2 ? s->h2 - p->h2 : 0;
    return d1 > d2 ? 1u : d2 > d1 ? 2u : 0u;
}

int wu_make_plan(const struct wu_config *c, const struct wu_snapshot *s,
                 const struct wu_snapshot *previous, struct wu_plan *out) {
    if (!out) return WU_ERR_ARGUMENT;
    memset(out, 0, sizeof *out);
    if (wu_config_validate(c) != WU_OK) {
        out->reason = WU_REASON_INVALID_CONFIG;
        return c ? WU_ERR_CONFIG : WU_ERR_ARGUMENT;
    }
    if (!snapshot_valid(s, c->capacity)) {
        out->reason = WU_REASON_INVALID_SNAPSHOT;
        return s ? WU_ERR_SNAPSHOT : WU_ERR_ARGUMENT;
    }
    uint32_t owned = s->owned_b1 + s->owned_b2;
    out->published_confirmed = s->confirmed_h_total + owned;
    out->capacity_used = out->published_confirmed + s->unknown + s->inflight_slots;
    out->desired = c->target > s->confirmed_h_total ? c->target - s->confirmed_h_total : 0;
    uint32_t usable = c->capacity - c->reserved_slots;
    uint32_t occupied_by_humans_and_joiners = s->confirmed_h_total + s->inflight_slots;
    uint32_t headroom = usable > occupied_by_humans_and_joiners ? usable - occupied_by_humans_and_joiners : 0;
    out->admission_safe_owned_target = out->desired < headroom ? out->desired : headroom;
    uint32_t preferred = arrival_team(s, previous);
    uint32_t best_difference = UINT_MAX, best_churn = UINT_MAX, best_preference = UINT_MAX;
    for (uint32_t b1 = 0; b1 <= out->admission_safe_owned_target; ++b1) {
        uint32_t b2 = out->admission_safe_owned_target - b1;
        uint32_t gap = difference(s->h1 + b1, s->h2 + b2);
        uint32_t churn = difference(s->owned_b1, b1) + difference(s->owned_b2, b2);
        /* Only choose same-team removal among equally balanced, equally small
         * changes. Retaining an already optimal allocation prevents parity churn. */
        uint32_t preference = preferred == 1 ? b1 : preferred == 2 ? b2 : 0;
        if (gap < best_difference ||
            (gap == best_difference && churn < best_churn) ||
            (gap == best_difference && churn == best_churn && preference < best_preference)) {
            best_difference = gap;
            best_churn = churn;
            best_preference = preference;
            out->target_b1 = b1;
            out->target_b2 = b2;
        }
    }
    if (!s->baseline_ready) { out->reason = WU_REASON_BASELINE; return WU_OK; }
    /* Fail closed: unknown objects may be real players or foreign ownership.
     * They occupy capacity but never change H, and cannot authorize mutations. */
    if (s->unknown) { out->reason = WU_REASON_UNKNOWN; return WU_OK; }
    out->publication_ready = s->inflight_slots == 0;
    if (owned > out->admission_safe_owned_target) {
        int excess1 = s->owned_b1 > out->target_b1;
        int excess2 = s->owned_b2 > out->target_b2;
        uint32_t team;
        if (preferred == 1 && excess1) team = 1;
        else if (preferred == 2 && excess2) team = 2;
        else if (excess1 && excess2) {
            uint32_t after1 = difference(s->h1 + s->owned_b1 - 1, s->h2 + s->owned_b2);
            uint32_t after2 = difference(s->h1 + s->owned_b1, s->h2 + s->owned_b2 - 1);
            team = after1 <= after2 ? 1u : 2u;
        } else team = excess1 ? 1u : 2u;
        out->action = (struct wu_action){ WU_REMOVE, team, 0 };
        if (s->inflight_slots) { out->reason = WU_REASON_INFLIGHT_HEADROOM; return WU_OK; }
    } else if (s->inflight_slots) {
        out->reason = WU_REASON_INFLIGHT;
        return WU_OK;
    } else if (owned < out->admission_safe_owned_target) {
        if (out->capacity_used >= c->capacity - c->reserved_slots) {
            out->reason = WU_REASON_CAPACITY;
            return WU_OK;
        }
        int need1 = s->owned_b1 < out->target_b1;
        int need2 = s->owned_b2 < out->target_b2;
        uint32_t team;
        if (need1 && need2) {
            uint32_t after1 = difference(s->h1 + s->owned_b1 + 1, s->h2 + s->owned_b2);
            uint32_t after2 = difference(s->h1 + s->owned_b1, s->h2 + s->owned_b2 + 1);
            team = after1 <= after2 ? 1u : 2u;
        } else team = need1 ? 1u : 2u;
        out->action = (struct wu_action){ WU_ADD, 0, team };
    } else if (s->owned_b1 != out->target_b1) {
        uint32_t from = s->owned_b1 > out->target_b1 ? 1u : 2u;
        out->action = (struct wu_action){ WU_MOVE, from, 3u - from };
    }
    out->reason = out->action.type == WU_NOOP ? WU_REASON_STABLE : WU_REASON_ACTION;
    return WU_OK;
}

static int config_same(const struct wu_config *a, const struct wu_config *b) {
    return a->target == b->target && a->capacity == b->capacity &&
        a->reserved_slots == b->reserved_slots && a->settle_samples == b->settle_samples;
}

static int snapshot_same(const struct wu_snapshot *a, const struct wu_snapshot *b) {
    return a->world_generation == b->world_generation &&
        a->confirmed_h_total == b->confirmed_h_total && a->h1 == b->h1 && a->h2 == b->h2 &&
        a->h_unassigned == b->h_unassigned && a->owned_b1 == b->owned_b1 &&
        a->owned_b2 == b->owned_b2 && a->unknown == b->unknown &&
        a->inflight_slots == b->inflight_slots && a->baseline_ready == b->baseline_ready;
}

void wu_controller_reset(struct wu_controller *c) { if (c) memset(c, 0, sizeof *c); }

int wu_controller_next(struct wu_controller *controller, const struct wu_config *config,
                       const struct wu_snapshot *s, struct wu_plan *out) {
    if (!controller || !out) return WU_ERR_ARGUMENT;
    int r = wu_make_plan(config, s, NULL, out);
    if (r != WU_OK) { controller->stable_samples = 0; return r; }
    if (controller->initialized && controller->last.world_generation != s->world_generation)
        wu_controller_reset(controller);
    if (controller->initialized && s->sample_id <= controller->last.sample_id) {
        out->action = (struct wu_action){ WU_NOOP, 0, 0 };
        out->publication_ready = 0;
        out->reason = WU_REASON_STALE_SAMPLE;
        return WU_OK;
    }
    int same = controller->initialized && config_same(&controller->config, config) &&
        snapshot_same(&controller->last, s) && controller->stable_samples;
    if (!same) {
        /* Preserve the pre-change human distribution through the debounce
         * window, rather than losing an arrival hint after its first sample. */
        controller->stable = controller->initialized ? controller->last : *s;
        controller->stable_samples = 1;
    } else if (controller->stable_samples < 1000u) ++controller->stable_samples;
    r = wu_make_plan(config, s, &controller->stable, out);
    controller->last = *s;
    controller->config = *config;
    controller->initialized = 1;
    if (controller->awaiting_resolution) {
        controller->stable_samples = 0;
        out->action = (struct wu_action){ WU_NOOP, 0, 0 };
        out->reason = WU_REASON_PENDING;
    } else if (!out->publication_ready && out->action.type == WU_NOOP) {
        controller->stable_samples = 0;
    } else if (out->action.type != WU_NOOP) {
        if (controller->stable_samples < config->settle_samples &&
            out->reason != WU_REASON_INFLIGHT_HEADROOM) {
            out->action = (struct wu_action){ WU_NOOP, 0, 0 };
            out->reason = WU_REASON_SETTLING;
        } else {
            controller->awaiting_resolution = 1;
            controller->emitted_sample_id = s->sample_id;
        }
    }
    return r;
}

void wu_controller_resolve(struct wu_controller *c) {
    if (c) { c->awaiting_resolution = 0; c->stable_samples = 0; }
}

void wu_rng_seed(struct wu_rng *r, uint64_t seed) {
    if (r) { r->state = seed ? seed : UINT64_C(0x9e3779b97f4a7c15); r->entropy = NULL; r->context = NULL; }
}

static uint64_t random_value(struct wu_rng *r) {
    if (r->entropy) return r->entropy(r->context);
    uint64_t x = r->state ? r->state : UINT64_C(0x9e3779b97f4a7c15);
    x ^= x >> 12; x ^= x << 25; x ^= x >> 27; r->state = x;
    return x * UINT64_C(2685821657736338717);
}

static int forbidden_scalar(uint32_t cp) {
    return cp < 0x20u || (cp >= 0x7fu && cp <= 0x9fu) ||
        (cp >= 0x200bu && cp <= 0x200fu) || (cp >= 0x2028u && cp <= 0x202eu) ||
        (cp >= 0x2060u && cp <= 0x206fu) || cp == 0xfeffu;
}

int wu_name_from_utf8(const char *utf8, size_t bytes, struct wu_name *out) {
    if (!utf8 || !out || !bytes) return WU_ERR_ARGUMENT;
    if (bytes > WU_NAME_MAX_UTF8_BYTES) return WU_ERR_NAME_TOO_LONG;
    struct wu_name name;
    memset(&name, 0, sizeof name);
    size_t i = 0, used = 0;
    int visible = 0;
    while (i < bytes) {
        unsigned char first = (unsigned char)utf8[i++];
        uint32_t cp, minimum;
        size_t following;
        if (first < 0x80u) { cp = first; following = 0; minimum = 0; }
        else if (first >= 0xc2u && first <= 0xdfu) { cp = first & 0x1fu; following = 1; minimum = 0x80u; }
        else if (first >= 0xe0u && first <= 0xefu) { cp = first & 0x0fu; following = 2; minimum = 0x800u; }
        else if (first >= 0xf0u && first <= 0xf4u) { cp = first & 7u; following = 3; minimum = 0x10000u; }
        else return WU_ERR_UTF8;
        if (following > bytes - i) return WU_ERR_UTF8;
        for (size_t j = 0; j < following; ++j) {
            unsigned char b = (unsigned char)utf8[i++];
            if ((b & 0xc0u) != 0x80u) return WU_ERR_UTF8;
            cp = (cp << 6) | (b & 0x3fu);
        }
        if (cp < minimum || cp > 0x10ffffu || (cp >= 0xd800u && cp <= 0xdfffu) ||
            forbidden_scalar(cp)) return WU_ERR_UTF8;
        size_t needed = cp >= 0x10000u ? 2u : 1u;
        if (needed > WU_NAME_MAX_UNITS - used) return WU_ERR_NAME_TOO_LONG;
        if (needed == 2) {
            cp -= 0x10000u;
            name.units[used++] = (uint16_t)(0xd800u + (cp >> 10));
            name.units[used++] = (uint16_t)(0xdc00u + (cp & 0x3ffu));
        } else name.units[used++] = (uint16_t)cp;
        if (cp != 0x20u && cp != 0x3000u) visible = 1;
    }
    if (!visible) return WU_ERR_UTF8;
    name.unit_count = (uint32_t)used + 1;
    memcpy(name.utf8, utf8, bytes);
    name.utf8[bytes] = 0;
    *out = name;
    return WU_OK;
}

static int name_valid(const struct wu_name *n) {
    if (!n || n->unit_count < 2 || n->unit_count > WU_NAME_STORAGE_UNITS ||
        n->units[n->unit_count - 1] != 0) return 0;
    for (uint32_t i = 0; i + 1 < n->unit_count; ++i) {
        uint32_t cp = n->units[i];
        if (cp >= 0xd800u && cp <= 0xdbffu) {
            if (i + 2 >= n->unit_count || n->units[i + 1] < 0xdc00u || n->units[i + 1] > 0xdfffu) return 0;
            cp = 0x10000u + ((cp - 0xd800u) << 10) + (n->units[++i] - 0xdc00u);
        } else if (cp >= 0xdc00u && cp <= 0xdfffu) return 0;
        if (forbidden_scalar(cp)) return 0;
    }
    return 1;
}

int wu_name_equal(const struct wu_name *a, const struct wu_name *b) {
    return name_valid(a) && name_valid(b) && a->unit_count == b->unit_count &&
        !memcmp(a->units, b->units, (size_t)a->unit_count * sizeof(uint16_t));
}

static int existing_valid(const struct wu_name *const *existing, size_t count) {
    if (count > WU_MAX_CAPACITY || (count && !existing)) return 0;
    for (size_t i = 0; i < count; ++i) if (!name_valid(existing[i])) return 0;
    return 1;
}

static int available(const struct wu_name *name, const struct wu_name *const *existing, size_t count) {
    for (size_t i = 0; i < count; ++i) if (wu_name_equal(name, existing[i])) return 0;
    return 1;
}

static size_t bounded_bytes(const char *s) {
    if (!s) return 0;
    size_t n = 0;
    while (n <= WU_NAME_MAX_UTF8_BYTES && s[n]) ++n;
    return n;
}

int wu_name_select(const char *const *pool, size_t count, struct wu_rng *rng,
                   const struct wu_name *const *existing, size_t existing_count, struct wu_name *out) {
    if (!pool || !count || count > WU_NAME_MAX_POOL || !rng || !out ||
        !existing_valid(existing, existing_count)) return WU_ERR_ARGUMENT;
    size_t start = (size_t)(random_value(rng) % count);
    for (size_t i = 0; i < count; ++i) {
        const char *text = pool[(start + i) % count];
        struct wu_name name;
        if (text && wu_name_from_utf8(text, bounded_bytes(text), &name) == WU_OK &&
            available(&name, existing, existing_count)) { *out = name; return WU_OK; }
    }
    return WU_ERR_NAME_EXHAUSTED;
}

static const char *const zh_first[16] = {
    "晚风", "山野", "青岚", "星河", "北岸", "南山", "雨巷", "云间",
    "松林", "远山", "清溪", "秋原", "月下", "海边", "晨雾", "长街"
};
static const char *const zh_last[16] = {
    "旅人", "来客", "听雨", "行舟", "拾光", "小鹿", "书生", "微光",
    "青鸟", "归舟", "漫游", "看海", "留白", "追风", "踏歌", "远行"
};
static const char *const en_first[16] = {
    "North", "Quiet", "Silver", "Amber", "Blue", "Misty", "Winter", "River",
    "Cedar", "Autumn", "Night", "Cloud", "Sunny", "Wild", "Echo", "Little"
};
static const char *const en_last[16] = {
    "Moss", "Fox", "Finch", "Reed", "Wren", "Otter", "Pine", "Stone",
    "Brook", "Robin", "Oak", "Vale", "Leaf", "Raven", "Wolf", "Drift"
};

static const char *const player_name_pool[WU_NAME_POOL_SIZE] = {
    "藤椒鱼", "行云起", "广志", "左巴羊", "苏苏", "和苏苏", "阿良", "陈皮",
    "李田所", "三九", "小何", "阿炳", "陈默", "十三", "一只小羊", "白开水",
    "木木", "大左", "余温", "小雨转阴", "林夕", "顾言", "无名氏", "小胡",
    "王木木", "老杜", "何大炮", "阿旺", "大葱", "猪猪", "鱼丸", "番茄",
    "大黄", "王二狗", "小夫", "范德彪", "李云龙", "张大彪", "田所浩二", "山本我日你先人",
    "马保国", "窃格瓦拉", "牢大", "雷军", "蟹老板", "旺仔小乔", "广志official", "牛爷爷",
    "东雪莲", "桜が咲いた", "椎名真昼", "雪ノ下雪乃", "Soraです", "綾小路", "猫又", "Yukino",
    "miku39", "Haku", "m0nesy", "NiKo", "Faker", "Kobe", "Walter White", "Peter",
    "Kevin", "doge", "no name", "OKOK", "qwqqq", "zzzz", "wzh", "woshixiaoyu",
    "qwerty123", "12345", "666666", "L1n", "M4A1", "Aimer", "banana", "N0thing"
};

static uint32_t player_name_style(const char *text) {
    int ascii = 0, non_ascii = 0;
    for (const unsigned char *p = (const unsigned char *)text; *p; ++p) {
        if (*p >= 0x80u) non_ascii = 1;
        else if ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') ||
                 (*p >= '0' && *p <= '9')) ascii = 1;
    }
    return ascii ? (non_ascii ? WU_STYLE_MIXED : WU_STYLE_ENGLISH) : WU_STYLE_CHINESE;
}

int wu_name_generate(uint32_t styles, struct wu_rng *rng,
                     const struct wu_name *const *existing, size_t existing_count, struct wu_name *out) {
    if (!styles || (styles & ~((uint32_t)WU_STYLE_ANY)) || !rng || !out ||
        !existing_valid(existing, existing_count)) return WU_ERR_ARGUMENT;
    if (styles == WU_STYLE_ANY) {
        static const uint32_t generated_styles[] = {
            WU_STYLE_CHINESE, WU_STYLE_ENGLISH, WU_STYLE_MIXED
        };
        uint32_t first = (uint32_t)(random_value(rng) % 3u);
        int prefer_generated = (random_value(rng) % 4u) != 0u;
        if (prefer_generated) {
            for (uint32_t i = 0; i < 3u; ++i) {
                uint32_t style = generated_styles[(first + i) % 3u];
                if (wu_name_generate(style, rng, existing, existing_count, out) == WU_OK) return WU_OK;
            }
        }
        int result = wu_name_select(player_name_pool, WU_NAME_POOL_SIZE, rng,
                                    existing, existing_count, out);
        if (result == WU_OK) {
            out->style = player_name_style(out->utf8);
            return WU_OK;
        }
        /* Keep generating when the curated names are already active. There are
         * 768 bounded combinations, and `existing` prevents active duplicates. */
        for (uint32_t i = 0; i < 3u; ++i) {
            uint32_t style = generated_styles[(first + i) % 3u];
            result = wu_name_generate(style, rng, existing, existing_count, out);
            if (result == WU_OK) return WU_OK;
        }
        return WU_ERR_NAME_EXHAUSTED;
    }
    uint32_t groups[3], group_count = 0;
    if (styles & WU_STYLE_CHINESE) groups[group_count++] = WU_STYLE_CHINESE;
    if (styles & WU_STYLE_ENGLISH) groups[group_count++] = WU_STYLE_ENGLISH;
    if (styles & WU_STYLE_MIXED) groups[group_count++] = WU_STYLE_MIXED;
    uint32_t count = group_count * 256u;
    uint32_t start = (uint32_t)(random_value(rng) % count);
    for (uint32_t i = 0; i < count; ++i) {
        uint32_t index = (start + i) % count;
        uint32_t style = groups[index / 256u];
        uint32_t first = (index % 256u) / 16u, last = index % 16u;
        const char *a = style == WU_STYLE_ENGLISH ? en_first[first] : zh_first[first];
        const char *b = style == WU_STYLE_CHINESE ? zh_last[last] : en_last[last];
        char text[WU_NAME_MAX_UTF8_BYTES + 1u];
        size_t a_bytes = strlen(a), b_bytes = strlen(b);
        if (a_bytes + b_bytes > WU_NAME_MAX_UTF8_BYTES) continue;
        memcpy(text, a, a_bytes); memcpy(text + a_bytes, b, b_bytes + 1);
        struct wu_name name;
        if (wu_name_from_utf8(text, a_bytes + b_bytes, &name) != WU_OK) continue;
        name.style = style;
        if (available(&name, existing, existing_count)) { *out = name; return WU_OK; }
    }
    return WU_ERR_NAME_EXHAUSTED;
}

int wu_message_build(const struct wu_name *name, int joining, uint16_t *out,
                     size_t capacity, size_t *unit_count) {
    if (!name_valid(name) || !unit_count || (joining != 0 && joining != 1)) return WU_ERR_ARGUMENT;
    const char *suffix = joining ? " has connected." : " has disconnected.";
    size_t length = strlen(suffix);
    size_t required = (size_t)name->unit_count + length;
    *unit_count = required;
    if (capacity < required) return WU_ERR_BUFFER;
    if (!out || out == name->units) return WU_ERR_ARGUMENT;
    memcpy(out, name->units, ((size_t)name->unit_count - 1u) * sizeof(uint16_t));
    for (size_t i = 0; i <= length; ++i) out[name->unit_count - 1u + i] = (uint16_t)(unsigned char)suffix[i];
    return WU_OK;
}

const char *wu_result_name(int r) {
    switch (r) {
        case WU_OK: return "ok";
        case WU_ERR_ARGUMENT: return "invalid_argument";
        case WU_ERR_CONFIG: return "invalid_config";
        case WU_ERR_SNAPSHOT: return "invalid_snapshot";
        case WU_ERR_UTF8: return "invalid_utf8_or_control";
        case WU_ERR_NAME_TOO_LONG: return "name_too_long";
        case WU_ERR_NAME_EXHAUSTED: return "name_pool_exhausted";
        case WU_ERR_BUFFER: return "insufficient_utf16_capacity";
        default: return "unknown_result";
    }
}

const char *wu_reason_name(enum wu_reason reason) {
    switch (reason) {
        case WU_REASON_STABLE: return "stable";
        case WU_REASON_ACTION: return "one_owned_action";
        case WU_REASON_BASELINE: return "baseline_not_ready";
        case WU_REASON_UNKNOWN: return "unknown_objects_freeze";
        case WU_REASON_INFLIGHT: return "inflight_add_move_blocked";
        case WU_REASON_INFLIGHT_HEADROOM: return "remove_owned_for_inflight_headroom";
        case WU_REASON_CAPACITY: return "reserved_capacity";
        case WU_REASON_SETTLING: return "waiting_distinct_stable_samples";
        case WU_REASON_PENDING: return "awaiting_explicit_resolution";
        case WU_REASON_STALE_SAMPLE: return "stale_or_duplicate_sample";
        case WU_REASON_INVALID_CONFIG: return "invalid_config";
        case WU_REASON_INVALID_SNAPSHOT: return "invalid_snapshot";
        default: return "unknown_reason";
    }
}
