import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2563EB',
          borderRadius: 14,
          color: '#ffffff',
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: '-0.04em',
        }}
      >
        V
      </div>
    ),
    { ...size },
  );
}
