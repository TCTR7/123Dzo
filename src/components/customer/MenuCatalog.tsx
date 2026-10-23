'use client';
import { useMemo,useState } from 'react';
import type { PublicMenuItem } from '@/lib/data/read-contracts';
import { formatVND } from '@/lib/utils';
const categories=[['ALL','Tất cả'],['FOOD','Món ăn'],['BEER','Bia'],['DRINK','Đồ uống'],['OTHER','Khác']] as const;
export function MenuItemCard({item,quantity,onAdd,disabled}:{item:PublicMenuItem;quantity:number;onAdd:()=>void;disabled:boolean}) {
  return <article className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 flex flex-wrap gap-3 items-center">
    {item.image_url&&<img src={item.image_url} alt="" loading="lazy" width={72} height={72} className="h-[72px] w-[72px] object-cover rounded-xl"/>}
    <div className="flex-1 min-w-32"><h3 className="font-bold break-words">{item.name}</h3><p className="text-amber-300 font-bold">{formatVND(item.price)}</p>
      {quantity>0&&<p className="text-sm text-zinc-300">Đang chọn: {quantity}</p>}{!item.is_available&&<p className="text-sm text-amber-300">Tạm hết</p>}</div>
    <button type="button" aria-label={`Thêm ${item.name}`} disabled={disabled||!item.is_available} onClick={onAdd} className="min-h-12 min-w-12 px-4 rounded-xl bg-amber-400 text-zinc-950 font-bold disabled:opacity-50">Thêm</button>
  </article>;
}
export function MenuCatalog({items,onAdd,selected=[],disabled=false,error,onRetry}:{items:PublicMenuItem[];onAdd:(item:PublicMenuItem)=>void;selected?:readonly {menu_item_id:string;quantity:number}[];disabled?:boolean;error?:string;onRetry?:()=>void}) {
  const [search,setSearch]=useState(''),[category,setCategory]=useState('ALL');
  const visible=useMemo(()=>items.filter(item=>(category==='ALL'||item.category===category)&&item.name.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))),[items,category,search]);
  return <section className="space-y-4"><label className="block space-y-2"><span>Tìm món</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Tên món, bia, nước…" className="w-full min-h-12 rounded-xl bg-zinc-900 border border-zinc-600 px-3"/></label>
    {search&&<button type="button" className="min-h-12 px-4 border rounded-xl" onClick={()=>setSearch('')}>Xóa tìm kiếm</button>}
    <div className="flex flex-wrap gap-2" aria-label="Loại món">{categories.map(([value,label])=><button key={value} type="button" aria-pressed={category===value} onClick={()=>setCategory(value)} className={`min-h-12 px-4 rounded-xl border ${category===value?'bg-amber-400 text-zinc-950 border-amber-400':'border-zinc-600'}`}>{label}</button>)}</div>
    {error?<div role="alert"><p>{error}</p>{onRetry&&<button type="button" onClick={onRetry} className="min-h-12 px-4 border rounded-xl">Thử tải lại</button>}</div>:visible.length?visible.map(item=><MenuItemCard key={item.id} item={item} quantity={selected.filter(line=>line.menu_item_id===item.id).reduce((sum,line)=>sum+line.quantity,0)} onAdd={()=>onAdd(item)} disabled={disabled}/>):<p role="status">{items.length?'Không tìm thấy món phù hợp. Thử tên khác hoặc chọn Tất cả.':'Quán chưa có món để hiển thị. Vui lòng hỏi nhân viên.'}</p>}
  </section>;
}
