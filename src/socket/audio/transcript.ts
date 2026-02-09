export function shouldEmitTranscript(
  state: { lastTranscriptText: string; lastTranscriptAt: number },
  text: string,
): boolean {
  const cleaned = text.trim();
  if (!cleaned) return false;

  const now = Date.now();
  const isDuplicate =
    cleaned.toLowerCase() === state.lastTranscriptText.toLowerCase() &&
    now - state.lastTranscriptAt < 2000;
  if (isDuplicate) return false;

  state.lastTranscriptText = cleaned;
  state.lastTranscriptAt = now;
  return true;
}
