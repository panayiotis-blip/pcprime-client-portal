import type { ReactNode } from 'react';

// Shared firm letterhead lockup for printed documents. Arranges the company
// name and logo per the firm's letterhead_logo_position / _height settings, so
// every printed document (engagement letter aside — that's jsPDF) shows the
// same brand lockup. Colours come from the surrounding print-page's CSS vars.

export type LogoPosition = 'name_only' | 'logo_left' | 'logo_right' | 'logo_above' | 'logo_only';
export type LogoHeight = 'small' | 'medium' | 'large';

export default function PrintLetterhead({
  name,
  logoUrl,
  position = 'logo_right',
  height = 'medium',
  meta,
}: {
  name: string;
  logoUrl?: string | null;
  position?: LogoPosition;
  height?: LogoHeight;
  /** Address / contact lines rendered under the lockup. */
  meta?: ReactNode;
}) {
  const showLogo = position !== 'name_only' && !!logoUrl;
  const showName = position !== 'logo_only';

  const logo = showLogo
    ? <img className={`pc-lh-logo pc-lh-logo--${height}`} src={logoUrl as string} alt={name || 'Company logo'} />
    : null;
  const nameEl = showName ? <div className="pc-lh-name">{name || '—'}</div> : null;

  // Order the lockup children by position.
  let lockup: ReactNode;
  if (position === 'logo_right') lockup = <>{nameEl}{logo}</>;
  else if (position === 'logo_left' || position === 'logo_above') lockup = <>{logo}{nameEl}</>;
  else if (position === 'logo_only') lockup = logo;
  else lockup = nameEl; // name_only

  return (
    <div className="pc-lh">
      <div className={`pc-lh-lockup ${position === 'logo_above' ? 'pc-lh-lockup--stacked' : ''}`}>
        {lockup}
      </div>
      {meta}
    </div>
  );
}
