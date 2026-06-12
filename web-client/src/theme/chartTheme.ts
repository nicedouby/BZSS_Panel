export interface ChartThemeTokens {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipText: string;
  series: string[];
}

export function readChartThemeTokens(root: HTMLElement | null = null): ChartThemeTokens {
  const source = root ?? document.documentElement;
  const styles = getComputedStyle(source);
  const read = (name: string, fallback: string) => String(styles.getPropertyValue(name)).trim() || fallback;

  return {
    grid: read("--chart-grid", "rgba(148, 163, 184, 0.14)"),
    axis: read("--chart-axis", "#718096"),
    tooltipBg: read("--chart-tooltip-bg", "#161b22"),
    tooltipText: read("--chart-tooltip-text", "#f0f6fc"),
    series: [
      read("--chart-series-1", "#3b82f6"),
      read("--chart-series-2", "#f59e0b"),
      read("--chart-series-3", "#ef4444"),
      read("--chart-series-4", "#22d3ee"),
      read("--chart-series-5", "#c084fc"),
      read("--chart-series-6", "#34d399"),
    ],
  };
}
