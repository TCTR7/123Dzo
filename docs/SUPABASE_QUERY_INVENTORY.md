# Supabase query inventory

Delta B20: validated POST customer/takeaway derives a server-only trusted ingress
network fingerprint, then calls service-only fn_takeaway_request_gate before
fn_create_takeaway. Quota RPC commits separately, counts failed/retried business
requests and returns429 budget state/Retry-After without rollback. New private
request_limits table stores expiring fixed-window counters only, not IP/body/PII;
no raw grants. GET snapshot/operation recovery bypasses create budget, still
requires capability. Missing trust/config/DB gate fails closed; settings also
disable checkout. Only expired quota counters are pruned, never audit identities.
No new browser DB/storage/channel query. Deployed ingress remains unverified.

Delta B19 (supersedes browse-only/provider statements below): customer menu SSR
remains safe projection; /api/customer/takeaway uses header capability and
service-only fn_create_takeaway/fn_get_takeaway_create/fn_get_takeaway_snapshot.
SQL0018 creates pending + snapshots atomically, no stock/outbox until receipt.
Guarded /api/staff/payments and SSR /staff/payments,/admin/payments use
fn_confirm_manual_payment/fn_get_manual_payment_operation/fn_manual_payment_status
(SQL0017), current DB role and immutable private ledger receipt, pages25+1.
Guarded /api/staff/takeaway uses fn_pickup_takeaway/fn_get_takeaway_pickup/
fn_takeaway_pickup_list (SQL0018) for paid, fully ready handover. Pickup closes
with server actor/time, no second receipt/export. All mutation/recovery RPCs
service-only; no new browser base-table reads/writes/channels. Public snapshot
omits contact/cost/receipt; no phone lookup. Automatic webhook stays disabled.
Migration parity18/18 and disposable PG evidence are local, not deployed grants.

Delta B17/B18 (supersedes older caller limitations below): analytics SSR/filter
use five views/RPCs with shared period semantics, including peak-hours RPC; menu/
staff aggregates page until empty instead of trusting an implicit API row cap.
SQL0015 adds nullable activated_at and effective queue time;0016 exposes only
admin-guarded count diagnostics via fn_admin_data_health. Public takeaway menu
SSR selects display fields only; active route is browse-only and makes no order/
payment writes. Dine-in foreground recovery is read-only; explicit retries retain
the same operation ID through ambiguous HTTP5xx. Staff/admin receipt UI uses
existing atomic session RPCs, resetting payment confirmation when amount/method
changes. Admin staff SSR maps raw push subscription to has_push_subscription
before serialization; no endpoint/key reaches those Client Component props.
No new browser .from/storage mutation or raw row channel is introduced.

Delta B16: customer realtime-ticket service SELECT table_sessions.id theo token,
DINE_IN ACTIVE/REQUEST_BILL; staff ticket current Clerk/DB active-role guard.
Browser dedicated client/accessToken/setAuth→one private Broadcast (không raw row
reads/publish/presence), refresh qua QR snapshot API hoặc guarded SSR như B13.
SQL0014 statement/session triggers→realtime.send chỉ {v,id}, private; managed
messages restrictive boundaries + fn_realtime_receive_allowed boolean duy nhất
authenticated được execute, không base/RPC business grants. Feature off mặc định,
chờ Supabase test-project proof; không được dùng polling làm acceptance realtime.

Delta B15: Staff push controls gọi POST/DELETE subscribe sau gesture, body actor
phải khớp guard (DELETE thêm staffId tùy chọn để chặn account-switch race), exact
endpoint CAS giữ nguyên. Không direct browser DB/Storage query mới. SW allowlist
static offline/icons/WAV; không cache SSR/QR/API/RSC hoặc mutation, không background
order replay. PWA account owner không chứa endpoint/key/token; API vẫn kiểm role.
Private Broadcast M-12a chưa có, guarded snapshots B13 vẫn là đường cập nhật.

Delta B14: /api/push/notify trả410 sau guard, bỏ caller-selected push/setTimeout;
subscribe POST/DELETE→fn_set_push_subscription, role DB/Origin/bounds/provider/key.
POST cron/notifications Bearer riêng→claim/prepare/ack/finish RPC0013, lease và
receipt private; fallback durable + bill trigger. Không raw private SELECT hoặc
service UPDATE push nữa. Admin notifications page/retry API→admin-only safe SQL
counters/list25 + CAS retry. Worker không trả subscription ra HTTP; legacy410
clear hash-CAS,404 retry. Scheduler/realtime riêng/PWA đích chưa bật/nghiệm thu.

Delta B13: guarded SSR dùng service client; QR bỏ direct base/global queue/kho
reads, thay fn_get_dine_in_snapshot qua SSR/GET customer/snapshot, token header,
safe projected DTO + SQL queuePositions. Staff/KDS bỏ cost/contact/push props;
admin staff chỉ cờ đăng ký push. KPI filter GET admin/analytics → views/RPC.
Các luồng đang bật bỏ browser postgres_changes; guarded snapshot refresh tạm.
0012 khóa SELECT/write table+column public roles, service raw writes trừ push,
KPI security_invoker và public fn_* EXECUTE. Takeaway legacy vẫn gate đóng;
private Broadcast/worker M-12 chưa triển khai, không dùng raw rows làm fallback.

Delta B12: bills bỏ history order_items500, sessions DB status/page25+1; logs
DB type/page25+1 thay limit100. Catalog/live pages dùng keyset id250 đến rỗng,
fail khi lỗi/duplicate/quá200 lượt; staff orders join active sessions thay
limit300 history, KDS giữ station/status. QR read lists không còn implicit cap,
projection/capability read vẫn M-04. Dashboard DB lỗi không fallback numeric0.
Cron Bearer/cooldown và select limit1, không exact count. Payment caller legacy
giữ code nhưng entry gate đóng; không runtime takeaway writes/unsigned payment,
M-09/10 còn chờ provider. Những query snapshot legacy không là caller được bật.

Delta B11: `MenuManager.handleImageFileChange` chỉ nén + gọi admin/menu-images;
bỏ browser Storage upload/getPublicUrl và ô dán URL. Server upload RESERVE/READY
RPC0011 + immutable scoped Storage path; menu trigger kiểm registry READY.
`handleCleanupImages` gọi admin/menu-images/cleanup → claim/remove/finish, không
nhận đường dẫn từ browser. Bucket restrictive write policies chặn grant permissive
cũ; private registry không public read/write. Storage thật và private read/realtime
vẫn cần kiểm môi trường đích; không kết luận toàn bộ app an toàn production.

