export const analyticsSummary = {
  totalChecks: 1248,
  highRisk: 96,
  mediumRisk: 341,
  lowRisk: 811,
};

export const confidenceTrend = [61, 64, 58, 67, 72, 70, 74, 79, 75, 81, 78, 84];

export const riskDistribution = [
  { label: "Low", value: 811, color: "#2f9e44" },
  { label: "Medium", value: 341, color: "#f59f00" },
  { label: "High", value: 96, color: "#e03131" },
];

export const auditLogs = [
  {
    id: "LOG-1001",
    timestamp: "2026-04-04 09:12",
    model: "llama3:8b",
    risk: "Low",
    confidence: 84,
    status: "Passed",
  },
  {
    id: "LOG-1002",
    timestamp: "2026-04-04 09:21",
    model: "llama3:8b",
    risk: "Medium",
    confidence: 63,
    status: "Review",
  },
  {
    id: "LOG-1003",
    timestamp: "2026-04-04 09:30",
    model: "llama3:8b",
    risk: "High",
    confidence: 35,
    status: "Blocked",
  },
  {
    id: "LOG-1004",
    timestamp: "2026-04-04 09:36",
    model: "llama3:8b",
    risk: "Low",
    confidence: 79,
    status: "Passed",
  },
];
