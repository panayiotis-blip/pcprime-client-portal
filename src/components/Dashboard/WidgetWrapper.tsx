import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboardLayout } from '../../context/DashboardLayoutContext';
import type { WidgetSize } from './widgets';

interface Props {
  id: string;
  size: WidgetSize;
  customising: boolean;
  children: ReactNode;
}

const SIZE_CLASS: Record<WidgetSize, string> = {
  small:  'widget-small',
  medium: 'widget-medium',
  large:  'widget-large',
};

// Wraps a single widget. In normal viewing mode it's just a position-aware
// passthrough. In customise mode it adds a toolbar with S/M/L resize buttons,
// a hide ✕ button, and a drag handle (⋮⋮) connected to dnd-kit.
export default function WidgetWrapper({ id, size, customising, children }: Props) {
  const { setWidgetSize, setWidgetVisible } = useDashboardLayout();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !customising });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`widget-slot ${SIZE_CLASS[size]} ${customising ? 'widget-slot-customising' : ''}`}
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
          <div className="widget-size-group" role="group" aria-label="Widget size">
            <button
              type="button"
              className={`widget-size-btn ${size === 'small' ? 'active' : ''}`}
              title="Small"
              onClick={() => setWidgetSize(id, 'small')}
            >S</button>
            <button
              type="button"
              className={`widget-size-btn ${size === 'medium' ? 'active' : ''}`}
              title="Medium"
              onClick={() => setWidgetSize(id, 'medium')}
            >M</button>
            <button
              type="button"
              className={`widget-size-btn ${size === 'large' ? 'active' : ''}`}
              title="Large"
              onClick={() => setWidgetSize(id, 'large')}
            >L</button>
          </div>
          <button
            type="button"
            className="widget-hide-btn"
            title="Hide this widget"
            onClick={() => setWidgetVisible(id, false)}
          >✕</button>
        </div>
      )}
      {children}
    </div>
  );
}
