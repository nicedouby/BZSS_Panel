import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import TacticalMapToolbar from "./TacticalMapToolbar.vue";

function mountToolbar(overrides: Record<string, unknown> = {}) {
  return mount(TacticalMapToolbar, {
    attachTo: document.body,
    props: {
      showGrid: true,
      showCaptureZones: true,
      showFobs: true,
      showPlayerNames: true,
      showPlayerCoords: false,
      filterAliveOnly: false,
      canEditCapturePoints: true,
      capturePointEditMode: false,
      capturePointCommandPending: false,
      measureMode: false,
      hasMeasurePoints: false,
      hasCombatHotspot: false,
      ...overrides,
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TacticalMapToolbar", () => {
  it("opens every panel and switches without relying on the map page", async () => {
    const wrapper = mountToolbar();
    const tabs = wrapper.findAll(".tactical-map-toolbar__tab");

    await tabs[0].trigger("click");
    expect(wrapper.text()).toContain("仅存活");

    await tabs[1].trigger("click");
    expect(wrapper.text()).toContain("改点");
    expect(wrapper.text()).toContain("测距");

    await tabs[2].trigger("click");
    expect(wrapper.text()).toContain("滚轮");
    wrapper.unmount();
  });

  it("emits layer and tool actions", async () => {
    const wrapper = mountToolbar();
    const tabs = wrapper.findAll(".tactical-map-toolbar__tab");

    await tabs[0].trigger("click");
    await wrapper.findAll(".tactical-map-toolbar__action")[0].trigger("click");
    expect(wrapper.emitted("update:showGrid")).toEqual([[false]]);

    await tabs[1].trigger("click");
    await wrapper.findAll(".tactical-map-toolbar__action")[0].trigger("click");
    expect(wrapper.emitted("toggle-capture-point-edit")).toHaveLength(1);
    wrapper.unmount();
  });

  it("closes on outside pointer input", async () => {
    const wrapper = mountToolbar();
    await wrapper.findAll(".tactical-map-toolbar__tab")[0].trigger("click");
    expect(wrapper.find(".tactical-map-toolbar__panel").exists()).toBe(true);

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".tactical-map-toolbar__panel").exists()).toBe(false);
    wrapper.unmount();
  });
});
