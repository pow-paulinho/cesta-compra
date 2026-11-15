/**
 * Simple, original product illustrations as inline SVG data URIs, for the mock API.
 * Generic shapes (carton, bottle, jar, pack...), no real brand or chain artwork.
 */
export type Shape = 'carton' | 'bottle' | 'jar' | 'eggs' | 'bag' | 'can' | 'cups' | 'loaf' | 'box' | 'brick6';

export interface Art {
  shape: Shape;
  /** Main body colour. */
  color: string;
  /** Accent / label colour. */
  accent: string;
  /** Short generic label (no brands). */
  label: string;
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${body}</svg>`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function labelText(x: number, y: number, text: string, size = 15, fill = '#fff') {
  return `<text x="${x}" y="${y}" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="700" font-size="${size}" fill="${fill}" text-anchor="middle">${esc(text)}</text>`;
}

const shadow = '<ellipse cx="100" cy="182" rx="58" ry="8" fill="#000" opacity=".10"/>';

function body(a: Art): string {
  const { color: c, accent: k, label } = a;
  switch (a.shape) {
    case 'carton':
      return `${shadow}<path d="M62 52 L78 30 H122 L138 52 V176 H62 Z" fill="${c}"/>
        <path d="M78 30 H122 L138 52 H62 Z" fill="#fff" opacity=".35"/>
        <rect x="104" y="18" width="14" height="16" rx="3" fill="${k}"/>
        <rect x="62" y="92" width="76" height="48" fill="#fff"/>
        ${labelText(100, 122, label, 15, k)}
        <path d="M70 160 q15 -10 30 0 t30 0" stroke="#fff" stroke-width="4" fill="none" opacity=".7"/>`;
    case 'brick6':
      return `${shadow}${[0, 1, 2]
        .map((i) => `<g transform="translate(${30 + i * 48} 0)"><path d="M6 66 L16 50 H40 L50 66 V176 H6 Z" fill="${c}"/><rect x="6" y="110" width="44" height="30" fill="#fff"/></g>`)
        .join('')}<rect x="28" y="88" width="144" height="16" rx="4" fill="${k}" opacity=".9"/>
        ${labelText(100, 130, label, 13, k)}`;
    case 'bottle':
      return `${shadow}<rect x="88" y="14" width="24" height="16" rx="4" fill="${k}"/>
        <path d="M90 30 H110 V50 C110 62 134 70 134 92 V170 Q134 178 126 178 H74 Q66 178 66 170 V92 C66 70 90 62 90 50 Z" fill="${c}"/>
        <path d="M76 96 Q78 80 92 72" stroke="#fff" stroke-width="5" fill="none" opacity=".45" stroke-linecap="round"/>
        <rect x="66" y="110" width="68" height="40" fill="#fff" opacity=".92"/>
        ${labelText(100, 136, label, 13, k)}`;
    case 'jar':
      return `${shadow}<rect x="68" y="34" width="64" height="18" rx="5" fill="${k}"/>
        <rect x="60" y="52" width="80" height="124" rx="18" fill="${c}"/>
        <rect x="60" y="90" width="80" height="46" fill="#fff" opacity=".92"/>
        ${labelText(100, 119, label, 14, k)}
        <path d="M70 66 V80" stroke="#fff" stroke-width="5" opacity=".5" stroke-linecap="round"/>`;
    case 'eggs':
      return `${shadow}<path d="M28 96 H172 L162 168 Q160 176 152 176 H48 Q40 176 38 168 Z" fill="${c}"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="${44 + i * 22.4}" cy="88" rx="11" ry="14" fill="${k}"/>`).join('')}
        <rect x="28" y="96" width="144" height="10" fill="#000" opacity=".08"/>
        ${labelText(100, 146, label, 16, '#fff')}`;
    case 'bag':
      return `${shadow}<path d="M58 40 Q100 30 142 40 L150 168 Q150 178 140 178 H60 Q50 178 50 168 Z" fill="${c}"/>
        <path d="M58 40 Q100 30 142 40 L140 54 Q100 46 60 54 Z" fill="${k}"/>
        <circle cx="100" cy="116" r="30" fill="#fff" opacity=".92"/>
        ${labelText(100, 122, label, 14, k)}`;
    case 'can':
      return `${shadow}${[0, 1, 2]
        .map((i) => `<g transform="translate(0 ${i * 40})"><rect x="50" y="64" width="100" height="34" rx="10" fill="${c}"/><rect x="50" y="64" width="100" height="8" rx="4" fill="#fff" opacity=".4"/></g>`)
        .join('')}<rect x="44" y="104" width="112" height="22" rx="6" fill="${k}"/>
        ${labelText(100, 120, label, 13)}`;
    case 'cups':
      return `${shadow}${[0, 1].map((r) => [0, 1].map((col) => {
          const x = 46 + col * 56;
          const y = 62 + r * 58;
          return `<path d="M${x} ${y} H${x + 52} L${x + 46} ${y + 52} H${x + 6} Z" fill="${c}"/><rect x="${x - 2}" y="${y - 6}" width="56" height="9" rx="3" fill="${k}"/>`;
        }).join('')).join('')}
        <rect x="56" y="104" width="88" height="20" rx="10" fill="#fff"/>
        ${labelText(100, 119, label, 12, k)}`;
    case 'loaf':
      return `${shadow}<path d="M40 92 Q40 50 80 50 H120 Q160 50 160 92 V170 Q160 178 152 178 H48 Q40 178 40 170 Z" fill="${c}"/>
        <path d="M52 92 Q52 64 82 64 H118 Q148 64 148 92 V166 H52 Z" fill="${k}" opacity=".95"/>
        <rect x="40" y="118" width="120" height="30" fill="#fff" opacity=".9"/>
        ${labelText(100, 139, label, 14, c)}`;
    case 'box':
    default:
      return `${shadow}<path d="M54 48 L74 32 H160 L146 48 Z" fill="${k}"/>
        <path d="M146 48 L160 32 V160 L146 176 Z" fill="#000" opacity=".18"/>
        <rect x="54" y="48" width="92" height="128" rx="6" fill="${c}"/>
        <circle cx="100" cy="96" r="22" fill="${k}"/>
        <rect x="62" y="130" width="76" height="28" rx="8" fill="#fff" opacity=".92"/>
        ${labelText(100, 149, label, 12, c)}`;
  }
}

export function productImage(a: Art): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(body(a)).replace(/\s{2,}/g, ' '))}`;
}
