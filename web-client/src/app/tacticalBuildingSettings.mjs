export function installBuildingSettings({ select, detailButton, invalidate, signal }) {
  const distances = [
    ["auto", "建筑距离：自动"], ["500", "建筑距离：500 米"],
    ["1000", "建筑距离：1 公里"], ["2000", "建筑距离：2 公里"], ["all", "建筑距离：全部"],
  ];
  for (const [value, label] of distances) select.add(new Option(label, value));
  select.setAttribute("aria-label", "建筑可见距离");
  select.title = "自动模式会在低空限制建筑距离，拉高视角时逐步扩大范围";
  select.addEventListener("change", invalidate, { signal });

  const modes = [["auto", "自动"], ["original", "原始"], ["performance", "性能"]];
  let mode = 0;
  detailButton.title = "切换建筑模型细节。性能模式较早使用低面数模型";
  detailButton.addEventListener("click", () => {
    mode = (mode + 1) % modes.length;
    detailButton.textContent = `细节：${modes[mode][1]}`;
    invalidate();
  }, { signal });

  return {
    get lod() { return modes[mode][0]; },
    range(camera, bounds) {
      if (select.value === "all") return Infinity;
      if (select.value !== "auto") return Number(select.value);
      if (!bounds || camera.position.y > bounds.max.y + 720) return Infinity;
      const midHeight = (bounds.min.y + bounds.max.y) / 2;
      return 900 + Math.max(0, camera.position.y - midHeight) * 3.4;
    },
  };
}
