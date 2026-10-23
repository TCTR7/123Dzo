import { ImageResponse } from 'next/og';
export const dynamic = 'force-static';
export function GET() {
  return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b', color: '#f59e0b', fontSize: 138, fontWeight: 800 }}>123Dzô</div>, { width: 512, height: 512 });
}
