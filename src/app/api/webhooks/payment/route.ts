import crypto from 'crypto';
import { onlinePaymentsEnabled } from '@/lib/config/payments';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

interface PayOSWebhookData {
  orderCode?: number | string;
  amount?: number;
  description?: string;
  reference?: string;
  transactionDateTime?: string;
  [key: string]: unknown;
}

interface PaymentWebhookPayload {
  // Chuẩn PayOS
  code?: string;
  desc?: string;
  success?: boolean;
  data?: PayOSWebhookData;
  signature?: string;

  // Chuẩn SePay hoặc Payload trực tiếp
  id?: number | string;
  transferAmount?: number;
  amount?: number;
  content?: string;
  description?: string;
  payment_code?: string;
}

/**
 * Xác thực chữ ký HMAC-SHA256 chuẩn của PayOS
 * Sắp xếp các key trong object `data` theo thứ tự bảng chữ cái: key1=val1&key2=val2...
 */
function verifyPayOSSignature(
  data: Record<string, unknown>,
  signature: string,
  checksumKey: string
): boolean {
  const sortedKeys = Object.keys(data).sort();
  const queryString = sortedKeys
    .map((key) => {
      const rawVal = data[key];
      const normalizedVal =
        rawVal === null || rawVal === undefined
          ? ''
          : typeof rawVal === 'object'
          ? JSON.stringify(rawVal)
          : String(rawVal);
      return `${key}=${normalizedVal}`;
    })
    .join('&');

  const computedSignature = crypto
    .createHmac('sha256', checksumKey)
    .update(queryString)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const computedBuffer = Buffer.from(computedSignature, 'utf8');

  if (sigBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, computedBuffer);
}

/**
 * Xác thực chữ ký / API Key từ PayOS hoặc SePay
 */
function verifyWebhookAuthenticity(
  req: Request,
  payload: PaymentWebhookPayload,
  rawBody: string
): boolean {
  const payosChecksumKey = process.env.PAYOS_CHECKSUM_KEY;
  const sepaySecret = process.env.SEPAY_WEBHOOK_SECRET;

  // 1. Kiểm tra theo chuẩn PayOS nếu có data + signature + PAYOS_CHECKSUM_KEY
  if (payosChecksumKey && payload.data && payload.signature) {
    return verifyPayOSSignature(
      payload.data as Record<string, unknown>,
      payload.signature,
      payosChecksumKey
    );
  }

  // 2. Kiểm tra theo chuẩn SePay (Header Authorization: Apikey <SEPAY_WEBHOOK_SECRET> hoặc x-webhook-signature)
  if (sepaySecret) {
    const authHeader = req.headers.get('authorization') ?? '';
    const customSecretHeader = req.headers.get('x-webhook-secret') ?? '';
    const hmacHeader = req.headers.get('x-webhook-signature') ?? '';

    if (
      authHeader === `Apikey ${sepaySecret}` ||
      authHeader === `Bearer ${sepaySecret}` ||
      customSecretHeader === sepaySecret
    ) {
      return true;
    }

    if (hmacHeader) {
      const expectedHmac = crypto
        .createHmac('sha256', sepaySecret)
        .update(rawBody)
        .digest('hex');
      if (hmacHeader === expectedHmac) {
        return true;
      }
    }

    return false;
  }

  // Không chấp nhận webhook unsigned, kể cả môi trường dev.
  if (payosChecksumKey) {
    return false;
  }

  return false;
}

/**
 * Trích xuất mã thanh toán (payment_code) từ nội dung chuyển khoản ngân hàng
 */
