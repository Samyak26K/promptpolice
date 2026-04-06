import { ApiError, evaluatePayload, getApiBaseUrl, optimizePromptPayload } from "./utils/apiClient.js";

const DEFAULT_DEBOUNCE_MS = 1200;
const tabState = new Map();

function getOrCreateTabState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      snapshot: null,
      result: null,
      error: null,
      timer: null,
      signature: "",
      updatedAt: 0,
    });
  }

  return tabState.get(tabId);
}

function cleanSignal(text) {
  return String(text || "").trim();
}

function extractRiskBand(result) {
  const level = String(result?.summary?.risk_level || "").toLowerCase();
  if (level === "low") {
    return { text: "LOW", color: "#16a34a" };
  }
  if (level === "medium") {
    return { text: "MED", color: "#f59e0b" };
  }
  return { text: "HIGH", color: "#dc2626" };
}

function buildErrorEnvelope(error) {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  return {
    code: error?.code || "REQUEST_FAILED",
    message: error?.message || "Request failed",
    status: error?.status || 0,
  };
}

async function notifyTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The tab might not have an injected content script yet.
  }
}

async function updateBadge(tabId, result, error) {
  if (!chrome.action?.setBadgeText) {
    return;
  }

  if (error) {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#dc2626" });
    return;
  }

  if (!result?.summary?.risk_level) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }

  const band = extractRiskBand(result);
  await chrome.action.setBadgeText({ tabId, text: band.text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: band.color });
}

async function analyzeSnapshot(tabId, snapshot) {
  const state = getOrCreateTabState(tabId);
  const prompt = cleanSignal(snapshot?.prompt);
  const response = cleanSignal(snapshot?.response);

  state.snapshot = { ...snapshot, prompt, response };
  state.updatedAt = Date.now();

  if (!prompt || !response) {
    state.result = null;
    state.error = null;
    await updateBadge(tabId, null, null);
    await notifyTab(tabId, {
      type: "SAFENET_TAB_STATUS",
      payload: {
        kind: "waiting",
        snapshot: state.snapshot,
        message: prompt
          ? "Waiting for the assistant response to finish streaming."
          : "Waiting for a complete prompt and response pair.",
      },
    });
    return { snapshot: state.snapshot, result: null, error: null };
  }

  try {
    const apiBaseUrl = await getApiBaseUrl();
    const result = await evaluatePayload(
      {
        prompt,
        response,
      },
      {
        baseUrl: apiBaseUrl,
        timeoutMs: 40000,
        retries: 1,
      },
    );

    state.result = result;
    state.error = null;
    state.signature = snapshot.signature || `${prompt}\n${response}`;

    await updateBadge(tabId, result, null);
    await notifyTab(tabId, {
      type: "SAFENET_TAB_ANALYSIS_RESULT",
      payload: {
        snapshot: state.snapshot,
        result,
        error: null,
      },
    });

    return { snapshot: state.snapshot, result, error: null };
  } catch (error) {
    const normalizedError = buildErrorEnvelope(error);
    state.result = null;
    state.error = normalizedError;

    await updateBadge(tabId, null, normalizedError);
    await notifyTab(tabId, {
      type: "SAFENET_TAB_ANALYSIS_RESULT",
      payload: {
        snapshot: state.snapshot,
        result: null,
        error: normalizedError,
      },
    });

    return { snapshot: state.snapshot, result: null, error: normalizedError };
  }
}

function scheduleAnalysis(tabId, snapshot) {
  const state = getOrCreateTabState(tabId);
  const signature = cleanSignal(snapshot?.signature || `${snapshot?.prompt || ""}\n${snapshot?.response || ""}`);

  if (!signature || signature === state.signature) {
    return;
  }

  state.signature = signature;
  state.snapshot = {
    ...snapshot,
    prompt: cleanSignal(snapshot?.prompt),
    response: cleanSignal(snapshot?.response),
  };

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    analyzeSnapshot(tabId, state.snapshot).catch(() => {
      // Analysis failures are handled inside analyzeSnapshot.
    });
  }, DEFAULT_DEBOUNCE_MS);
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id ?? null;
}

async function requestSnapshotFromTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SAFENET_GET_CURRENT_SNAPSHOT" });
  } catch {
    return null;
  }
}

async function extractSnapshotViaScripting(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
        const pickLastText = (selectors) => {
          for (const selector of selectors) {
            const nodes = [...document.querySelectorAll(selector)].filter((node) => node instanceof HTMLElement);
            for (let i = nodes.length - 1; i >= 0; i -= 1) {
              const text = clean(nodes[i].innerText || nodes[i].textContent || "");
              if (text) {
                return text;
              }
            }
          }
          return "";
        };

        const userSelectors = [
          "div[data-message-author-role='user']",
          "main [data-message-author-role='user']",
          "div[data-testid='user-message']",
          "[data-testid='user-message']",
          ".user-message",
        ];

        const assistantSelectors = [
          "div[data-message-author-role='assistant']",
          "main [data-message-author-role='assistant']",
          "div[data-testid='assistant-message']",
          "[data-testid='assistant-message']",
          ".assistant-message",
          "article[data-testid*='conversation-turn'] .markdown",
          "article[data-testid*='conversation-turn'] .prose",
        ];

        const prompt = pickLastText(userSelectors);
        const response = pickLastText(assistantSelectors);

        if (!prompt && !response) {
          const fallback = clean((document.body?.innerText || "").slice(-2000));
          return {
            prompt: "",
            response: fallback,
            signature: `${fallback}`,
            source: fallback ? "background-fallback-body-tail" : null,
            detectedAt: Date.now(),
            empty: !fallback,
          };
        }

        return {
          prompt,
          response,
          signature: `${prompt}${response}`,
          source: "background-selector-fallback",
          detectedAt: Date.now(),
          empty: !prompt && !response,
        };
      },
    });

    return result || null;
  } catch {
    return null;
  }
}

