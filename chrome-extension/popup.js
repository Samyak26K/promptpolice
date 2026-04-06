const state = {
  currentPrompt: "",
  currentResponse: "",
  loading: false,
  result: null,
  error: null,
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatRisk(riskLevel) {
  const level = String(riskLevel || "waiting").toLowerCase();
  if (level === "low") {
    return { label: "Low", className: "risk-low" };
  }
  if (level === "medium") {
    return { label: "Medium", className: "risk-medium" };
  }
  if (level === "high") {
    return { label: "High", className: "risk-high" };
  }
  return { label: "Waiting", className: "risk-waiting" };
}

function setText(id, value) {
  const element = elements[id];
  if (element) {
    element.textContent = value;
  }
}

function setTextarea(id, value) {
  const element = elements[id];
  if (element) {
    element.value = value || "";
  }
}

function setChip(id, label, active, tone) {
  const element = elements[id];
  if (!element) {
    return;
  }

  element.textContent = `${label}: ${active ? "Flagged" : "Clear"}`;
  element.className = `flag-chip ${active ? tone : ""}`.trim();
}

function updateError(error) {
  state.error = error || null;
  const errorPanel = elements.errorPanel;
  if (!errorPanel) {
    return;
  }

  if (state.error) {
    errorPanel.classList.remove("hidden");
    elements.errorText.textContent = `${state.error.code || "REQUEST_FAILED"}: ${state.error.message || "Unknown error"}`;
  } else {
    errorPanel.classList.add("hidden");
    elements.errorText.textContent = "";
  }
}

function render() {
  const risk = formatRisk(state.result?.summary?.risk_level);
  elements.statusCard.className = `status-card ${risk.className}`;

  setText("riskValue", risk.label);
  setText("confidenceValue", state.result?.summary?.confidence !== undefined
    ? `${Math.round(Number(state.result.summary.confidence))}%`
    : state.loading
      ? "Analyzing..."
      : "—");
  setText("relevanceValue", state.result?.relevance_score !== undefined
    ? `${Math.round(Number(state.result.relevance_score) * 100)}%`
    : "—");

  setTextarea("promptPreview", state.currentPrompt);
  setTextarea("responsePreview", state.currentResponse);
  setText("promptLength", `${state.currentPrompt.length} chars`);
  setText("responseLength", `${state.currentResponse.length} chars`);

  const hallucinationFlag = Boolean(state.result?.detectors?.hallucination?.flag);
  const toxicityFlag = Boolean(state.result?.detectors?.toxicity?.flag);
  const piiFlag = Boolean(state.result?.detectors?.pii?.flag);

  setChip("hallucinationFlag", "Hallucination", hallucinationFlag, "warn");
  setChip("toxicityFlag", "Toxicity", toxicityFlag, "warn");
  setChip("piiFlag", "PII", piiFlag, "danger");

  const analysisState = elements.analysisState;
  if (analysisState) {
    if (state.loading) {
      analysisState.textContent = "Analyzing latest conversation pair...";
    } else if (state.result) {
      const factCheck = state.result.detectors?.fact_check;
      const factStatus = factCheck?.mode === "reference_only"
        ? "Reference-only fact check"
        : `Fact check: ${factCheck?.status || "unverified"}`;
      analysisState.textContent = `${factStatus}. Latency: ${state.result.meta?.latency_ms ?? "?"} ms.`;
    } else {
      analysisState.textContent = state.error
        ? `${state.error.code || "REQUEST_FAILED"}: ${state.error.message || "Unknown error"}`
        : "Open a supported LLM chat and click Analyze.";
    }
  }

  updateError(state.error);
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function refreshActiveTab(analyze = false) {
  state.loading = true;
  state.error = null;
  render();

  const message = analyze
    ? { type: "SAFENET_ANALYZE_ACTIVE_TAB" }
    : { type: "SAFENET_GET_ACTIVE_TAB_STATE" };

  const response = await sendMessage(message);

  if (!response?.ok) {
    state.loading = false;
    state.result = null;
    updateError(response?.error || { code: "REQUEST_FAILED", message: "Unable to read the active tab." });
    render();
    return;
  }

  const snapshot = response.snapshot || response.result?.snapshot || null;
  state.currentPrompt = normalizeText(snapshot?.prompt || "");
  state.currentResponse = normalizeText(snapshot?.response || "");
  state.result = response.result || null;
  state.loading = false;
  state.error = response.error || null;

  if (!state.result && state.currentPrompt && state.currentResponse && analyze) {
    state.error = response.error || { code: "NO_RESULT", message: "The backend did not return an analysis." };
  }

  render();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    refreshActiveTab(true).catch((error) => {
      state.loading = false;
      state.error = {
        code: error?.code || "REQUEST_FAILED",
        message: error?.message || "Unable to analyze the current tab.",
      };
      render();
    });
  });
}

async function init() {
  elements.refreshButton = $("refreshButton");
  elements.statusCard = $("statusCard");
  elements.riskValue = $("riskValue");
  elements.confidenceValue = $("confidenceValue");
  elements.relevanceValue = $("relevanceValue");
  elements.promptPreview = $("promptPreview");
  elements.responsePreview = $("responsePreview");
  elements.promptLength = $("promptLength");
  elements.responseLength = $("responseLength");
  elements.hallucinationFlag = $("hallucinationFlag");
  elements.toxicityFlag = $("toxicityFlag");
  elements.piiFlag = $("piiFlag");
  elements.analysisState = $("analysisState");
  elements.errorPanel = $("errorPanel");
  elements.errorText = $("errorText");

  bindEvents();
  render();

  try {
    await refreshActiveTab(false);
  } catch (error) {
    state.loading = false;
    state.error = {
      code: error?.code || "REQUEST_FAILED",
      message: error?.message || "Unable to read the active tab.",
    };
    render();
  }
}

document.addEventListener("DOMContentLoaded", init);
