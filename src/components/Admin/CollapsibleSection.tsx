import { type ReactNode } from 'react';

// Collapsible panel styled like a form-section. Used to tidy up the
// Company Settings page — admin sub-tools start collapsed and expand on
// click. Built on the native <details>/<summary> elements.
export default function CollapsibleSection({
  title,
  headerRight,
  defaultOpen = false,
  children,
}: {
  title: string;
  headerRight?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="form-section collapsible-section" open={defaultOpen}>
      <summary className="collapsible-summary">
        <span className="collapsible-title">{title}</span>
        {headerRight ? (
          // Stop the click from toggling the panel when using header controls.
          <span className="collapsible-actions" onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </span>
        ) : null}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
