// /api/_lib/fetchWithRetry.js
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, options = {}, retries = DEFAULT_RETRIES) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) {
      // 429 / 5xx はリトライ対象
      if (retries > 0 && (res.status === 429 || (res.status >= 500 && res.status <= 599))) {
        const delay = (DEFAULT_RETRIES - retries + 1) * 400; // 400ms, 800ms, 1200ms...
        await sleep(delay);
        return fetchWithRetry(url, options, retries - 1);
      }
    }
    return res;
  } catch (e) {
    if (retries > 0) {
      const delay = (DEFAULT_RETRIES - retries + 1) * 400;
      await sleep(delay);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchWithRetry };