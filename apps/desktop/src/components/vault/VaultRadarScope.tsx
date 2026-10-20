import type { CSSProperties, ReactNode } from "react";
import type { VaultItem } from "../../state/vault.js";

const point = (angle: number, radius: number): [number, number] => {
  const radians = angle * Math.PI / 180;
  return [160 - Math.cos(radians) * radius, 160 - Math.sin(radians) * radius];
};

/**
 * Sector scan. Marks represent real stored items, never nearby people/devices.
 * The beam crosses each echo at its animation phase; labels do not orbit.
 */
export function VaultRadarScope({ items }: { items: VaultItem[] }): ReactNode {
  const echoes = items.slice(0, 6);
  return <div className="vault-radar-disc" aria-hidden="true">
    <div className="vault-radar-screen">
      <span className="vault-radar-sweep" />
      <svg viewBox="0 0 320 176" className="vault-radar-grid" fill="none">
        {[38, 74, 110, 146].map(radius => <path key={radius} d={`M${160 - radius} 160 a${radius} ${radius} 0 0 1 ${radius * 2} 0`} />)}
        {[0, 30, 60, 90, 120, 150, 180].map(angle => {
          const [x, y] = point(angle, 146);
          return <path className="vault-radar-bearing" key={angle} d={`M160 160 L${x} ${y}`} />;
        })}
        {Array.from({ length: 37 }, (_, index) => {
          const [x1, y1] = point(index * 5, index % 6 === 0 ? 149 : 153);
          const [x2, y2] = point(index * 5, 157);
          return <path className="vault-radar-tick" key={index} d={`M${x1} ${y1}L${x2} ${y2}`} />;
        })}
        <path className="vault-radar-baseline" d="M4 160H316" />
      </svg>
      <svg viewBox="0 0 320 176" className="vault-radar-contacts" fill="none">
        {echoes.map((item, index) => {
          // Evenly distributed bearings with alternating range keep contacts legible.
          const angle = 24 + index * 132 / Math.max(1, echoes.length - 1);
          const [x, y] = point(angle, [112, 78, 128, 94, 118, 74][index]!);
          // Scan moves left → right, covering 180° in 88% of the cycle.
          const phase = angle / 180 * .88;
          return <g key={item.id} className="vault-radar-echo" style={{ "--og-vault-echo-phase": phase } as CSSProperties}>
            <circle className="vault-radar-echo-halo" cx={x} cy={y} r="9" />
            <path className="vault-radar-echo-bracket" d={`M${x - 7} ${y - 3}v-4h4m6 0h4v4m0 6v4h-4m-6 0h-4v-4`} />
            <circle className="vault-radar-echo-dot" cx={x} cy={y} r="2.5" />
          </g>;
        })}
        <circle className="vault-radar-origin-ring" cx="160" cy="160" r="12" />
        <circle className="vault-radar-origin" cx="160" cy="160" r="4" />
      </svg>
    </div>
  </div>;
}
