'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { VoxRobot } from './vox-robot';

/**
 * Hero visual: three messenger windows (Telegram, WhatsApp, MAX) fly in and
 * "open", then a unified Voxly inbox card assembles in front — the core promise
 * (all messengers in one window). Vox floats behind. Light theme.
 */
export function HeroShowcase() {
  const reduce = useReducedMotion();

  const windows = [
    { name: 'Telegram', color: '#2aabee', x: -18, y: -46, rot: -8, delay: 0.15, text: 'Здравствуйте! Есть доставка?' },
    { name: 'WhatsApp', color: '#25d366', x: 150, y: -8, rot: 7, delay: 0.3, text: 'Пишу из WhatsApp 👋' },
    { name: 'MAX', color: '#a855f7', x: -6, y: 150, rot: -5, delay: 0.45, text: 'А в MAX отвечаете?' },
  ];

  return (
    <div className="relative mx-auto h-[440px] w-full max-w-[440px] sm:h-[480px]">
      {/* Robot behind */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <VoxRobot size={280} />
      </div>

      {/* Floating messenger windows */}
      {windows.map((w) => (
        <motion.div
          key={w.name}
          className="absolute w-[190px] rounded-lg border border-[rgba(2,8,23,0.08)] bg-white/95 p-3 shadow-[0_20px_50px_-24px_rgba(2,8,23,0.4)] backdrop-blur"
          style={{ left: `calc(50% + ${w.x}px)`, top: `calc(50% + ${w.y}px)`, x: '-50%', y: '-50%' }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: w.rot * 2, y: 30 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: w.rot }}
          transition={{ duration: 0.7, delay: w.delay, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: w.color }} />
            <span className="text-xs font-semibold text-[#020817]">{w.name}</span>
          </div>
          <p className="mt-2 rounded-md bg-[#f4f5f7] px-2.5 py-1.5 text-[11px] leading-snug text-[#4b5160]">
            {w.text}
          </p>
        </motion.div>
      ))}

      {/* Unified inbox card assembling in front */}
      <motion.div
        className="absolute left-1/2 bottom-2 w-[260px] -translate-x-1/2 rounded-lg border border-[rgba(2,8,23,0.1)] bg-white p-4 shadow-[0_30px_70px_-28px_rgba(130,97,251,0.55)]"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.75, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[#020817]">Мария К. · одно окно</p>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            В работе
          </span>
        </div>
        <div className="mt-3 space-y-1.5">
          {[
            { c: '#2aabee', t: 'Telegram найден' },
            { c: '#25d366', t: 'WhatsApp найден' },
            { c: '#a855f7', t: 'MAX проверен' },
          ].map((r, i) => (
            <motion.div
              key={r.t}
              className="flex items-center gap-2 rounded-md bg-[#f4f5f7] px-2.5 py-1.5 text-[11px] text-[#3a4050]"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 1 + i * 0.15 }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: r.c }} />
              <Check className="h-3 w-3 text-emerald-600" />
              {r.t}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
