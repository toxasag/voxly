"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MascotId = "voxly_robot" | "quantum_orb" | "cosmo_fox" | "cyber_cat";

export interface MascotDefinition {
  id: MascotId;
  name: string;
  category: "3d_robot" | "character" | "abstract";
  description: string;
  badge: string;
}

export const AVAILABLE_MASCOTS: MascotDefinition[] = [
  {
    id: "voxly_robot",
    name: "Вокси (AI Робот)",
    category: "3d_robot",
    description: "Фирменный технологичный 3D-робот с анимированным взглядом",
    badge: "Популярный",
  },
  {
    id: "quantum_orb",
    name: "Квантовая Сфера",
    category: "abstract",
    description: "Футуристичная неоновая сфера с плавающим ядром-зрачком",
    badge: "Минимализм",
  },
  {
    id: "cosmo_fox",
    name: "Фокси (3D Лис)",
    category: "character",
    description: "Дружелюбный персонаж в стиле 3D-анимации и чиби",
    badge: "Для продаж",
  },
  {
    id: "cyber_cat",
    name: "Кибер-Кот",
    category: "character",
    description: "Стильный цифровой кот с неоновыми сенсорами",
    badge: "Креатив",
  },
];

interface InteractiveMascotProps {
  mascotId: MascotId;
  size?: number;
  accentColor?: string;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
}

export function InteractiveMascot({
  mascotId,
  size = 56,
  accentColor = "#4a38f5",
  className,
  interactive = true,
  onClick,
}: InteractiveMascotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [headTilt, setHeadTilt] = useState({ x: 0, y: 0, rotate: 0 });
  const [isBooped, setIsBooped] = useState(false);
  const [isWinking, setIsWinking] = useState(false);

  // Интерактивное отслеживание курсора
  useEffect(() => {
    if (!interactive) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const distance = Math.hypot(dx, dy);

      if (distance < 10) {
        setEyeOffset({ x: 0, y: 0 });
        setHeadTilt({ x: 0, y: 0, rotate: 0 });
        return;
      }

      // Ограничиваем максимальное смещение зрачков (до 3.5px)
      const maxEyeShift = 3.5;
      const angle = Math.atan2(dy, dx);
      const intensity = Math.min(distance / 200, 1);

      const eyeX = Math.cos(angle) * maxEyeShift * intensity;
      const eyeY = Math.sin(angle) * maxEyeShift * intensity;

      // Лёгкий наклон головы в сторону курсора (до 5 градусов)
      const tiltX = Math.cos(angle) * 2 * intensity;
      const tiltY = Math.sin(angle) * 2 * intensity;
      const rotate = Math.cos(angle) * 6 * intensity;

      setEyeOffset({ x: eyeX, y: eyeY });
      setHeadTilt({ x: tiltX, y: tiltY, rotate });
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [interactive]);

  const handleBoop = () => {
    setIsBooped(true);
    setIsWinking(true);

    if (onClick) {
      onClick();
    }

    setTimeout(() => {
      setIsBooped(false);
    }, 400);

    setTimeout(() => {
      setIsWinking(false);
    }, 650);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleBoop}
      className={cn(
        "relative flex items-center justify-center select-none transition-transform duration-150 cursor-pointer",
        isBooped && "scale-90",
        className,
      )}
      style={{
        width: size,
        height: size,
      }}
      title="Нажмите, чтобы поздороваться с маскотом!"
    >
      <div
        className="w-full h-full transition-transform duration-100 ease-out flex items-center justify-center"
        style={{
          transform: `translate3d(${headTilt.x}px, ${headTilt.y}px, 0) rotate(${headTilt.rotate}deg)`,
        }}
      >
        {mascotId === "voxly_robot" && (
          <RobotMascotSVG
            size={size}
            accentColor={accentColor}
            eyeOffset={eyeOffset}
            isWinking={isWinking}
          />
        )}
        {mascotId === "quantum_orb" && (
          <OrbMascotSVG
            size={size}
            accentColor={accentColor}
            eyeOffset={eyeOffset}
            isWinking={isWinking}
          />
        )}
        {mascotId === "cosmo_fox" && (
          <FoxMascotSVG
            size={size}
            accentColor={accentColor}
            eyeOffset={eyeOffset}
            isWinking={isWinking}
          />
        )}
        {mascotId === "cyber_cat" && (
          <CatMascotSVG
            size={size}
            accentColor={accentColor}
            eyeOffset={eyeOffset}
            isWinking={isWinking}
          />
        )}
      </div>

      {/* Эмодзи-реакция при клике (Boop) */}
      {isWinking && (
        <span className="absolute -top-2 -right-1 text-xs animate-bounce pointer-events-none">
          ✨
        </span>
      )}
    </div>
  );
}

