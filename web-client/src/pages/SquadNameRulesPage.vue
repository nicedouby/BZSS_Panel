<template>
  <AppPage class="policy-page" full-bleed>
    <WorkspaceToolbar class="page-toolbar">
      <div class="page-heading">
        <button class="icon-button" type="button" title="返回规则链" @click="goBack">←</button>
        <div>
          <div class="heading-line">
            <strong>队名规范</strong>
            <AppStatusBadge tone="idle">v{{ state?.version || 2 }} · 修订 {{ state?.revision || 0 }}</AppStatusBadge>
            <AppStatusBadge :tone="dirty ? 'warn' : 'ok'">{{ dirty ? "有修改尚未保存" : "所有修改已保存" }}</AppStatusBadge>
          </div>
          <p>统一管理步兵、载具、支援与后勤队名，以及类型继承的人数上限。</p>
        </div>
      </div>
      <template #actions>
        <button class="btn ghost" type="button" :disabled="loading" @click="loadState">{{ loading ? "刷新中…" : "刷新" }}</button>
        <button class="btn ghost desktop-only" type="button" @click="toggleAdvanced">高级 JSON</button>
        <button v-if="canSave" class="btn" type="button" :disabled="saving" @click="validateDraft">检查草稿</button>
        <button v-if="canSave" class="btn primary save-button" type="button" :disabled="saving || !dirty" @click="saveState">
          {{ saving ? "正在验证并保存…" : dirty ? "保存修改" : "已保存" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="notice error-notice">
      <div><strong>操作没有完成</strong><span>{{ error }}</span></div>
      <button class="icon-button" type="button" @click="error = ''">×</button>
    </div>

    <div v-if="validation && !validation.valid" class="notice validation-notice">
      <div class="notice-title">
        <div><strong>草稿中有 {{ validation.errors.length }} 个问题</strong><span>点击问题可直接定位到对应规则或类型。</span></div>
        <button class="icon-button" type="button" @click="validation = null">×</button>
      </div>
      <div class="validation-items">
        <button v-for="item in validation.errors.slice(0, 8)" :key="`${item.code}:${item.index}:${item.message}`" type="button" @click="openValidationItem(item)">
          <span>{{ item.section === "types" ? "类型" : "规则" }}</span>{{ item.message }}<b>查看 →</b>
        </button>
      </div>
      <small v-if="validation.errors.length > 8">另有 {{ validation.errors.length - 8 }} 个问题未展开，请修复上方问题后再次检查。</small>
    </div>

    <section class="overview-grid" aria-label="配置概览">
      <button class="overview-card" type="button" @click="showAllRules">
        <span>队名规则</span><strong>{{ entries.length }}</strong><small>{{ enabledRuleCount }} 条正在使用</small>
      </button>
      <button class="overview-card" type="button" @click="showDisabledRules">
        <span>已停用规则</span><strong>{{ disabledRuleCount }}</strong><small>保留数据但不参与匹配</small>
      </button>
      <button class="overview-card" type="button" @click="activeTab = 'types'">
        <span>队伍类型</span><strong>{{ types.length }}</strong><small>{{ enabledTypeCount }} 个可继续使用</small>
      </button>
      <button class="overview-card" :class="{ attention: legacyTypeCount > 0 }" type="button" @click="showLegacyTypes">
        <span>待确认类型</span><strong>{{ legacyTypeCount }}</strong><small>{{ legacyTypeCount ? "由旧配置迁移，建议逐步整理" : "迁移数据已整理" }}</small>
      </button>
    </section>

    <nav class="tabs" aria-label="队名规范功能">
      <button :class="{ active: activeTab === 'rules' }" type="button" @click="activeTab = 'rules'">
        队名规则 <span>{{ entries.length }}</span>
      </button>
      <button :class="{ active: activeTab === 'types' }" type="button" @click="activeTab = 'types'">
        队伍类型 <span>{{ types.length }}</span>
      </button>
    </nav>

    <section v-if="activeTab === 'rules'" class="workspace rules-workspace">
      <div class="primary-actions">
        <label class="search-box">
          <span>⌕</span>
          <input v-model.trim="filters.search" type="search" placeholder="搜索队名、别名、关键词、阵营或资产路径" />
          <button v-if="filters.search" type="button" title="清除搜索" @click="filters.search = ''">×</button>
        </label>
        <button class="btn filter-button" :class="{ active: filtersActive }" type="button" @click="showFilters = !showFilters">
          筛选<span v-if="activeFilterCount">{{ activeFilterCount }}</span>
        </button>
        <button v-if="canSave" class="btn primary" type="button" @click="addRule">＋ 新增规则</button>
      </div>

      <div v-if="showFilters" class="filter-panel">
        <label>宽泛性质<select v-model="filters.nature"><option value="">全部性质</option><option v-for="nature in natures" :key="nature" :value="nature">{{ natureLabel(nature) }}</option></select></label>
        <label>队伍类型<select v-model="filters.typeId"><option value="">全部类型</option><option v-for="type in sortedTypes" :key="type.id" :value="type.id">{{ type.label }}</option></select></label>
        <label>使用状态<select v-model="filters.status"><option value="">全部状态</option><option value="enabled">正在使用</option><option value="disabled">已停用</option></select></label>
        <label>数据来源<select v-model="filters.source"><option value="">全部来源</option><option v-for="sourceName in sources" :key="sourceName" :value="sourceName">{{ sourceLabel(sourceName) }}</option></select></label>
        <button class="btn ghost" type="button" :disabled="!filtersActive" @click="clearFilters">重置筛选</button>
      </div>

      <div class="result-summary">
        <span>找到 <strong>{{ filteredEntries.length }}</strong> 条规则</span>
        <span v-if="filtersActive">已从 {{ entries.length }} 条规则中筛选</span>
        <button v-if="selectedIds.length" type="button" @click="showBulk = !showBulk">已选择 {{ selectedIds.length }} 条 · 批量修改</button>
        <span v-else>勾选规则后可批量修改</span>
      </div>

      <div v-if="selectedIds.length && showBulk" class="bulk-panel">
        <div class="bulk-heading"><div><strong>批量修改 {{ selectedIds.length }} 条规则</strong><span>只会应用你明确填写的项目。</span></div><button class="icon-button" type="button" @click="showBulk = false">×</button></div>
        <div class="bulk-fields">
          <label>改为类型<select v-model="bulk.typeId"><option value="">保持不变</option><option v-for="type in enabledTypes" :key="type.id" :value="type.id">{{ type.label }}</option></select></label>
          <label>改为阵营<input v-model="bulk.faction" placeholder="留空表示不修改" /></label>
          <label>覆盖人数<input v-model.number="bulk.maxPlayersOverride" type="number" min="1" placeholder="留空表示不修改" /></label>
          <label>使用状态<select v-model="bulk.enabled"><option value="">保持不变</option><option value="true">启用</option><option value="false">停用</option></select></label>
        </div>
        <div class="bulk-options">
          <label><input v-model="bulk.clearOverride" type="checkbox" />清除单条人数覆盖，重新继承类型默认值</label>
          <label><input v-model="bulk.clearAsset" type="checkbox" />清除资产路径</label>
        </div>
        <div class="button-row"><button class="btn primary" type="button" @click="applyBulk">应用修改</button><button class="btn ghost" type="button" @click="selectedIds = []; showBulk = false">取消选择</button></div>
      </div>

      <details class="test-card">
        <summary>
          <div><span class="summary-icon">✓</span><div><strong>实时测试队名</strong><small>使用当前尚未保存的草稿进行匹配，不会影响服务器。</small></div></div>
          <span>展开测试</span>
        </summary>
        <div class="test-content">
          <div class="test-input-row"><input v-model.trim="testName" placeholder="输入队名，例如 BMP队" @keyup.enter="runLiveTest" /><button class="btn primary" type="button" :disabled="testing || !testName" @click="runLiveTest">{{ testing ? "测试中…" : "立即测试" }}</button></div>
          <div v-if="testResult" class="test-result" :data-valid="testResult.valid">
            <div class="test-verdict"><span>{{ testResult.valid ? "✓" : "!" }}</span><div><strong>{{ testResult.valid ? "这个队名可以使用" : "这个队名不被允许" }}</strong><small>{{ testResult.reason || (testResult.valid ? "已命中一条启用规则" : "没有命中允许规则") }}</small></div></div>
            <dl>
              <div><dt>命中规则</dt><dd>{{ testResult.classification?.ruleId || "—" }}</dd></div>
              <div><dt>分类</dt><dd>{{ natureLabel(testResult.classification?.nature || "other") }} / {{ testResult.classification?.typeLabel || "未知" }}</dd></div>
              <div><dt>人数上限</dt><dd>{{ testResult.classification?.effectiveMaxPlayers ?? "不限" }} · {{ maxSourceLabel(testResult.classification?.maxPlayersSource) }}</dd></div>
              <div><dt>命中方式</dt><dd>{{ matchKindLabel(testResult.matched?.matchedKind) }}</dd></div>
              <div v-if="testResult.classification?.assetPath" class="wide"><dt>资产路径</dt><dd class="mono">{{ testResult.classification.assetPath }}</dd></div>
            </dl>
          </div>
        </div>
      </details>

      <div class="table-card">
        <div class="table-wrap">
          <table class="rules-table">
            <thead><tr><th class="check"><input type="checkbox" :checked="allVisibleSelected" aria-label="选择当前显示的规则" @change="toggleVisibleSelection" /></th><th>状态</th><th>允许队名与别名</th><th>分类</th><th>人数上限</th><th>适用范围</th><th>来源</th><th class="actions-column">操作</th></tr></thead>
            <tbody>
              <tr v-for="entry in visibleEntries" :key="entry.id" :class="{ invalid: invalidRuleIds.has(entry.id) }" @click="openEditor(entry.id)">
                <td class="check" @click.stop><input v-model="selectedIds" type="checkbox" :value="entry.id" :aria-label="`选择 ${entry.name}`" /></td>
                <td><button class="status-pill" :data-enabled="entry.enabled" type="button" :disabled="!canSave" @click.stop="toggleEntryStatus(entry)"><i></i>{{ entry.enabled ? "使用中" : "已停用" }}</button></td>
                <td><div class="rule-name"><strong>{{ entry.name }}</strong><span>{{ entry.id }}</span></div><div class="alias-list"><span v-for="alias in entry.aliases.slice(0, 2)" :key="alias">{{ alias }}</span><span v-if="entry.aliases.length > 2">+{{ entry.aliases.length - 2 }}</span><small v-if="!entry.aliases.length">没有别名</small></div></td>
                <td><div class="type-cell"><span class="nature-dot" :data-nature="typeFor(entry.typeId)?.nature || 'other'"></span><div><strong>{{ typeFor(entry.typeId)?.label || entry.typeId }}</strong><small>{{ natureLabel(typeFor(entry.typeId)?.nature || "other") }}</small></div></div></td>
                <td><div class="limit-cell"><strong>{{ effectiveMax(entry) ?? "不限" }}</strong><small>{{ entry.maxPlayersOverride != null ? "此规则单独设置" : typeFor(entry.typeId)?.defaultMaxPlayers != null ? "继承类型默认" : "没有人数限制" }}</small></div></td>
                <td><div class="scope-cell"><span v-if="entry.faction">{{ entry.faction }}</span><span v-else>全部阵营</span><small v-if="entry.asset" title="已配置资产路径">已关联资产</small><small v-else>{{ typeFor(entry.typeId)?.nature === "vehicle" ? "未关联资产" : "无需资产" }}</small></div></td>
                <td><span class="source-pill">{{ sourceLabel(entry.source) }}</span></td>
                <td class="actions-column"><button class="row-action" type="button" @click.stop="openEditor(entry.id)">编辑 →</button></td>
              </tr>
              <tr v-if="!visibleEntries.length"><td colspan="8"><div class="empty-state"><span>⌕</span><strong>没有找到符合条件的规则</strong><small>尝试更换关键词或清除筛选条件。</small><button v-if="filtersActive" class="btn" type="button" @click="clearFilters">清除筛选</button></div></td></tr>
            </tbody>
          </table>
        </div>
        <div v-if="filteredEntries.length > renderLimit" class="load-more"><span>当前显示 {{ visibleEntries.length }} / {{ filteredEntries.length }}</span><button class="btn" type="button" @click="renderLimit += 100">再显示 100 条</button></div>
      </div>
    </section>

    <section v-else class="workspace types-workspace">
      <div class="primary-actions">
        <label class="search-box"><span>⌕</span><input v-model.trim="typeFilters.search" type="search" placeholder="搜索类型名称、ID 或描述" /><button v-if="typeFilters.search" type="button" @click="typeFilters.search = ''">×</button></label>
        <select v-model="typeFilters.nature" class="standalone-select"><option value="">全部性质</option><option v-for="nature in natures" :key="nature" :value="nature">{{ natureLabel(nature) }}</option></select>
        <button v-if="canSave" class="btn primary" type="button" @click="addType">＋ 新增类型</button>
      </div>
      <div class="type-help"><span>人数继承</span><p>修改类型默认人数，会立即影响所有没有设置“单条覆盖人数”的关联规则。点击类型卡片查看影响范围。</p></div>
      <div class="type-grid">
        <article v-for="type in filteredTypes" :key="type.id" class="type-card" :class="{ invalid: invalidTypeIds.has(type.id), disabled: !type.enabled }" tabindex="0" @click="openTypeEditor(type.id)" @keydown.enter="openTypeEditor(type.id)">
          <header><div class="type-identity"><span class="nature-icon" :data-nature="type.nature">{{ natureShortLabel(type.nature) }}</span><div><strong>{{ type.label }}</strong><code>{{ type.id }}</code></div></div><span class="status-text" :data-enabled="type.enabled">{{ type.enabled ? "可使用" : "已停用" }}</span></header>
          <p>{{ type.description || "尚未填写类型说明。" }}</p>
          <dl><div><dt>关联规则</dt><dd>{{ ruleCount(type.id) }}</dd></div><div><dt>默认人数</dt><dd>{{ type.defaultMaxPlayers ?? "不限" }}</dd></div><div><dt>继承规则</dt><dd>{{ inheritedRuleCount(type.id) }}</dd></div><div><dt>资产路径</dt><dd>{{ assetModeLabel(type.assetMode) }}</dd></div></dl>
          <footer><span>{{ natureLabel(type.nature) }}</span><button type="button" @click.stop="openTypeEditor(type.id)">编辑设置 →</button></footer>
        </article>
        <button v-if="canSave" class="type-card add-type-card" type="button" @click="addType"><span>＋</span><strong>新增队伍类型</strong><small>例如无人机、防空或炮兵</small></button>
        <div v-if="!filteredTypes.length" class="empty-state type-empty"><span>⌕</span><strong>没有找到队伍类型</strong><small>请更换关键词或性质筛选。</small></div>
      </div>
    </section>

    <div v-if="editorEntry" class="drawer-backdrop" @click.self="closeEditor">
      <aside class="drawer rule-drawer">
        <header class="drawer-header"><div><span class="eyebrow">队名规则</span><strong>{{ editorEntry.name || "未命名规则" }}</strong><small>{{ editorEntry.id }}</small></div><button class="icon-button" type="button" aria-label="关闭编辑器" @click="closeEditor">×</button></header>
        <div class="drawer-body">
          <section class="form-section"><div class="section-heading"><strong>基本信息</strong><span>决定这条规则属于哪一类队伍。</span></div><label class="field"><span>允许队名<b>必填</b></span><input v-model="editorEntry.name" :disabled="!canSave" placeholder="例如 BMP" @input="markDirty" /></label><label class="field"><span>队伍类型<b>必填</b></span><select v-model="editorEntry.typeId" :disabled="!canSave" @change="onEntryTypeChanged(editorEntry)"><option v-for="type in sortedTypes" :key="type.id" :value="type.id">{{ type.label }} · {{ natureLabel(type.nature) }}{{ type.enabled ? "" : "（已停用）" }}</option></select></label><div class="two-col"><label class="field"><span>适用阵营</span><input v-model="editorEntry.faction" :disabled="!canSave" placeholder="留空表示全部阵营" @input="markDirty" /></label><label class="field"><span>使用状态</span><select v-model="editorEntry.enabled" :disabled="!canSave" @change="markDirty"><option :value="true">启用并参与匹配</option><option :value="false">停用但保留数据</option></select></label></div></section>
          <section class="form-section"><div class="section-heading"><strong>队名匹配</strong><span>别名是可直接使用的队名；关键词只用于违规名称建议。</span></div><label class="field"><span>允许的别名</span><textarea :value="editorEntry.aliases.join('\n')" :disabled="!canSave" placeholder="每行一个，例如：&#10;BMP-1&#10;步战车" @input="setList(editorEntry, 'aliases', $event)" /><small>共 {{ editorEntry.aliases.length }} 个别名，系统会自动去除重复项。</small></label><label class="field"><span>建议关键词</span><textarea :value="editorEntry.keywords.join('\n')" :disabled="!canSave" placeholder="每行一个，仅用于生成相似队名建议" @input="setList(editorEntry, 'keywords', $event)" /></label><label class="switch-row"><input v-model="editorEntry.allowSquadSuffix" :disabled="!canSave" type="checkbox" @change="markDirty" /><span><strong>允许常见队伍后缀</strong><small>开启后，BMP队、BMP小队、BMP Squad、BMP Team 也会命中。</small></span></label></section>
          <section class="form-section"><div class="section-heading"><strong>人数与资产</strong><span>人数限制由其他模块执行，这里只提供分类结果。</span></div><div class="inheritance-box"><div><span>类型默认</span><strong>{{ typeFor(editorEntry.typeId)?.defaultMaxPlayers ?? "不限" }}</strong></div><b>→</b><div><span>规则覆盖</span><strong>{{ editorEntry.maxPlayersOverride ?? "未设置" }}</strong></div><b>→</b><div class="effective"><span>最终上限</span><strong>{{ effectiveMax(editorEntry) ?? "不限" }}</strong></div></div><label class="field"><span>单条覆盖人数</span><input v-model.number="editorEntry.maxPlayersOverride" :disabled="!canSave" type="number" min="1" placeholder="留空则继承类型默认值" @input="markDirty" /><small>仅当这条规则需要不同于同类型规则时才填写。</small></label><label class="field"><span>资产路径 <b v-if="typeFor(editorEntry.typeId)?.assetMode === 'required'">必填</b></span><input v-model="editorEntry.asset" :disabled="!canSave || typeFor(editorEntry.typeId)?.assetMode === 'none'" :placeholder="assetHint(editorEntry)" @input="markDirty" /><small>{{ assetHint(editorEntry) }}</small></label></section>
          <details class="advanced-section"><summary>高级设置</summary><div class="advanced-fields"><div class="two-col"><label class="field"><span>优先级</span><input v-model.number="editorEntry.priority" :disabled="!canSave" type="number" @input="markDirty" /></label><label class="field"><span>数据来源</span><input v-model="editorEntry.source" :disabled="!canSave" @input="markDirty" /></label></div><label class="field"><span>规则 ID</span><input v-model="editorEntry.id" disabled /></label><label class="field"><span>内部备注</span><textarea v-model="editorEntry.notes" :disabled="!canSave" placeholder="记录这条规则的用途或变更原因" @input="markDirty" /></label></div></details>
        </div>
        <footer class="drawer-footer"><div><button v-if="canSave" class="btn ghost" type="button" @click="duplicateRule(editorEntry)">复制规则</button><button v-if="canSave" class="btn danger ghost" type="button" @click="removeRule(editorEntry.id)">删除</button></div><button class="btn primary" type="button" @click="closeEditor">完成</button></footer>
      </aside>
    </div>

    <div v-if="editorType" class="drawer-backdrop" @click.self="closeTypeEditor">
      <aside class="drawer type-drawer">
        <header class="drawer-header"><div><span class="eyebrow">队伍类型</span><strong>{{ editorType.label || "未命名类型" }}</strong><small>{{ editorType.id }}</small></div><button class="icon-button" type="button" aria-label="关闭编辑器" @click="closeTypeEditor">×</button></header>
        <div class="drawer-body">
          <div class="impact-banner"><span>{{ ruleCount(editorType.id) }}</span><div><strong>条规则关联此类型</strong><small>其中 {{ inheritedRuleCount(editorType.id) }} 条会继承默认人数上限。</small></div></div>
          <section class="form-section"><div class="section-heading"><strong>类型信息</strong><span>ID 用于事件和历史记录；一旦被规则使用就不能修改。</span></div><label class="field"><span>类型 ID<b>必填</b></span><input v-model="editorType.id" :disabled="!canEditTypeId(editorType)" placeholder="小写英文，例如 artillery" @input="onTypeIdInput(editorType)" /><small v-if="!canEditTypeId(editorType)">此 ID 已被规则使用，为避免历史记录失效已锁定。</small></label><label class="field"><span>显示名称<b>必填</b></span><input v-model="editorType.label" :disabled="!canSave" placeholder="例如 炮兵" @input="markDirty" /></label><label class="field"><span>宽泛性质<b>必填</b></span><select v-model="editorType.nature" :disabled="!canSave" @change="onTypeNatureChanged(editorType)"><option v-for="nature in natures" :key="nature" :value="nature">{{ natureLabel(nature) }}</option></select></label><label class="field"><span>类型说明</span><textarea v-model="editorType.description" :disabled="!canSave" placeholder="说明此类型适用于哪些小队" @input="markDirty" /></label></section>
          <section class="form-section"><div class="section-heading"><strong>默认限制</strong><span>未设置单条覆盖的规则将继承这里的设置。</span></div><label class="field"><span>默认人数上限</span><input v-model.number="editorType.defaultMaxPlayers" :disabled="!canSave" type="number" min="1" placeholder="留空表示不限人数" @input="markDirty" /><small v-if="inheritedRuleCount(editorType.id)">修改后将影响 {{ inheritedRuleCount(editorType.id) }} 条规则。</small></label><label class="field"><span>资产路径模式</span><select v-model="editorType.assetMode" :disabled="!canSave || editorType.nature !== 'vehicle'" @change="markDirty"><option value="none">禁止设置资产路径</option><option value="optional">资产路径可选</option><option value="required">必须填写资产路径</option></select><small v-if="editorType.nature !== 'vehicle'">只有载具性质可以配置资产路径。</small></label></section>
          <section class="form-section"><div class="two-col"><label class="field"><span>使用状态</span><select v-model="editorType.enabled" :disabled="!canSave" @change="markDirty"><option :value="true">允许规则继续使用</option><option :value="false">停用此类型</option></select></label><label class="field"><span>页面排序</span><input v-model.number="editorType.sortOrder" :disabled="!canSave" type="number" @input="markDirty" /></label></div></section>
        </div>
        <footer class="drawer-footer"><div><button v-if="canSave" class="btn danger ghost" type="button" :disabled="ruleCount(editorType.id) > 0" :title="ruleCount(editorType.id) ? '请先迁移关联规则' : '删除此类型'" @click="removeType(editorType.id)">删除类型</button></div><button class="btn primary" type="button" @click="closeTypeEditor">完成</button></footer>
      </aside>
    </div>

    <div v-if="showAdvanced" class="drawer-backdrop" @click.self="showAdvanced = false">
      <aside class="drawer json-drawer"><header class="drawer-header"><div><span class="eyebrow">高级工具</span><strong>JSON 导入与导出</strong><small>JSON 不会在没有确认时覆盖表格草稿</small></div><button class="icon-button" type="button" @click="showAdvanced = false">×</button></header><div class="drawer-body"><div class="json-warning">这里适合批量迁移和故障排查。日常修改请优先使用规则与类型编辑器。</div><div class="button-row"><button class="btn" type="button" @click="syncJsonFromDraft">重新生成 JSON</button><button class="btn" type="button" @click="exportJson">导出文件</button><label class="btn file-btn">导入文件<input type="file" accept="application/json,.json" @change="importJsonFile" /></label></div><textarea v-model="jsonText" class="json-editor" spellcheck="false" @input="jsonEdited = true" /><button v-if="canSave" class="btn primary" type="button" :disabled="!jsonEdited" @click="applyJsonToDraft">确认用 JSON 覆盖当前草稿</button><section class="form-section"><div class="section-heading"><strong>匹配器设置</strong><span>不熟悉正则表达式时请保持默认。</span></div><label class="field"><span>建议候选数量</span><input v-model.number="suggestionLimit" :disabled="!canSave" type="number" min="1" max="50" @input="markDirty" /></label><label class="field"><span>默认队名正则</span><textarea :value="defaultNamePatterns.join('\n')" :disabled="!canSave" @input="setDefaultPatterns" /></label></section><dl class="metadata"><div><dt>配置文件</dt><dd>{{ state?.policyPath || "—" }}</dd></div><div><dt>最后更新</dt><dd>{{ formattedUpdatedAt }}</dd></div><div><dt>迁移记录</dt><dd>{{ state?.migrationWarnings?.length || 0 }} 条</dd></div></dl></div></aside>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { apiGet, apiPost, ApiError } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

type Nature = "infantry" | "vehicle" | "support" | "logistics" | "other";
type SquadType = { id: string; label: string; nature: Nature; description: string; defaultMaxPlayers: number | null; assetMode: "none" | "optional" | "required"; enabled: boolean; sortOrder: number; ruleCount?: number };
type PolicyEntry = { id: string; name: string; aliases: string[]; keywords: string[]; typeId: string; faction: string; asset: string; maxPlayersOverride: number | null; allowSquadSuffix: boolean; enabled: boolean; priority: number; source: string; notes: string; legacyVehicleType?: string; searchTokens?: string[] };
type ValidationItem = { code: string; message: string; section?: string; index?: number; ruleId?: string; typeId?: string };
type ValidationResult = { valid: boolean; errors: ValidationItem[]; warnings: ValidationItem[] };
type PolicyState = { ok: boolean; policyPath: string; version: number; revision: number; source: Record<string, string>; importedAt: string | null; updatedAt: string | null; suggestionLimit: number; defaultNamePatterns: string[]; types: SquadType[]; entries: PolicyEntry[]; migrationWarnings?: unknown[]; validation?: ValidationResult };
type TestResult = { valid: boolean; reason?: string; matched?: { matchedKind?: string } | null; classification?: { nature: string; typeId: string; typeLabel: string; ruleId: string; effectiveMaxPlayers: number | null; maxPlayersSource: string; assetPath: string } | null };

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const canSave = computed(() => Boolean(auth.user?.isSuperAdmin));
const state = ref<PolicyState | null>(null);
const types = ref<SquadType[]>([]);
const entries = ref<PolicyEntry[]>([]);
const suggestionLimit = ref(5);
const defaultNamePatterns = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const dirty = ref(false);
const error = ref("");
const validation = ref<ValidationResult | null>(null);
const activeTab = ref<"rules" | "types">("rules");
const renderLimit = ref(100);
const selectedIds = ref<string[]>([]);
const editorEntryId = ref("");
const editorTypeId = ref("");
const showAdvanced = ref(false);
const showFilters = ref(false);
const showBulk = ref(false);
const jsonText = ref("");
const jsonEdited = ref(false);
const testName = ref("BMP队");
const testing = ref(false);
const testResult = ref<TestResult | null>(null);
const natures: Nature[] = ["infantry", "vehicle", "support", "logistics", "other"];
const filters = reactive({ search: "", nature: "", typeId: "", status: "", source: "" });
const typeFilters = reactive({ search: "", nature: "" });
const bulk = reactive({ typeId: "", faction: "", maxPlayersOverride: null as number | null, enabled: "", clearAsset: false, clearOverride: false });

const sortedTypes = computed(() => [...types.value].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)));
const enabledTypes = computed(() => sortedTypes.value.filter((item) => item.enabled));
const sources = computed(() => [...new Set(entries.value.map((entry) => entry.source).filter(Boolean))].sort());
const typeMap = computed(() => new Map(types.value.map((type) => [type.id, type])));
const enabledRuleCount = computed(() => entries.value.filter((entry) => entry.enabled).length);
const disabledRuleCount = computed(() => entries.value.length - enabledRuleCount.value);
const enabledTypeCount = computed(() => types.value.filter((type) => type.enabled).length);
const legacyTypeCount = computed(() => types.value.filter((type) => type.id.startsWith("legacy_")).length);
const activeFilterCount = computed(() => [filters.nature, filters.typeId, filters.status, filters.source].filter(Boolean).length);
const filtersActive = computed(() => Boolean(filters.search || activeFilterCount.value));
const filteredEntries = computed(() => entries.value.filter((entry) => {
  const type = typeFor(entry.typeId);
  const search = filters.search.toLowerCase();
  return (!search || [entry.name, entry.id, entry.aliases.join(" "), entry.keywords.join(" "), entry.faction, entry.asset, entry.source, type?.label].join(" ").toLowerCase().includes(search))
    && (!filters.nature || type?.nature === filters.nature)
    && (!filters.typeId || entry.typeId === filters.typeId)
    && (!filters.status || (filters.status === "enabled") === entry.enabled)
    && (!filters.source || entry.source === filters.source);
}));
const visibleEntries = computed(() => filteredEntries.value.slice(0, renderLimit.value));
const filteredTypes = computed(() => sortedTypes.value.filter((type) => {
  const search = typeFilters.search.toLowerCase();
  return (!search || [type.id, type.label, type.description].join(" ").toLowerCase().includes(search))
    && (!typeFilters.nature || type.nature === typeFilters.nature);
}));
const allVisibleSelected = computed(() => visibleEntries.value.length > 0 && visibleEntries.value.every((entry) => selectedIds.value.includes(entry.id)));
const editorEntry = computed(() => entries.value.find((entry) => entry.id === editorEntryId.value) ?? null);
const editorType = computed(() => types.value.find((type) => type.id === editorTypeId.value) ?? null);
const invalidRuleIds = computed(() => new Set((validation.value?.errors ?? []).map((item) => item.ruleId).filter(Boolean) as string[]));
const invalidTypeIds = computed(() => new Set((validation.value?.errors ?? []).map((item) => item.typeId).filter(Boolean) as string[]));
const formattedUpdatedAt = computed(() => state.value?.updatedAt ? new Date(state.value.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未记录");

onMounted(() => { window.addEventListener("beforeunload", beforeUnload); void loadState(); });
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
onBeforeRouteLeave(() => !dirty.value || window.confirm("队名规范存在未保存修改，确定离开吗？"));

function beforeUnload(event: BeforeUnloadEvent) { if (!dirty.value) return; event.preventDefault(); event.returnValue = ""; }
function goBack() { void router.push("/squad-rule-chain"); }
function typeFor(id: string) { return typeMap.value.get(id); }
function natureLabel(value: string) { return ({ infantry: "步兵", vehicle: "载具", support: "支援", logistics: "后勤", other: "其他" } as Record<string, string>)[value] || value; }
function natureShortLabel(value: string) { return ({ infantry: "步", vehicle: "载", support: "援", logistics: "勤", other: "其" } as Record<string, string>)[value] || "其"; }
function sourceLabel(value?: string) { return ({ manual: "手动维护", migration: "旧数据迁移", xlsx_import: "表格导入" } as Record<string, string>)[value || ""] || value || "未知"; }
function assetModeLabel(value: SquadType["assetMode"]) { return value === "required" ? "必须填写" : value === "optional" ? "可以填写" : "不使用"; }
function maxSourceLabel(value?: string) { return value === "rule_override" ? "规则单独设置" : value === "type_default" ? "继承类型默认" : "无限制"; }
function matchKindLabel(value?: string) { return ({ canonical: "标准名", alias: "别名", suffix: "允许后缀", infantry: "步兵规则", special_infantry: "特种步兵规则" } as Record<string, string>)[value || ""] || value || "—"; }
function effectiveMax(entry: PolicyEntry) { return entry.maxPlayersOverride ?? typeFor(entry.typeId)?.defaultMaxPlayers ?? null; }
function ruleCount(typeId: string) { return entries.value.filter((entry) => entry.typeId === typeId).length; }
function inheritedRuleCount(typeId: string) { return entries.value.filter((entry) => entry.typeId === typeId && entry.maxPlayersOverride == null).length; }
function markDirty() { dirty.value = true; validation.value = null; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function normalizeEntry(entry: Partial<PolicyEntry>): PolicyEntry { return { id: entry.id || `rule:manual_${Date.now().toString(36)}`, name: entry.name || "新队名规则", aliases: Array.isArray(entry.aliases) ? entry.aliases : [], keywords: Array.isArray(entry.keywords) ? entry.keywords : [], typeId: entry.typeId || enabledTypes.value[0]?.id || "other", faction: entry.faction || "", asset: entry.asset || "", maxPlayersOverride: entry.maxPlayersOverride ?? null, allowSquadSuffix: entry.allowSquadSuffix !== false, enabled: entry.enabled !== false, priority: Number(entry.priority ?? 100), source: entry.source || "manual", notes: entry.notes || "", legacyVehicleType: entry.legacyVehicleType || "", searchTokens: entry.searchTokens || [] }; }
async function loadState() { if (dirty.value && !window.confirm("放弃未保存修改并刷新吗？")) return; loading.value = true; error.value = ""; try { applyState(await apiGet<PolicyState>("/api/squad-name-policy/state")); } catch (err) { error.value = formatError(err); } finally { loading.value = false; } }
function applyState(payload: PolicyState) { state.value = payload; types.value = clone(payload.types || []); entries.value = (payload.entries || []).map(normalizeEntry); suggestionLimit.value = payload.suggestionLimit || 5; defaultNamePatterns.value = [...(payload.defaultNamePatterns || [])]; dirty.value = false; validation.value = payload.validation || null; selectedIds.value = []; editorEntryId.value = ""; editorTypeId.value = ""; renderLimit.value = 100; syncJsonFromDraft(); jsonEdited.value = false; }
function buildPayload() { return { version: 2, revision: state.value?.revision ?? 1, source: state.value?.source ?? { type: "manual" }, importedAt: state.value?.importedAt ?? null, suggestionLimit: suggestionLimit.value, defaultNamePatterns: defaultNamePatterns.value, types: types.value, entries: entries.value }; }
async function validateDraft() { if (!canSave.value) return; saving.value = true; error.value = ""; try { validation.value = await apiPost<ValidationResult>("/api/squad-name-policy/validate", buildPayload()); ui.pushToast({ title: "草稿检查通过", message: "当前草稿可以安全保存。", tone: "ok" }); } catch (err) { const result = validationFromError(err); if (result) { validation.value = result; ui.pushToast({ title: `发现 ${result.errors.length} 个问题`, message: "请根据页面提示修复后再保存。", tone: "warn" }); } else error.value = formatError(err); } finally { saving.value = false; } }
async function saveState() { if (!canSave.value) return; saving.value = true; error.value = ""; try { const payload = buildPayload(); validation.value = await apiPost<ValidationResult>("/api/squad-name-policy/validate", payload); const saved = await apiPost<PolicyState>("/api/squad-name-policy/state", payload); applyState(saved); ui.pushToast({ title: "保存完成", message: `队名规范已保存为修订 ${saved.revision}。`, tone: "ok" }); } catch (err) { const result = validationFromError(err); if (result) { validation.value = result; ui.pushToast({ title: "暂时无法保存", message: `草稿中还有 ${result.errors.length} 个问题。`, tone: "warn" }); } else { error.value = formatError(err); ui.pushToast({ title: "保存失败", message: error.value, tone: "error" }); } } finally { saving.value = false; } }
function addRule() { const entry = normalizeEntry({}); entries.value.unshift(entry); editorEntryId.value = entry.id; markDirty(); }
function duplicateRule(source: PolicyEntry) { const entry = normalizeEntry({ ...clone(source), id: `rule:manual_${Date.now().toString(36)}`, name: `${source.name} 副本`, source: "manual", enabled: false }); entries.value.unshift(entry); editorEntryId.value = entry.id; markDirty(); }
function removeRule(id: string) { if (!window.confirm("确定删除此队名规则吗？此操作将在保存后生效。")) return; entries.value = entries.value.filter((entry) => entry.id !== id); selectedIds.value = selectedIds.value.filter((item) => item !== id); closeEditor(); markDirty(); }
function openEditor(id: string) { editorEntryId.value = id; }
function closeEditor() { editorEntryId.value = ""; }
function toggleEntryStatus(entry: PolicyEntry) { entry.enabled = !entry.enabled; markDirty(); }
function addType() { let index = types.value.length + 1; let id = `custom_type_${index}`; while (typeFor(id)) id = `custom_type_${++index}`; types.value.push({ id, label: "新队伍类型", nature: "other", description: "", defaultMaxPlayers: null, assetMode: "none", enabled: true, sortOrder: types.value.length * 10 + 10 }); activeTab.value = "types"; editorTypeId.value = id; markDirty(); }
function openTypeEditor(id: string) { editorTypeId.value = id; }
function closeTypeEditor() { editorTypeId.value = ""; }
function removeType(id: string) { if (ruleCount(id)) return; if (!window.confirm("确定删除此队伍类型吗？此操作将在保存后生效。")) return; types.value = types.value.filter((type) => type.id !== id); closeTypeEditor(); markDirty(); }
function canEditTypeId(type: SquadType) { return canSave.value && ruleCount(type.id) === 0; }
function onTypeIdInput(type: SquadType) { editorTypeId.value = type.id; markDirty(); }
function onTypeNatureChanged(type: SquadType) { if (type.nature !== "vehicle") { type.assetMode = "none"; for (const entry of entries.value.filter((item) => item.typeId === type.id)) entry.asset = ""; } else if (type.assetMode === "none") type.assetMode = "optional"; markDirty(); }
function onEntryTypeChanged(entry: PolicyEntry) { if (typeFor(entry.typeId)?.nature !== "vehicle") entry.asset = ""; markDirty(); }
function assetHint(entry: PolicyEntry) { const type = typeFor(entry.typeId); return type?.assetMode === "required" ? "此载具类型要求填写资产路径" : type?.assetMode === "optional" ? "可选：填写对应的游戏资产路径" : "当前类型不使用资产路径"; }
function parseList(value: string) { return [...new Set(value.split(/[\r\n,，]+/).map((item) => item.trim()).filter(Boolean))]; }
function setList(entry: PolicyEntry, field: "aliases" | "keywords", event: Event) { entry[field] = parseList((event.target as HTMLTextAreaElement).value); markDirty(); }
function setDefaultPatterns(event: Event) { defaultNamePatterns.value = parseList((event.target as HTMLTextAreaElement).value); markDirty(); }
function clearFilters() { Object.assign(filters, { search: "", nature: "", typeId: "", status: "", source: "" }); renderLimit.value = 100; }
function showAllRules() { activeTab.value = "rules"; clearFilters(); }
function showDisabledRules() { activeTab.value = "rules"; clearFilters(); filters.status = "disabled"; showFilters.value = true; }
function showLegacyTypes() { activeTab.value = "types"; typeFilters.search = "legacy_"; typeFilters.nature = ""; }
function openValidationItem(item: ValidationItem) { if (item.section === "types") { activeTab.value = "types"; if (item.typeId) openTypeEditor(item.typeId); return; } activeTab.value = "rules"; if (item.ruleId) openEditor(item.ruleId); }
function toggleVisibleSelection() { const visible = visibleEntries.value.map((entry) => entry.id); selectedIds.value = allVisibleSelected.value ? selectedIds.value.filter((id) => !visible.includes(id)) : [...new Set([...selectedIds.value, ...visible])]; }
function applyBulk() { const selected = new Set(selectedIds.value); for (const entry of entries.value) { if (!selected.has(entry.id)) continue; if (bulk.typeId) { entry.typeId = bulk.typeId; if (typeFor(entry.typeId)?.nature !== "vehicle") entry.asset = ""; } if (bulk.faction !== "") entry.faction = bulk.faction; if (bulk.clearOverride) entry.maxPlayersOverride = null; else if (bulk.maxPlayersOverride != null) entry.maxPlayersOverride = Number(bulk.maxPlayersOverride) || null; if (bulk.enabled) entry.enabled = bulk.enabled === "true"; if (bulk.clearAsset) entry.asset = ""; } showBulk.value = false; markDirty(); ui.pushToast({ title: "批量修改已应用", message: `已更新 ${selected.size} 条规则，保存后生效。`, tone: "ok" }); }
async function runLiveTest() { testing.value = true; try { testResult.value = await apiPost<TestResult>("/api/squad-name-policy/test", { name: testName.value, policy: buildPayload() }); } catch (err) { ui.pushToast({ title: "测试失败", message: formatError(err), tone: "error" }); } finally { testing.value = false; } }
function toggleAdvanced() { showAdvanced.value = !showAdvanced.value; if (showAdvanced.value && !jsonEdited.value) syncJsonFromDraft(); }
function syncJsonFromDraft() { jsonText.value = JSON.stringify(buildPayload(), null, 2); jsonEdited.value = false; }
function applyJsonToDraft() { try { const parsed = JSON.parse(jsonText.value); if (!Array.isArray(parsed.types) || !Array.isArray(parsed.entries)) throw new Error("JSON 必须包含 types 和 entries 数组"); if (dirty.value && !window.confirm("这会用 JSON 覆盖当前表格草稿，是否继续？")) return; types.value = clone(parsed.types); entries.value = parsed.entries.map(normalizeEntry); suggestionLimit.value = Number(parsed.suggestionLimit || 5); defaultNamePatterns.value = [...(parsed.defaultNamePatterns || [])]; jsonEdited.value = false; markDirty(); showAdvanced.value = false; } catch (err) { error.value = formatError(err); } }
function exportJson() { const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `squad_name_policy_v2_r${state.value?.revision || 0}.json`; anchor.click(); URL.revokeObjectURL(url); }
async function importJsonFile(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; jsonText.value = await file.text(); jsonEdited.value = true; }
function validationFromError(err: unknown): ValidationResult | null { if (!(err instanceof ApiError) || !err.detail || typeof err.detail !== "object") return null; const detail = err.detail as Partial<ValidationResult> & { validation?: ValidationResult }; if (typeof detail.valid === "boolean" && Array.isArray(detail.errors)) return detail as ValidationResult; return detail.validation ?? null; }
function formatError(err: unknown) { return err instanceof Error ? err.message : String(err); }
</script>

<style scoped>
.policy-page{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,color-mix(in srgb,var(--color-brand-primary) 3%,transparent),transparent 220px)}
.page-toolbar{flex:0 0 auto}.page-heading{display:flex;align-items:center;gap:12px;min-width:0}.page-heading>div{min-width:0}.heading-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.heading-line>strong{font-size:18px;letter-spacing:.01em}.page-heading p{margin:3px 0 0;color:var(--color-text-muted);font-size:12px}.icon-button{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--color-border-default);border-radius:8px;background:transparent;color:var(--color-text-primary);cursor:pointer;font-size:18px}.btn{height:34px;padding:0 13px;border:1px solid var(--color-border-default);border-radius:8px;background:var(--color-bg-card);color:var(--color-text-primary);cursor:pointer;font-weight:600}.btn:hover:not(:disabled),.icon-button:hover{border-color:color-mix(in srgb,var(--color-brand-primary) 60%,var(--color-border-default));background:color-mix(in srgb,var(--color-brand-primary) 7%,var(--color-bg-card))}.btn:disabled{opacity:.45;cursor:not-allowed}.btn.primary{border-color:transparent;background:var(--color-brand-primary);color:#07101d}.btn.ghost{background:transparent}.btn.danger{color:var(--color-status-error)}
.notice{margin:10px 18px 0;padding:12px 14px;border:1px solid;border-radius:10px}.error-notice{display:flex;align-items:center;justify-content:space-between;border-color:color-mix(in srgb,var(--color-status-error) 45%,transparent);background:color-mix(in srgb,var(--color-status-error) 9%,var(--color-bg-panel))}.error-notice>div,.notice-title>div{display:grid;gap:3px}.error-notice span,.notice-title span{font-size:12px;color:var(--color-text-muted)}.validation-notice{border-color:color-mix(in srgb,var(--color-status-error) 38%,transparent);background:color-mix(in srgb,var(--color-status-error) 7%,var(--color-bg-panel))}.notice-title{display:flex;align-items:start;justify-content:space-between;gap:16px}.validation-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:10px}.validation-items button{display:flex;align-items:center;gap:8px;min-width:0;padding:8px;border:1px solid var(--color-border-soft);border-radius:7px;background:rgba(0,0,0,.12);color:var(--color-text-primary);text-align:left;cursor:pointer;font-size:12px}.validation-items button>span{flex:none;padding:2px 6px;border-radius:999px;background:color-mix(in srgb,var(--color-status-error) 15%,transparent);color:var(--color-status-error)}.validation-items button>b{margin-left:auto;flex:none;color:var(--color-brand-primary)}.validation-notice>small{display:block;margin-top:8px;color:var(--color-text-muted)}
.overview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:14px 18px 8px}.overview-card{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:12px 14px;border:1px solid var(--color-border-soft);border-radius:11px;background:color-mix(in srgb,var(--color-bg-card) 92%,transparent);color:var(--color-text-primary);text-align:left;cursor:pointer}.overview-card:hover{border-color:color-mix(in srgb,var(--color-brand-primary) 45%,var(--color-border-default));transform:translateY(-1px)}.overview-card>span{font-size:12px;color:var(--color-text-muted)}.overview-card>strong{grid-row:1/3;grid-column:2;font-size:25px;line-height:1}.overview-card>small{color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.overview-card.attention>strong{color:var(--color-status-warn)}
.tabs{display:flex;gap:4px;padding:4px 18px 0;border-bottom:1px solid var(--color-border-default)}.tabs button{display:flex;align-items:center;gap:7px;padding:10px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--color-text-muted);cursor:pointer;font-weight:700}.tabs button span{padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.06);font-size:10px}.tabs button.active{border-color:var(--color-brand-primary);color:var(--color-text-primary)}
.workspace{flex:1;min-height:0;display:flex;flex-direction:column;padding:12px 18px 18px;overflow:auto}.primary-actions{display:flex;align-items:center;gap:9px;flex:none}.search-box{height:36px;display:flex;align-items:center;gap:8px;flex:1;max-width:620px;padding:0 10px;border:1px solid var(--color-border-default);border-radius:9px;background:rgba(0,0,0,.18)}.search-box>span{color:var(--color-text-muted);font-size:18px}.search-box input{flex:1;border:0!important;background:transparent!important;padding:0!important;outline:0;color:var(--color-text-primary)}.search-box button{border:0;background:transparent;color:var(--color-text-muted);cursor:pointer;font-size:17px}.filter-button{display:flex;align-items:center;gap:7px}.filter-button span{padding:1px 6px;border-radius:999px;background:var(--color-brand-primary);color:#07101d;font-size:10px}.filter-button.active{border-color:color-mix(in srgb,var(--color-brand-primary) 55%,transparent)}input,select,textarea{border:1px solid var(--color-border-default);border-radius:7px;background:rgba(0,0,0,.2);color:var(--color-text-primary);padding:7px 9px;min-width:0}.filter-panel{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-top:9px;padding:11px;border:1px solid var(--color-border-soft);border-radius:10px;background:rgba(255,255,255,.025)}.filter-panel label,.bulk-fields label{display:grid;gap:5px;color:var(--color-text-muted);font-size:11px}.filter-panel select{min-width:145px}.result-summary{display:flex;align-items:center;gap:12px;padding:10px 2px;color:var(--color-text-muted);font-size:12px}.result-summary strong{color:var(--color-text-primary)}.result-summary button{margin-left:auto;border:0;background:transparent;color:var(--color-brand-primary);cursor:pointer}.bulk-panel{margin-bottom:10px;padding:14px;border:1px solid color-mix(in srgb,var(--color-brand-primary) 35%,var(--color-border-default));border-radius:11px;background:color-mix(in srgb,var(--color-brand-primary) 6%,var(--color-bg-card))}.bulk-heading{display:flex;justify-content:space-between;align-items:start}.bulk-heading>div{display:grid;gap:3px}.bulk-heading span{color:var(--color-text-muted);font-size:11px}.bulk-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}.bulk-options{display:flex;gap:18px;flex-wrap:wrap;margin:12px 0;font-size:12px}.bulk-options label{display:flex;align-items:center;gap:7px}.button-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.test-card{flex:none;margin-bottom:10px;border:1px solid var(--color-border-soft);border-radius:11px;background:var(--color-bg-card);overflow:hidden}.test-card summary{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;cursor:pointer;list-style:none}.test-card summary::-webkit-details-marker{display:none}.test-card summary>div{display:flex;align-items:center;gap:10px}.test-card summary>div>div{display:grid;gap:2px}.test-card summary small{color:var(--color-text-muted)}.test-card summary>span{color:var(--color-brand-primary);font-size:12px}.summary-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:color-mix(in srgb,var(--color-brand-primary) 12%,transparent);color:var(--color-brand-primary)}.test-content{display:grid;gap:10px;padding:0 13px 13px;border-top:1px solid var(--color-border-soft)}.test-input-row{display:flex;gap:8px;padding-top:12px}.test-input-row input{flex:1}.test-result{padding:12px;border-radius:9px;background:rgba(255,255,255,.025)}.test-verdict{display:flex;align-items:center;gap:10px}.test-verdict>span{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;font-size:18px}.test-result[data-valid=true] .test-verdict>span{background:color-mix(in srgb,var(--color-status-success) 17%,transparent);color:var(--color-status-success)}.test-result[data-valid=false] .test-verdict>span{background:color-mix(in srgb,var(--color-status-error) 17%,transparent);color:var(--color-status-error)}.test-verdict>div{display:grid;gap:2px}.test-verdict small{color:var(--color-text-muted)}.test-result dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0 0}.test-result dl>div{display:grid;gap:3px;padding:8px;border-radius:7px;background:rgba(0,0,0,.14)}.test-result dl>.wide{grid-column:1/-1}.test-result dt{color:var(--color-text-muted);font-size:10px}.test-result dd{margin:0;font-size:12px;overflow-wrap:anywhere}.mono{font-family:monospace}
.table-card{flex:1;min-height:300px;display:flex;flex-direction:column;border:1px solid var(--color-border-soft);border-radius:11px;background:var(--color-bg-card);overflow:hidden}.table-wrap{flex:1;min-height:0;overflow:auto}.rules-table{width:100%;min-width:1030px;border-collapse:separate;border-spacing:0;font-size:12px}.rules-table th{position:sticky;top:0;z-index:3;padding:10px 11px;border-bottom:1px solid var(--color-border-default);background:var(--color-bg-panel);color:var(--color-text-muted);text-align:left;font-size:10px;letter-spacing:.06em}.rules-table td{padding:10px 11px;border-bottom:1px solid var(--color-border-soft);vertical-align:middle}.rules-table tbody tr{cursor:pointer}.rules-table tbody tr:hover{background:color-mix(in srgb,var(--color-brand-primary) 4%,transparent)}.rules-table tr.invalid{background:color-mix(in srgb,var(--color-status-error) 7%,transparent)}.rules-table .check{width:38px;text-align:center}.rules-table .actions-column{width:76px;text-align:right}.status-pill{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:4px 8px;background:rgba(255,255,255,.05);color:var(--color-text-muted);font-size:10px;cursor:pointer}.status-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}.status-pill[data-enabled=true]{background:color-mix(in srgb,var(--color-status-success) 13%,transparent);color:var(--color-status-success)}.rule-name{display:grid;gap:2px}.rule-name>strong{font-size:13px}.rule-name>span{max-width:250px;overflow:hidden;text-overflow:ellipsis;color:var(--color-text-muted);font-family:monospace;font-size:9px}.alias-list{display:flex;align-items:center;gap:4px;margin-top:5px}.alias-list span{max-width:100px;padding:2px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:5px;background:rgba(255,255,255,.05);color:var(--color-text-muted);font-size:9px}.alias-list small{color:var(--color-text-muted)}.type-cell{display:flex;align-items:center;gap:8px}.nature-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--color-text-muted)}.nature-dot[data-nature=vehicle],.nature-icon[data-nature=vehicle]{background:#60a5fa}.nature-dot[data-nature=infantry],.nature-icon[data-nature=infantry]{background:#34d399}.nature-dot[data-nature=support],.nature-icon[data-nature=support]{background:#c084fc}.nature-dot[data-nature=logistics],.nature-icon[data-nature=logistics]{background:#fbbf24}.nature-dot[data-nature=other],.nature-icon[data-nature=other]{background:#94a3b8}.type-cell>div,.limit-cell,.scope-cell{display:grid;gap:3px}.type-cell small,.limit-cell small,.scope-cell small{color:var(--color-text-muted);font-size:9px}.limit-cell>strong{font-size:14px}.source-pill{padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.05);color:var(--color-text-muted);white-space:nowrap;font-size:10px}.row-action{border:0;background:transparent;color:var(--color-brand-primary);cursor:pointer}.empty-state{display:grid;place-items:center;gap:5px;padding:38px;color:var(--color-text-muted);text-align:center}.empty-state>span{font-size:30px}.empty-state>strong{color:var(--color-text-primary)}.load-more{display:flex;align-items:center;justify-content:center;gap:12px;padding:10px;border-top:1px solid var(--color-border-soft);color:var(--color-text-muted);font-size:11px}
.types-workspace{gap:12px}.standalone-select{height:36px}.type-help{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--color-brand-primary) 22%,var(--color-border-soft));border-radius:9px;background:color-mix(in srgb,var(--color-brand-primary) 5%,transparent)}.type-help>span{flex:none;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--color-brand-primary) 14%,transparent);color:var(--color-brand-primary);font-size:10px}.type-help p{margin:0;color:var(--color-text-muted);font-size:11px}.type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:10px;padding-bottom:10px}.type-card{display:flex;flex-direction:column;min-height:190px;padding:14px;border:1px solid var(--color-border-soft);border-radius:11px;background:var(--color-bg-card);cursor:pointer;outline:0}.type-card:hover,.type-card:focus{border-color:color-mix(in srgb,var(--color-brand-primary) 45%,var(--color-border-default));transform:translateY(-1px)}.type-card.invalid{border-color:var(--color-status-error)}.type-card.disabled{opacity:.66}.type-card header{display:flex;justify-content:space-between;gap:10px}.type-identity{display:flex;align-items:center;gap:10px}.nature-icon{width:34px;height:34px;display:grid;place-items:center;flex:none;border-radius:10px;color:#07101d;font-weight:800}.type-identity>div{display:grid;gap:2px}.type-identity code{color:var(--color-text-muted);font-size:9px}.status-text{height:max-content;padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.05);color:var(--color-text-muted);font-size:9px}.status-text[data-enabled=true]{background:color-mix(in srgb,var(--color-status-success) 12%,transparent);color:var(--color-status-success)}.type-card>p{min-height:34px;margin:12px 0;color:var(--color-text-muted);font-size:11px;line-height:1.5}.type-card dl{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:0}.type-card dl>div{display:grid;gap:2px;padding:7px 5px;border-radius:7px;background:rgba(0,0,0,.13);text-align:center}.type-card dt{color:var(--color-text-muted);font-size:8px}.type-card dd{margin:0;font-weight:700;font-size:11px}.type-card footer{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:12px}.type-card footer>span{color:var(--color-text-muted);font-size:10px}.type-card footer button{border:0;background:transparent;color:var(--color-brand-primary);cursor:pointer;font-size:11px}.add-type-card{align-items:center;justify-content:center;gap:5px;border-style:dashed;color:var(--color-text-muted)}.add-type-card>span{font-size:28px;color:var(--color-brand-primary)}.add-type-card>strong{color:var(--color-text-primary)}.type-empty{grid-column:1/-1}
.drawer-backdrop{position:fixed;z-index:70;inset:0;background:rgba(3,7,18,.58);backdrop-filter:blur(3px)}.drawer{position:absolute;right:0;top:0;bottom:0;width:min(540px,96vw);display:flex;flex-direction:column;border-left:1px solid var(--color-border-default);background:color-mix(in srgb,var(--color-bg-panel) 97%,transparent);box-shadow:-22px 0 60px rgba(0,0,0,.38)}.json-drawer{width:min(700px,97vw)}.drawer-header{display:flex;justify-content:space-between;align-items:start;gap:12px;padding:17px 18px;border-bottom:1px solid var(--color-border-default)}.drawer-header>div{display:grid;gap:3px}.drawer-header strong{font-size:17px}.drawer-header small{max-width:430px;overflow:hidden;text-overflow:ellipsis;color:var(--color-text-muted);font-family:monospace;font-size:9px}.eyebrow{color:var(--color-brand-primary);font-size:9px;font-weight:800;letter-spacing:.12em}.drawer-body{flex:1;min-height:0;display:grid;align-content:start;gap:12px;padding:16px 18px;overflow:auto}.form-section{display:grid;gap:12px;padding:14px;border:1px solid var(--color-border-soft);border-radius:10px;background:rgba(255,255,255,.02)}.section-heading{display:grid;gap:3px;padding-bottom:3px}.section-heading>span{color:var(--color-text-muted);font-size:10px}.field{display:grid;gap:6px;color:var(--color-text-muted);font-size:11px}.field>span{display:flex;align-items:center;gap:6px}.field>span>b{padding:1px 5px;border-radius:999px;background:color-mix(in srgb,var(--color-brand-primary) 12%,transparent);color:var(--color-brand-primary);font-size:8px}.field input,.field select,.field textarea{width:100%;color:var(--color-text-primary)}.field textarea{min-height:80px;resize:vertical}.field>small{color:var(--color-text-muted);font-size:9px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px}.switch-row{display:flex;align-items:start;gap:9px;padding:10px;border-radius:8px;background:rgba(0,0,0,.12);cursor:pointer}.switch-row input{margin-top:2px}.switch-row>span{display:grid;gap:3px}.switch-row small{color:var(--color-text-muted);font-size:9px;line-height:1.4}.inheritance-box{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:6px}.inheritance-box>div{display:grid;gap:3px;padding:9px;border-radius:8px;background:rgba(0,0,0,.14);text-align:center}.inheritance-box span{color:var(--color-text-muted);font-size:8px}.inheritance-box>b{color:var(--color-text-muted)}.inheritance-box .effective{background:color-mix(in srgb,var(--color-brand-primary) 10%,transparent)}.advanced-section{border:1px solid var(--color-border-soft);border-radius:10px;overflow:hidden}.advanced-section summary{padding:12px 14px;cursor:pointer;font-weight:700}.advanced-fields{display:grid;gap:12px;padding:0 14px 14px}.drawer-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--color-border-default);background:var(--color-bg-panel)}.drawer-footer>div{display:flex;gap:6px}.impact-banner{display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--color-brand-primary) 8%,transparent)}.impact-banner>span{font-size:28px;font-weight:800;color:var(--color-brand-primary)}.impact-banner>div{display:grid;gap:3px}.impact-banner small{color:var(--color-text-muted)}.json-warning{padding:10px;border-radius:8px;background:color-mix(in srgb,var(--color-status-warn) 9%,transparent);color:var(--color-status-warn);font-size:11px}.json-editor{width:100%;min-height:48vh;resize:vertical;font-family:monospace;font-size:10px}.file-btn{display:inline-flex!important;align-items:center}.file-btn input{display:none}.metadata{display:grid;gap:7px;margin:0;padding:12px;border-radius:9px;background:rgba(0,0,0,.12)}.metadata>div{display:grid;grid-template-columns:90px 1fr;gap:8px}.metadata dt{color:var(--color-text-muted);font-size:10px}.metadata dd{margin:0;overflow-wrap:anywhere;font-size:10px}
@media(max-width:1100px){.overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.validation-items{grid-template-columns:1fr}.bulk-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.test-result dl{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.policy-page{overflow:auto}.page-heading p,.desktop-only{display:none}.page-toolbar :deep(.workspace-toolbar__inner){align-items:flex-start}.overview-grid{grid-template-columns:1fr 1fr;padding:10px 10px 6px;gap:6px}.overview-card{padding:10px}.overview-card>small{display:none}.tabs{padding-left:10px}.workspace{overflow:visible;padding:10px}.primary-actions{flex-wrap:wrap}.search-box{max-width:none;width:100%;flex-basis:100%}.primary-actions>.btn.primary{margin-left:auto}.filter-panel{align-items:stretch}.filter-panel label{width:calc(50% - 5px)}.filter-panel select{width:100%;min-width:0}.bulk-fields{grid-template-columns:1fr}.test-result dl{grid-template-columns:1fr 1fr}.table-card{min-height:420px}.type-grid{grid-template-columns:1fr}.two-col{grid-template-columns:1fr}.inheritance-box{grid-template-columns:1fr}.inheritance-box>b{transform:rotate(90deg);text-align:center}.drawer{width:100vw}.drawer-header,.drawer-body,.drawer-footer{padding-left:14px;padding-right:14px}.validation-notice,.error-notice{margin-left:10px;margin-right:10px}.desktop-only{display:none}}
</style>