Delta B10: `InventoryManager.handleSaveIngredient` và
`StaffAndTableManager.handleSaveZone/handleDeleteZone/handleSaveTable/
handleDeleteTable` qua POST/GET admin/metadata → save/get RPC0010. Hai component
không còn browser .from mutation; ingredient/table/zone table+column writes
anon/authenticated bị revoke, FK liên kết lịch sử chuyển RESTRICT. Staff edits
và assignment vẫn API B02/B07. Storage upload và takeaway còn caller cũ riêng,
không coi read RLS hay toàn bộ ứng dụng đã an toàn production.

Delta B09: `MenuManager.handleSaveMenuItem/handleDeleteMenuItem/
handleToggleAvailability` và `KitchenKdsBoard.handleToggle86MenuItem` qua
POST/GET staff/menu-actions → fn_menu_action/fn_get_menu_action_operation0009.
Không còn browser menu_items mutation; thu hồi cả column writes, CAS và
ledger trong DB. Storage upload vẫn browser, metadata ingredient/table/zone
và private realtime/read grants còn M-14/M-12/M-04; chưa coi toàn bộ CRUD an toàn.

Delta B08: `handleServeOrderItem`, staff/admin cancel và KDS start/complete
đều qua item-actions API/RPC0008. Bỏ recalculateSessionTotal và admin cancel
update total từ list; không browser order_items/table_sessions mutation tại3
components này, không KDS gọi push/notify. KDS menu 86ing vẫn direct write M-14.

Delta B07: staff open/transfer/handover/close, admin bill close, admin table
assignment và customer request bill đã chuyển session action API/RPC0006.
Không client sinh token Math.random, không nhiều request cập nhật hai bàn.
Full detail GET staff/bill → RPC0007 thay việc dùng list300/500 làm bill detail.
Staff/admin cancel vẫn ghi item/total từ list cũ; serve/KDS/takeaway/metadata
tables còn caller riêng M-11/M-10/M-14, không coi base grants đã an toàn.

Delta B06: `StaffDashboard.handleReturnBeer/runBeerReturn` chỉ gọi staff return
API/RPC, không browser update quantity/status/stock/total hoặc insert RETURN_BEER.
Full return quantity0, UI bỏ hàng chờ phục vụ và giữ nhãn lịch sử.0005 order RPC
lưu stock_export_log_id, DTO ẩn FK; legacy thiếu provenance chặn trả tự động.

Delta B05: `InventoryManager.handleCreateInventoryLog/runInventory` không còn
browser insert inventory_logs hoặc update stock/unit_cost. Thay bằng admin
inventory POST/GET → record/get RPC0004. `handleSaveIngredient` chỉ ghi metadata,
nguyên liệu mới dùng default stock0/cost0; chưa chuyển metadata API/RLS M-14/M-04.
EXPORT_SALE/RETURN_BEER không còn là lựa chọn tạo phiếu thủ công ở admin.

Delta B04: `DineInOrderView.handleSubmitOrder` và
`StaffDashboard.handleStaffAddOrderItem` không còn browser insert món, update
stock, insert EXPORT_SALE hoặc cộng total từ state. Đi qua shared
`orders/route-handlers.ts` → submit/get order RPC. Các write return/cancel/serve/
checkout/takeaway và raw realtime reads vẫn chưa chuyển; không coi inventory
baseline bên dưới là current-safe. Migration0003 chỉ cấp RPC cho service_role.

Delta B02 (2026-10-22): StaffAndTableManager đã bỏ 5 call sites ghi staff_profiles
(create/update/zone/active và zone side effect khi assign bàn). Thay bằng
POST /api/admin/staff → fn_admin_save_staff. Danh sách bên dưới là snapshot B01;
line/query cũ chỉ dùng truy vết, không phải current code. Không regenerate toàn
inventory mỗi batch; ghi delta theo symbol, regenerate ở milestone/release.

Snapshot: 2026-10-22, after Auth foundation changes. AST scan of every .from/.rpc/.channel in src; no environment or runtime data read.

This is a call-site inventory, not a statement that database permissions are safe. Browser writes remain open audit work until API/RPC migration and RLS verification. Review dynamic query continuations in the referenced functions.

Total call sites: 137.

## src/app/(auth-protected)/admin/bills/page.tsx

- Q-001 at line 13: server page; from 'table_sessions'; operations select; owner tasks M-14.
  Query: supabase .from('table_sessions') .select( 'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at' ) .order('opened_at', { ascending: false }) .limit(100)

- Q-002 at line 20: server page; from 'order_items'; operations select; owner tasks M-14.
  Query: supabase .from('order_items') .select( 'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason' ) .order('created_at', { ascending: true }) .limit(500)

- Q-003 at line 27: server page; from 'tables'; operations select; owner tasks M-14.
  Query: supabase .from('tables') .select('id, table_number, zone_id, status, current_session_id')

- Q-004 at line 30: server page; from 'menu_items'; operations select; owner tasks M-14.
  Query: supabase .from('menu_items') .select( 'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id' )

- Q-005 at line 35: server page; from 'staff_profiles'; operations select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .select( 'id, full_name, role, assigned_zone_id, push_subscription, is_active' )

## src/app/(auth-protected)/admin/inventory/page.tsx

- Q-006 at line 12: server page; from 'ingredients'; operations select; owner tasks M-14.
  Query: supabase .from('ingredients') .select('id, name, unit, stock_quantity, min_threshold, unit_cost') .order('name', { ascending: true })

- Q-007 at line 16: server page; from 'inventory_logs'; operations select; owner tasks M-14.
  Query: supabase .from('inventory_logs') .select( 'id, ingredient_id, type, quantity_change, total_cost, note, created_by, created_at' ) .order('created_at', { ascending: false }) .limit(100)

- Q-008 at line 23: server page; from 'staff_profiles'; operations select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .select('id, full_name, role, assigned_zone_id, push_subscription, is_active')

## src/app/(auth-protected)/admin/menu/page.tsx

- Q-009 at line 12: server page; from 'menu_items'; operations select; owner tasks M-14.
  Query: supabase .from('menu_items') .select( 'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id' ) .order('category', { ascending: true }) .order('name', { ascending: true })

- Q-010 at line 19: server page; from 'ingredients'; operations select; owner tasks M-14.
  Query: supabase .from('ingredients') .select('id, name, unit, stock_quantity, min_threshold, unit_cost') .order('name', { ascending: true })

## src/app/(auth-protected)/admin/page.tsx

