// Parses `#t=<token>` from the current URL fragment. Returns null if absent.
export function readToken(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
}
