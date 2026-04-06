const OVERLAY_ID = "safenet-ai-overlay-root";
const ANALYZE_BUTTON_ID = "safenet-ai-analyze-fab";
const FLOATING_ROOT_ID = "safenet-floating-root";
const FLOATING_Z_INDEX = "2147483646";
const DEBOUNCE_MS = 1200;
const STABILIZE_MS = 1000;

const PLATFORM_STRATEGIES = {
  claude: {
    hostname: ["claude.ai"],
    user: [
      "[data-testid='user-message']",
      "div[data-testid='user-message']",
    ],
    assistant: [
      "[class*='font-claude-response']",
      "[class*='standard-markdown']",
    ],
    assistantExcludeIfInsideUser: [
      "[data-testid='user-message']",
    ],
  },
  chatgpt: {
    hostname: ["chatgpt.com", "chat.openai.com"],
    user: [
      "div[data-message-author-role='user']",
      "main [data-message-author-role='user']",
      "article[data-testid*='conversation-turn'] [data-message-author-role='user']",
    ],
    assistant: [
      "div[data-message-author-role='assistant']",
      "main [data-message-author-role='assistant']",
      "article[data-testid*='conversation-turn'] [data-message-author-role='assistant']",
      "article[data-testid*='conversation-turn'] .markdown",
    ],
    turn: "article[data-testid*='conversation-turn']",
    turnAssistantQuery: "[data-message-author-role='assistant'], .markdown, .prose",
  },
  gemini: {
    hostname: ["gemini.google.com"],
    user: [
      "user-query",
      "user-query .query-text",
    ],
    assistant: [
      "model-response",
      "model-response .response-content",
    ],
  },
  perplexity: {
    hostname: ["perplexity.ai"],
    user: [
      "[data-testid='user-query']",
      ".user-query",
    ],
    assistant: [
      ".prose",
      "[class*='prose']",
      ".answer-text",
    ],
  },
  generic: {
    hostname: [],
    user: [
      ".user-message",
      "[aria-label*='user message' i]",
      "main [data-message-author-role='user']",
    ],
    assistant: [
      ".assistant-message",
      "[aria-label*='assistant message' i]",
      "main [data-message-author-role='assistant']",
    ],
  },
};

const UI_ARTIFACTS = [
  "copy code",
  "regenerate",
  "continue generating",
  "show more",
  "show less",
  "edit",
  "assistant",
  "user",
];

let overlayShadow = null;
let overlayElements = null;
let currentSnapshot = null;
let currentResult = null;
let currentError = null;
let collapsed = false;
let dragState = null;
let mutationObserver = null;
let debounceTimer = null;
let lastSignature = "";
let lastAssistantText = "";
let assistantStableSince = Date.now();
let streamingRetryTimer = null;
let runtimeGuardEnabled = false;
let lastDiagnosticLog = null;  // Track last logged diagnostic to avoid spam

const CHAT_HOST_HINTS = [
  "chatgpt",
  "openai",
  "claude",
  "anthropic",
  "gemini",
  "perplexity",
  "copilot",
  "poe",
];

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripUiArtifacts(text) {
  const lines = normalizeWhitespace(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lowered = line.toLowerCase();
      return !UI_ARTIFACTS.some((artifact) => lowered === artifact || lowered.startsWith(`${artifact} `));
    });

  return lines.join("\n").trim();
}

function quickCleanText(text) {
  return stripUiArtifacts(String(text || "").replace(/\s+/g, " ").trim());
}

function isChatLikePage() {
  const hostname = String(window.location.hostname || "").toLowerCase();
  if (CHAT_HOST_HINTS.some((hint) => hostname.includes(hint))) {
    return true;
  }

  const hasKnownChatNodes = Boolean(
    document.querySelector("[data-message-author-role]") ||
    document.querySelector("[data-testid='user-message']") ||
    document.querySelector("[data-testid='assistant-message']") ||
    document.querySelector("article[data-testid*='conversation-turn']")
  );

  if (hasKnownChatNodes) {
    return true;
  }

  const bodyText = quickCleanText((document.body?.innerText || "").slice(0, 4000));
  if (!bodyText) {
    return false;
  }

  const conversationalSignals = [
    "assistant",
    "chat",
    "message",
    "prompt",
    "regenerate",
    "continue generating",
  ];

  const hitCount = conversationalSignals.reduce((count, signal) => {
    return count + (bodyText.toLowerCase().includes(signal) ? 1 : 0);
  }, 0);

  return hitCount >= 2;
}

function isVisible(element) {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getTextContent(element) {
  if (!element) {
    return "";
  }

  const text = "innerText" in element ? element.innerText : element.textContent || "";
  return quickCleanText(text);
}

function getRoleForNode(node) {
  if (!(node instanceof Element)) {
    return null;
  }

  const explicitRole = node.getAttribute("data-message-author-role");
  if (explicitRole === "user" || explicitRole === "assistant") {
    return explicitRole;
  }

  const className = String(node.className || "").toLowerCase();
  if (className.includes("assistant")) {
    return "assistant";
  }
  if (className.includes("user")) {
    return "user";
  }

  const aria = String(node.getAttribute("aria-label") || "").toLowerCase();
  if (aria.includes("assistant")) {
    return "assistant";
  }
  if (aria.includes("user")) {
    return "user";
  }

  return null;
}

function uniqueVisibleNodes(selectors) {
  const seen = new Set();
  const seenText = new Set();
  const nodes = [];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement) || seen.has(node)) {
        return;
      }

      // Filter hidden elements: offsetParent === null means element is display:none or hidden
      if (node.offsetParent === null) {
        return;
      }

      // Additional visibility checks
      const style = window.getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
        return;
      }

      const text = getTextContent(node);
      if (!text) {
        return;
      }

      // Deduplicate by text content to avoid counting the same message multiple times
      // (e.g., due to virtual DOM or animation duplicates)
      if (seenText.has(text)) {
        return;
      }

      seen.add(node);
      seenText.add(text);
      nodes.push(node);
    });
  }
  return nodes;
}

