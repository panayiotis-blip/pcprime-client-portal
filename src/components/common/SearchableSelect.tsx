import { useState, useRef, useEffect } from 'react';

export interface SearchOption {
  value: string | number;
  label: string;
  sublabel?: string;
}

interface Props {
  value: string | number;
  options: SearchOption[];
  onChange: (value: string | number) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}

export default function SearchableSelect({ value, options, onChange, placeholder = '-- Select --', disabled, allowClear, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => String(o.value) === String(value));

  const filtered = options.filter(o => {
    if (!search) return true;
    const t = search.toLowerCase();
    return o.label.toLowerCase().includes(t) || (o.sublabel || '').toLowerCase().includes(t) || String(o.value).toLowerCase().includes(t);
  });

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (val: string | number) => {
    onChange(val);
    setOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[focusedIndex]) handleSelect(filtered[focusedIndex].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div ref={ref} className={`searchable-select ${className || ''}`}>
      <div
        className={`ss-display form-input ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        tabIndex={0}
      >
        {selected ? (
          <span className="ss-selected">
            {selected.label}
            {selected.sublabel && <span className="ss-sublabel"> — {selected.sublabel}</span>}
          </span>
        ) : (
          <span className="ss-placeholder">{placeholder}</span>
        )}
        <span className="ss-arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="ss-dropdown">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setFocusedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            className="ss-search"
          />
          <div className="ss-options">
            {allowClear && (
              <div className="ss-option ss-clear" onClick={() => handleSelect('')}>
                <em>Clear selection</em>
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="ss-empty">No matches</div>
            ) : (
              filtered.map((o, i) => (
                <div
                  key={o.value}
                  className={`ss-option ${i === focusedIndex ? 'focused' : ''} ${String(o.value) === String(value) ? 'selected' : ''}`}
                  onClick={() => handleSelect(o.value)}
                  onMouseEnter={() => setFocusedIndex(i)}
                >
                  <div className="ss-option-label">{o.label}</div>
                  {o.sublabel && <div className="ss-option-sublabel">{o.sublabel}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
