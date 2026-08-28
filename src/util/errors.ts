/** The readable half of anything that was thrown, so callers stop rewriting the same ternary. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
