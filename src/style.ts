/**
 * Minimal ANSI styling for the terminal.
 *
 * Colors are emitted only when stdout is a TTY and NO_COLOR is unset, so piped
 * output and CI stay plain. No dependencies; each helper wraps one SGR code.
 */

const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function sgr(codes: string, text: string): string {
  return enabled ? `\x1b[${codes}m${text}\x1b[0m` : text;
}

export const dim = (text: string) => sgr("2", text);
export const red = (text: string) => sgr("31", text);
export const green = (text: string) => sgr("32", text);
export const yellow = (text: string) => sgr("33", text);
export const magenta = (text: string) => sgr("35", text);
export const cyan = (text: string) => sgr("36", text);
export const boldGreen = (text: string) => sgr("1;32", text);
