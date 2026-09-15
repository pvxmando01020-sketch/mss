const KEY = 'mss-session';

/**
 * Anonymous session id per browser (localStorage).
 * The API maps it to a user row (users.session_token) for per-session
 * conversation isolation and per-session rate limiting.
 */
export function getSessionId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
  } catch {
    id = `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return id;
}

export function sessionHeaders(): Record<string, string> {
  return { 'x-session-id': getSessionId() };
}