function buildStructuredLists(strategy) {
  const userNodes = uniqueVisibleNodes(strategy.user || []);
  const assistantNodes = uniqueVisibleNodes(strategy.assistant || []);
  return { userNodes, assistantNodes };
}

function byDomOrder(list) {
  return [...list].sort((left, right) => {
    if (left === right) {
      return 0;
    }
    const position = left.compareDocumentPosition(right);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }
    return 0;
  });
}

function findPairFromLists(userNodes, assistantNodes) {
  const orderedUsers = byDomOrder(userNodes);
  const orderedAssistants = byDomOrder(assistantNodes);
  const lastUser = orderedUsers[orderedUsers.length - 1] || null;
  const lastAssistant = orderedAssistants[orderedAssistants.length - 1] || null;

  if (!lastUser && !lastAssistant) {
    return { prompt: "", response: "", userNode: null, assistantNode: null };
  }

  if (!lastAssistant) {
    return {
      prompt: getTextContent(lastUser),
      response: "",
      userNode: lastUser,
      assistantNode: null,
    };
  }

  let pairedUser = null;
  for (let index = orderedUsers.length - 1; index >= 0; index -= 1) {
    const candidate = orderedUsers[index];
    const position = candidate.compareDocumentPosition(lastAssistant);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      pairedUser = candidate;
      break;
    }
  }

  return {
    prompt: getTextContent(pairedUser || lastUser),
    response: getTextContent(lastAssistant),
    userNode: pairedUser || lastUser,
    assistantNode: lastAssistant,
  };
}

function detectByTurnSelector(turnSelector, assistantQuery) {
  if (!turnSelector) {
    return null;
  }

  const turns = [...document.querySelectorAll(turnSelector)].filter((turn) => turn instanceof HTMLElement);
  if (!turns.length) {
    return null;
  }

  const defaultAssistantQuery = "[data-message-author-role='assistant'], [data-testid='assistant-message'], .markdown, .prose";
  const queryToUse = assistantQuery || defaultAssistantQuery;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const userNode = turn.querySelector("[data-message-author-role='user'], [data-testid='user-message']");
    const assistantNode = turn.querySelector(queryToUse);
    const prompt = getTextContent(userNode);
    const response = getTextContent(assistantNode);
    if (prompt || response) {
      return {
        prompt,
        response,
        userNode,
        assistantNode,
      };
    }
  }

  return null;
}

function getFallbackSnapshot() {
  const tail = quickCleanText((document.body?.innerText || "").slice(-2000));
  if (!tail) {
    return null;
  }

  return {
    prompt: "",
    response: tail,
    userNode: null,
    assistantNode: null,
    fallback: true,
  };
}

function extractPerplexitySnapshot() {
  const promptSources = [
    document.querySelector("main h1"),
    document.querySelector("h1"),
    document.querySelector("[data-testid='query']"),
    document.querySelector("[data-testid='search-query']"),
    document.querySelector("textarea"),
  ];

  let prompt = "";
  let promptNode = null;

  for (const node of promptSources) {
    if (!node) {
      continue;
    }

    const candidateText = node instanceof HTMLTextAreaElement ? quickCleanText(node.value) : getTextContent(node);
    if (!candidateText) {
      continue;
    }

    prompt = candidateText;
    promptNode = node;
    break;
  }

  if (!prompt) {
    const queryFromUrl = quickCleanText(new URLSearchParams(window.location.search).get("q") || "");
    if (queryFromUrl) {
      prompt = queryFromUrl;
    }
  }

  const answerNodes = byDomOrder(uniqueVisibleNodes([
    "[data-testid='answer']",
    "main [data-testid='answer']",
    ".answer-text",
    ".prose",
    "[class*='prose']",
  ]));
  const responseNode = answerNodes[answerNodes.length - 1] || null;
  const response = getTextContent(responseNode);

  return {
    prompt,
    response,
    userNode: promptNode,
    assistantNode: responseNode,
  };
}

function detectPlatform() {
  const hostname = String(window.location.hostname || "").toLowerCase();

  for (const [platformName, strategy] of Object.entries(PLATFORM_STRATEGIES)) {
    if (platformName === "generic") {
      continue;
    }
    if (strategy.hostname && strategy.hostname.some((host) => hostname.includes(host))) {
      return { name: platformName, strategy };
    }
  }

  return { name: "generic", strategy: PLATFORM_STRATEGIES.generic };
}

