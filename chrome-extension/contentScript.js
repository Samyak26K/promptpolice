const OVERLAY_ID = "safenet-ai-overlay-root";
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
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.inset = "auto 18px 18px auto";

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

  document.documentElement.appendChild(host);
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
  if (!overlayElements?.host) {
    return;
  }

  dragState = {
    startX: event.clientX,
    startY: event.clientY,
    left: overlayElements.host.getBoundingClientRect().left,
    top: overlayElements.host.getBoundingClientRect().top,
  };

  overlayElements.host.style.inset = "auto";
  overlayElements.host.style.right = "auto";
  overlayElements.host.style.bottom = "auto";
  overlayElements.host.style.left = `${dragState.left}px`;
  overlayElements.host.style.top = `${dragState.top}px`;

  window.addEventListener("pointermove", continueDrag);
  window.addEventListener("pointerup", endDrag, { once: true });
}

function continueDrag(event) {
  if (!dragState || !overlayElements?.host) {
    return;
  }

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  overlayElements.host.style.left = `${Math.max(8, dragState.left + dx)}px`;
  overlayElements.host.style.top = `${Math.max(8, dragState.top + dy)}px`;
}

function endDrag() {
  dragState = null;
  window.removeEventListener("pointermove", continueDrag);
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
      currentResult = null;
      currentError = null;
      renderState();
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
      currentResult = null;
      currentError = null;
      showOverlay();
      overlayElements.status.textContent = "Waiting for response to finish streaming";
      renderState();
      return;
    }

    if (snapshot.signature === lastSignature) {
      return;
    }

    lastSignature = snapshot.signature;
    currentSnapshot = snapshot;
    currentError = null;
    renderSnapshot(snapshot);
    showOverlay();
    overlayElements.status.textContent = "Conversation updated";
    renderWaiting("Sending the latest prompt and response to SafeNet AI.");

    sendMessage({
      type: "SAFENET_SNAPSHOT_UPDATED",
      snapshot,
    }).catch(() => {
      // The background worker may not be ready yet.
    });
  }, DEBOUNCE_MS);
}

async function bootstrap() {
  runtimeGuardEnabled = isChatLikePage();
  if (!runtimeGuardEnabled) {
    console.log("SafeNet: Not a chat-like page, skipping content script runtime.");
    return;
  }

  ensureOverlayRoot();
  showOverlay();
  renderWaiting("Waiting for conversation data from a supported LLM chat.");
  renderSnapshot(buildConversationSnapshot());

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

  scheduleExtraction();
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
