import { useMemo, useRef, useState } from 'react';

// Email recipient input with removable chips + autocomplete against known
// contacts. Commit a recipient with comma / semicolon / Enter / Tab, or by
// picking a suggestion; paste supports comma/semicolon/whitespace-separated
// lists. Backspace on an empty field removes the last chip. No dependency.

export interface RecipientSuggestion { name: string; email: string; }

interface Props {
  value: string[];                       // committed recipient emails
  onChange: (emails: string[]) => void;
  suggestions: RecipientSuggestion[];
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitList = (s: string) => s.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);

export default function RecipientInput({ value, onChange, suggestions, placeholder, autoFocus, ariaLabel }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const lower = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!lower) return [];
    const chosen = new Set(value.map(v => v.toLowerCase()));
    return suggestions
      .filter(s => !chosen.has(s.email.toLowerCase()))
      .filter(s => s.email.toLowerCase().includes(lower) || (s.name || '').toLowerCase().includes(lower))
      .slice(0, 8);
  }, [lower, suggestions, value]);

  const addMany = (emails: string[]) => {
    const next = [...value];
    for (const e of emails) {
      const v = e.trim();
      if (v && !next.some(x => x.toLowerCase() === v.toLowerCase())) next.push(v);
    }
    onChange(next);
  };
  const addEmail = (email: string) => { addMany([email]); setText(''); setOpen(false); setActive(0); };
  const commitTyped = () => { if (text.trim()) { addMany(splitList(text)); setText(''); setOpen(false); } };
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && matches.length && e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); return; }
    if (open && matches.length && e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      if (!text.trim() && e.key === 'Tab') return; // let Tab move focus when empty
      e.preventDefault();
      if (open && matches.length && (e.key === 'Enter' || e.key === 'Tab')) addEmail(matches[active].email);
      else commitTyped();
      return;
    }
    if (e.key === 'Backspace' && !text && value.length) removeAt(value.length - 1);
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', background: '#fff', position: 'relative', cursor: 'text' }}
    >
      {value.map((em, i) => {
        const s = suggestions.find(x => x.email.toLowerCase() === em.toLowerCase());
        const valid = EMAIL_RE.test(em);
        return (
          <span key={em + i} title={s?.name ? `${s.name} <${em}>` : em}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: valid ? '#eef2ff' : '#fee2e2', color: valid ? '#1a365d' : '#b91c1c', borderRadius: 999, padding: '2px 4px 2px 9px', fontSize: 12.5, maxWidth: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s?.name || em}</span>
            <button type="button" onClick={(ev) => { ev.stopPropagation(); removeAt(i); }} title="Remove"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        value={text}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={e => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setTimeout(() => { commitTyped(); setOpen(false); }, 120); }}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          if (/[,;\n\r\t]/.test(t)) { e.preventDefault(); addMany(splitList(t)); }
        }}
        placeholder={value.length ? '' : (placeholder || 'name@example.com')}
        style={{ border: 'none', outline: 'none', flex: 1, minWidth: 140, fontSize: 13, padding: '4px 2px', background: 'transparent' }}
      />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, marginTop: 2, zIndex: 50, boxShadow: '0 6px 16px rgba(0,0,0,0.1)', maxHeight: 240, overflowY: 'auto' }}>
          {matches.map((m, i) => (
            <div key={m.email}
              onMouseDown={(e) => { e.preventDefault(); addEmail(m.email); }}
              onMouseEnter={() => setActive(i)}
              style={{ padding: '6px 10px', cursor: 'pointer', background: i === active ? '#eef2ff' : '#fff', fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{m.name || m.email}</span>
              {m.name && <span style={{ color: '#64748b' }}> · {m.email}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
