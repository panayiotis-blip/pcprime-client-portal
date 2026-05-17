/** Tiny className joiner — drops falsy values, joins the rest with a space. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
