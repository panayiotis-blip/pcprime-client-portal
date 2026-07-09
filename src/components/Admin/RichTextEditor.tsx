import { useEffect, useRef } from 'react';

// Lightweight rich-text editor for composing email — no external dependency.
// A contentEditable surface plus a small formatting toolbar (Bold / Italic /
// Underline / bullet + numbered lists / link / clear-formatting). It emits the
// current innerHTML via onChange. Deliberately uncontrolled after mount: the
// initial HTML is written once, then the DOM owns the content and we only read
// from it — re-writing innerHTML on every keystroke would fight the caret.
//
// execCommand is deprecated on paper but is still the pragmatic, zero-dep way to
// do inline rich text and remains supported across current browsers. For a
// staff-only internal tool that's the right trade-off.

interface Props {
  value: string;               // initial HTML (set once on mount)
  onChange: (html: string) => void;
  minHeight?: number;
  ariaLabel?: string;
}

const btnStyle: React.CSSProperties = {
  border: '1px solid transparent', background: 'transparent', cursor: 'pointer',
  borderRadius: 4, padding: '3px 8px', fontSize: 14, lineHeight: 1, color: '#334155',
};

export default function RichTextEditor({ value, onChange, minHeight = 220, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed the editor content exactly once.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML ?? '');

  // Run a formatting command without losing the text selection (mousedown
  // preventDefault keeps focus in the editable region).
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt('Link address (https://…):', 'https://');
    if (url && url.trim() && url.trim() !== 'https://') exec('createLink', url.trim());
  };

  const Btn = ({ cmd, arg, title, children }: { cmd?: string; arg?: string; title: string; children: React.ReactNode; onClickOverride?: () => void }) => (
    <button
      type="button"
      title={title}
      style={btnStyle}
      onMouseDown={(e) => { e.preventDefault(); if (cmd) exec(cmd, arg); }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );

  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: 4, borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap' }}>
        <Btn cmd="bold" title="Bold"><strong>B</strong></Btn>
        <Btn cmd="italic" title="Italic"><em>I</em></Btn>
        <Btn cmd="underline" title="Underline"><span style={{ textDecoration: 'underline' }}>U</span></Btn>
        <span style={{ width: 1, height: 18, background: '#cbd5e1', margin: '0 4px' }} />
        <Btn cmd="insertUnorderedList" title="Bulleted list">•&nbsp;List</Btn>
        <Btn cmd="insertOrderedList" title="Numbered list">1.&nbsp;List</Btn>
        <span style={{ width: 1, height: 18, background: '#cbd5e1', margin: '0 4px' }} />
        <button type="button" title="Insert link" style={btnStyle}
          onMouseDown={(e) => { e.preventDefault(); addLink(); }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >🔗&nbsp;Link</button>
        <Btn cmd="removeFormat" title="Clear formatting">⌫&nbsp;Clear</Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel || 'Email body'}
        onInput={emit}
        onBlur={emit}
        style={{
          minHeight, maxHeight: 420, overflowY: 'auto', padding: '10px 12px',
          fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 14, lineHeight: 1.5,
          color: '#1a365d', outline: 'none',
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}
