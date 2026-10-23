import { handleOrderRequest } from '@/lib/orders/route-handlers';
export async function POST(req: Request) { return handleOrderRequest(req,'customer'); }
