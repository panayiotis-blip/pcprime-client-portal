import { useRef, type ReactNode, type PointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboardLayout } from '../../context/DashboardLayoutContext';
import { ROW_PX, MIN_W, MAX_W, MIN_H, MAX_H } from './widgets';

interface Props {
  id: string;
  w: number;
  h: number;
  customising: boolean;
  children: ReactNode;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Wraps a single widget. In normal viewing mode it's a position-aware
// passthrough. In customise mode it adds a drag handle (⋮⋮) for reordering,
// a hide ✕, and a bottom-right handle to drag-resize the widget's width
// (columns) and height (rows).
export default function WidgetWrapper({ id, w, h, customising, children }: Props) {
  const { setWidgetBox, setWidgetVisible } = useDashboardLayout();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !customising });

  const slotRef = useRef<HTMLDivElement | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    gridColumn: `span ${w}`,
    gridRow: `span ${h}`,
  };

  // Drag the corner handle: horizontal movement changes width (columns),
  // vertical changes height (rows). Updates live; the context debounces saving.
  const startResize = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = slotRef.current;
    if (!el) return;
    const colPx = el.offsetWidth / w;       // approx pixels per grid column
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = w;
    const startH = h;

    const onMove = (ev: globalThis.PointerEvent) => {
      const dCol = Math.round((ev.clientX - startX) / colPx);
      const dRow = Math.round((ev.clientY - startY) / ROW_PX);
      setWidgetBox(
        id,
        clamp(startW + dCol, MIN_W, MAX_W),
        clamp(startH + dRow, MIN_H, MAX_H),
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={(el) => { setNodeRef(el); slotRef.current = el; }}
      style={style}
      className={`widget-slot ${customising ? 'widget-slot-customising' : ''}`}
      {...attributes}
    >
      {customising && (
        <div className="widget-toolbar no-print">
          <button
            type="button"
            className="widget-handle"
            title="Drag to reorder"
            aria-label="Drag handle"
            {...listeners}
          >
            ⋮⋮
          </button>
          <button
            type="button"
            className="widget-hide-btn"
            title="Hide this widget"
            onClick={() => setWidgetVisible(id, false)}
          >✕</button>
        </div>
      )}

      <div className="widget-body">{children}</div>

      {customising && (
        <button
          type="button"
          className="widget-resize-handle no-print"
          title="Drag to resize"
          aria-label="Resize widget"
          onPointerDown={startResize}
        />
      )}
    </div>
  );
}