function buildConversationSnapshot() {
  const { name: platformName, strategy: platformStrategy } = detectPlatform();

  let lists = buildStructuredLists(platformStrategy);

  // Filter assistant nodes if strategy specifies exclusions
  if (platformStrategy.assistantExcludeIfInsideUser && platformStrategy.assistantExcludeIfInsideUser.length > 0) {
    lists.assistantNodes = lists.assistantNodes.filter((node) => {
      for (const excludeSelector of platformStrategy.assistantExcludeIfInsideUser) {
        if (node.closest(excludeSelector)) {
          return false;
        }
      }
      return true;
    });
  }

  const usersTotal = lists.userNodes.length;
  const assistantsTotal = lists.assistantNodes.length;

  const diagnostics = {
    usersFound: usersTotal,
    assistantsFound: assistantsTotal,
    platform: platformName,
  };

  // Add Claude-specific diagnostics
  if (platformName === "claude") {
    diagnostics.claudeSpecific = {
      fontClaudeResponseEls: document.querySelectorAll("[class*='font-claude-response']").length,
      standardMarkdownEls: document.querySelectorAll("[class*='standard-markdown']").length,
      streamingEls: document.querySelectorAll("[data-is-streaming]").length,
    };
  }

  // Only log if counts have changed (to avoid spam)
  const diagnosticKey = JSON.stringify(diagnostics);
  if (diagnosticKey !== lastDiagnosticLog) {
    lastDiagnosticLog = diagnosticKey;
    console.log("SafeNet Debug:", diagnostics);
  }

  if (usersTotal === 0 && assistantsTotal === 0) {
    const bodyHint = quickCleanText((document.body?.innerText || "").slice(-500));
    console.log("SafeNet Debug: zero structured chat nodes. DOM hint:", {
      title: document.title,
      url: window.location.href,
      bodyHint,
    });
  }

  // Try turn-based extraction first if strategy has turn selector
  let byTurn = null;
  if (platformStrategy.turn) {
    byTurn = detectByTurnSelector(platformStrategy.turn, platformStrategy.turnAssistantQuery);
  }

  // Perplexity renders the prompt outside regular chat bubbles (heading/input/query area).
  const byPlatform = platformName === "perplexity" ? extractPerplexitySnapshot() : null;

  // Try list-based extraction
  const byListBased = findPairFromLists(lists.userNodes, lists.assistantNodes);

  // Pick best result: platform-specific > turn-based > list-based > fallback
  const candidate = [byPlatform, byTurn, byListBased].find((item) => item && (item.prompt || item.response)) || { prompt: "", response: "", userNode: null, assistantNode: null };
  const fallback = candidate.prompt || candidate.response ? null : getFallbackSnapshot();
  const selected = (candidate.prompt || candidate.response) ? candidate : fallback || { prompt: "", response: "", userNode: null, assistantNode: null };

  const prompt = quickCleanText(selected.prompt || "");
  const response = quickCleanText(selected.response || "");

  return {
    prompt,
    response,
    signature: `${prompt}${response}`,
    source: detectSourceName(selected.assistantNode) || detectSourceName(selected.userNode) || (selected.fallback ? "fallback-body-tail" : null),
    detectedAt: Date.now(),
    empty: !prompt && !response,
    usersFound: usersTotal,
    assistantsFound: assistantsTotal,
    platform: platformName,
  };
}

function detectSourceName(node) {
  if (!(node instanceof Element)) {
    return null;
  }

  if (node.closest("[data-message-author-role]")) {
    return "chatgpt-or-compatible";
  }

  if (node.closest("main")) {
    return "llm-chat";
  }

  return null;
}

function ensureFloatingRoot() {
  let root = document.getElementById(FLOATING_ROOT_ID);
  if (root) {
    return root;
  }

  root = document.createElement("div");
  root.id = FLOATING_ROOT_ID;
  root.style.position = "fixed";
  root.style.right = "16px";
  root.style.bottom = "16px";
  root.style.zIndex = FLOATING_Z_INDEX;
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.alignItems = "flex-end";
  root.style.gap = "14px";
  root.style.maxHeight = "calc(100vh - 24px)";
  root.style.maxWidth = "min(94vw, 420px)";
  root.style.overflowY = "auto";
  root.style.pointerEvents = "none";

  document.documentElement.appendChild(root);
  return root;
}

