export const pluginCatalog = [
  {
    id: "raw-log-console",
    name: "原生日志控制台",
    description: "接收、缓存、过滤并显示 Squad 原生日志。",
    category: "Logs",
    icon: "",
    enabled: true,
    subscribed: true,
    version: "1.0.0",
    author: "BZSS",
    status: "ok",
    configSchema: [
      {
        key: "maxBufferedLines",
        label: "最大缓存行数",
        type: "number",
        defaultValue: 3000,
      },
      {
        key: "blacklistRegex",
        label: "过滤正则",
        type: "textarea",
        defaultValue: "",
        description: "匹配到的日志会被隐藏或丢弃。",
      },
    ],
    config: {
      maxBufferedLines: 3000,
      blacklistRegex: "",
    },
  },
];
