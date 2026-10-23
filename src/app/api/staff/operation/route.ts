import { handleOrderRequest } from '@/lib/orders/route-handlers';
export async function GET(req: Request) { return handleOrderRequest(req,'staff',true); }
