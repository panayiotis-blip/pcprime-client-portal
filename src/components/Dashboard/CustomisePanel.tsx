import { useDashboardLayout } from '../../context/DashboardLayoutContext';
import { WIDGET_REGISTRY } from './widgets';

interface Props {
  onClose: () => void;
}

// Slide-in side panel listing every widget in the registry with a show/hide
// checkbox plus a "Reset to default" button. Auto-saves on every toggle.
export default function CustomisePanel({ onClose }: Props) {
  const { layout, setWidgetVisible, resetLayout } = useDashboardLayout();
  const byId = new Map(layout.widgets.map(w => [w.id, w]));

  return (
    <div className="customise-panel-overlay" onClick={onClose}>
      <aside className="customise-panel" onClick={e => e.stopPropagation()}>
        <div className="customise-panel-header">
          <h3 style={{ margin: 0 }}>Customise dashboard</h3>
          <button type="button" className="btn btn-link" onClick={onClose} title="Close panel">✕</button>
        </div>

        <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px 0' }}>
          Choose which widgets appear. Drag to reorder them on the dashboard. Resize by dragging the handle at a widget's bottom-right corner. Changes save automatically.
        </p>

        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>KPI tiles</strong>
          <ul className="customise-list">
            {WIDGET_REGISTRY.filter(w => w.category === 'kpi').map(spec => {
              const lw = byId.get(spec.id);
              return (
                <li key={spec.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={lw?.visible ?? spec.defaultVisible}
                      onChange={(e) => setWidgetVisible(spec.id, e.target.checked)}
                    />
                    <span>{spec.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Widgets</strong>
          <ul className="customise-list">
            {WIDGET_REGISTRY.filter(w => w.category === 'content').map(spec => {
              const lw = byId.get(spec.id);
              return (
                <li key={spec.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={lw?.visible ?? spec.defaultVisible}
                      onChange={(e) => setWidgetVisible(spec.id, e.target.checked)}
                    />
                    <span>{spec.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="customise-panel-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (confirm('Reset dashboard to the default layout? Your custom arrangement will be lost.')) {
                resetLayout();
              }
            }}
          >
            ↺ Reset to default
          </button>
        </div>
      </aside>
    </div>
  );
}
