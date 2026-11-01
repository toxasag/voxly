"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type MascotId =
  | "ballerina"
  | "glasses"
  | "kamran"
  | "cat"
  | "crt"
  | "drone"
  | "scout"
  | "grandpa"
  | "granny"
  | "fox"
  | "otter"
  | "custom";

export interface MascotDefinition {
  id: MascotId;
  name: string;
  category: "people" | "robots" | "animals";
  description: string;
  badge?: string;
  directions: string;
  reactions: string;
}

export const AVAILABLE_MASCOTS: MascotDefinition[] = [
  {
    id: "ballerina",
    name: "Алиса (Девушка)",
    category: "people",
    description: "Приятная стилизованная девушка с пучком и розовым бантом",
    badge: "Выбор клиентов",
    directions: "/mascots/ballerina-directions.webp",
    reactions: "/mascots/ballerina-reactions.webp",
  },
  {
    id: "glasses",
    name: "Полина (В очках)",
    category: "people",
    description: "Рыжеволосая девушка в очках и бирюзовом свитере",
    badge: "Консультант",
    directions: "/mascots/glasses-directions.webp",
    reactions: "/mascots/glasses-reactions.webp",
  },
  {
    id: "kamran",
    name: "Камран (Из фото)",
    category: "people",
    description: "Пример чиби-маскота, созданного по реальной фотографии",
    badge: "По фото",
    directions: "/mascots/kamran-directions.webp",
    reactions: "/mascots/kamran-reactions.webp",
  },
  {
    id: "drone",
    name: "Вокси (Робот-дрон)",
    category: "robots",
    description: "Фиолетовый кибер-дрон с турбинами и большими глазами",
    badge: "AI бот",
    directions: "/mascots/drone-directions.webp",
    reactions: "/mascots/drone-reactions.webp",
  },
  {
    id: "scout",
    name: "Скаут (Стимпанк)",
    category: "robots",
    description: "Оранжевый робот с выразительными светящимися глазами",
    badge: "Инновации",
    directions: "/mascots/scout-directions.webp",
    reactions: "/mascots/scout-reactions.webp",
  },
  {
    id: "crt",
    name: "Ретро-Монитор",
    category: "robots",
    description: "Винтажный ламповый компьютер со смайликом",
    badge: "Ретро",
    directions: "/mascots/crt-directions.webp",
    reactions: "/mascots/crt-reactions.webp",
  },
  {
    id: "cat",
    name: "Барсик (Кот)",
    category: "animals",
    description: "Чёрно-белый дружелюбный кот Смокинг",
    badge: "Популярный",
    directions: "/mascots/cat-directions.webp",
    reactions: "/mascots/cat-reactions.webp",
  },
  {
    id: "fox",
    name: "Фокси (Лисичка)",
    category: "animals",
    description: "Классическая оранжевая чиби-лисичка",
    badge: "Классика",
    directions: "/mascots/fox-directions.webp",
    reactions: "/mascots/fox-reactions.webp",
  },
  {
    id: "otter",
    name: "Оскар (Выдра)",
    category: "animals",
    description: "Милая шоколадная выдра с выразительными глазами",
    badge: "Милота",
    directions: "/mascots/otter-directions.webp",
    reactions: "/mascots/otter-reactions.webp",
  },
  {
    id: "grandpa",
    name: "Виктор (Дедушка)",
    category: "people",
    description: "Седой опытный специалист в очках и с усами",
    badge: "Эксперт",
    directions: "/mascots/grandpa-directions.webp",
    reactions: "/mascots/grandpa-reactions.webp",
  },
  {
    id: "granny",
    name: "Елена (Бабушка)",
    category: "people",
    description: "Добрая заботливая наставница в круглых очках",
    badge: "Забота",
    directions: "/mascots/granny-directions.webp",
    reactions: "/mascots/granny-reactions.webp",
  },
];

const DIRECTIONS = [
  "up-left",
  "up",
  "up-right",
  "left",
  "center",
  "right",
  "down-left",
  "down",
  "down-right",
] as const;

const REACTIONS = [
  "blink",
  "heart",
  "sparkle",
  "surprised",
  "wink",
  "bashful",
  "sleepy",
  "dizzy",
  "delighted",
] as const;

type Direction = (typeof DIRECTIONS)[number];
type Reaction = (typeof REACTIONS)[number];

const CLOCKWISE: Direction[] = [
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
  "up",
  "up-right",
];
const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 40;