- Q-011 at line 46: server page; from 'vw_kpi_financial_summary'; operations select; owner tasks M-13.
  Query: supabase.from('vw_kpi_financial_summary').select('*').single()

- Q-012 at line 47: server page; from 'vw_kpi_peak_hours'; operations select; owner tasks M-13.
  Query: supabase .from('vw_kpi_peak_hours') .select('*') .order('hour_of_day', { ascending: true })

- Q-013 at line 51: server page; from 'vw_kpi_menu_analytics'; operations select; owner tasks M-13.
  Query: supabase .from('vw_kpi_menu_analytics') .select('*') .order('total_quantity_sold', { ascending: false })

- Q-014 at line 55: server page; from 'vw_kpi_kitchen_performance'; operations select; owner tasks M-13.
  Query: supabase.from('vw_kpi_kitchen_performance').select('*').single()

- Q-015 at line 56: server page; from 'vw_kpi_waitstaff_performance'; operations select; owner tasks M-13.
  Query: supabase .from('vw_kpi_waitstaff_performance') .select('*') .order('active_serving_count', { ascending: false })

## src/app/(auth-protected)/admin/staff/page.tsx

- Q-016 at line 13: server page; from 'zones'; operations select; owner tasks M-14.
  Query: supabase .from('zones') .select('id, name, created_at') .order('created_at', { ascending: true })

- Q-017 at line 17: server page; from 'tables'; operations select; owner tasks M-14.
  Query: supabase .from('tables') .select('id, table_number, zone_id, status, current_session_id') .order('table_number', { ascending: true })

- Q-018 at line 21: server page; from 'staff_profiles'; operations select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .select( 'id, full_name, role, assigned_zone_id, push_subscription, is_active' ) .order('full_name', { ascending: true })

- Q-019 at line 27: server page; from 'table_sessions'; operations select; owner tasks M-14.
  Query: supabase .from('table_sessions') .select( 'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at' ) .neq('status', 'CLOSED')

## src/app/(auth-protected)/kitchen/page.tsx

- Q-020 at line 12: server page; from 'order_items'; operations select; owner tasks M-14.
  Query: supabase .from('order_items') .select( 'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason' ) .eq('station', 'KITCHEN') .in('status', ['QUEUED', 'COOKING']) .order('created_at', { ascending: true })

- Q-021 at line 20: server page; from 'table_sessions'; operations select; owner tasks M-14.
  Query: supabase .from('table_sessions') .select( 'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at' ) .in('status', ['ACTIVE', 'REQUEST_BILL'])

- Q-022 at line 26: server page; from 'tables'; operations select; owner tasks M-14.
  Query: supabase .from('tables') .select('id, table_number, zone_id, status, current_session_id')

- Q-023 at line 29: server page; from 'menu_items'; operations select; owner tasks M-14.
  Query: supabase .from('menu_items') .select( 'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id' ) .order('name', { ascending: true })

## src/app/(auth-protected)/staff/page.tsx

- Q-024 at line 21: server page; from 'zones'; operations select; owner tasks M-14.
  Query: supabase .from('zones') .select('id, name, created_at') .order('created_at', { ascending: true })

- Q-025 at line 25: server page; from 'tables'; operations select; owner tasks M-14.
  Query: supabase .from('tables') .select('id, table_number, zone_id, status, current_session_id') .order('table_number', { ascending: true })

- Q-026 at line 29: server page; from 'table_sessions'; operations select; owner tasks M-14.
  Query: supabase .from('table_sessions') .select( 'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at' ) .neq('status', 'CLOSED')

- Q-027 at line 35: server page; from 'order_items'; operations select; owner tasks M-14.
  Query: supabase .from('order_items') .select( 'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason' ) .order('created_at', { ascending: false }) .limit(300)

- Q-028 at line 42: server page; from 'menu_items'; operations select; owner tasks M-14.
  Query: supabase .from('menu_items') .select( 'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id' ) .order('category', { ascending: true }) .order('name', { ascending: true })

- Q-029 at line 49: server page; from 'ingredients'; operations select; owner tasks M-14.
  Query: supabase .from('ingredients') .select('id, name, unit, stock_quantity, min_threshold, unit_cost')

- Q-030 at line 52: server page; from 'staff_profiles'; operations select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .select( 'id, full_name, role, assigned_zone_id, push_subscription, is_active' ) .order('full_name', { ascending: true })

## src/app/api/cron/keep-alive/route.ts

- Q-031 at line 11: server API; from 'zones'; operations select; owner tasks M-14.
  Query: supabase .from('zones') .select('id', { count: 'exact', head: true })

## src/app/api/push/notify/route.ts

- Q-032 at line 122: server API; from 'order_items'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('order_items') .select('id, status, served_at') .in('id', orderItemIds) .eq('status', 'READY') .is('served_at', null)

- Q-033 at line 134: server API; from 'staff_profiles'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('staff_profiles') .select( 'id, full_name, role, assigned_zone_id, push_subscription, is_active' ) .eq('is_active', true) .in('role', ['staff', 'admin'])

- Q-034 at line 183: server API; from 'order_items'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('order_items') .select('id, session_id, menu_item_id, quantity') .in('id', itemIds)

- Q-035 at line 192: server API; from new Set(items.map((i) => i.menu_item_id)); operations RPC/channel; owner tasks M-03/M-12.
  Query: Array.from(new Set(items.map((i) => i.menu_item_id)))

- Q-036 at line 193: server API; from 'menu_items'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('menu_items') .select('id, name') .in('id', menuIds)

- Q-037 at line 217: server API; from 'table_sessions'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('table_sessions') .select( 'id, session_type, table_id, assigned_staff_id, customer_name' ) .eq('id', resolvedSessionId) .single()

- Q-038 at line 239: server API; from 'tables'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('tables') .select('id, table_number, zone_id') .eq('id', session.table_id) .single()

- Q-039 at line 257: server API; from 'staff_profiles'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('staff_profiles') .select( 'id, full_name, role, assigned_zone_id, push_subscription, is_active' ) .eq('id', session.assigned_staff_id) .eq('is_active', true) .single()

- Q-040 at line 273: server API; from 'staff_profiles'; operations select; owner tasks M-03/M-12.
  Query: supabase .from('staff_profiles') .select( 'id, full_name, role, assigned_zone_id, push_subscription, is_active' ) .eq('is_active', true) .in('role', ['staff', 'admin'])

## src/app/api/push/subscribe/route.ts

- Q-041 at line 42: server API; from 'staff_profiles'; operations update, select; owner tasks M-03/M-12.
  Query: supabase .from('staff_profiles') .update({ push_subscription: body.subscription, }) .eq('id', targetStaffId) .select('id, full_name, role, assigned_zone_id, is_active') .single()

