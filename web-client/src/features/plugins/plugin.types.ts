export type PluginConfigFieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "textarea";

export interface PluginConfigOption {
  label: string;
  value: string | number | boolean;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: PluginConfigFieldType;
  defaultValue?: unknown;
  required?: boolean;
  description?: string;
  options?: PluginConfigOption[];
}

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  enabled: boolean;
  subscribed: boolean;
  version?: string;
  author?: string;
  status?: "ok" | "warning" | "error" | "disabled";
  configSchema?: PluginConfigField[];
  config?: Record<string, unknown>;
}
