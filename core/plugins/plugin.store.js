export const pluginCatalog = [
  {
    id: "raw-log-console",
    name: "\u539f\u751f\u65e5\u5fd7\u63a7\u5236\u53f0",
    description: "Receive, buffer, filter, and display raw Squad log lines.",
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
        label: "\u6700\u5927\u7f13\u5b58\u884c\u6570",
        type: "number",
        defaultValue: 3000,
      },
      {
        key: "blacklistRegex",
        label: "\u8fc7\u6ee4\u6b63\u5219",
        type: "textarea",
        defaultValue: "",
        description: "Matching log lines will be hidden or discarded.",
      },
    ],
    config: {
      maxBufferedLines: 3000,
      blacklistRegex: "",
    },
  },
  {
    id: "group-report",
    name: "\u62b1\u56e2\u62a5\u5907",
    description: "Manually maintained player group data source for persistence and event fan-out.",
    category: "Management",
    icon: "",
    enabled: true,
    subscribed: true,
    version: "1.0.0",
    author: "BZSS",
    status: "ok",
  },
];

