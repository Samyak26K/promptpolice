const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");

export async function evaluateOutput(payload) {
  const response = await fetch(`${API_BASE_URL}/api/v1/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorCode = data?.error?.code || "REQUEST_FAILED";
    const errorMessage = data?.error?.message || `Request failed with status ${response.status}`;
    const error = new Error(errorMessage);
    error.code = errorCode;
    throw error;
  }

  return data;
}
