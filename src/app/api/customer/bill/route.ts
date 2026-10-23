import { handleSessionAction } from '@/lib/sessions/routes';
export function POST(req: Request) { return handleSessionAction(req, 'customer', false); }
export function GET(req: Request) { return handleSessionAction(req, 'customer', true); }