## src/app/api/webhooks/payment/route.ts

- Q-042 at line 59: server API; from signature; operations RPC/channel; owner tasks M-09/M-10.
  Query: Buffer.from(signature, 'utf8')

- Q-043 at line 60: server API; from computedSignature; operations RPC/channel; owner tasks M-09/M-10.
  Query: Buffer.from(computedSignature, 'utf8')

- Q-044 at line 192: server API; from 'table_sessions'; operations select; owner tasks M-09/M-10.
  Query: supabase .from('table_sessions') .select( 'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at' ) .eq('payment_code', paymentCode) .single()

- Q-045 at line 238: server API; from 'table_sessions'; operations update, select; owner tasks M-09/M-10.
  Query: supabase .from('table_sessions') .update({ status: 'ACTIVE', payment_method: 'VIETQR', }) .eq('id', session.id) .eq('status', 'PENDING_PAYMENT') .select('*') .single()

- Q-046 at line 258: server API; from 'order_items'; operations update, select; owner tasks M-09/M-10.
  Query: supabase .from('order_items') .update({ status: 'QUEUED', created_at: nowIso, }) .eq('session_id', session.id) .eq('station', 'KITCHEN') .select('*')

- Q-047 at line 269: server API; from 'order_items'; operations update, select; owner tasks M-09/M-10.
  Query: supabase .from('order_items') .update({ status: 'READY', ready_at: nowIso, }) .eq('session_id', session.id) .eq('station', 'BAR_INSTANT') .select('*')

- Q-048 at line 283: server API; from new Set(allOrderItems.map((i) => i.menu_item_id)); operations RPC/channel; owner tasks M-09/M-10.
  Query: Array.from( new Set(allOrderItems.map((i) => i.menu_item_id)) )

- Q-049 at line 286: server API; from 'menu_items'; operations select; owner tasks M-09/M-10.
  Query: supabase .from('menu_items') .select('id, name, linked_ingredient_id') .in('id', menuIds)

- Q-050 at line 294: server API; from 'ingredients'; operations select; owner tasks M-09/M-10.
  Query: supabase .from('ingredients') .select('id, name, unit, stock_quantity, unit_cost') .eq('id', menu.linked_ingredient_id) .single()

- Q-051 at line 302: server API; from 'ingredients'; operations update; owner tasks M-09/M-10.
  Query: supabase .from('ingredients') .update({ stock_quantity: nextStock }) .eq('id', ing.id)

- Q-052 at line 307: server API; from 'inventory_logs'; operations insert; owner tasks M-09/M-10.
  Query: supabase.from('inventory_logs').insert({ ingredient_id: ing.id, type: 'EXPORT_SALE', quantity_change: -item.quantity, total_cost: item.quantity * ing.unit_cost, note: 'Đơn mang về (${session.payment_code}): ${item.quantity}x ${menu.name}', created_by: session.assigned_staff_id, })

- Q-053 at line 333: server API; from 'table_sessions'; operations update, select; owner tasks M-09/M-10.
  Query: supabase .from('table_sessions') .update({ status: 'CLOSED', payment_method: 'VIETQR', closed_at: nowIso, }) .eq('id', session.id) .select('*') .single()

- Q-054 at line 349: server API; from 'tables'; operations update; owner tasks M-09/M-10.
  Query: supabase .from('tables') .update({ status: 'AVAILABLE', current_session_id: null, }) .eq('id', session.table_id)

## src/app/customer/order/[token]/page.tsx

- Q-055 at line 19: server page; from 'table_sessions'; operations select; owner tasks M-14.
  Query: supabase .from('table_sessions') .select( 'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at' ) .eq('session_token', token) .single()

- Q-056 at line 55: server page; from 'tables'; operations select; owner tasks M-14.
  Query: supabase .from('tables') .select('id, table_number, zone_id, status, current_session_id') .eq('id', session.table_id) .single()

- Q-057 at line 61: server page; from 'menu_items'; operations select; owner tasks M-14.
  Query: supabase .from('menu_items') .select( 'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id' ) .order('category', { ascending: true }) .order('name', { ascending: true })

- Q-058 at line 68: server page; from 'order_items'; operations select; owner tasks M-14.
  Query: supabase .from('order_items') .select( 'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason' ) .eq('session_id', session.id) .order('created_at', { ascending: false })

- Q-059 at line 75: server page; from 'order_items'; operations select; owner tasks M-14.
  Query: supabase .from('order_items') .select( 'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason' ) .eq('station', 'KITCHEN') .eq('status', 'QUEUED') .order('created_at', { ascending: true })

- Q-060 at line 83: server page; from 'table_sessions'; operations select; owner tasks M-14.
  Query: supabase .from('table_sessions') .select('id') .in('status', ['ACTIVE', 'REQUEST_BILL'])

- Q-061 at line 87: server page; from 'ingredients'; operations select; owner tasks M-14.
  Query: supabase .from('ingredients') .select('id, name, unit, stock_quantity, min_threshold, unit_cost')

- Q-062 at line 102: server page; from 'zones'; operations select; owner tasks M-14.
  Query: supabase .from('zones') .select('id, name, created_at') .eq('id', table.zone_id) .single()

## src/app/customer/takeaway/page.tsx

- Q-063 at line 9: server page; from 'menu_items'; operations select; owner tasks M-14.
  Query: supabase .from('menu_items') .select( 'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id' ) .order('category', { ascending: true }) .order('name', { ascending: true })

## src/components/admin/AdminKpiDashboard.tsx

- Q-064 at line 93: browser; from 'vw_kpi_financial_summary'; operations select; owner tasks M-13.
  Query: supabase.from('vw_kpi_financial_summary').select('*').single()

- Q-065 at line 94: browser; from 'vw_kpi_menu_analytics'; operations select; owner tasks M-13.
  Query: supabase.from('vw_kpi_menu_analytics').select('*')

- Q-066 at line 95: browser; from 'vw_kpi_kitchen_performance'; operations select; owner tasks M-13.
  Query: supabase.from('vw_kpi_kitchen_performance').select('*').single()

- Q-067 at line 96: browser; from 'vw_kpi_waitstaff_performance'; operations select; owner tasks M-13.
  Query: supabase.from('vw_kpi_waitstaff_performance').select('*')

- Q-068 at line 148: browser; rpc 'fn_get_financial_kpi'; operations RPC/channel; owner tasks M-13.
  Query: supabase.rpc('fn_get_financial_kpi', rpcArgs)

