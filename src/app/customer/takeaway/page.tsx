import { TakeawayFlow } from '@/components/customer/TakeawayFlow';
import {takeawaySettings} from '@/lib/takeaway/config';
import { customerStoreConfig } from '@/lib/customer/customer-config';
import { readPublicMenu } from '@/lib/data/public-menu';

export const dynamic = 'force-dynamic';

export default async function TakeawayPage() {
  try { return <TakeawayFlow menu={(await readPublicMenu())} store={customerStoreConfig()} settings={takeawaySettings()}/>; }
  catch { return <TakeawayFlow menu={[]} error="Chưa tải được thực đơn. Vui lòng thử lại hoặc nhờ nhân viên hỗ trợ." store={customerStoreConfig()} settings={takeawaySettings()}/>; }
}
