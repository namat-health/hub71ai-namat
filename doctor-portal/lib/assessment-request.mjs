// A stalled connection must never leave the assessment card spinning forever.
export async function assessmentRequest(
  url,
  options = {},
  timeoutMs = 25000,
  fetchImpl = fetch,
) {
  const controller = new AbortController();
  let timer;
  let cancel;
  const deadline = new Promise((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error("The assessment took too long to respond. Please try again."),
      );
    }, timeoutMs);
  });
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (options.signal?.aborted) {
      cancel();
      return await deadline;
    }
    return await Promise.race([
      fetchImpl(url, { ...options, signal: controller.signal }).then(
        async (response) => ({
          response,
          data: await response.json().catch(() => ({})),
        }),
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
