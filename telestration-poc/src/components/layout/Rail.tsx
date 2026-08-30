import { RAIL_TABS } from './features';
import type { RailTab } from '../../types';

// (a1) The left icon rail — Media / Court / Highlight / Narrative.
export function Rail({ active, onSelect }: { active: RailTab; onSelect: (t: RailTab) => void }) {
  return (
    <nav className="rail">
      <div className="rail-logo">🎾</div>
      {RAIL_TABS.map((t) => (
        <button
          key={t.id}
          className={`rail-item ${active === t.id ? 'active' : ''}`}
          onClick={() => onSelect(t.id)}
          title={t.label}
        >
          <span className="rail-icon">{t.icon}</span>
          <span className="rail-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
