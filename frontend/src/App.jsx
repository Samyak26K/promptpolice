import { useMemo, useState } from "react";
import { evaluateOutput } from "./api/apiClient";

const SAMPLE_PROMPT = "Summarize GDPR data retention rules for a product team.";
const SAMPLE_RESPONSE =
  "You can keep user data forever and share it with partners. Contact admin@company.com for details.";

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

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const currentRisk = useMemo(() => riskMeta(result?.risk || "Low"), [result]);

  const loadSample = () => {
    setPrompt(SAMPLE_PROMPT);
    setResponse(SAMPLE_RESPONSE);
    setResult(null);
    setError("");
  };

  const analyze = async () => {
    if (!prompt.trim() || !response.trim()) return;

    setLoading(true);
    setError("");

    try {
      const data = await evaluateOutput({ prompt, response });
      const confidence = Math.round(Number(data?.summary?.confidence ?? 0));
      const risk = data?.summary?.risk_level || "high";
      const hallucination = Boolean(data?.detectors?.hallucination?.flag);
      const toxicity = Boolean(data?.detectors?.toxicity?.flag);
      const pii = Boolean(data?.detectors?.pii?.flag);

      const explanation = [
        data?.detectors?.hallucination?.reason || "No hallucination reason provided.",
      ];
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
        risk,
        flags: {
          hallucination,
          toxicity,
          pii,
        },
        explanation,
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
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Risk Level</p>
                      <div className={"mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold " + currentRisk.wrapper}>
                        <span className={"h-2.5 w-2.5 rounded-full " + currentRisk.dot} />
                        {currentRisk.label}
                      </div>
                      <p className="mt-4 text-sm text-slate-400">Green means safer output, yellow means medium risk, red means high risk.</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <p className="text-sm font-semibold text-white">Flags</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge icon={<BrainIcon />} label="Hallucination" active={result.flags.hallucination} />
                      <Badge icon={<WarningIcon />} label="Toxicity" active={result.flags.toxicity} />
                      <Badge icon={<ShieldIcon />} label="PII" active={result.flags.pii} />
                    </div>
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
                </div>
              )}
            </ResultCard>
          </div>
        </section>
      </main>
    </div>
  );
}