// 1. Вокси (3D Робот)
function RobotMascotSVG({
  size,
  accentColor,
  eyeOffset,
  isWinking,
}: {
  size: number;
  accentColor: string;
  eyeOffset: { x: number; y: number };
  isWinking: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Антенна */}
      <circle cx="32" cy="7" r="3.5" fill={accentColor} />
      <path d="M32 10.5V16" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" />

      {/* Уши-сенсоры */}
      <rect x="7" y="27" width="5" height="12" rx="2.5" fill="#334155" />
      <rect x="52" y="27" width="5" height="12" rx="2.5" fill="#334155" />

      {/* Корпус головы */}
      <rect
        x="10"
        y="15"
        width="44"
        height="36"
        rx="12"
        fill="#0f172a"
        stroke={accentColor}
        strokeWidth="2.5"
      />

      {/* Экран лица */}
      <rect x="15" y="21" width="34" height="24" rx="8" fill="#020617" />

      {/* Глаза */}
      {isWinking ? (
        // Подмигивание: левый открыт, правый подмигивает
        <>
          <circle cx={25 + eyeOffset.x} cy={32 + eyeOffset.y} r="4" fill="#38bdf8" />
          <path
            d="M36 33C38 31 41 31 43 33"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        // Обычное состояние: оба глаза следят за мышкой
        <>
          <circle cx="25" cy="32" r="5" fill="#0369a1" />
          <circle cx={25 + eyeOffset.x} cy={32 + eyeOffset.y} r="3.5" fill="#38bdf8" />
          <circle cx={26.5 + eyeOffset.x * 0.8} cy={30.5 + eyeOffset.y * 0.8} r="1.2" fill="#ffffff" />

          <circle cx="39" cy="32" r="5" fill="#0369a1" />
          <circle cx={39 + eyeOffset.x} cy={32 + eyeOffset.y} r="3.5" fill="#38bdf8" />
          <circle cx={40.5 + eyeOffset.x * 0.8} cy={30.5 + eyeOffset.y * 0.8} r="1.2" fill="#ffffff" />
        </>
      )}

      {/* Дружелюбная улыбка */}
      <path
        d="M28 40C30 42 34 42 36 40"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 2. Квантовая Сфера
function OrbMascotSVG({
  size,
  accentColor,
  eyeOffset,
  isWinking,
}: {
  size: number;
  accentColor: string;
  eyeOffset: { x: number; y: number };
  isWinking: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <radialGradient id="orbGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="40%" stopColor={accentColor} />
          <stop offset="100%" stopColor="#090d16" />
        </radialGradient>
      </defs>

      {/* Внешнее кольцо орбиты */}
      <ellipse
        cx="32"
        cy="32"
        rx="28"
        ry="12"
        stroke={accentColor}
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.6"
        transform="rotate(-25 32 32)"
      />

      {/* Сфера */}
      <circle cx="32" cy="32" r="23" fill="url(#orbGrad)" />

      {/* Внутреннее светящееся ядро (глаз) */}
      <circle cx={32 + eyeOffset.x * 1.5} cy={32 + eyeOffset.y * 1.5} r={isWinking ? 3 : 7} fill="#ffffff" opacity="0.9" />
      <circle cx={32 + eyeOffset.x * 1.5} cy={32 + eyeOffset.y * 1.5} r={isWinking ? 1.5 : 4} fill={accentColor} />
    </svg>
  );
}

// 3. Фокси (3D Лис)
function FoxMascotSVG({
  size,
  accentColor,
  eyeOffset,
  isWinking,
}: {
  size: number;
  accentColor: string;
  eyeOffset: { x: number; y: number };
  isWinking: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Уши */}
      <polygon points="12,24 22,6 30,22" fill="#f97316" stroke="#c2410c" strokeWidth="1.5" />
      <polygon points="16,21 22,11 27,20" fill="#fef08a" />

      <polygon points="52,24 42,6 34,22" fill="#f97316" stroke="#c2410c" strokeWidth="1.5" />
      <polygon points="48,21 42,11 37,20" fill="#fef08a" />

      {/* Голова */}
      <circle cx="32" cy="36" r="20" fill="#f97316" />
      {/* Белые щёчки */}
      <ellipse cx="23" cy="40" rx="9" ry="8" fill="#ffffff" />
      <ellipse cx="41" cy="40" rx="9" ry="8" fill="#ffffff" />

      {/* Глаза */}
      {isWinking ? (
        <>
          <circle cx={25 + eyeOffset.x} cy={33 + eyeOffset.y} r="3" fill="#1e293b" />
          <path d="M36 34C38 32 41 32 43 34" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={24 + eyeOffset.x} cy={33 + eyeOffset.y} r="3.2" fill="#1e293b" />
          <circle cx={25 + eyeOffset.x * 0.8} cy={32 + eyeOffset.y * 0.8} r="1.1" fill="#ffffff" />

          <circle cx={40 + eyeOffset.x} cy={33 + eyeOffset.y} r="3.2" fill="#1e293b" />
          <circle cx={41 + eyeOffset.x * 0.8} cy={32 + eyeOffset.y * 0.8} r="1.1" fill="#ffffff" />
        </>
      )}

      {/* Носик */}
      <polygon points="30,41 34,41 32,44" fill="#0f172a" />
      {/* Улыбочка */}
      <path d="M30 45C31 47 33 47 34 45" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// 4. Кибер-Кот
function CatMascotSVG({
  size,
  accentColor,
  eyeOffset,
  isWinking,
}: {
  size: number;
  accentColor: string;
  eyeOffset: { x: number; y: number };
  isWinking: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Ушки кота */}
      <polygon points="12,28 20,10 28,26" fill="#1e1b4b" stroke={accentColor} strokeWidth="1.5" />
      <polygon points="16,25 20,15 25,24" fill="#a855f7" />

      <polygon points="52,28 44,10 36,26" fill="#1e1b4b" stroke={accentColor} strokeWidth="1.5" />
      <polygon points="48,25 44,15 39,24" fill="#a855f7" />

      {/* Мордочка */}
      <circle cx="32" cy="37" r="19" fill="#0f172a" stroke={accentColor} strokeWidth="2" />

      {/* Глаза кота */}
      {isWinking ? (
        <>
          <ellipse cx={24 + eyeOffset.x} cy={34 + eyeOffset.y} rx="3" ry="4" fill="#38bdf8" />
          <path d="M37 35C39 33 42 33 44 35" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx={24 + eyeOffset.x} cy={34 + eyeOffset.y} rx="3.5" ry="4.5" fill="#38bdf8" />
          <ellipse cx={24 + eyeOffset.x} cy={34 + eyeOffset.y} rx="1" ry="3.5" fill="#0f172a" />

          <ellipse cx={40 + eyeOffset.x} cy={34 + eyeOffset.y} rx="3.5" ry="4.5" fill="#38bdf8" />
          <ellipse cx={40 + eyeOffset.x} cy={34 + eyeOffset.y} rx="1" ry="3.5" fill="#0f172a" />
        </>
      )}

      {/* Усики и нос */}
      <circle cx="32" cy="41" r="1.5" fill="#a855f7" />
      <path d="M16 40L23 41M16 44L23 43" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M48 40L41 41M48 44L41 43" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
