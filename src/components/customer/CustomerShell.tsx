import type { ReactNode } from 'react';
export function CustomerShell({children,as:Tag='main'}:{children:ReactNode;as?:'main'|'section'}) {
  return <Tag className="customer-app min-h-dvh bg-zinc-950 text-zinc-100"><div className="mx-auto w-full max-w-[640px] pb-40">{children}</div></Tag>;
}
