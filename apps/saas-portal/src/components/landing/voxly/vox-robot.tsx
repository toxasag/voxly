'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Vox — the Voxly mascot. A friendly rounded assistant-bot head with a wide
 * "visor" screen, a pulsing antenna and a chat-spark badge. Tuned for a light
 * background: soft indigo/blue body, lime antenna accent. Pure SVG + framer-motion.
 */
export function VoxRobot({ className, size = 240 }: { className?: string; size?: number }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      style={{ width: size, height: size }}
      animate={reduce ? undefined : { y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden
    >
      <svg viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <defs>
          <linearGradient id="vox-body" x1="46" y1="52" x2="194" y2="192" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset="1" stopColor="#eef0f6" />
          </linearGradient>
          <linearGradient id="vox-visor" x1="66" y1="90" x2="174" y2="156" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2aabee" />
            <stop offset="0.55" stopColor="#8261fb" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
          <radialGradient id="vox-glow" cx="0.5" cy="0.5" r="0.5">
            <stop stopColor="#8261fb" stopOpacity="0.28" />
            <stop offset="1" stopColor="#8261fb" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="vox-ant" x1="120" y1="20" x2="120" y2="52" gradientUnits="userSpaceOnUse">
            <stop stopColor="#e0fe56" />
            <stop offset="1" stopColor="#8261fb" />
          </linearGradient>
        </defs>

        {/* Ambient glow */}
        <ellipse cx="120" cy="135" rx="112" ry="106" fill="url(#vox-glow)" />

        {/* Antenna */}
        <line x1="120" y1="52" x2="120" y2="30" stroke="url(#vox-ant)" strokeWidth="4" strokeLinecap="round" />
        <motion.circle
          cx="120"
          cy="24"
          r="8"
          fill="#e0fe56"
          stroke="#c7e83a"
          strokeWidth="1"
          animate={reduce ? undefined : { opacity: [1, 0.55, 1], scale: [1, 1.35, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '120px 24px' }}
        />

        {/* Head / body */}
        <rect x="46" y="52" width="148" height="140" rx="42" fill="url(#vox-body)" stroke="rgba(2,8,23,0.1)" strokeWidth="1.5" />

        {/* Ears */}
        <rect x="34" y="104" width="14" height="40" rx="7" fill="#e7eaf1" stroke="rgba(2,8,23,0.08)" strokeWidth="1.5" />
        <rect x="192" y="104" width="14" height="40" rx="7" fill="#e7eaf1" stroke="rgba(2,8,23,0.08)" strokeWidth="1.5" />

        {/* Visor */}
        <rect x="66" y="90" width="108" height="66" rx="26" fill="#0a0b07" />
        <rect x="72" y="96" width="96" height="54" rx="21" fill="url(#vox-visor)" opacity="0.22" />

        {/* Eyes (blink) */}
        <motion.g
          animate={reduce ? undefined : { scaleY: [1, 1, 0.1, 1] }}
          transition={{ duration: 4, times: [0, 0.92, 0.96, 1], repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: '120px 118px' }}
        >
          <circle cx="100" cy="118" r="9" fill="#e0fe56" />
          <circle cx="140" cy="118" r="9" fill="#e0fe56" />
        </motion.g>

        {/* Smile */}
        <path d="M104 136c4 5 28 5 32 0" stroke="#8261fb" strokeWidth="3.5" strokeLinecap="round" fill="none" />

        {/* Chat spark badge */}
        <g>
          <rect x="96" y="168" width="48" height="30" rx="12" fill="url(#vox-visor)" />
          <circle cx="110" cy="183" r="3" fill="#fff" />
          <circle cx="120" cy="183" r="3" fill="#fff" />
          <circle cx="130" cy="183" r="3" fill="#fff" />
          <path d="M114 196l6 8 6-8" fill="url(#vox-visor)" />
        </g>
      </svg>
    </motion.div>
  );
}
