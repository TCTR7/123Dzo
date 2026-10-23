import { handleSessionAction } from '@/lib/sessions/routes';
export function POST(req: Request) { return handleSessionAction(req, 'staff', false); }
export function GET(req: Request) { return handleSessionAction(req, 'staff', true); }
