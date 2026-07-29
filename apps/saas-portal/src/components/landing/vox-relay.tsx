import Image from 'next/image';
import { cn } from '@/lib/utils';

export type VoxPose = 'hero' | 'solution' | 'cta' | 'default';

const POSE_SRC: Record<VoxPose, string> = {
  hero: '/mascot/voxly-hero-v5.png',
  solution: '/mascot/voxly-solution-v5.png',
  cta: '/mascot/voxly-cta-v5.png',
  default: '/mascot/voxly.png',
};

const POSE_ASPECT: Record<VoxPose, string> = {
  hero: 'aspect-[3/4]',
  solution: 'aspect-square',
  cta: 'aspect-[3/4]',
  default: 'aspect-[380/938]',
};

interface VoxRelayProps {
  className?: string;
  caption?: string;
  size?: 'md' | 'lg';
  priority?: boolean;
  light?: boolean;
  pose?: VoxPose;
}

/** Official Voxly mascot — generated poses for landing sections. */
export function VoxRelay({
  className,
  caption,
  size = 'md',
  priority = false,
  light = false,
  pose = 'default',
}: VoxRelayProps) {
  return (
    <figure
      className={cn(
        'relative mx-auto w-full',
        size === 'lg' ? 'max-w-[360px] sm:max-w-[420px]' : 'max-w-[260px] sm:max-w-[320px]',
        className,
      )}
    >
      <div className={cn('relative mx-auto w-full bg-transparent', POSE_ASPECT[pose])}>
        <Image
          src={POSE_SRC[pose]}
          alt="Voxly — робот-компаньон для продаж в мессенджерах"
          fill
          priority={priority}
          sizes="(max-width: 768px) 280px, 420px"
          className="bg-transparent object-contain object-bottom"
        />
      </div>
      {caption ? (
        <figcaption
          className={cn(
            'mt-4 text-center text-sm',
            light ? 'text-white/55' : 'text-[var(--land-muted)]',
          )}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
