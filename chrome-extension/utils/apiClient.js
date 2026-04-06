const DEFAULT_API_BASE_URL = "http://127.0.0.1:8001";
const STORAGE_KEY = "safenetApiBaseUrl";

export class ApiError extends Error {
  constructor(message, code = "REQUEST_FAILED", status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isLikelyJson(contentType) {
  return String(contentType || "").toLowerCase().includes("application/json");
}

function asText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (isLikelyJson(contentType)) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeErrorPayload(payload, fallbackStatus, fallbackMessage) {
  if (!payload || typeof payload !== "object") {
    return {
      code: `HTTP_${fallbackStatus}`,
      message: fallbackMessage,
      details: payload,
    };
  }

  const error = payload.error;
  if (error && typeof error === "object") {
    return {
      code: asText(error.code || payload.code || `HTTP_${fallbackStatus}`),
      message: asText(error.message || payload.message || fallbackMessage),
      details: payload,
    };
  }

  if (typeof error === "string") {
    return {
      code: error,
      message: asText(payload.message || fallbackMessage),
      details: payload,
    };
  }

  return {
    code: asText(payload.code || `HTTP_${fallbackStatus}`),
    message: asText(payload.message || fallbackMessage),
    details: payload,
  };
}

function resolveExtensionStorage() {
  return typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : null;
}

export async function getApiBaseUrl() {
  const storage = resolveExtensionStorage();
  if (!storage) {
    return DEFAULT_API_BASE_URL;
  }

  const result = await storage.get(STORAGE_KEY);
  const configured = asText(result?.[STORAGE_KEY]).trim();
  return configured || DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(baseUrl) {
  const storage = resolveExtensionStorage();
  if (!storage) {
    return;
  }

  const normalized = asText(baseUrl).trim().replace(/\/$/, "");
  if (!normalized) {
    await storage.remove(STORAGE_KEY);
    return;
  }

  await storage.set({ [STORAGE_KEY]: normalized });
}

export function createApiClient({ baseUrl = DEFAULT_API_BASE_URL, timeoutMs = 40000, retries = 1 } = {}) {
  const normalizedBaseUrl = asText(baseUrl).trim().replace(/\/$/, "") || DEFAULT_API_BASE_URL;
  const evaluateUrl = `${normalizedBaseUrl}/api/v1/evaluate`;

  async function requestEvaluate(payload, requestOptions = {}) {
    const effectiveTimeoutMs = Number(requestOptions.timeoutMs ?? timeoutMs ?? 40000);
    const maxAttempts = Math.max(1, Number(requestOptions.retries ?? retries ?? 1) + 1);
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

      try {
        const response = await fetch(evaluateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const body = await readResponseBody(response);

        if (!response.ok) {
          const fallbackMessage = `Request failed with status ${response.status}`;
          const normalized = normalizeErrorPayload(body, response.status, fallbackMessage);
          throw new ApiError(normalized.message, normalized.code, response.status, normalized.details);
        }

        return body;
      } catch (error) {
        const isAbort = error?.name === "AbortError";
        const isNetworkFailure = !isAbort && error?.name === "TypeError";
        const status = isAbort ? 504 : error?.status || 0;
        const code = isAbort
          ? "LLM_TIMEOUT"
          : isNetworkFailure
            ? "BACKEND_OFFLINE"
            : error?.code || "REQUEST_FAILED";
        const message = isAbort
          ? "Model did not respond in time"
          : isNetworkFailure
            ? `Cannot reach backend at ${evaluateUrl}. Ensure SafeNet API is running.`
            : asText(error?.message || "Request failed");

        lastError = error instanceof ApiError
          ? error
          : new ApiError(
              message,
              code,
              status,
              error,
            );

        const shouldRetry = attempt < maxAttempts && (isAbort || code === "REQUEST_FAILED" || code === "LLM_TIMEOUT");
        if (!shouldRetry) {
          throw lastError;
        }

        await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new ApiError("Request failed", "REQUEST_FAILED", 0);
  }

  return {
    requestEvaluate,
  };
}

export async function evaluatePayload(payload, options = {}) {
  const baseUrl = options.baseUrl || (await getApiBaseUrl());
  const client = createApiClient({
    baseUrl,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });
  return client.requestEvaluate(payload, options);
}
