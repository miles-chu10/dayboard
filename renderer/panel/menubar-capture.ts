/** After a rejected capture: keep anything typed since, and name the text that failed. */
export function afterRejection(
  current: string,
  submitted: string,
  reason: string,
): { text: string; error: string } {
  return {
    text: current.trim() ? current : submitted,
    error: `Couldn’t add “${submitted}”: ${reason}`,
  };
}
