import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Web Push đã ngừng sử dụng. Ứng dụng nhận thông báo nội bộ qua /api/events.' }, { status: 410 });
}
