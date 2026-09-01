import { TextStyle } from 'react-native';

import { color } from './tokens';

/**
 * Barlow Condensed for headings, Barlow for body — the Industry pairing.
 *
 * React Native cannot synthesise weights for a custom font, so every text
 * style names its family explicitly. Never set `fontWeight` on its own.
 */
export const font = {
  /** Barlow 400 — body copy. */
  body: 'Barlow_400Regular',
  /** Barlow 500 — list row titles. */
  medium: 'Barlow_500Medium',
  /** Barlow 600 — card titles, emphasised body. */
  semibold: 'Barlow_600SemiBold',
  /** Barlow Condensed 600 — every heading, and every button label. */
  head: 'BarlowCondensed_600SemiBold',
} as const;

/**
 * Letter-spacing in the design is expressed in `em`. React Native wants
 * points, so convert against the size it is used at.
 */
export const tracking = (size: number, em: number) => size * em;

/**
 * The documented scale. Sizes are final; only colour varies by context, so
 * these styles deliberately leave `color` out except where the design pins it.
 */
export const text = {
  /** Screen title — 34px condensed uppercase. */
  screenTitle: {
    fontFamily: font.head,
    fontSize: 34,
    lineHeight: 34,
    textTransform: 'uppercase',
    color: color.text,
  },

  /** Section header — 22px condensed uppercase, .02em. */
  sectionHeader: {
    fontFamily: font.head,
    fontSize: 22,
    lineHeight: 24,
    letterSpacing: tracking(22, 0.02),
    textTransform: 'uppercase',
    color: color.text,
  },

  /** Card title — 15px Barlow 600. */
  cardTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text,
  },

  /** Body — 14.5px. */
  body: {
    fontFamily: font.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: color.text,
  },

  /** Row title — 14.5px Barlow 500. */
  rowTitle: {
    fontFamily: font.medium,
    fontSize: 14.5,
    lineHeight: 20,
    color: color.text,
  },

  /** Row title, emphasised — 14.5px Barlow 600. */
  rowTitleStrong: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    lineHeight: 20,
    color: color.text,
  },

  /** Meta / secondary — 12.5px. This is the smallest text in the system. */
  meta: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.neutral600,
  },

  /** Group label — 10.5px uppercase, .13em. */
  eyebrow: {
    fontFamily: font.body,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: tracking(10.5, 0.13),
    textTransform: 'uppercase',
    color: color.neutral600,
  },

  /** Tab label — 10px uppercase, .09em. */
  tabLabel: {
    fontFamily: font.body,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: tracking(10, 0.09),
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;
