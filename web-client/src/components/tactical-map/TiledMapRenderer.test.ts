import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TiledMapRenderer from "./TiledMapRenderer.vue";

const tileState = vi.hoisted(() => ({
  visibleTiles: null as any,
  fallbackTiles: null as any,
}));

vi.mock("../../composables/useTileLoader", () => ({
  useTileLoader: () => ({
    visibleTiles: tileState.visibleTiles,
    fallbackTiles: tileState.fallbackTiles,
    currentTileZoom: { value: 1 },
  }),
}));

vi.mock("../../composables/tacticalMapViewport", () => ({
  useTacticalMapViewport: () => ({
    zoom: { value: 1 },
    panX: { value: 0 },
    panY: { value: 0 },
  }),
}));

function tiles(prefix: string) {
  return [
    { key: `${prefix}-a`, src: `/${prefix}-a.png`, left: 0, top: 0, width: 50, height: 100 },
    { key: `${prefix}-b`, src: `/${prefix}-b.png`, left: 50, top: 0, width: 50, height: 100 },
  ];
}

function mountRenderer(fallbackImage = "") {
  return mount(TiledMapRenderer, {
    props: {
      tileBasePath: "/tiles/map",
      maxZoom: 4,
      tilesEnabled: true,
      viewportWidth: 1280,
      viewportHeight: 720,
      fallbackImage,
    },
  });
}

async function activate() {
  await vi.advanceTimersByTimeAsync(120);
  await nextTick();
}

describe("TiledMapRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tileState.visibleTiles = ref(tiles("primary"));
    tileState.fallbackTiles = ref([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a candidate layer invisible until every tile has decoded", async () => {
    const wrapper = mountRenderer();
    await activate();

    const pending = wrapper.findAll("img.map-tile--pending");
    expect(pending).toHaveLength(2);
    await pending[0].trigger("load");
    expect(wrapper.findAll("img.map-tile--pending")).toHaveLength(2);

    await pending[1].trigger("load");
    expect(wrapper.findAll("img.map-tile--pending")).toHaveLength(0);
    expect(wrapper.findAll("img.map-tile")).toHaveLength(2);
    expect(wrapper.emitted("ready")).toHaveLength(1);
  });

  it("keeps the prior decoded layer visible while a newer viewport loads", async () => {
    const wrapper = mountRenderer();
    await activate();
    for (const image of wrapper.findAll("img.map-tile--pending")) await image.trigger("load");

    tileState.visibleTiles.value = tiles("next");
    await nextTick();
    expect(wrapper.findAll("img.map-tile:not(.map-tile--pending)")).toHaveLength(2);
    expect(wrapper.findAll("img.map-tile--pending")).toHaveLength(2);

    for (const image of wrapper.findAll("img.map-tile--pending")) await image.trigger("load");
    expect(wrapper.findAll("img.map-tile:not(.map-tile--pending)")).toHaveLength(2);
    expect(wrapper.html()).toContain("/next-a.png");
    expect(wrapper.html()).not.toContain("/primary-a.png");
  });

  it("allows the full fallback image to make the renderer ready", async () => {
    const wrapper = mountRenderer("/map.png");
    await activate();
    await wrapper.get("img.map-image-fallback").trigger("load");
    expect(wrapper.emitted("ready")).toHaveLength(1);
  });
});