const PAYOFFS: Reaction[] = ["heart", "sparkle", "delighted", "wink"];
const BOOP_PAYOFF = 120;
const BOOP_END = 600;
const SQUASH_MS = 400;

const SQUASH: Keyframe[] = [
  { transform: "scale(1, 1)", easing: "ease-in" },
  { transform: "scale(1.10, 0.86)", offset: 0.18, easing: "ease-out" },
  { transform: "scale(0.95, 1.08)", offset: 0.45, easing: "ease-in-out" },
  { transform: "scale(1.03, 0.97)", offset: 0.72, easing: "ease-in-out" },
  { transform: "scale(1, 1)" },
];

function cell(index: number): CSSProperties {
  return { backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%` };
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const layer: CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundSize: "300% 300%",
  backgroundRepeat: "no-repeat",
  imageRendering: "auto",
};

export interface InteractiveMascotProps {
  mascotId: MascotId;
  customDirections?: string;
  customReactions?: string;
  size?: number;
  className?: string;
  interactive?: boolean;
  accentColor?: string;
  onClick?: () => void;
}

export function InteractiveMascot({
  mascotId,
  customDirections,
  customReactions,
  size = 80,
  className,
  interactive = true,
  onClick,
}: InteractiveMascotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const squashRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<number[]>([]);
  const boopsRef = useRef({ count: 0, at: 0 });

  const [direction, setDirection] = useState<Direction>("center");
  const [reaction, setReaction] = useState<Reaction | null>(null);

  // Находим пути к спрайт-листам
  const { directions, reactions } = useMemo(() => {
    if (mascotId === "custom" && customDirections) {
      return {
        directions: customDirections,
        reactions: customReactions && customReactions.trim().length > 0 ? customReactions : customDirections,
      };
    }
    const found = AVAILABLE_MASCOTS.find((m) => m.id === mascotId);
    if (found) {
      return { directions: found.directions, reactions: found.reactions };
    }
    return {
      directions: "/mascots/ballerina-directions.webp",
      reactions: "/mascots/ballerina-reactions.webp",
    };
  }, [mascotId, customDirections, customReactions]);

  // Интерактивное отслеживание курсора
  useEffect(() => {
    if (!interactive) return;

    let sector = -1;
    let pointer: { x: number; y: number } | null = null;

    const aim = () => {
      const el = containerRef.current;
      if (!el || !pointer) return;

      const box = el.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);

      if (Math.hypot(dx, dy) < DEAD_ZONE) {
        sector = -1;
        setDirection("center");
        return;
      }

      const angle = Math.atan2(dy, dx);
      if (sector !== -1 && Math.abs(wrap(angle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
        return;
      }

      sector = (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
      setDirection(CLOCKWISE[sector]);
    };

    const onPointerMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      aim();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", aim, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", aim);
    };
  }, [interactive]);

  // Очистка таймеров реакций
  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
    };
  }, []);

  const boop = () => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];

    const later = (ms: number, next: Reaction | null) => {
      timersRef.current.push(window.setTimeout(() => setReaction(next), ms));
    };

    const now = Date.now();
    const boops = boopsRef.current;
    boops.count = now - boops.at < 1800 ? boops.count + 1 : 1;
    boops.at = now;

    setReaction("blink");
    later(BOOP_PAYOFF, PAYOFFS[(boops.count - 1) % PAYOFFS.length]);
    later(BOOP_END, null);

    squashRef.current?.animate(SQUASH, { duration: SQUASH_MS, easing: "linear" });

    if (onClick) {
      onClick();
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={boop}
      className={cn(
        "relative select-none cursor-pointer flex items-center justify-center transition-transform",
        className,
      )}
      style={{
        width: size,
        height: size,
      }}
      title="Нажмите, чтобы поздороваться с персонажем!"
    >
      <span
        ref={squashRef}
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          height: "100%",
          transformOrigin: "50% 78%",
        }}
      >
        {/* Слой направлений головы (3х3 сетка) */}
        <span
          style={{
            ...layer,
            backgroundImage: `url(${directions})`,
            ...cell(DIRECTIONS.indexOf(direction)),
            opacity: reaction ? 0 : 1,
            transition: "opacity 80ms ease-in-out",
          }}
        />

        {/* Слой реакций и эмоций (3х3 сетка) */}
        <span
          style={{
            ...layer,
            backgroundImage: `url(${reactions})`,
            ...cell(REACTIONS.indexOf(reaction ?? "blink")),
            opacity: reaction ? 1 : 0,
            transition: "opacity 80ms ease-in-out",
          }}
        />
      </span>
    </div>
  );
}