- Q-069 at line 149: browser; rpc 'fn_get_menu_kpi'; operations RPC/channel; owner tasks M-13.
  Query: supabase.rpc('fn_get_menu_kpi', rpcArgs)

- Q-070 at line 150: browser; rpc 'fn_get_kitchen_kpi'; operations RPC/channel; owner tasks M-13.
  Query: supabase.rpc('fn_get_kitchen_kpi', rpcArgs)

- Q-071 at line 151: browser; rpc 'fn_get_waitstaff_kpi'; operations RPC/channel; owner tasks M-13.
  Query: supabase.rpc('fn_get_waitstaff_kpi', rpcArgs)

## src/components/admin/BillsManager.tsx

- Q-072 at line 93: browser; channel 'admin-bills-realtime'; operations on, subscribe; owner tasks M-12.
  Query: supabase .channel('admin-bills-realtime') .on( 'postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', }, (payload) => { if (payload.eventType === 'INSERT') { const created = payload.new as TableSessionRow; setSessions((prev) => prev.some((s) => s.id === created.id) ? prev : [created, ...prev] ); } else if (payload.eventType === 'UPDATE') { const updated = payload.new as TableSessionRow; const old = payload.old as Partial<TableSessionRow>; setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)) ); if ( updated.status === 'REQUEST_BILL' && old.status !== 'REQUEST_BILL' ) { void playNotificationSound('/sounds/ting-ting.mp3'); } } } ) .on( 'postgres_changes', { event: '*', schema: 'public', table: 'order_items', }, (payload) => { if (payload.eventType === 'INSERT') { const created = payload.new as OrderItemRow; setOrderItems((prev) => prev.some((i) => i.id === created.id) ? prev : [created, ...prev] ); } else if (payload.eventType === 'UPDATE') { const updated = payload.new as OrderItemRow; setOrderItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)) ); } } ) .subscribe()

- Q-073 at line 255: browser; from 'order_items'; operations update, select; owner tasks M-08.
  Query: supabase .from('order_items') .update({ status: 'CANCELLED', cancelled_at: nowIso, cancelled_by: validAdminId, cancel_reason: trimmedReason, }) .eq('id', cancellingOrderItem.id) .select('*') .single()

- Q-074 at line 282: browser; from 'table_sessions'; operations update, select; owner tasks M-08.
  Query: supabase .from('table_sessions') .update({ total_amount: newTotal }) .eq('id', selectedSession.id) .select('*') .single()

- Q-075 at line 327: browser; from 'table_sessions'; operations update, select; owner tasks M-08.
  Query: supabase .from('table_sessions') .update({ status: 'CLOSED', payment_method: finalMethod, total_amount: calculatedBillTotal, closed_at: nowIso, }) .eq('id', selectedSession.id) .select('*') .single()

- Q-076 at line 344: browser; from 'tables'; operations update; owner tasks M-08.
  Query: supabase .from('tables') .update({ status: 'AVAILABLE', current_session_id: null, }) .eq('id', selectedSession.table_id)

## src/components/admin/InventoryManager.tsx

- Q-077 at line 232: browser; from 'ingredients'; operations update, select; owner tasks M-07/M-14.
  Query: supabase .from('ingredients') .update({ name: trimmedName, unit: trimmedUnit, stock_quantity: parsedStock, min_threshold: parsedMinThreshold, unit_cost: parsedUnitCost, }) .eq('id', editingIngredient.id) .select('*') .single()

- Q-078 at line 253: browser; from 'ingredients'; operations insert, select; owner tasks M-07/M-14.
  Query: supabase .from('ingredients') .insert({ name: trimmedName, unit: trimmedUnit, stock_quantity: parsedStock, min_threshold: parsedMinThreshold, unit_cost: parsedUnitCost, }) .select('*') .single()

- Q-079 at line 332: browser; from 'inventory_logs'; operations insert, select; owner tasks M-07/M-14.
  Query: supabase .from('inventory_logs') .insert({ ingredient_id: targetIngredient.id, type: logType, quantity_change: signedQuantityChange, total_cost: calculatedTotalCost, note: logNote.trim() || null, created_by: validStaffId, }) .select('*') .single()

- Q-080 at line 355: browser; from 'ingredients'; operations update, select; owner tasks M-07/M-14.
  Query: supabase .from('ingredients') .update({ stock_quantity: newStockQuantity, unit_cost: updatedUnitCost, }) .eq('id', targetIngredient.id) .select('*') .single()

## src/components/admin/MenuManager.tsx

- Q-081 at line 189: browser; storage MENU_STORAGE_BUCKET; operations upload; owner tasks M-14.
  Query: supabase.storage .from(MENU_STORAGE_BUCKET) .upload(uniqueFileName, compressedWebpFile, { contentType: 'image/webp', cacheControl: '31536000', upsert: true, })

- Q-082 at line 203: browser; storage MENU_STORAGE_BUCKET; operations RPC/channel; owner tasks M-14.
  Query: supabase.storage .from(MENU_STORAGE_BUCKET) .getPublicUrl(uniqueFileName)

- Q-083 at line 231: browser; from 'menu_items'; operations update, select; owner tasks M-14.
  Query: supabase .from('menu_items') .update({ is_available: nextAvailable }) .eq('id', item.id) .select('*') .single()

- Q-084 at line 299: browser; from 'menu_items'; operations update, select; owner tasks M-14.
  Query: supabase .from('menu_items') .update(payload) .eq('id', editingItem.id) .select('*') .single()

- Q-085 at line 314: browser; from 'menu_items'; operations insert, select; owner tasks M-14.
  Query: supabase .from('menu_items') .insert(payload) .select('*') .single()

- Q-086 at line 343: browser; from 'menu_items'; operations delete; owner tasks M-14.
  Query: supabase .from('menu_items') .delete() .eq('id', itemId)

## src/components/admin/StaffAndTableManager.tsx

- Q-087 at line 135: browser; from 'zones'; operations update, select; owner tasks M-14.
  Query: supabase .from('zones') .update({ name: trimmed }) .eq('id', editingZone.id) .select('*') .single()

- Q-088 at line 149: browser; from 'zones'; operations insert, select; owner tasks M-14.
  Query: supabase .from('zones') .insert({ name: trimmed }) .select('*') .single()

- Q-089 at line 178: browser; from 'zones'; operations delete; owner tasks M-14.
  Query: supabase.from('zones').delete().eq('id', zoneId)

