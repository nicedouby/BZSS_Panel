import * as echarts from "echarts/core";
import {
  LineChart,
  HeatmapChart,
  GaugeChart,
  BarChart,
} from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { ComposeOption } from "echarts/core";
import type {
  LineSeriesOption,
  HeatmapSeriesOption,
  GaugeSeriesOption,
  BarSeriesOption,
} from "echarts/charts";
import type {
  TitleComponentOption,
  TooltipComponentOption,
  GridComponentOption,
  LegendComponentOption,
  VisualMapComponentOption,
  MarkLineComponentOption,
  MarkPointComponentOption,
  DataZoomComponentOption,
} from "echarts/components";

echarts.use([
  LineChart,
  HeatmapChart,
  GaugeChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export type EChartsOption = ComposeOption<
  | LineSeriesOption
  | HeatmapSeriesOption
  | GaugeSeriesOption
  | BarSeriesOption
  | TitleComponentOption
  | TooltipComponentOption
  | GridComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
  | MarkLineComponentOption
  | MarkPointComponentOption
  | DataZoomComponentOption
>;

export type { ECharts } from "echarts/core";
export { echarts };
export default echarts;
