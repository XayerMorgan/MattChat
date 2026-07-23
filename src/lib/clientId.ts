/** Stable browser client id for multi-user server capacity accounting. */

const KEY = "mattchat-client-id";

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `ephemeral-${Date.now()}`;
  }
}

export function mattchatHeaders(
  extra?: Record<string, string>
): Record<string, string> {
  return {
    "X-MattChat-Client-Id": getClientId(),
    ...(extra || {}),
  };
}
