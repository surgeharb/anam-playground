export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      payload?.error || `Request failed with status ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function isRetriableStartError(error) {
  if (typeof error?.status === "number") {
    return error.status >= 500 || error.status === 429;
  }

  return true;
}
