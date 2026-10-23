export interface CustomerStoreConfig {name:string;address:string;phone:string;hours:string;verified:boolean}
export function customerStoreConfig():CustomerStoreConfig {
 const name=process.env.NEXT_PUBLIC_STORE_NAME?.trim()||'123Dzô';
 const address=process.env.NEXT_PUBLIC_STORE_ADDRESS?.trim()||'',phone=process.env.NEXT_PUBLIC_STORE_PHONE?.trim()||'',hours=process.env.NEXT_PUBLIC_STORE_HOURS?.trim()||'';
 const verified=process.env.NEXT_PUBLIC_STORE_INFO_VERIFIED==='true'&&Boolean(address&&hours&&/^(?:\+84|0)[0-9\s.-]{8,14}$/.test(phone));
 return {name,address:verified?address:'',phone:verified?phone:'',hours:verified?hours:'',verified};
}
export function recipientInput(name:string,phone:string) {
 const normalized=phone.replace(/[\s().-]/g,'').replace(/^\+84/,'0');
 return {name:name.trim().replace(/\s+/g,' '),phone:normalized,
  nameError:name.trim().length<2||name.trim().length>80?'Nhập tên người nhận từ 2 đến 80 ký tự.':null,
  phoneError:!/^0[35789]\d{8}$/.test(normalized)?'Nhập số điện thoại di động Việt Nam gồm 10 số.':null};
}