function ensureOverlayRoot() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    overlayShadow = existing.shadowRoot;
    overlayElements = overlayShadow?.querySelector("[data-safenet-root]") ? overlayElements : overlayElements;
    return existing;
  }

  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  host.style.all = "initial";
  host.style.display = "none";
  host.style.pointerEvents = "auto";

  overlayShadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.setAttribute("data-safenet-root", "true");
  container.innerHTML = `
    <div class="safenet-panel safenet-collapsed" data-panel>
      <div class="safenet-header" data-drag-handle>
        <div class="safenet-title-block">
          <div class="safenet-title">SafeNet AI</div>
          <div class="safenet-subtitle" data-status>Waiting for conversation</div>
        </div>
        <div class="safenet-header-actions">
          <button type="button" class="safenet-icon-button" data-analyze-btn title="Analyze now">Analyze</button>
          <button type="button" class="safenet-icon-button" data-toggle-btn title="Expand or collapse">+</button>
          <button type="button" class="safenet-icon-button" data-close-btn title="Hide overlay">×</button>
        </div>
      </div>
      <div class="safenet-body" data-body hidden>
        <div class="safenet-grid">
          <div class="safenet-metric">
            <div class="safenet-label">Risk</div>
            <div class="safenet-value" data-risk>—</div>
          </div>
          <div class="safenet-metric">
            <div class="safenet-label">Confidence</div>
            <div class="safenet-value" data-confidence>—</div>
          </div>
          <div class="safenet-metric">
            <div class="safenet-label">Relevance</div>
            <div class="safenet-value" data-relevance>—</div>
          </div>
          <div class="safenet-metric">
            <div class="safenet-label">Fact Check</div>
            <div class="safenet-value" data-fact-check>—</div>
          </div>
        </div>

        <div class="safenet-section">
          <div class="safenet-section-title">Flags</div>
          <div class="safenet-badges">
            <span class="safenet-badge safenet-badge-quiet" data-flag="hallucination">Hallucination: Clear</span>
            <span class="safenet-badge safenet-badge-quiet" data-flag="toxicity">Toxicity: Clear</span>
            <span class="safenet-badge safenet-badge-quiet" data-flag="pii">PII: Clear</span>
          </div>
        </div>

        <div class="safenet-section">
          <div class="safenet-section-title">Latest Pair</div>
          <div class="safenet-snapshot">
            <div class="safenet-snapshot-label">Prompt</div>
            <div class="safenet-snapshot-text" data-prompt>Waiting for a prompt...</div>
            <div class="safenet-snapshot-label">Response</div>
            <div class="safenet-snapshot-text" data-response>Waiting for a response...</div>
          </div>
        </div>

        <div class="safenet-section">
          <div class="safenet-section-title">Details</div>
          <div class="safenet-details" data-details>Open a supported LLM chat to start analysis.</div>
        </div>
      </div>
    </div>
  `;

  overlayShadow.appendChild(container);

  const styleLink = document.createElement("style");
  styleLink.textContent = "";
  overlayShadow.appendChild(styleLink);

  fetch(chrome.runtime.getURL("overlay.css"))
    .then((response) => response.text())
    .then((cssText) => {
      styleLink.textContent = cssText;
    })
    .catch(() => {
      styleLink.textContent = "";
    });

  ensureFloatingRoot().appendChild(host);
  overlayElements = {
    host,
    panel: overlayShadow.querySelector("[data-panel]"),
    body: overlayShadow.querySelector("[data-body]"),
    status: overlayShadow.querySelector("[data-status]"),
    prompt: overlayShadow.querySelector("[data-prompt]"),
    response: overlayShadow.querySelector("[data-response]"),
    risk: overlayShadow.querySelector("[data-risk]"),
    confidence: overlayShadow.querySelector("[data-confidence]"),
    relevance: overlayShadow.querySelector("[data-relevance]"),
    factCheck: overlayShadow.querySelector("[data-fact-check]"),
    details: overlayShadow.querySelector("[data-details]"),
    analyzeBtn: overlayShadow.querySelector("[data-analyze-btn]"),
    toggleBtn: overlayShadow.querySelector("[data-toggle-btn]"),
    closeBtn: overlayShadow.querySelector("[data-close-btn]"),
    dragHandle: overlayShadow.querySelector("[data-drag-handle]"),
    flags: {
      hallucination: overlayShadow.querySelector("[data-flag='hallucination']"),
      toxicity: overlayShadow.querySelector("[data-flag='toxicity']"),
      pii: overlayShadow.querySelector("[data-flag='pii']"),
    },
  };

  overlayElements.toggleBtn.addEventListener("click", toggleOverlay);
  overlayElements.closeBtn.addEventListener("click", hideOverlay);
  overlayElements.analyzeBtn.addEventListener("click", requestAnalysisNow);
  overlayElements.dragHandle.addEventListener("pointerdown", beginDrag);

  return host;
}

function ensureAnalyzeFab() {
  let button = document.getElementById(ANALYZE_BUTTON_ID);
  if (button) {
    return button;
  }

  button = document.createElement("button");
  button.id = ANALYZE_BUTTON_ID;
  button.type = "button";
  button.textContent = "Analyze";
  button.style.position = "relative";
  button.style.pointerEvents = "auto";
  button.style.border = "1px solid #1e3a8a";
  button.style.background = "rgb(6 182 212 / var(--tw-bg-opacity, 1))";
  button.style.color = "#000000";
  button.style.fontSize = "12px";
  button.style.fontWeight = "700";
  button.style.padding = "8px 12px";
  button.style.borderRadius = "999px";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 8px 20px rgba(0,0,0,0.35)";
  button.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestAnalysisNow();
  });

  ensureFloatingRoot().appendChild(button);
  return button;
}

function showOverlay() {
  const host = ensureOverlayRoot();
  host.style.display = "block";
}

function hideOverlay() {
  if (overlayElements?.host) {
    overlayElements.host.style.display = "none";
  }
}

function toggleOverlay() {
  collapsed = !collapsed;
  if (overlayElements?.panel) {
    overlayElements.panel.classList.toggle("safenet-collapsed", collapsed);
  }
  if (overlayElements?.body) {
    overlayElements.body.hidden = collapsed;
  }
  if (overlayElements?.toggleBtn) {
    overlayElements.toggleBtn.textContent = collapsed ? "+" : "−";
  }
}

function beginDrag(event) {
  // Shared floating layout is flex-driven; manual drag positioning is disabled to prevent overlap.
  event.preventDefault();
}

function continueDrag(event) {
  void event;
}

function endDrag() {
  dragState = null;
}

function setBadgeText(element, text, tone) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.dataset.tone = tone || "neutral";
}

function setFlag(element, label, active, tone) {
  if (!element) {
    return;
  }

  element.textContent = `${label}: ${active ? "Flagged" : "Clear"}`;
  element.classList.toggle("safenet-badge-flagged", Boolean(active));
  element.classList.toggle("safenet-badge-quiet", !active);
  element.dataset.tone = tone || (active ? "danger" : "neutral");
}