function extractPaymentCode(payload: PaymentWebhookPayload): string | null {
  if (payload.payment_code && typeof payload.payment_code === 'string') {
    return payload.payment_code.trim().toUpperCase();
  }

  const candidateTexts = [
    payload.data?.description,
    payload.content,
    payload.description,
    String(payload.data?.orderCode ?? ''),
  ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

  for (const text of candidateTexts) {
    // Khớp định dạng mã chuyển khoản dự án 123Dzô (VD: DZO...)
    const match = text.toUpperCase().match(/DZO[A-Z0-9]{4,20}/);
    if (match?.[0]) {
      return match[0];
    }
  }

  const firstText = candidateTexts[0];
  return firstText ? firstText.trim().toUpperCase() : null;
}

/**
 * Trích xuất số tiền chuyển khoản thực tế từ payload PayOS / SePay
 */
function extractPaidAmount(payload: PaymentWebhookPayload): number {
  const raw =
    payload.data?.amount ?? payload.transferAmount ?? payload.amount ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * POST /api/webhooks/payment
 * Nhận Webhook từ PayOS / SePay khi khách chuyển khoản thành công (Mục 3.1 - Luồng 2 & Mục 9.2 PRD_SPEC.md)
 */
export async function POST(req: Request) {
  if (!onlinePaymentsEnabled()) return NextResponse.json({ error: { code: 'PAYMENT_NOT_CONFIGURED' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody) as PaymentWebhookPayload;

    // 1. Xác thực chữ ký bảo mật PayOS / SePay
    const isAuthentic = verifyWebhookAuthenticity(req, payload, rawBody);
    if (!isAuthentic) {
      return NextResponse.json(
        { error: 'Chữ ký Webhook (Signature / Secret) không hợp lệ' },
        { status: 401 }
      );
    }

    const paymentCode = extractPaymentCode(payload);
    const paidAmount = extractPaidAmount(payload);

    if (!paymentCode) {
      return NextResponse.json(
        { error: 'Không tìm thấy mã thanh toán (payment_code) trong nội dung chuyển khoản' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServiceRoleClient();

    // 2. Tìm phiên đơn hàng (table_sessions) theo payment_code
    const { data: session, error: sessionErr } = await supabase
      .from('table_sessions')
      .select(
        'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at'
      )
      .eq('payment_code', paymentCode)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json(
        { error: `Không tìm thấy phiên đơn hàng khớp với mã ${paymentCode}` },
        { status: 404 }
      );
    }

    // 3. Đảm bảo tính Idempotency (Chống xử lý trùng lặp nếu cổng thanh toán bắn lại Webhook)
    if (
      (session.session_type === 'TAKEAWAY' &&
        (session.status === 'ACTIVE' || session.status === 'CLOSED')) ||
      (session.session_type === 'DINE_IN' && session.status === 'CLOSED')
    ) {
      return NextResponse.json({
        success: true,
        idempotent: true,
        message: 'Giao dịch đã được xử lý trước đó (Idempotent)',
        sessionId: session.id,
        status: session.status,
      });
    }

    // 4. Kiểm tra số tiền chuyển khoản khớp (hoặc lớn hơn/bằng) total_amount
    if (paidAmount < Number(session.total_amount) || Number(session.total_amount) <= 0) {
      return NextResponse.json(
        {
          error: `Số tiền chuyển khoản (${paidAmount}) không khớp với tổng tiền đơn hàng (${session.total_amount})`,
        },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    // 5A. Xử lý cho đơn MANG VỀ (TAKEAWAY):
    // Chuyển trạng thái phiên từ PENDING_PAYMENT -> ACTIVE và đẩy món vào hàng đợi Bếp (QUEUED)
    if (session.session_type === 'TAKEAWAY') {
      const { data: activatedSession, error: updateSessionError } =
        await supabase
          .from('table_sessions')
          .update({
            status: 'ACTIVE',
            payment_method: 'VIETQR',
          })
          .eq('id', session.id)
          .eq('status', 'PENDING_PAYMENT')
          .select('*')
          .single();

      if (updateSessionError || !activatedSession) {
        return NextResponse.json({
          success: true,
          idempotent: true,
          message: 'Đơn hàng đã được kích hoạt bởi tiến trình khác',
        });
      }

      // Đẩy các món KITCHEN vào hàng đợi Bếp (status = 'QUEUED', cập nhật created_at = nowIso để phát Realtime cho KDS)
      const { data: kitchenItems } = await supabase
        .from('order_items')
        .update({
          status: 'QUEUED',
          created_at: nowIso,
        })
        .eq('session_id', session.id)
        .eq('station', 'KITCHEN')
        .select('*');

      // Các món BAR_INSTANT chuyển thẳng sang READY (ready_at = nowIso)
      const { data: barItems } = await supabase
        .from('order_items')
        .update({
          status: 'READY',
          ready_at: nowIso,
        })
        .eq('session_id', session.id)
        .eq('station', 'BAR_INSTANT')
        .select('*');

      const allOrderItems = [...(kitchenItems ?? []), ...(barItems ?? [])];

      // Tự động trừ kho nguyên liệu (EXPORT_SALE) cho các món có linked_ingredient_id
      if (allOrderItems.length > 0) {
        const menuIds = Array.from(
          new Set(allOrderItems.map((i) => i.menu_item_id))
        );
        const { data: menus } = await supabase
          .from('menu_items')
          .select('id, name, linked_ingredient_id')
          .in('id', menuIds);

        for (const item of allOrderItems) {
          const menu = (menus ?? []).find((m) => m.id === item.menu_item_id);
          if (menu?.linked_ingredient_id) {
            const { data: ing } = await supabase
              .from('ingredients')
              .select('id, name, unit, stock_quantity, unit_cost')
              .eq('id', menu.linked_ingredient_id)
              .single();

            if (ing) {
              const nextStock = Math.max(0, ing.stock_quantity - item.quantity);
              await supabase
                .from('ingredients')
                .update({ stock_quantity: nextStock })
                .eq('id', ing.id);

              await supabase.from('inventory_logs').insert({
                ingredient_id: ing.id,
                type: 'EXPORT_SALE',
                quantity_change: -item.quantity,
                total_cost: item.quantity * ing.unit_cost,
                note: `Đơn mang về (${session.payment_code}): ${item.quantity}x ${menu.name}`,
                created_by: session.assigned_staff_id,
              });
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        idempotent: false,
        sessionType: 'TAKEAWAY',
        sessionId: activatedSession.id,
        status: activatedSession.status,
        queuedKitchenCount: kitchenItems?.length ?? 0,
        readyBarCount: barItems?.length ?? 0,
      });
    }

    // 5B. Xử lý cho đơn TẠI BÀN (DINE_IN) thanh toán qua VietQR:
    // Gạch nợ hóa đơn, đóng phiên bàn (CLOSED) và giải phóng bàn vật lý (AVAILABLE)
    const { data: closedSession, error: closeErr } = await supabase
      .from('table_sessions')
      .update({
        status: 'CLOSED',
        payment_method: 'VIETQR',
        closed_at: nowIso,
      })
      .eq('id', session.id)
      .select('*')
      .single();

    if (closeErr || !closedSession) {
      throw new Error(closeErr?.message ?? 'Không thể đóng phiên bàn sau thanh toán');
    }

    if (session.table_id) {
      await supabase
        .from('tables')
        .update({
          status: 'AVAILABLE',
          current_session_id: null,
        })
        .eq('id', session.table_id);
    }

    return NextResponse.json({
      success: true,
      idempotent: false,
      sessionType: 'DINE_IN',
      sessionId: closedSession.id,
      status: closedSession.status,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Lỗi xử lý Webhook thanh toán',
      },
      { status: 500 }
    );
  }
}