async function getTabStatePayload(tabId) {
  const state = tabId ? getOrCreateTabState(tabId) : null;
  return {
    tabId,
    snapshot: state?.snapshot || null,
    result: state?.result || null,
    error: state?.error || null,
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const baseUrl = await getApiBaseUrl();
  console.log("SafeNet AI Inspector installed. API base URL:", baseUrl);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "SAFENET_SNAPSHOT_UPDATED") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: { code: "NO_TAB", message: "Missing sender tab" } });
      return false;
    }

    scheduleAnalysis(tabId, message.snapshot || message.payload || {});
    sendResponse({ ok: true });
    return false;
  }

  if (type === "SAFENET_GET_ACTIVE_TAB_STATE") {
    (async () => {
      const tabId = await getActiveTabId();
      if (!tabId) {
        return { ok: false, error: { code: "NO_ACTIVE_TAB", message: "No active tab found" } };
      }

      const state = getOrCreateTabState(tabId);
      let snapshot = state.snapshot;
      let result = state.result;
      let error = state.error;

      if (!snapshot) {
        snapshot = await requestSnapshotFromTab(tabId);
      }

      if (!snapshot) {
        snapshot = await extractSnapshotViaScripting(tabId);
      }

      return {
        ok: true,
        tabId,
        snapshot,
        result,
        error,
      };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: buildErrorEnvelope(error) }));

    return true;
  }

  if (type === "SAFENET_ANALYZE_ACTIVE_TAB") {
    (async () => {
      const tabId = await getActiveTabId();
      if (!tabId) {
        return { ok: false, error: { code: "NO_ACTIVE_TAB", message: "No active tab found" } };
      }

      const snapshot = await requestSnapshotFromTab(tabId);
      const effectiveSnapshot = snapshot || (await extractSnapshotViaScripting(tabId));
      if (!effectiveSnapshot) {
        return {
          ok: true,
          tabId,
          snapshot: null,
          result: null,
          error: { code: "NO_CHAT_DETECTED", message: "No supported chat content was found on this page." },
        };
      }

      return {
        ok: true,
        tabId,
        ...(await analyzeSnapshot(tabId, effectiveSnapshot)),
      };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: buildErrorEnvelope(error) }));

    return true;
  }

  if (type === "SAFENET_GET_CURRENT_SNAPSHOT") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: { code: "NO_TAB", message: "Missing sender tab" } });
      return false;
    }

    const state = getOrCreateTabState(tabId);
    sendResponse({
      ok: true,
      tabId,
      snapshot: state.snapshot,
      result: state.result,
      error: state.error,
    });
    return false;
  }

  if (type === "SAFENET_REQUEST_ANALYSIS") {
    (async () => {
      const tabId = message.tabId || (await getActiveTabId());
      if (!tabId) {
        return { ok: false, error: { code: "NO_ACTIVE_TAB", message: "No active tab found" } };
      }

      const snapshot = message.snapshot || (await requestSnapshotFromTab(tabId));
      const effectiveSnapshot = snapshot || (await extractSnapshotViaScripting(tabId));
      if (!effectiveSnapshot) {
        return {
          ok: true,
          tabId,
          snapshot: null,
          result: null,
          error: { code: "NO_CHAT_DETECTED", message: "No supported chat content was found on this page." },
        };
      }

      return {
        ok: true,
        tabId,
        ...(await analyzeSnapshot(tabId, effectiveSnapshot)),
      };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: buildErrorEnvelope(error) }));

    return true;
  }

  if (type === "SAFENET_OPTIMIZE_PROMPT") {
    (async () => {
      const prompt = cleanSignal(message?.prompt);
      if (!prompt) {
        return {
          ok: false,
          error: { code: "INVALID_PROMPT", message: "Prompt is required for optimization." },
        };
      }

      const apiBaseUrl = await getApiBaseUrl();
      const payload = await optimizePromptPayload(
        { prompt },
        {
          baseUrl: apiBaseUrl,
          timeoutMs: Number(message?.timeoutMs || 30000),
          retries: 0,
        },
      );

      return {
        ok: true,
        optimizedPrompt: cleanSignal(payload?.optimized_prompt || payload?.optimizedPrompt || ""),
      };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: buildErrorEnvelope(error) }));

    return true;
  }

  return false;
});