function formatConfidence(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Math.round(Number(value))}%`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

function getRiskTone(riskLevel) {
  const level = String(riskLevel || "").toLowerCase();
  if (level === "low") {
    return "safe";
  }
  if (level === "medium") {
    return "warn";
  }
  return "danger";
}

function renderSnapshot(snapshot) {
  if (!overlayElements) {
    return;
  }

  overlayElements.prompt.textContent = snapshot?.prompt || "Waiting for a prompt...";
  overlayElements.response.textContent = snapshot?.response || "Waiting for a response...";
}

function renderWaiting(message) {
  if (!overlayElements) {
    return;
  }

  setBadgeText(overlayElements.risk, "Waiting", "neutral");
  overlayElements.confidence.textContent = "—";
  overlayElements.relevance.textContent = "—";
  overlayElements.factCheck.textContent = "—";
  overlayElements.details.textContent = message || "Open a supported LLM chat to start analysis.";
  setFlag(overlayElements.flags.hallucination, "Hallucination", false, "neutral");
  setFlag(overlayElements.flags.toxicity, "Toxicity", false, "neutral");
  setFlag(overlayElements.flags.pii, "PII", false, "neutral");
}

function renderError(error) {
  if (!overlayElements) {
    return;
  }

  setBadgeText(overlayElements.risk, "Error", "danger");
  overlayElements.confidence.textContent = "—";
  overlayElements.relevance.textContent = "—";
  overlayElements.factCheck.textContent = "—";
  overlayElements.details.textContent = `${error?.code || "REQUEST_FAILED"}: ${error?.message || "Unable to analyze this chat."}`;
}

function renderResult(result) {
  if (!overlayElements) {
    return;
  }

  const riskLevel = String(result?.summary?.risk_level || "high");
  const riskTone = getRiskTone(riskLevel);
  setBadgeText(overlayElements.risk, riskLevel.toUpperCase(), riskTone);
  overlayElements.risk.classList.remove("tone-safe", "tone-warn", "tone-danger", "tone-neutral");
  overlayElements.risk.classList.add(`tone-${riskTone}`);

  overlayElements.confidence.textContent = formatConfidence(result?.summary?.confidence);
  overlayElements.relevance.textContent = formatPercent(result?.relevance_score);

  const factCheck = result?.detectors?.fact_check;
  if (factCheck?.mode === "reference_only") {
    overlayElements.factCheck.textContent = "Reference only";
  } else {
    overlayElements.factCheck.textContent = `${factCheck?.status || "unverified"} · ${formatConfidence(Number(factCheck?.score ?? 0) * 100)}`;
  }

  const hallucinationFlag = Boolean(result?.detectors?.hallucination?.flag);
  const toxicityFlag = Boolean(result?.detectors?.toxicity?.flag);
  const piiFlag = Boolean(result?.detectors?.pii?.flag);

  setFlag(overlayElements.flags.hallucination, "Hallucination", hallucinationFlag, hallucinationFlag ? "warn" : "neutral");
  setFlag(overlayElements.flags.toxicity, "Toxicity", toxicityFlag, toxicityFlag ? "warn" : "neutral");
  setFlag(overlayElements.flags.pii, "PII", piiFlag, piiFlag ? "danger" : "neutral");

  const lines = [];
  lines.push("Confidence reflects safety and reliability. Relevance reflects alignment with the user query.");
  if (result?.detectors?.hallucination?.reason) {
    lines.push(`Hallucination: ${result.detectors.hallucination.reason}`);
  }
  if (Array.isArray(result?.detectors?.toxicity?.categories) && result.detectors.toxicity.categories.length > 0) {
    lines.push(`Toxicity categories: ${result.detectors.toxicity.categories.join(", ")}`);
  }
  if (Array.isArray(result?.detectors?.pii?.categories) && result.detectors.pii.categories.length > 0) {
    lines.push(`PII categories: ${result.detectors.pii.categories.join(", ")}`);
  }
  if (factCheck?.mode === "reference_only") {
    lines.push(factCheck?.message || "Reference-only mode: no fact score was produced.");
  } else if (Array.isArray(factCheck?.claims) && factCheck.claims.length > 0) {
    lines.push(`Fact claims extracted: ${factCheck.claims.length}`);
  }
  lines.push(`Latency: ${result?.meta?.latency_ms ?? "?"} ms`);
  overlayElements.details.textContent = lines.join("\n");
}

function renderState() {
  renderSnapshot(currentSnapshot);

  if (currentError) {
    renderError(currentError);
    return;
  }

  if (!currentResult) {
    renderWaiting("Waiting for conversation data from a supported LLM chat.");
    return;
  }

  renderResult(currentResult);
}

async function sendMessage(message) {
  // After extension reload/update, old content-script contexts can linger briefly.
  // Guard against calling runtime APIs from an invalidated context.
  if (!globalThis.chrome?.runtime?.id) {
    return {
      ok: false,
      error: {
        code: "CONTEXT_INVALIDATED",
        message: "Extension context invalidated. Reload the tab to reattach SafeNet.",
      },
    };
  }

  try {
    const response = await chrome.runtime.sendMessage(message);
    if (response === undefined) {
      return {
        ok: false,
        error: {
          code: "NO_RESPONSE",
          message: "No response received from extension background service worker.",
        },
      };
    }
    return response;
  } catch (error) {
    const messageText = String(error?.message || "");
    if (messageText.toLowerCase().includes("context invalidated")) {
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (streamingRetryTimer) {
        clearTimeout(streamingRetryTimer);
        streamingRetryTimer = null;
      }

      return {
        ok: false,
        error: {
          code: "CONTEXT_INVALIDATED",
          message: "Extension context invalidated. Reload the page after reloading the extension.",
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "RUNTIME_MESSAGE_FAILED",
        message: messageText || "Failed to message extension background service worker.",
      },
    };
  }
}

async function requestAnalysisNow() {
  showOverlay();
  overlayElements.status.textContent = "Analyzing now...";

  const response = await sendMessage({ type: "SAFENET_ANALYZE_ACTIVE_TAB" });
  if (!response?.ok) {
    currentError = response?.error || { code: "REQUEST_FAILED", message: "Unable to analyze this chat." };
    currentResult = null;
    renderState();
    return;
  }

  currentSnapshot = response.snapshot || currentSnapshot;
  currentResult = response.result || null;
  currentError = response.error || null;
  overlayElements.status.textContent = currentResult ? "Live analysis updated" : "Waiting for complete chat content";
  renderState();
}

function scheduleExtraction() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const snapshot = buildConversationSnapshot();
    if (!snapshot || (!snapshot.prompt && !snapshot.response && snapshot.usersFound === 0 && snapshot.assistantsFound === 0)) {
      currentSnapshot = snapshot;
      return;
    }

    const assistantText = quickCleanText(snapshot.response || "");
    if (assistantText !== lastAssistantText) {
      lastAssistantText = assistantText;
      assistantStableSince = Date.now();
    }

    if (assistantText && Date.now() - assistantStableSince < STABILIZE_MS) {
      if (streamingRetryTimer) {
        clearTimeout(streamingRetryTimer);
      }
      streamingRetryTimer = setTimeout(() => {
        streamingRetryTimer = null;
        scheduleExtraction();
      }, STABILIZE_MS);

      currentSnapshot = snapshot;
      return;
    }

    if (snapshot.signature === lastSignature) {
      return;
    }

    lastSignature = snapshot.signature;
    currentSnapshot = snapshot;
  }, DEBOUNCE_MS);
}

const PROMPT_OPTIMIZER_ID = "safenet-prompt-optimizer-root";
const PROMPT_OPTIMIZER_DEBOUNCE_MS = 900;
const PROMPT_OPTIMIZER_IDLE_HIDE_MS = 5000;
const PROMPT_OPTIMIZER_REQUEST_TIMEOUT_MS = 12000;

let promptOptimizerWidget = null;

function normalizePromptInputElement(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return target;
  }

  const contentEditable = target.closest("[contenteditable='true']");
  return contentEditable instanceof HTMLElement ? contentEditable : null;
}

function detectPromptPlatform() {
  const hostname = String(window.location.hostname || "").toLowerCase();
  if (hostname.includes("chatgpt.com") || hostname.includes("chat.openai.com")) {
    return "chatgpt";
  }
  if (hostname.includes("claude.ai")) {
    return "claude";
  }
  if (hostname.includes("gemini.google.com")) {
    return "gemini";
  }
  if (hostname.includes("perplexity.ai")) {
    return "perplexity";
  }
  return "generic";
}

function getPromptInputSelectors(platform) {
  const byPlatform = {
    chatgpt: [
      "#prompt-textarea",
      "textarea[data-id='root']",
      "textarea[placeholder*='Message' i]",
    ],
    claude: [
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']",
      "textarea",
    ],
    gemini: [
      "textarea",
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']",
    ],
    perplexity: [
      "textarea",
      "input[type='text']",
      "div[contenteditable='true'][role='textbox']",
    ],
    generic: [
      "textarea",
      "input[type='text']",
      "div[contenteditable='true'][role='textbox']",
      "div[contenteditable='true']",
    ],
  };

  return byPlatform[platform] || byPlatform.generic;
}

function isPromptInputElement(element) {
  const normalized = normalizePromptInputElement(element);
  if (!normalized) {
    return false;
  }

  const platform = detectPromptPlatform();
  const selectors = getPromptInputSelectors(platform);
  if (selectors.some((selector) => normalized.matches(selector))) {
    return true;
  }

  return normalized.matches("textarea, input[type='text'], [contenteditable='true']");
}

function readPromptInputValue(element) {
  const normalized = normalizePromptInputElement(element);
  if (!normalized) {
    return "";
  }

  if (normalized instanceof HTMLTextAreaElement || normalized instanceof HTMLInputElement) {
    return quickCleanText(normalized.value || "");
  }

  return quickCleanText(normalized.innerText || normalized.textContent || "");
}

function optimizePromptText(rawPrompt) {
  const prompt = quickCleanText(rawPrompt || "");
  if (!prompt) {
    return "";
  }

  const words = prompt.split(/\s+/).filter(Boolean);
  const looksQuestion = /\?$/.test(prompt);

  if (words.length <= 3) {
    return `Explain ${prompt.replace(/\?+$/, "")} clearly with key details, practical examples, and concise next steps.`;
  }

  if (!looksQuestion && words.length < 12) {
    return `${prompt}. Include clear context, constraints, and expected output format.`;
  }

  return prompt;
}

async function rewritePromptWithLLM(rawPrompt) {
  const prompt = quickCleanText(rawPrompt || "");
  if (!prompt) {
    return "";
  }

  const optimizationResponse = await sendMessage({
    type: "SAFENET_OPTIMIZE_PROMPT",
    prompt,
    timeoutMs: PROMPT_OPTIMIZER_REQUEST_TIMEOUT_MS,
  });

  if (optimizationResponse?.ok) {
    const optimized = quickCleanText(optimizationResponse.optimizedPrompt || "");
    if (optimized) {
      return optimized;
    }
  }

  // If optimization service is unavailable, preserve user intent without noisy templates.
  return optimizePromptText(prompt);
}

function createPromptOptimizerWidget() {
  const existing = document.getElementById(PROMPT_OPTIMIZER_ID);
  if (existing?.shadowRoot?.querySelector("[data-po-root]")) {
    return {
      host: existing,
      shadow: existing.shadowRoot,
      root: existing.shadowRoot.querySelector("[data-po-root]"),
    };
  }

  const host = document.createElement("div");
  host.id = PROMPT_OPTIMIZER_ID;
  host.style.all = "initial";
  host.style.position = "relative";
  host.style.display = "block";
  host.style.pointerEvents = "auto";

  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.setAttribute("data-po-root", "true");
  container.innerHTML = `
    <style>
      :host { all: initial; }
      .po-wrap { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; color: #e5e7eb; }
      .po-btn {
        border: none;
        border-radius: 999px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        background: rgb(6 182 212 / var(--tw-bg-opacity, 1));
        color: #111827;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0,0,0,0.35);
      }
      .po-panel {
        width: 330px;
        margin-top: 8px;
        border-radius: 12px;
        overflow: hidden;
        background: #0b1220;
        border: 1px solid #1f2937;
        box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      }
      .po-hidden { display: none; }
      .po-head {
        background: #111827;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #f9fafb;
        cursor: move;
        user-select: none;
      }
      .po-body { padding: 8px; display: grid; gap: 8px; }
      .po-label { font-size: 11px; color: #93c5fd; margin-bottom: 4px; }
      .po-box {
        width: 100%;
        min-height: 66px;
        max-height: 140px;
        overflow: auto;
        border-radius: 8px;
        border: 1px solid #243244;
        background: #0f172a;
        color: #e5e7eb;
        font-size: 12px;
        line-height: 1.4;
        padding: 8px;
        white-space: pre-wrap;
      }
      .po-actions { display: flex; justify-content: flex-end; }
      .po-mini-btn {
        border: 1px solid #334155;
        border-radius: 8px;
        background: #1e293b;
        color: #e2e8f0;
        font-size: 11px;
        padding: 6px 8px;
        cursor: pointer;
      }
    </style>
    <div class="po-wrap">
      <button class="po-btn" data-po-toggle type="button">⚡ Optimize</button>
      <div class="po-panel po-hidden" data-po-panel>
        <div class="po-head" data-po-drag>Prompt Optimizer</div>
        <div class="po-body">
          <div>
            <div class="po-label">Original prompt</div>
            <div class="po-box" data-po-original>Start typing in a prompt box...</div>
          </div>
          <div>
            <div class="po-label">Optimized prompt</div>
            <div class="po-box" data-po-optimized>Optimized prompt will appear here.</div>
          </div>
          <div class="po-actions">
            <button class="po-mini-btn" data-po-refresh type="button">Optimize now</button>
            <button class="po-mini-btn" data-po-copy type="button">Copy to input</button>
          </div>
        </div>
      </div>
    </div>
  `;

  shadow.appendChild(container);
  ensureFloatingRoot().appendChild(host);

  return {
    host,
    shadow,
    root: container,
  };
}

function initPromptOptimizerWidget() {
  if (promptOptimizerWidget) {
    return;
  }

  const ui = createPromptOptimizerWidget();
  const panel = ui.shadow.querySelector("[data-po-panel]");
  const toggleBtn = ui.shadow.querySelector("[data-po-toggle]");
  const refreshBtn = ui.shadow.querySelector("[data-po-refresh]");
  const copyBtn = ui.shadow.querySelector("[data-po-copy]");
  const dragHandle = ui.shadow.querySelector("[data-po-drag]");
  const originalBox = ui.shadow.querySelector("[data-po-original]");
  const optimizedBox = ui.shadow.querySelector("[data-po-optimized]");

  let activeInput = null;
  let hideTimer = null;
  let listenersAbortController = new AbortController();
  let optimizingRequestId = 0;
  let isOptimizing = false;
  let lastOptimizedSource = "";
  let lastOptimizedValue = "";
  let lastTypingAt = 0;
  let lastInteractionAt = 0;
  let drag = null;

  const markInteraction = () => {
    lastInteractionAt = Date.now();
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const setWidgetVisible = (visible) => {
    ui.host.style.display = visible ? "block" : "none";
    if (!visible) {
      setExpanded(false);
    }
  };

  const setExpanded = (expanded) => {
    if (!panel) {
      return;
    }
    panel.classList.toggle("po-hidden", !expanded);
  };

  const runOptimization = async () => {
    const original = readPromptInputValue(activeInput);
    originalBox.textContent = original || "Start typing in a prompt box...";

    if (!original) {
      optimizedBox.textContent = "Optimized prompt will appear here.";
      return;
    }

    if (original === lastOptimizedSource && lastOptimizedValue) {
      optimizedBox.textContent = lastOptimizedValue;
      return;
    }

    if (isOptimizing) {
      return;
    }

    isOptimizing = true;

    const currentRequestId = ++optimizingRequestId;
    optimizedBox.textContent = "⚡ Improving prompt...";

    try {
      const optimized = await rewritePromptWithLLM(original);
      if (currentRequestId !== optimizingRequestId) {
        return;
      }

      lastOptimizedSource = original;
      lastOptimizedValue = optimized || optimizePromptText(original) || original;
      optimizedBox.textContent = lastOptimizedValue;
    } catch {
      if (currentRequestId === optimizingRequestId) {
        optimizedBox.textContent = "Unable to optimize right now.";
      }
    } finally {
      if (currentRequestId === optimizingRequestId) {
        isOptimizing = false;
      }
    }
  };

  const copyOptimizedToInput = () => {
    const target = normalizePromptInputElement(activeInput || document.activeElement);
    const optimized = quickCleanText(lastOptimizedValue || optimizedBox.textContent || "");

    if (!target || !optimized || optimized === "⚡ Improving prompt...") {
      return;
    }

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      target.focus();
      target.value = optimized;
      target.setSelectionRange(optimized.length, optimized.length);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (target instanceof HTMLElement) {
      target.focus();
      target.textContent = optimized;
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: optimized, inputType: "insertText" }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const scheduleAutoHide = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      hideTimer = null;

      const activeEl = document.activeElement;
      const focusInInput = isPromptInputElement(activeEl);
      const focusInOptimizer = activeEl === ui.host || (activeEl instanceof Node && ui.shadow.contains(activeEl));
      const idleForMs = Date.now() - Math.max(lastTypingAt, lastInteractionAt);

      if (idleForMs >= PROMPT_OPTIMIZER_IDLE_HIDE_MS && !focusInInput && !focusInOptimizer) {
        setWidgetVisible(false);
      } else if (ui.host.style.display !== "none") {
        scheduleAutoHide();
      }
    }, PROMPT_OPTIMIZER_IDLE_HIDE_MS);
  };

  const handleFocusIn = (event) => {
    const candidate = normalizePromptInputElement(event.target);
    if (!candidate || !isPromptInputElement(candidate)) {
      return;
    }
    activeInput = candidate;
    markInteraction();
    originalBox.textContent = readPromptInputValue(activeInput) || "Start typing in a prompt box...";
    optimizedBox.textContent = lastOptimizedValue || "Click Optimize now to improve this prompt.";
  };

  const handleInput = (event) => {
    const candidate = normalizePromptInputElement(event.target);
    if (!candidate || !isPromptInputElement(candidate)) {
      return;
    }

    activeInput = candidate;
    lastTypingAt = Date.now();
    markInteraction();
    originalBox.textContent = readPromptInputValue(activeInput) || "Start typing in a prompt box...";
    if (!lastOptimizedValue) {
      optimizedBox.textContent = "Click Optimize now to improve this prompt.";
    }
  };

  const handleFocusOut = (event) => {
    const nextFocus = event.relatedTarget;
    if (nextFocus === ui.host || (nextFocus instanceof Node && ui.shadow.contains(nextFocus))) {
      markInteraction();
      return;
    }
  };

  const beginDrag = (event) => {
    markInteraction();
    drag = null;
    event.preventDefault();
  };

  toggleBtn?.addEventListener("click", () => {
    markInteraction();
    setWidgetVisible(true);
    const isHidden = panel?.classList.contains("po-hidden");
    setExpanded(Boolean(isHidden));
    originalBox.textContent = readPromptInputValue(activeInput || document.activeElement) || "Start typing in a prompt box...";
    if (!lastOptimizedValue) {
      optimizedBox.textContent = "Click Optimize now to improve this prompt.";
    }
  });

  refreshBtn?.addEventListener("click", () => {
    markInteraction();
    runOptimization();
    setExpanded(true);
  });

  copyBtn?.addEventListener("click", () => {
    markInteraction();
    copyOptimizedToInput();
    setExpanded(true);
  });

  dragHandle?.addEventListener("pointerdown", beginDrag);
  ui.shadow.addEventListener("pointerdown", () => {
    markInteraction();
  });
  ui.shadow.addEventListener("focusin", () => {
    markInteraction();
  });

  document.addEventListener("focusin", handleFocusIn, { capture: true, signal: listenersAbortController.signal });
  document.addEventListener("input", handleInput, { capture: true, signal: listenersAbortController.signal });
  document.addEventListener("focusout", handleFocusOut, { capture: true, signal: listenersAbortController.signal });

  const inputLifecycleObserver = new MutationObserver(() => {
    if (activeInput && !document.contains(activeInput)) {
      activeInput = null;
    }
  });
  inputLifecycleObserver.observe(document.body || document.documentElement, {
    subtree: true,
    childList: true,
  });

  promptOptimizerWidget = {
    ui,
    inputLifecycleObserver,
    cleanup: () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      listenersAbortController.abort();
      inputLifecycleObserver.disconnect();
    },
  };
}

async function bootstrap() {
  initPromptOptimizerWidget();

  runtimeGuardEnabled = isChatLikePage();
  if (!runtimeGuardEnabled) {
    console.log("SafeNet: Not a chat-like page, skipping content script runtime.");
    return;
  }

  ensureAnalyzeFab();
  currentSnapshot = buildConversationSnapshot();

  mutationObserver = new MutationObserver(() => {
    scheduleExtraction();
  });

  mutationObserver.observe(document.body || document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleExtraction();
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SAFENET_GET_CURRENT_SNAPSHOT") {
    if (!runtimeGuardEnabled && !isChatLikePage()) {
      sendResponse(null);
      return false;
    }

    const snapshot = buildConversationSnapshot();
    currentSnapshot = snapshot;
    sendResponse(snapshot);
    return false;
  }

  if (message?.type === "SAFENET_TAB_ANALYSIS_RESULT") {
    currentSnapshot = message.payload?.snapshot || currentSnapshot;
    currentResult = message.payload?.result || null;
    currentError = message.payload?.error || null;
    overlayElements.status.textContent = currentError ? "Analysis error" : "Live analysis updated";
    renderState();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "SAFENET_TAB_STATUS") {
    currentSnapshot = message.payload?.snapshot || currentSnapshot;
    currentResult = null;
    currentError = null;
    overlayElements.status.textContent = message.payload?.message || "Waiting for conversation";
    renderState();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
