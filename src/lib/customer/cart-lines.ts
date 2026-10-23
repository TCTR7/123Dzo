import type { MenuCategory, StationType } from '@/types/database.types';
export interface CartLine {
  lineId:string; menu_item_id:string; name:string; category:MenuCategory; station:StationType;
  unit_price:number; image_url:string|null; quantity:number; note:string;
}
export function migrateCartLines(input:unknown):CartLine[] {
  if (!Array.isArray(input)) return [];
  const ids=new Set<string>();
  return input.slice(0,100).flatMap((row:unknown)=>{
    if (!row || typeof row!=='object') return [];
    const r=row as Record<string,unknown>;
    if (typeof r.menu_item_id!=='string' || !r.menu_item_id || r.menu_item_id.length>100 || typeof r.name!=='string' ||
      !['FOOD','BEER','DRINK','OTHER'].includes(String(r.category)) || !['KITCHEN','BAR_INSTANT'].includes(String(r.station)) ||
      typeof r.unit_price!=='number' || !Number.isFinite(r.unit_price) || r.unit_price<0 ||
      typeof r.quantity!=='number' || !Number.isInteger(r.quantity) || r.quantity<1 || r.quantity>99) return [];
    const lineId=typeof r.lineId==='string' && /^[0-9a-f-]{36}$/.test(r.lineId) && !ids.has(r.lineId) ? r.lineId : crypto.randomUUID();
    ids.add(lineId);
    return [{lineId,menu_item_id:r.menu_item_id,name:r.name,category:r.category as MenuCategory,station:r.station as StationType,
      unit_price:r.unit_price,image_url:typeof r.image_url==='string'?r.image_url:null,quantity:r.quantity,note:typeof r.note==='string'?r.note.slice(0,500):''}];
  });
}