- Q-090 at line 236: browser; from 'tables'; operations update, select; owner tasks M-14.
  Query: supabase .from('tables') .update({ table_number: trimmedNumber, zone_id: tableZoneId, }) .eq('id', editingTable.id) .select('*') .single()

- Q-091 at line 252: browser; from 'tables'; operations insert, select; owner tasks M-14.
  Query: supabase .from('tables') .insert({ table_number: trimmedNumber, zone_id: tableZoneId, status: 'AVAILABLE', }) .select('*') .single()

- Q-092 at line 283: browser; from 'tables'; operations delete; owner tasks M-14.
  Query: supabase .from('tables') .delete() .eq('id', tableId)

- Q-093 at line 312: browser; from 'table_sessions'; operations update, select; owner tasks M-14.
  Query: supabase .from('table_sessions') .update({ assigned_staff_id: staffId }) .eq('id', activeSession.id) .select('*') .single()

- Q-094 at line 332: browser; from 'staff_profiles'; operations update, select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .update({ assigned_zone_id: table.zone_id }) .eq('id', staffId) .select('*') .single()

- Q-095 at line 398: browser; from 'staff_profiles'; operations update, select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .update({ full_name: trimmedName, role: staffRole, assigned_zone_id: staffZoneId || null, is_active: staffIsActive, }) .eq('id', editingStaff.id) .select('*') .single()

- Q-096 at line 416: browser; from 'staff_profiles'; operations insert, select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .insert({ id: trimmedId, full_name: trimmedName, role: staffRole, assigned_zone_id: staffZoneId || null, is_active: staffIsActive, }) .select('*') .single()

- Q-097 at line 451: browser; from 'staff_profiles'; operations update, select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .update({ assigned_zone_id: zoneId }) .eq('id', staffId) .select('*') .single()

- Q-098 at line 473: browser; from 'staff_profiles'; operations update, select; owner tasks M-14.
  Query: supabase .from('staff_profiles') .update({ is_active: !staff.is_active }) .eq('id', staff.id) .select('*') .single()

## src/components/customer/DineInOrderView.tsx

- Q-099 at line 160: browser; channel `dine-in-session-${initialSession.id}`; operations on, subscribe; owner tasks M-12.
  Query: supabase .channel('dine-in-session-${initialSession.id}') .on( 'postgres_changes', { event: '*', schema: 'public', table: 'order_items', }, (payload) => { if (payload.eventType === 'INSERT') { const newItem = payload.new as OrderItemRow; if (newItem.session_id === initialSession.id) { setSessionOrders((prev) => { if (prev.some((i) => i.id === newItem.id)) return prev; return [newItem, ...prev]; }); } if ( newItem.station === 'KITCHEN' && newItem.status === 'QUEUED' ) { setGlobalKitchenQueue((prev) => { if (prev.some((i) => i.id === newItem.id)) return prev; return [...prev, newItem]; }); } } else if (payload.eventType === 'UPDATE') { const updatedItem = payload.new as OrderItemRow; if (updatedItem.session_id === initialSession.id) { setSessionOrders((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)) ); } setGlobalKitchenQueue((prev) => { const exists = prev.some((i) => i.id === updatedItem.id); if ( updatedItem.station === 'KITCHEN' && updatedItem.status === 'QUEUED' ) { return exists ? prev.map((i) => i.id === updatedItem.id ? updatedItem : i ) : [...prev, updatedItem]; } return prev.filter((i) => i.id !== updatedItem.id); }); } else if (payload.eventType === 'DELETE') { const deletedId = (payload.old as { id?: string }).id; if (deletedId) { setSessionOrders((prev) => prev.filter((i) => i.id !== deletedId) ); setGlobalKitchenQueue((prev) => prev.filter((i) => i.id !== deletedId) ); } } } ) .on( 'postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: 'id=eq.${initialSession.id}', }, (payload) => { const updatedSession = payload.new as TableSessionRow; setSession(updatedSession); } ) .on( 'postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_items', }, (payload) => { const updatedMenu = payload.new as MenuItemRow; setMenuItems((prev) => prev.map((m) => (m.id === updatedMenu.id ? updatedMenu : m)) ); } ) .subscribe()

- Q-100 at line 341: browser; from 'table_sessions'; operations select; owner tasks M-06/M-08/M-12.
  Query: supabase .from('table_sessions') .select('*') .eq('id', session.id) .eq('session_token', session.session_token) .single()

- Q-101 at line 363: browser; from 'menu_items'; operations select; owner tasks M-06/M-08/M-12.
  Query: supabase .from('menu_items') .select('*') .in('id', cartMenuIds)

- Q-102 at line 408: browser; from 'order_items'; operations insert, select; owner tasks M-06/M-08/M-12.
  Query: supabase .from('order_items') .insert(rowsToInsert) .select('*')

- Q-103 at line 429: browser; from 'ingredients'; operations update, select; owner tasks M-06/M-08/M-12.
  Query: supabase .from('ingredients') .update({ stock_quantity: newStock }) .eq('id', ing.id) .select('*') .single()

- Q-104 at line 444: browser; from 'inventory_logs'; operations insert; owner tasks M-06/M-08/M-12.
  Query: supabase.from('inventory_logs').insert({ ingredient_id: ing.id, type: 'EXPORT_SALE', quantity_change: -inserted.quantity, total_cost: inserted.quantity * ing.unit_cost, note: 'Khách đặt tại ${table?.table_number ?? 'Bàn'}: ${ inserted.quantity }x ${dbMenu.name}', created_by: freshSession.assigned_staff_id, })

- Q-105 at line 478: browser; from 'table_sessions'; operations update, select; owner tasks M-06/M-08/M-12.
  Query: supabase .from('table_sessions') .update({ total_amount: updatedTotal }) .eq('id', freshSession.id) .select('*') .single()

- Q-106 at line 544: browser; from 'table_sessions'; operations update, select; owner tasks M-06/M-08/M-12.
  Query: supabase .from('table_sessions') .update({ status: 'REQUEST_BILL', payment_method: selectedPaymentMethod, total_amount: liveBillTotalAmount, }) .eq('id', session.id) .select('*') .single()

## src/components/customer/TakeawayOrderView.tsx

- Q-107 at line 161: browser; channel `takeaway-session-${currentSession.id}`; operations on, subscribe; owner tasks M-12.
  Query: supabase .channel('takeaway-session-${currentSession.id}') .on( 'postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: 'id=eq.${currentSession.id}', }, (payload) => { const updated = payload.new as TableSessionRow; setCurrentSession(updated); } ) .on( 'postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: 'session_id=eq.${currentSession.id}', }, (payload) => { if (payload.eventType === 'INSERT') { const newItem = payload.new as OrderItemRow; setCurrentOrderItems((prev) => { if (prev.some((i) => i.id === newItem.id)) return prev; return [...prev, newItem]; }); } else if (payload.eventType === 'UPDATE') { const updatedItem = payload.new as OrderItemRow; setCurrentOrderItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)) ); } } ) .on( 'postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_items', }, (payload) => { const updatedMenu = payload.new as MenuItemRow; setMenuItems((prev) => prev.map((m) => (m.id === updatedMenu.id ? updatedMenu : m)) ); } ) .subscribe()

