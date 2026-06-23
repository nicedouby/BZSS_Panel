import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AlertBanner from "./AlertBanner.vue";
import AppButton from "./AppButton.vue";
import EmptyState from "./EmptyState.vue";
import StatCard from "./StatCard.vue";
import StatGrid from "./StatGrid.vue";
import StatusBadge from "./StatusBadge.vue";
import PageCard from "../common/PageCard.vue";
import PageWorkspace from "../layout/PageWorkspace.vue";

vi.mock("vue-router", () => ({
  useRoute: () => ({
    meta: {
      layoutMode: "workspace",
    },
  }),
}));

describe("shared UI components", () => {
  it("disables AppButton while loading and exposes aria-busy", () => {
    const wrapper = mount(AppButton, {
      props: { loading: true, variant: "primary", size: "sm" },
      slots: { default: "保存" },
    });

    expect(wrapper.classes()).toContain("app-button--primary");
    expect(wrapper.attributes("disabled")).toBeDefined();
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.text()).toContain("保存");
  });

  it("maps legacy StatusBadge tones to the new tone classes", () => {
    const wrapper = mount(StatusBadge, {
      props: { tone: "ok", dot: true },
      slots: { default: "运行中" },
    });

    expect(wrapper.classes()).toContain("status-badge--success");
    expect(wrapper.find(".status-badge__dot").exists()).toBe(true);
  });

  it("renders AlertBanner, EmptyState, StatCard and StatGrid slots/props", () => {
    const alert = mount(AlertBanner, {
      props: { tone: "danger", title: "失败", message: "请求失败" },
    });
    expect(alert.classes()).toContain("alert-banner--danger");
    expect(alert.text()).toContain("请求失败");

    const empty = mount(EmptyState, {
      props: { title: "暂无记录", compact: true },
    });
    expect(empty.classes()).toContain("empty-state--compact");
    expect(empty.text()).toContain("暂无记录");

    const card = mount(StatCard, {
      props: { label: "成功踢出", value: 3, description: "失败 0 次", tone: "success" },
    });
    expect(card.classes()).toContain("stat-card--success");
    expect(card.text()).toContain("成功踢出");

    const grid = mount(StatGrid, {
      props: {
        items: [
          { key: "entries", label: "条目", value: 12, tone: "info" },
        ],
      },
    });
    expect(grid.findAllComponents(StatCard)).toHaveLength(1);
  });

  it("renders PageCard actions, footer and body mode classes", () => {
    const wrapper = mount(PageCard, {
      props: { title: "卡片", bodyMode: "scroll", tone: "warning", padding: "sm" },
      slots: {
        actions: "操作",
        default: "内容",
        footer: "底部",
      },
    });

    expect(wrapper.classes()).toContain("page-card--body-scroll");
    expect(wrapper.classes()).toContain("page-card--tone-warning");
    expect(wrapper.text()).toContain("操作");
    expect(wrapper.text()).toContain("底部");
  });

  it("uses fill DataState mode inside PageWorkspace", () => {
    const wrapper = mount(PageWorkspace, {
      props: { title: "工作区", bodyMode: "flow" },
      slots: {
        status: "状态",
        actions: "动作",
        default: "主体",
      },
    });

    expect(wrapper.find("h1").text()).toBe("工作区");
    expect(wrapper.find(".bz-data-state--fill").exists()).toBe(true);
    expect(wrapper.text()).toContain("主体");
  });
});
