export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 15000, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}