- Q-108 at line 326: browser; from 'menu_items'; operations select; owner tasks M-09/M-10/M-12.
  Query: supabase .from('menu_items') .select('*') .in('id', menuIds)

- Q-109 at line 354: browser; from 'table_sessions'; operations insert, select; owner tasks M-09/M-10/M-12.
  Query: supabase .from('table_sessions') .insert({ session_token: sessionToken, session_type: 'TAKEAWAY', table_id: null, assigned_staff_id: null, customer_name: trimmedName, customer_phone: cleanedPhone, status: 'PENDING_PAYMENT', payment_method: 'VIETQR', payment_code: paymentCode, total_amount: verifiedTotalAmount, opened_at: nowIso, }) .select('*') .single()

- Q-110 at line 396: browser; from 'order_items'; operations insert, select; owner tasks M-09/M-10/M-12.
  Query: supabase .from('order_items') .insert(orderPayloads) .select('*')

- Q-111 at line 452: browser; from 'table_sessions'; operations select; owner tasks M-09/M-10/M-12.
  Query: supabase .from('table_sessions') .select('*') .eq('session_type', 'TAKEAWAY') .order('opened_at', { ascending: false }) .limit(10)

- Q-112 at line 489: browser; from 'order_items'; operations select; owner tasks M-09/M-10/M-12.
  Query: supabase .from('order_items') .select('*') .eq('session_id', targetSession.id) .order('created_at', { ascending: true })

- Q-113 at line 1013: browser; from 'table_sessions'; operations select; owner tasks M-09/M-10/M-12.
  Query: supabase .from('table_sessions') .select('*') .eq('id', rec.sessionId) .single()

## src/components/kitchen/KitchenKdsBoard.tsx

