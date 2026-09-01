/**
 * Prime & Calculate design tokens.
 *
 * Structure comes from the "Industry" design system (square corners, hairline
 * borders, blueprint registration marks). Colour comes from the Prime &
 * Calculate brand palette, which overrides Industry's steel-blue defaults.
 *
 * Values are transcribed from the handoff README's token table. Do not invent
 * new colours here — if a screen needs a tint, derive it from a ramp step.
 */

export const color = {
  bg: '#F7F5F1',
  surface: '#FFFFFF',
  text: '#0F2A3B',
  /** All hairline borders and rules: text @ 16%. */
  divider: 'rgba(15, 42, 59, 0.16)',

  accent: '#B0813C',
  accent100: '#FAF4E9',
  accent200: '#F1E4CB',
  accent300: '#E3CC9B',
  accent400: '#D0AE68',
  accent500: '#B0813C',
  accent600: '#8F6830',
  accent700: '#6E5025',
  accent800: '#1D4257',
  accent900: '#0F2A3B',

  neutral100: '#EAE5DC',
  neutral200: '#E9E5DE',
  neutral300: '#D6D1C8',
  neutral400: '#B4AEA4',
  neutral500: '#93908A',
  neutral600: '#7A8892',
  neutral700: '#5C6A74',
  neutral800: '#33454F',
  neutral900: '#0F2A3B',
} as const;

/**
 * Derived surfaces. Each one is a tint of a token above, never a new hue.
 */
export const tint = {
  /** Blueprint registration marks on the paper ground: text @ 55%. */
  markInk: 'rgba(15, 42, 59, 0.55)',
  /** Registration marks over a navy field, so they stay visible: bg @ 55%. */
  markPaper: 'rgba(247, 245, 241, 0.55)',
  /** Home alert card fill: accent @ 18%. */
  alert: 'rgba(176, 129, 60, 0.18)',
  /** Sign-in input fill over navy. */
  fieldOnNavy: 'rgba(242, 242, 243, 0.07)',
  /** Placeholder text over navy. */
  placeholderOnNavy: 'rgba(247, 245, 241, 0.45)',
  /** Pressed state for outlined/ghost controls on paper: text @ 14%. */
  pressInk: 'rgba(15, 42, 59, 0.14)',
  /** Pressed state for a card acting as a button: text @ 5%. */
  pressCard: 'rgba(15, 42, 59, 0.05)',
  /** Pressed state for ghost buttons: accent @ 18%. */
  pressAccent: 'rgba(176, 129, 60, 0.18)',
  /** Sheet backdrop: neutral-900 @ 50%. */
  backdrop: 'rgba(15, 42, 59, 0.5)',
} as const;

export const space = {
  /** Horizontal padding on every screen. */
  screenX: 22,
  /** Padding inside a card. */
  card: 16,
  /** Gap between stacked cards. */
  cardGap: 12,
  /** Top margin before a new section. */
  section: 28,
} as const;

/**
 * Radius is zero everywhere. Square corners are the system — this constant
 * exists so the rule is greppable, not so it can be changed.
 */
export const RADIUS = 0;

/** Hairline border width used by every framed object. */
export const HAIRLINE = 1;

/**
 * The only shadow in the system. Everything except the toast is flat.
 * Mirrors Industry's --shadow-lg.
 */
export const shadowLg = {
  shadowColor: '#0F2A3B',
  shadowOpacity: 0.22,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
} as const;

/**
 * The prototype is laid out for a 402pt-wide phone. Wider viewports keep the
 * content in a centred column rather than stretching the line length.
 */
export const CONTENT_MAX_WIDTH = 520;

/**
 * The design measures top padding from the physical top of the screen, with
 * the status bar overlaid on it — the reference device has a 59pt top inset.
 * `topPad` re-expresses a design value against the real inset.
 */
export const REFERENCE_TOP_INSET = 59;
