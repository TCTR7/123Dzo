import { createElement,type AnchorHTMLAttributes } from 'react';
const router={refresh(){window.dispatchEvent(new Event('preview-refresh'));},push(path:string){location.assign(path);}};
export const useRouter=()=>router;
export default function PreviewLink(props:AnchorHTMLAttributes<HTMLAnchorElement>){return createElement('a',props);}
export function UserButton(){return createElement('span',null,'Tài khoản kiểm thử');}
