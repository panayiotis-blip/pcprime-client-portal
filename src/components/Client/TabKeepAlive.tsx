import { Component, useRef, type ReactNode } from 'react';

// Keep-alive wrapper for client-detail tabs.
//
// Background: the tab pane used to render each tab conditionally
// (`{tab === 'x' && <Tab/>}`), so switching tabs unmounted the current one and
// discarded its local state (filters, scroll, in-flight fetches). A previous
// attempt to keep tabs alive mounted ALL of them at once and crashed the page.
//
// This version is deliberately conservative:
//  - LAZY: a tab is not mounted until it's activated for the first time, so page
//    load mounts nothing extra and a never-opened tab costs nothing. Once opened
//    it stays mounted and is merely hidden with `display:none`.
//  - `display:contents` while active means the wrapper adds no layout box — the
//    tab lays out exactly as a direct child of `.cd-tab-pane`, unchanged.
//  - Charts/measured content mount while VISIBLE (first activation), so they size
//    correctly; hiding later just stops painting, it doesn't remount them.
//
// Reset per client by passing `key={clientId}` at the call site.
export function KeepAlive({ active, children }: { active: boolean; children: ReactNode }) {
  const mountedOnce = useRef(false);
  if (active) mountedOnce.current = true;
  if (!mountedOnce.current) return null; // never opened yet — render nothing
  return <div style={{ display: active ? 'contents' : 'none' }}>{children}</div>;
}

// Contains a render error to the single tab that threw, so one bad tab can't
// blank the whole client page (the failure mode of the earlier keep-alive try).
export class TabErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[TabErrorBoundary]', this.props.label, error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" style={{ padding: 24 }}>
          <p>This tab hit an error and couldn't be shown.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
