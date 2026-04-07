import { useEffect, useMemo, useState } from "react";
import { evaluateOutput } from "./api/apiClient";

const SAMPLE_PROMPT = "Summarize GDPR data retention rules for a product team.";
const SAMPLE_RESPONSE =
  "You can keep user data forever and share it with partners. Contact admin@company.com for details.";
const AUDIT_LOG_KEY = "safenet_audit_logs";
const AUDIT_LOG_PARAM = "safenetAuditLogs";
const TRANSFER_PAYLOAD_PARAM = "safenetPayload";
const TRANSFER_HASH_KEY = "safenetTransfer";
const POLICIES_KEY = "safenet_policies";

function riskMeta(risk) {
  const normalizedRisk = String(risk || "").toLowerCase();

  if (normalizedRisk === "low") {
    return {
      label: "Low",
      wrapper: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      dot: "bg-emerald-400",
      bar: "bg-emerald-400",
    };
  }

  if (normalizedRisk === "medium") {
    return {
      label: "Medium",
      wrapper: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      dot: "bg-amber-400",
      bar: "bg-amber-400",
    };
  }

  return {
    label: "High",
    wrapper: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    dot: "bg-rose-400",
    bar: "bg-rose-400",
  };
}

function factStatusMeta(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "verified") {
    return { label: "Verified", classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (normalized === "partially_verified") {
    return { label: "Partially Verified", classes: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  }
  if (normalized === "contradictory") {
    return { label: "Contradictory", classes: "border-rose-500/40 bg-rose-500/10 text-rose-300" };
  }
  return { label: "Unverified", classes: "border-slate-500/30 bg-slate-500/20 text-slate-200" };
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M9 7a3 3 0 0 1 6 0 3 3 0 0 1 2 5.24A3.5 3.5 0 0 1 14 18h-4a3.5 3.5 0 0 1-3-5.76A3 3 0 0 1 9 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path d="M12 3 22 20H2L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 3 19 6v6c0 4.2-2.7 7.4-7 9-4.3-1.6-7-4.8-7-9V6l7-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9.5 12 1.8 1.8L14.8 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Badge({ icon, label, active }) {
  return (
    <span
      className={
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold " +
        (active
          ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300")
      }
    >
      {icon}
      <span>
        {label}: {active ? "Flagged" : "Clear"}
      </span>
    </span>
  );
}

function ResultCard({ title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur">
      <p className="text-sm font-semibold tracking-wide text-slate-200">{title}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function detectJailbreak(promptText, responseText) {
  const text = `${String(promptText || "")}\n${String(responseText || "")}`.toLowerCase();
  const rules = [
    { pattern: /ignore\s+previous\s+instructions?/i, reason: "Matched pattern: ignore previous instructions" },
    { pattern: /\bbypass\b/i, reason: "Matched pattern: bypass" },
    { pattern: /\bact\s+as\b/i, reason: "Matched pattern: act as" },
    { pattern: /\bjailbreak\b/i, reason: "Matched pattern: jailbreak" },
    { pattern: /\bdo\s+anything\s+now\b/i, reason: "Matched pattern: do anything now" },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      return { detected: true, reason: rule.reason };
    }
  }

  return { detected: false, reason: "No known jailbreak patterns matched." };
}

function readTransferBundleFromHash() {
  try {
    const rawHash = String(window.location.hash || "").replace(/^#/, "");
    if (!rawHash) {
      return null;
    }

    const hashParams = new URLSearchParams(rawHash);
    const encoded = hashParams.get(TRANSFER_HASH_KEY);
    if (!encoded) {
      return null;
    }

    const parsed = JSON.parse(decodeURIComponent(encoded));
    const payload = parsed?.payload || null;
    const logs = Array.isArray(parsed?.logs) ? parsed.logs : [];

    return { payload, logs };
  } catch {
    return null;
  }
}

function readExtensionTransferPayload() {
  const hashTransfer = readTransferBundleFromHash();
  if (hashTransfer?.payload) {
    const prompt = String(hashTransfer.payload?.prompt || "").trim();
    const response = String(hashTransfer.payload?.response || "").trim();
    const timestamp = Number(hashTransfer.payload?.timestamp || Date.now());

    if (!prompt && !response) {
      return null;
    }

    return { prompt, response, timestamp };
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const payloadText = params.get(TRANSFER_PAYLOAD_PARAM);
    if (!payloadText) {
      return null;
    }

    const payload = JSON.parse(payloadText);
    const prompt = String(payload?.prompt || "").trim();
    const response = String(payload?.response || "").trim();
    const timestamp = Number(payload?.timestamp || Date.now());

    if (!prompt && !response) {
      return null;
    }

    return { prompt, response, timestamp };
  } catch {
    return null;
  }
}

function readAuditLogsFromUrl() {
  const hashTransfer = readTransferBundleFromHash();
  if (Array.isArray(hashTransfer?.logs) && hashTransfer.logs.length) {
    return hashTransfer.logs;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const logsText = params.get(AUDIT_LOG_PARAM);
    if (!logsText) {
      return [];
    }

    const logs = JSON.parse(logsText);
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function clearTransferParams() {
  const params = new URLSearchParams(window.location.search);
  params.delete(TRANSFER_PAYLOAD_PARAM);
  params.delete(AUDIT_LOG_PARAM);

  const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  hashParams.delete(TRANSFER_HASH_KEY);

  const nextSearch = params.toString();
  const nextHash = hashParams.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function getRiskFromLogResult(result) {
  return String(result?.summary?.risk_level || result?.risk || "unknown").toLowerCase();
}

function formatLogTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) {
    return "Unknown time";
  }
  return new Date(value).toLocaleString();
}

function loadAuditLogs() {
  try {
    const logs = JSON.parse(window.localStorage.getItem(AUDIT_LOG_KEY) || "[]");
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function clearAuditLogs() {
  try {
    window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify([]));
    return true;
  } catch {
    return false;
  }
}

function loadPolicies() {
  try {
    const items = JSON.parse(window.localStorage.getItem(POLICIES_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function savePolicies(policies) {
  try {
    window.localStorage.setItem(POLICIES_KEY, JSON.stringify(policies));
    return true;
  } catch {
    return false;
  }
}

function matchRule(rule, text) {
  if (!rule) {
    return false;
  }

  try {
    return new RegExp(rule, "i").test(text);
  } catch {
    return text.toLowerCase().includes(String(rule).toLowerCase());
  }
}

function evaluateLocalPolicies(promptText, responseText, policies) {
  const text = `${String(promptText || "")}\n${String(responseText || "")}`;
  const results = [];

  for (const policy of policies || []) {
    const rules = Array.isArray(policy?.rules) ? policy.rules : [];
    const normalizedRules = rules.map((item) => (typeof item === "string" ? item : item?.pattern)).filter(Boolean);
    const matchedRule = normalizedRules.find((rule) => matchRule(rule, text));
    results.push({
      name: String(policy?.name || "Unnamed policy"),
      detected: Boolean(matchedRule),
      action: String(policy?.action || "flag"),
      reason: matchedRule ? `Matched rule: ${matchedRule}` : "No rule matched",
    });
  }

  return results;
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    name: "",
    category: "pii",
    rules: "",
    action: "flag",
  });

  const currentRisk = useMemo(() => riskMeta(result?.risk || "Low"), [result]);
  const currentFactStatus = useMemo(() => factStatusMeta(result?.factCheck?.status || "unverified"), [result]);
  const relevanceNote = result?.alignmentNote || "";

  useEffect(() => {
    const transferredLogs = readAuditLogsFromUrl();
    if (transferredLogs.length) {
      const sorted = [...transferredLogs].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
      setAuditLogs(sorted);
      try {
        window.localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(sorted));
      } catch {
        // Ignore localStorage write failures.
      }
    } else {
      const storedLogs = loadAuditLogs();
      const sortedStoredLogs = [...storedLogs].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
      setAuditLogs(sortedStoredLogs);
    }

    const transferredPayload = readExtensionTransferPayload();
    if (!transferredPayload) {
      clearTransferParams();
      setPolicies(loadPolicies());
      return;
    }

    setPrompt(transferredPayload.prompt);
    setResponse(transferredPayload.response);
    setResult(null);
    setError("");
    clearTransferParams();
    setPolicies(loadPolicies());
  }, []);

  const loadSample = () => {
    setPrompt(SAMPLE_PROMPT);
    setResponse(SAMPLE_RESPONSE);
    setResult(null);
    setError("");
  };

  const analyze = async () => {
    if (!prompt.trim() || !response.trim()) return;

    const localPolicyResults = evaluateLocalPolicies(prompt, response, policies);
    const blockingPolicy = localPolicyResults.find((item) => item.detected && item.action === "block");
    if (blockingPolicy) {
      setError(`Blocked by policy: ${blockingPolicy.name}. ${blockingPolicy.reason}`);
      setResult((prev) => ({ ...(prev || {}), policyResults: localPolicyResults }));
      return;
    }

    const warningPolicy = localPolicyResults.find((item) => item.detected && item.action === "warn");
    if (warningPolicy) {
      const shouldContinue = window.confirm(
        `Policy warning: ${warningPolicy.name}. ${warningPolicy.reason}. Continue analysis?`
      );
      if (!shouldContinue) {
        setError(`Analysis cancelled due to warning policy: ${warningPolicy.name}`);
        setResult((prev) => ({ ...(prev || {}), policyResults: localPolicyResults }));
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      const policyPayload = policies.map((policy) => {
        const ruleItems = Array.isArray(policy?.rules)
          ? policy.rules
          : String(policy?.rules || "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);

        const normalizedRules = ruleItems.map((item) => (typeof item === "string" ? item : item?.pattern)).filter(Boolean);

        return {
          name: String(policy?.name || "Unnamed policy"),
          category: String(policy?.category || "custom"),
          rules: normalizedRules,
          action: String(policy?.action || "flag"),
        };
      });

      const data = await evaluateOutput({ prompt, response, policies: policyPayload });
      const confidence = Math.round(Number(data?.summary?.confidence ?? 0));
      const relevanceScore = Number(data?.relevance_score ?? 0);
      const risk = data?.summary?.risk_level || "high";
      const hallucination = Boolean(data?.detectors?.hallucination?.flag);
      const toxicity = Boolean(data?.detectors?.toxicity?.flag);
      const pii = Boolean(data?.detectors?.pii?.flag);
      const rawFactCheck = data?.detectors?.fact_check || {};
      const factMode = String(rawFactCheck?.mode || "standard");
      const isReferenceOnly = factMode === "reference_only";
      const factScore = isReferenceOnly
        ? null
        : Number(rawFactCheck?.score ?? 0.5);
      const factStatus = String(rawFactCheck?.status || "unverified");
      const factClaims = Array.isArray(rawFactCheck?.claims)
        ? rawFactCheck.claims
        : [];
      const factReferences = Array.isArray(rawFactCheck?.references)
        ? rawFactCheck.references
        : [];
      const factMessage = String(rawFactCheck?.message || "No verifiable facts detected. Here are some relevant sources you can explore:");
      const alignmentNote = String(data?.alignment_note || (relevanceScore < 0.4 ? "This response has low alignment with the user query" : ""));
      const jailbreak = detectJailbreak(prompt, response);

      const explanation = [
        "Confidence score reflects safety and reliability, while relevance score reflects alignment with the user query.",
        data?.detectors?.hallucination?.reason || "No hallucination reason provided.",
      ];
      if (alignmentNote) {
        explanation.push(alignmentNote);
      }
      if (Array.isArray(data?.detectors?.toxicity?.categories) && data.detectors.toxicity.categories.length > 0) {
        explanation.push(`Toxicity categories: ${data.detectors.toxicity.categories.join(", ")}`);
      }
      if (pii) {
        const piiCount = Number(data?.detectors?.pii?.count ?? 0);
        const piiCategories = Array.isArray(data?.detectors?.pii?.categories)
          ? data.detectors.pii.categories.join(", ")
          : "unknown";
        explanation.push(`PII detected (${piiCount}): ${piiCategories}`);
      }

      setResult({
        confidence,
        relevanceScore: Math.round(relevanceScore * 100),
        risk,
        factCheck: {
          score: factScore === null ? null : Math.round(factScore * 100),
          status: factStatus,
          mode: factMode,
          references: factReferences,
          message: factMessage,
          claims: factClaims,
        },
        alignmentNote,
        flags: {
          hallucination,
          toxicity,
          pii,
        },
        jailbreak,
        explanation,
        policyResults: Array.isArray(data?.policy_results) ? data.policy_results : localPolicyResults,
      });
    } catch (requestError) {
      setResult(null);
      const message = requestError?.message || "Backend request failed";
      const code = requestError?.code ? ` (${requestError.code})` : "";
      setError(`${message}${code}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    const cleared = clearAuditLogs();
    if (cleared) {
      setAuditLogs([]);
    }
  };

  const handleAddPolicy = () => {
    const name = String(policyForm.name || "").trim();
    if (!name) {
      return;
    }

    const parsedRules = String(policyForm.rules || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const nextPolicy = {
      id: `${Date.now()}`,
      name,
      category: policyForm.category,
      action: policyForm.action,
      rules: parsedRules,
    };

    const nextPolicies = [...policies, nextPolicy];
    if (savePolicies(nextPolicies)) {
      setPolicies(nextPolicies);
      setPolicyForm({ name: "", category: "pii", rules: "", action: "flag" });
      setShowPolicyForm(false);
    }
  };

  const handleDeletePolicy = (id) => {
    const nextPolicies = policies.filter((item) => item.id !== id);
    if (savePolicies(nextPolicies)) {
      setPolicies(nextPolicies);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_20%),linear-gradient(180deg,#020617_0%,#0f172a_100%)]" />

      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="mb-4 inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
            Live AI Evaluation (Connected to Backend)
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
            AI Output Risk & Hallucination Detector
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
            Analyze AI responses for safety, accuracy, and compliance.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Input</h2>
                <p className="mt-1 text-sm text-slate-400">Enter the prompt and the AI-generated response you want to inspect.</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="prompt" className="mb-2 block text-sm font-medium text-slate-200">
                  User Prompt
                </label>
                <textarea
                  id="prompt"
                  rows={5}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: Summarize GDPR data retention rules for a product team."
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
                />
              </div>

              <div>
                <label htmlFor="response" className="mb-2 block text-sm font-medium text-slate-200">
                  AI Response
                </label>
                <textarea
                  id="response"
                  rows={8}
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder="Example: You can keep user data forever and share it with partners. Contact admin@company.com."
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50"
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  onClick={analyze}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/20 border-t-slate-950" />}
                  {loading ? "Analyzing..." : "Analyze Response"}
                </button>

                <button
                  type="button"
                  onClick={loadSample}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Load Sample
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <ResultCard title="Results">
              {error ? (
                <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}

              {!result ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/60 p-5 text-sm text-slate-400">
                  Run an analysis to see confidence, risk level, and flags.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Confidence Score</p>
                      <div className="mt-3 flex items-end gap-2">
                        <span className="text-4xl font-bold text-white">{result.confidence}%</span>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className={"h-full rounded-full " + currentRisk.bar} style={{ width: String(result.confidence) + "%" }} />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Relevance Score</p>
                      <div className="mt-3 flex items-end gap-2">
                        <span className="text-4xl font-bold text-white">{result.relevanceScore}%</span>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-cyan-400" style={{ width: String(result.relevanceScore) + "%" }} />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Risk Level</p>
                      <div className={"mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold " + currentRisk.wrapper}>
                        <span className={"h-2.5 w-2.5 rounded-full " + currentRisk.dot} />
                        {currentRisk.label}
                      </div>
                      <p className="mt-4 text-sm text-slate-400">Green means safer output, yellow means medium risk, red means high risk.</p>
                    </div>
                  </div>

                  {relevanceNote ? (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                      {relevanceNote}
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold text-white">Flags</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge icon={<BrainIcon />} label="Hallucination" active={result.flags.hallucination} />
                      <Badge icon={<WarningIcon />} label="Toxicity" active={result.flags.toxicity} />
                      <Badge icon={<ShieldIcon />} label="PII" active={result.flags.pii} />
                    </div>
                  </div>

                  <div className={"rounded-2xl border p-4 " + (result.jailbreak?.detected ? "border-rose-500/30 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/10")}>
                    <p className="text-sm font-semibold text-white">Jailbreak Detection</p>
                    <p className={"mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold " + (result.jailbreak?.detected ? "border-rose-500/40 text-rose-300" : "border-emerald-500/40 text-emerald-300")}>
                      {result.jailbreak?.detected ? "Jailbreak Detected" : "Safe"}
                    </p>
                    <p className="mt-2 text-sm text-slate-300">{result.jailbreak?.reason || "No known jailbreak patterns matched."}</p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold text-white">Policy Compliance</p>
                    {!Array.isArray(result.policyResults) || result.policyResults.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-400">No policies evaluated.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {result.policyResults.map((policyItem) => {
                          const isDetected = Boolean(policyItem?.detected);
                          const action = String(policyItem?.action || "flag").toLowerCase();
                          const actionClasses =
                            action === "block"
                              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                              : action === "warn"
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                : "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";

                          return (
                            <div key={`${policyItem?.name || "policy"}-${action}`} className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={"inline-flex rounded-full border px-2 py-1 text-xs font-semibold " + (isDetected ? "border-rose-500/40 text-rose-300" : "border-emerald-500/40 text-emerald-300")}>
                                  {isDetected ? "Violated" : "Safe"}
                                </span>
                                <span className="text-sm font-semibold text-slate-100">{policyItem?.name || "Unnamed policy"}</span>
                                <span className={"inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase " + actionClasses}>
                                  {action}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-slate-400">{policyItem?.reason || "No reason provided"}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold text-white">Explainability</p>
                    <p className="mt-1 text-sm text-slate-400">Why this was flagged</p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
                      {result.explanation.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">Fact Check</p>
                      <span className={"inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold " + currentFactStatus.classes}>
                        {currentFactStatus.label}
                      </span>
                    </div>

                    {result.factCheck?.mode === "reference_only" ? (
                      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-4">
                        <p className="text-sm font-semibold text-white">No verifiable facts found</p>
                        <p className="mt-2 text-sm text-slate-300">
                          {result.factCheck?.message || "No verifiable facts detected. Here are some relevant sources you can explore:"}
                        </p>

                        {Array.isArray(result.factCheck?.references) && result.factCheck.references.length > 0 ? (
                          <div className="mt-4">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Related References</p>
                            <div className="mt-2 space-y-1">
                              {result.factCheck.references.map((source) => (
                                <a
                                  key={source.url}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block text-sm text-cyan-300 underline decoration-cyan-500/50 underline-offset-2 hover:text-cyan-200"
                                >
                                  [{source.source}] {source.title}
                                </a>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate-400">No related references are available right now.</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Fact Score</p>
                          <p className="mt-1 text-2xl font-bold text-white">{result.factCheck?.score ?? 0}%</p>
                        </div>

                        {result.factCheck?.claims?.length ? (
                          <div className="mt-4 space-y-3">
                            {result.factCheck.claims.map((item, idx) => (
                              <div key={String(item?.claim || idx)} className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                                <p className="text-sm font-semibold text-slate-100">Claim {idx + 1}</p>
                                <p className="mt-1 text-sm text-slate-300">{item.claim}</p>

                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                  <span className="rounded-full border border-white/10 px-2 py-1 text-slate-200">
                                    Verdict: {item.verdict}
                                  </span>
                                  <span className="rounded-full border border-white/10 px-2 py-1 text-slate-200">
                                    Confidence: {Math.round(Number(item.confidence || 0) * 100)}%
                                  </span>
                                </div>

                                <p className="mt-2 text-xs text-slate-400">{item.explanation}</p>

                                {Array.isArray(item.sources) && item.sources.length > 0 ? (
                                  <div className="mt-3 space-y-1">
                                    {item.sources.map((source) => (
                                      <a
                                        key={source.url}
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block text-xs text-cyan-300 underline decoration-cyan-500/50 underline-offset-2 hover:text-cyan-200"
                                      >
                                        [{source.source}] {source.title}
                                      </a>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate-400">No verifiable claims were extracted.</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </ResultCard>

            <ResultCard title="Audit Log">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-400">Recent analyzed conversations (latest first)</p>
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  Clear Logs
                </button>
              </div>

              {!auditLogs.length ? (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-900/60 p-4 text-sm text-slate-400">
                  No audit logs available.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {auditLogs.map((log, index) => {
                    const promptPreview = String(log?.prompt || "").slice(0, 120) || "(No prompt)";
                    const risk = getRiskFromLogResult(log?.result);

                    return (
                      <div key={`${log?.timestamp || 0}-${index}`} className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                        <p className="text-xs text-slate-400">{formatLogTime(log?.timestamp)} {log?.platform ? `· ${log.platform}` : ""}</p>
                        <p className="mt-1 text-sm text-slate-100">{promptPreview}{String(log?.prompt || "").length > 120 ? "..." : ""}</p>
                        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-cyan-300">Risk: {risk}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </ResultCard>

            <ResultCard title="Enterprise Policies">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-400">Define custom policy rules and actions</p>
                <button
                  type="button"
                  onClick={() => setShowPolicyForm((current) => !current)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  {showPolicyForm ? "Cancel" : "Add Policy"}
                </button>
              </div>

              {showPolicyForm ? (
                <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-slate-900/60 p-3">
                  <input
                    type="text"
                    value={policyForm.name}
                    onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Policy name"
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select
                      value={policyForm.category}
                      onChange={(event) => setPolicyForm((current) => ({ ...current, category: event.target.value }))}
                      className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
                    >
                      <option value="pii">pii</option>
                      <option value="medical">medical</option>
                      <option value="financial">financial</option>
                      <option value="custom">custom</option>
                    </select>
                    <select
                      value={policyForm.action}
                      onChange={(event) => setPolicyForm((current) => ({ ...current, action: event.target.value }))}
                      className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
                    >
                      <option value="flag">flag</option>
                      <option value="warn">warn</option>
                      <option value="block">block</option>
                    </select>
                  </div>
                  <textarea
                    rows={3}
                    value={policyForm.rules}
                    onChange={(event) => setPolicyForm((current) => ({ ...current, rules: event.target.value }))}
                    placeholder="Comma-separated rules (regex or plain text)"
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/50"
                  />
                  <button
                    type="button"
                    onClick={handleAddPolicy}
                    className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                  >
                    Save Policy
                  </button>
                </div>
              ) : null}

              {!policies.length ? (
                <p className="mt-4 text-sm text-slate-400">No custom policies saved yet.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {policies.map((policy) => (
                    <div key={policy.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-100">{policy.name}</p>
                        <button
                          type="button"
                          onClick={() => handleDeletePolicy(policy.id)}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                        >
                          Delete
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {policy.category} · {policy.action}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Rules: {Array.isArray(policy.rules) ? policy.rules.join(", ") : "-"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </ResultCard>
          </div>
        </section>
      </main>
    </div>
  );
}
