// Reconnect schedule for the speech-to-text socket: 1 s, 2 s, 4 s, then give up.
export const MAX_RETRIES = 3;
export function backoffDelays(base = 1000, retries = MAX_RETRIES) {
  return Array.from({ length: retries }, (_, i) => base * 2 ** i);
}