- Q-114 at line 164: browser; channel 'kitchen-kds-realtime'; operations on, subscribe; owner tasks M-12.
  Query: supabase .channel('kitchen-kds-realtime') .on( 'postgres_changes', { event: '*', schema: 'public', table: 'order_items', }, (payload) => { if (payload.eventType === 'INSERT') { const newItem = payload.new as OrderItemRow; if (newItem.station !== 'KITCHEN') return; setOrders((prev) => { if (prev.some((i) => i.id === newItem.id)) return prev; return [...prev, newItem]; }); // Chỉ phát chuông khi phiên bàn đã ACTIVE (chặn chuông từ đơn mang về đang PENDING_PAYMENT) const sess = sessionMap.get(newItem.session_id); if ( newItem.status === 'QUEUED' && sess && (sess.status === 'ACTIVE' || sess.status === 'REQUEST_BILL') ) { void playNotificationSound('/sounds/ting-ting.mp3'); } } else if (payload.eventType === 'UPDATE') { const updatedItem = payload.new as OrderItemRow; if (updatedItem.station !== 'KITCHEN') return; setOrders((prev) => { const exists = prev.some((i) => i.id === updatedItem.id); if ( updatedItem.status === 'QUEUED' || updatedItem.status === 'COOKING' ) { return exists ? prev.map((i) => i.id === updatedItem.id ? updatedItem : i ) : [...prev, updatedItem]; } return prev.filter((i) => i.id !== updatedItem.id); }); } else if (payload.eventType === 'DELETE') { const deletedId = (payload.old as { id?: string }).id; if (deletedId) { setOrders((prev) => prev.filter((i) => i.id !== deletedId)); } } } ) .on( 'postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', }, (payload) => { if (payload.eventType === 'INSERT') { const newSession = payload.new as TableSessionRow; setSessions((prev) => { if (prev.some((s) => s.id === newSession.id)) return prev; return [...prev, newSession]; }); } else if (payload.eventType === 'UPDATE') { const updatedSession = payload.new as TableSessionRow; const oldSession = payload.old as Partial<TableSessionRow>; setSessions((prev) => { const exists = prev.some((s) => s.id === updatedSession.id); return exists ? prev.map((s) => s.id === updatedSession.id ? updatedSession : s ) : [...prev, updatedSession]; }); // Khi đơn Mang về vừa được Webhook kích hoạt từ PENDING_PAYMENT -> ACTIVE, phát chuông báo Bếp if ( updatedSession.status === 'ACTIVE' && oldSession.status === 'PENDING_PAYMENT' ) { void playNotificationSound('/sounds/ting-ting.mp3'); } } } ) .on( 'postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_items', }, (payload) => { const updatedMenu = payload.new as MenuItemRow; setMenuItems((prev) => prev.map((m) => (m.id === updatedMenu.id ? updatedMenu : m)) ); } ) .subscribe()

- Q-115 at line 399: browser; from 'order_items'; operations update, select; owner tasks M-11/M-12.
  Query: supabase .from('order_items') .update({ status: 'COOKING', cooking_started_at: nowIso, batch_id: sharedBatchId, }) .in('id', itemIds) .select('*')

- Q-116 at line 442: browser; from 'order_items'; operations update, select; owner tasks M-11/M-12.
  Query: supabase .from('order_items') .update({ status: 'READY', ready_at: nowIso, }) .in('id', itemIds) .select('*')

- Q-117 at line 503: browser; from 'menu_items'; operations update, select; owner tasks M-11/M-12.
  Query: supabase .from('menu_items') .update({ is_available: !menuItem.is_available }) .eq('id', menuItem.id) .select('*') .single()

## src/components/staff/StaffDashboard.tsx

- Q-118 at line 192: browser; from 'table_sessions'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('table_sessions') .update({ total_amount: validTotal }) .eq('id', sessionId) .select('*') .single()

- Q-119 at line 210: browser; channel 'staff-realtime-channel'; operations on, subscribe; owner tasks M-12.
  Query: supabase .channel('staff-realtime-channel') .on( 'postgres_changes', { event: '*', schema: 'public', table: 'order_items', }, (payload) => { if (payload.eventType === 'INSERT') { const newItem = payload.new as OrderItemRow; setOrderItems((prev) => { if (prev.some((i) => i.id === newItem.id)) return prev; return [newItem, ...prev]; }); if (newItem.status === 'READY') { void playNotificationSound('/sounds/ting-ting.mp3'); } } else if (payload.eventType === 'UPDATE') { const updatedItem = payload.new as OrderItemRow; const oldItem = payload.old as Partial<OrderItemRow>; setOrderItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)) ); if ( updatedItem.status === 'READY' && oldItem.status !== 'READY' ) { void playNotificationSound('/sounds/ting-ting.mp3'); } } else if (payload.eventType === 'DELETE') { const deletedId = (payload.old as { id?: string }).id; if (deletedId) { setOrderItems((prev) => prev.filter((i) => i.id !== deletedId)); } } } ) .on( 'postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', }, (payload) => { if (payload.eventType === 'INSERT') { const newSession = payload.new as TableSessionRow; setSessions((prev) => { if (prev.some((s) => s.id === newSession.id)) return prev; return [newSession, ...prev]; }); } else if (payload.eventType === 'UPDATE') { const updatedSession = payload.new as TableSessionRow; const oldSession = payload.old as Partial<TableSessionRow>; setSessions((prev) => prev.map((s) => s.id === updatedSession.id ? updatedSession : s ) ); // Phát chuông khi khách bấm "Gọi tính tiền" (REQUEST_BILL) if ( updatedSession.status === 'REQUEST_BILL' && oldSession.status !== 'REQUEST_BILL' ) { void playNotificationSound('/sounds/ting-ting.mp3'); } } } ) .subscribe()

- Q-120 at line 331: browser; from 'table_sessions'; operations insert, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('table_sessions') .insert({ session_token: token, session_type: 'DINE_IN', table_id: table.id, assigned_staff_id: validCurrentStaffId, status: 'ACTIVE', payment_code: paymentCode, total_amount: 0, opened_at: new Date().toISOString(), }) .select('*') .single()

- Q-121 at line 350: browser; from 'tables'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('tables') .update({ status: 'OCCUPIED', current_session_id: createdSession.id, }) .eq('id', table.id) .select('*') .single()

- Q-122 at line 389: browser; from 'order_items'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('order_items') .update({ status: 'SERVED', served_at: nowIso, served_by_staff_id: validCurrentStaffId, }) .eq('id', item.id) .select('*') .single()

- Q-123 at line 441: browser; from 'order_items'; operations insert, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('order_items') .insert({ session_id: activeTableSession.id, menu_item_id: menuItem.id, quantity: qty, note, station: menuItem.station, status: isInstantBar ? 'READY' : 'QUEUED', unit_price: menuItem.price, unit_cost_price: menuItem.cost_price, created_at: nowIso, ready_at: isInstantBar ? nowIso : null, }) .select('*') .single()

- Q-124 at line 467: browser; from 'ingredients'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('ingredients') .update({ stock_quantity: updatedStock }) .eq('id', linkedIng.id) .select('*') .single()

- Q-125 at line 480: browser; from 'inventory_logs'; operations insert; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase.from('inventory_logs').insert({ ingredient_id: linkedIng.id, type: 'EXPORT_SALE', quantity_change: -qty, total_cost: qty * linkedIng.unit_cost, note: 'Xuất bán ${qty} ${linkedIng.unit} (${menuItem.name}) cho ${ activeTable?.table_number ?? 'Bàn' }', created_by: validCurrentStaffId, })

- Q-126 at line 547: browser; from 'table_sessions'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('table_sessions') .update({ table_id: targetTable.id }) .eq('id', activeTableSession.id) .select('*') .single()

- Q-127 at line 559: browser; from 'tables'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('tables') .update({ status: 'AVAILABLE', current_session_id: null }) .eq('id', activeTable.id) .select('*') .single()

- Q-128 at line 571: browser; from 'tables'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('tables') .update({ status: 'OCCUPIED', current_session_id: updatedSession.id, }) .eq('id', targetTable.id) .select('*') .single()

- Q-129 at line 615: browser; from 'table_sessions'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('table_sessions') .update({ assigned_staff_id: targetHandoverStaffId }) .eq('id', activeTableSession.id) .select('*') .single()

- Q-130 at line 679: browser; from 'order_items'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('order_items') .update({ quantity: remainingQty }) .eq('id', targetOrderItem.id) .select('*') .single()

- Q-131 at line 692: browser; from 'order_items'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('order_items') .update({ status: 'CANCELLED', cancelled_at: nowIso, cancelled_by: validCurrentStaffId, cancel_reason: 'Khách trả lại toàn bộ ${returnQty} lon/chai (${ menuItem?.name ?? 'Đồ uống' })', }) .eq('id', targetOrderItem.id) .select('*') .single()

- Q-132 at line 725: browser; from 'ingredients'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('ingredients') .update({ stock_quantity: newStock }) .eq('id', linkedIngredient.id) .select('*') .single()

- Q-133 at line 744: browser; from 'inventory_logs'; operations insert; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('inventory_logs') .insert({ ingredient_id: linkedIngredient.id, type: 'RETURN_BEER', quantity_change: returnQty, total_cost: returnQty * linkedIngredient.unit_cost, note: 'Trả lại ${returnQty} ${linkedIngredient.unit} từ ${ activeTable?.table_number ?? 'Bàn' }', created_by: validCurrentStaffId, })

- Q-134 at line 798: browser; from 'order_items'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('order_items') .update({ status: 'CANCELLED', cancelled_at: nowIso, cancelled_by: validCurrentStaffId, cancel_reason: item.status === 'QUEUED' ? 'Khách đổi ý hủy món khi đang chờ bếp' : 'Admin hủy món', }) .eq('id', item.id) .select('*') .single()

- Q-135 at line 844: browser; from 'table_sessions'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('table_sessions') .update({ status: 'CLOSED', payment_method: checkoutPaymentMethod, total_amount: validTotal, closed_at: nowIso, }) .eq('id', activeTableSession.id) .select('*') .single()

- Q-136 at line 860: browser; from 'tables'; operations update, select; owner tasks M-06/M-07/M-08/M-11/M-12.
  Query: supabase .from('tables') .update({ status: 'AVAILABLE', current_session_id: null, }) .eq('id', activeTable.id) .select('*') .single()

## src/lib/supabase/sync-staff.ts

- Q-137 at line 28: server module; from 'staff_profiles'; operations select; owner tasks M-03.
  Query: supabase .from('staff_profiles') .select('id, role, is_active') .eq('id', userId) .maybeSingle()
