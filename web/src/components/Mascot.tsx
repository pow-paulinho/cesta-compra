/**
 * Cesti: an original mascot, a round green shopping basket with big eyes and a leaf.
 * Moods: idle (bob + blink), searching (looks around), happy, celebrate, sad.
 */
export type Mood = 'idle' | 'searching' | 'happy' | 'celebrate' | 'sad';

export function Cesti({ mood = 'idle', size = 72, title }: { mood?: Mood; size?: number; title?: string }) {
  const happyEyes = mood === 'happy' || mood === 'celebrate';
  return (
    <svg
      className={`cesti ${mood}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <ellipse cx="60" cy="114" rx="36" ry="5" fill="#000" opacity=".1" />
      <g className="body">
        {/* handle */}
        <path d="M28 46 C30 10, 90 10, 92 46" fill="none" stroke="#46A302" strokeWidth="8" strokeLinecap="round" />
        {/* leaf */}
        <g className="leaf">
          <path d="M66 18 C70 4, 88 2, 92 8 C86 18, 74 22, 66 18 Z" fill="#89E219" />
          <path d="M68 17 C74 13, 82 10, 89 8" stroke="#46A302" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        {/* basket */}
        <path d="M12 50 H108 L100 98 C98.5 106 93 110 85 110 H35 C27 110 21.5 106 20 98 Z" fill="#58CC02" />
        <path d="M24 92 H96" stroke="#46A302" strokeWidth="3" strokeLinecap="round" opacity=".7" />
        <path d="M40 96 V108 M60 96 V110 M80 96 V108" stroke="#46A302" strokeWidth="3" strokeLinecap="round" opacity=".55" />
        <rect x="8" y="42" width="104" height="14" rx="7" fill="#46A302" />
        <rect x="14" y="44.5" width="40" height="4" rx="2" fill="#fff" opacity=".35" />
        {/* cheeks */}
        <ellipse cx="27" cy="84" rx="7" ry="4.5" fill="#FF8FA3" opacity=".75" />
        <ellipse cx="93" cy="84" rx="7" ry="4.5" fill="#FF8FA3" opacity=".75" />
        {/* eyes */}
        {happyEyes ? (
          <g stroke="#3C3C3C" strokeWidth="4.5" strokeLinecap="round" fill="none">
            <path d="M34 72 Q43 60 52 72" />
            <path d="M68 72 Q77 60 86 72" />
          </g>
        ) : (
          <g className="eyes">
            <circle cx="43" cy="71" r="12.5" fill="#fff" />
            <circle cx="77" cy="71" r="12.5" fill="#fff" />
            <g className="pupils">
              <circle cx={mood === 'sad' ? 43 : 45} cy={mood === 'sad' ? 75 : 72} r="6.5" fill="#3C3C3C" />
              <circle cx={mood === 'sad' ? 77 : 79} cy={mood === 'sad' ? 75 : 72} r="6.5" fill="#3C3C3C" />
              <circle cx={mood === 'sad' ? 45 : 47} cy={mood === 'sad' ? 72 : 69} r="2.2" fill="#fff" />
              <circle cx={mood === 'sad' ? 79 : 81} cy={mood === 'sad' ? 72 : 69} r="2.2" fill="#fff" />
            </g>
          </g>
        )}
        {mood === 'sad' && (
          <g stroke="#2B6A00" strokeWidth="3.5" strokeLinecap="round">
            <path d="M33 58 L49 54" />
            <path d="M87 58 L71 54" />
          </g>
        )}
        {/* mouth */}
        {mood === 'idle' && <path d="M53 88 Q60 94 67 88" stroke="#3C3C3C" strokeWidth="3.5" fill="none" strokeLinecap="round" />}
        {mood === 'searching' && <ellipse cx="60" cy="90" rx="4" ry="4.5" fill="#3C3C3C" />}
        {mood === 'sad' && <path d="M52 93 Q60 86 68 93" stroke="#3C3C3C" strokeWidth="3.5" fill="none" strokeLinecap="round" />}
        {(mood === 'happy' || mood === 'celebrate') && (
          <g>
            <path d="M48 84 H72 Q71 99 60 99 Q49 99 48 84 Z" fill="#3C3C3C" />
            <path d="M53 94 Q60 90 67 94 Q64 99 60 99 Q56 99 53 94 Z" fill="#FF6B81" />
          </g>
        )}
        {mood === 'celebrate' && (
          <g fill="#FFC800">
            <path d="M8 22 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" />
            <path d="M108 24 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" />
          </g>
        )}
      </g>
    </svg>
  );
}
