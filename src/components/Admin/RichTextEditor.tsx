import { useEffect, useRef } from 'react';

// Lightweight rich-text editor for composing email — no external dependency.
// A contentEditable surface plus an icon-only formatting toolbar (Bold /
// Italic / Underline / bullet + numbered lists / link / clear-formatting),
// each with a tooltip. It emits the current innerHTML via onChange.
// Deliberately uncontrolled after mount: the initial HTML is written once,
// then the DOM owns the content and we only read from it — re-writing
// innerHTML on every keystroke would fight the caret.
//
// execCommand is deprecated on paper but is still the pragmatic, zero-dep way
// to do inline rich text and remains supported across current browsers. For a
// staff-only internal tool that's the right trade-off.

interface Props {
  value: string;               // initial HTML (set once on mount)
  onChange: (html: string) => void;
  minHeight?: number;
  ariaLabel?: string;
}

// ---- Toolbar icons (monochrome SVG, inherit currentColor) ----
const S = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const BulletIcon = (
  <svg {...S}>
    <circle cx="2.75" cy="4.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="2.75" cy="11.5" r="1" fill="currentColor" stroke="none" />
    <line x1="6" y1="4.5" x2="14" y2="4.5" />
    <line x1="6" y1="11.5" x2="14" y2="11.5" />
  </svg>
);
const NumberIcon = (
  <svg {...S}>
    <text x="0.5" y="6.3" fontSize="6" fill="currentColor" stroke="none">1</text>
    <text x="0.5" y="13.3" fontSize="6" fill="currentColor" stroke="none">2</text>
    <line x1="6" y1="4.5" x2="14" y2="4.5" />
    <line x1="6" y1="11.5" x2="14" y2="11.5" />
  </svg>
);
const LinkIcon = (
  <svg {...S}>
    <path d="M6.4 9.6l3.2-3.2" />
    <path d="M8.2 4.9l1-1a2.4 2.4 0 0 1 3.4 3.4l-1 1" />
    <path d="M7.8 11.1l-1 1a2.4 2.4 0 0 1-3.4-3.4l1-1" />
  </svg>
);
const ClearIcon = (
  <svg {...S}>
    <path d="M4 4.5h7" />
    <path d="M7.5 4.5v5.5" />
    <line x1="2.5" y1="14" x2="13.5" y2="2.5" strokeWidth="1.2" />
  </svg>
);

const glyphStyle: React.CSSProperties = { fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 14 };

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

  const IconBtn = ({ title, onDo, children }: { title: string; onDo: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); onDo(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, border: '1px solid transparent', background: 'transparent',
        color: '#334155', borderRadius: 5, cursor: 'pointer', padding: 0,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
  const Divider = () => <span style={{ width: 1, height: 18, background: '#cbd5e1', margin: '0 4px' }} />;

  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', gap: 1, alignItems: 'center', padding: 4, borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap' }}>
        <IconBtn title="Bold" onDo={() => exec('bold')}><b style={glyphStyle}>B</b></IconBtn>
        <IconBtn title="Italic" onDo={() => exec('italic')}><i style={glyphStyle}>I</i></IconBtn>
        <IconBtn title="Underline" onDo={() => exec('underline')}><span style={{ ...glyphStyle, textDecoration: 'underline' }}>U</span></IconBtn>
        <Divider />
        <IconBtn title="Bulleted list" onDo={() => exec('insertUnorderedList')}>{BulletIcon}</IconBtn>
        <IconBtn title="Numbered list" onDo={() => exec('insertOrderedList')}>{NumberIcon}</IconBtn>
        <Divider />
        <IconBtn title="Insert link" onDo={addLink}>{LinkIcon}</IconBtn>
        <IconBtn title="Clear formatting" onDo={() => exec('removeFormat')}>{ClearIcon}</IconBtn>
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
