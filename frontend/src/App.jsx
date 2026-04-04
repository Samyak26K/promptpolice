import { useState } from "react";
import { analyticsSummary, auditLogs, confidenceTrend, riskDistribution } from "./data/mockData";

function Card({ title, children }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MiniLineChart({ values }) {
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * 100;
      const y = 100 - (v / max) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="line-chart">
        <polyline points={points} />
      </svg>
    </div>
  );
}

function RiskBars({ items }) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;

  return (
    <div className="bars">
      {items.map((item) => {
        const width = (item.value / total) * 100;
        return (
          <div key={item.label} className="bar-row">
            <span>{item.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%`, background: item.color }} />
            </div>
            <strong>{item.value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function LiveAnalysisPage() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

  async function runAnalysis() {
    if (!prompt.trim() || !response.trim()) {
      setError("Prompt and response are required.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const res = await fetch(`${apiBaseUrl}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          response,
        }),
      });

      if (!res.ok) {
        throw new Error(`Request failed (${res.status}).`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Unexpected error while calling /analyze.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid two-col">
      <Card title="Analyze Response">
        <label>Prompt</label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
        <label>Response</label>
        <textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={6} />
        <button type="button" onClick={runAnalysis} disabled={isLoading}>
          {isLoading ? "Running..." : "Run Analysis"}
        </button>
        {error ? <p className="muted">{error}</p> : null}
      </Card>

      <Card title="Live Result">
        {result ? (
          <div className="result">
            <p><strong>Confidence:</strong> {result.confidence}</p>
            <p><strong>Risk:</strong> {result.risk}</p>
            <p><strong>Hallucination:</strong> {result.hallucination?.conclusion}</p>
            <p><strong>Toxicity:</strong> {result.toxicity?.verdict}</p>
            <p><strong>PII Found:</strong> {result.pii?.pii_found ? "Yes" : "No"}</p>
            <p>{result.explanation}</p>
          </div>
        ) : (
          <p className="muted">Enter prompt and response, then click Run Analysis.</p>
        )}
      </Card>
    </div>
  );
}

function AnalyticsPage() {
  return (
    <div className="grid two-col">
      <Card title="Overview">
        <div className="stats">
          <div><span>Total Checks</span><strong>{analyticsSummary.totalChecks}</strong></div>
          <div><span>Low Risk</span><strong>{analyticsSummary.lowRisk}</strong></div>
          <div><span>Medium Risk</span><strong>{analyticsSummary.mediumRisk}</strong></div>
          <div><span>High Risk</span><strong>{analyticsSummary.highRisk}</strong></div>
        </div>
      </Card>

      <Card title="Confidence Trend">
        <MiniLineChart values={confidenceTrend} />
      </Card>

      <Card title="Risk Distribution">
        <RiskBars items={riskDistribution} />
      </Card>
    </div>
  );
}

function LogsPage() {
  return (
    <Card title="Evaluation Logs">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Log ID</th>
              <th>Time</th>
              <th>Model</th>
              <th>Risk</th>
              <th>Confidence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.timestamp}</td>
                <td>{row.model}</td>
                <td>{row.risk}</td>
                <td>{row.confidence}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function App() {
  const [page, setPage] = useState("live");

  return (
    <div className="app-shell">
      <header>
        <h1>AI Evaluation Dashboard</h1>
        <nav>
          <button className={page === "live" ? "active" : ""} onClick={() => setPage("live")}>Live Analysis</button>
          <button className={page === "analytics" ? "active" : ""} onClick={() => setPage("analytics")}>Analytics</button>
          <button className={page === "logs" ? "active" : ""} onClick={() => setPage("logs")}>Logs</button>
        </nav>
      </header>

      <main>
        {page === "live" && <LiveAnalysisPage />}
        {page === "analytics" && <AnalyticsPage />}
        {page === "logs" && <LogsPage />}
      </main>
    </div>
  );
}
