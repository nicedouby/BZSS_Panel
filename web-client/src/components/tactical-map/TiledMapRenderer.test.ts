import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function mountRenderer() {
  return mount(TiledMapRenderer, {
    props: {
      tileBasePath: "/tiles/map",
      maxZoom: 4,
      tilesEnabled: true,
      viewportWidth: 1280,
      viewportHeight: 720,
      fallbackImage: "/map.png",
    },
  });
}

describe("TiledMapRenderer", () => {
  beforeEach(() => {
    tileState.visibleTiles = ref( [
      { key: "primary-a", src: "/a.png", left: 0, top: 0, width: 50, height: 100 },
      { key: "primary-b", src: "/b.png", left: 50, top: 0, width: 50, height: 100 },
    ]);
    tileState.fallbackTiles = ref( [
      { key: "fallback-old", src: "/fallback-tile.png", left: 0, top: 0, width: 100, height: 100 },
    ]);
  });

  it("waits for every current primary tile instead of counting unrelated loaded keys", async () => {
    const wrapper = mountRenderer();
    const primaryTiles = wrapper.findAll("img.map-tile").filter((node) => !node.classes().includes("map-tile--fallback"));

    await primaryTiles[0].trigger("load");
    expect(wrapper.emitted("ready")).toBeUndefined();

    await primaryTiles[1].trigger("load");
    expect(wrapper.emitted("ready")).toHaveLength(1);
  });

  it("allows the full fallback image to make the renderer ready", async () => {
    const wrapper = mountRenderer();
    await wrapper.get("img.map-image-fallback").trigger("load");
    expect(wrapper.emitted("ready")).toHaveLength(1);
  });
});
