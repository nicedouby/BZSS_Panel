import type { UiTheme } from "../stores/ui.store";

export interface UiThemeOption {
  id: UiTheme;
  label: string;
  description: string;
  colorScheme: "dark" | "light";
  previewClass: string;
}

export const UI_THEME_OPTIONS: readonly UiThemeOption[] = [
  {
    id: "default",
    label: "默认",
    description: "当前深色战术控制台",
    colorScheme: "dark",
    previewClass: "theme-preview-default",
  },
  {
    id: "daylight",
    label: "白天",
    description: "明亮、清晰的浅色界面",
    colorScheme: "light",
    previewClass: "theme-preview-daylight",
  },
  {
    id: "colorful",
    label: "彩色",
    description: "多彩环境光与高对比强调色",
    colorScheme: "dark",
    previewClass: "theme-preview-colorful",
  },
  {
    id: "green",
    label: "绿色",
    description: "深绿色战术终端风格",
    colorScheme: "dark",
    previewClass: "theme-preview-green",
  },
] as const;
