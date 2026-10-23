import { expect,type Page } from '@playwright/test';
/** Outcomes and role/name locators, no browser API/SSR interception. */
export class CustomerPage {
 constructor(readonly page:Page){}
 async openTable(token:string){await this.page.goto('/customer/order/'+encodeURIComponent(token));await expect(this.page.getByRole('button',{name:'Thực đơn',exact:true})).toBeVisible();}
 async chooseFirstAvailable(){const add=this.page.getByRole('button',{name:/^Thêm /}).filter({visible:true}).and(this.page.locator(':enabled'));await expect(add.first()).toBeVisible();await add.first().click();}
 async openCart(){await this.page.getByRole('button',{name:/Giỏ hàng đã chọn/}).click();await expect(this.page.getByRole('dialog',{name:/Giỏ hàng/})).toBeVisible();}
 async note(value:string){await this.page.getByRole('dialog').getByRole('textbox',{name:/Ghi chú/}).first().fill(value);}
}
export class OperationsPage {
 constructor(readonly page:Page){}
 async open(path:'/staff'|'/kitchen'){await this.page.goto(path);await expect(this.page.getByRole('heading',{level:1})).toBeVisible();}
 async showAllWork(){await this.page.getByRole('button',{name:'Hỗ trợ toàn quán',exact:true}).click();}
}
export class TakeawayPage {
 constructor(readonly page:Page){}
 async review(name:string,phone:string,menuName:string){
  await this.page.goto('/customer/takeaway');await expect(this.page.getByRole('heading',{name:'Đặt món mang về',exact:true})).toBeVisible();
  await this.page.getByRole('button',{name:'Thêm '+menuName,exact:true}).click();
  await this.page.getByRole('button',{name:/Xem giỏ mang về/}).click();await this.page.getByRole('button',{name:'Xem lại và thông tin nhận',exact:true}).click();
  const dialog=this.page.getByRole('dialog',{name:'Xem lại đơn mang về',exact:true});await dialog.getByRole('textbox',{name:'Tên người nhận',exact:true}).fill(name);await dialog.getByRole('textbox',{name:'Số điện thoại',exact:true}).fill(phone);
  await dialog.getByRole('button',{name:'Tiếp tục xác nhận đơn',exact:true}).click();await expect(this.page.getByRole('dialog',{name:'Gửi đơn và chờ xác nhận tiền',exact:true})).toBeVisible();
 }
 async submit(){await this.page.getByRole('button',{name:'Xác nhận gửi đơn mang về',exact:true}).click();await expect(this.page.getByRole('heading',{name:'Đơn mang về của bạn',exact:true})).toBeVisible();}
 async reopen(){await this.page.reload();await this.page.getByRole('button',{name:'Mở đơn đã lưu 1',exact:true}).click();await expect(this.page.getByRole('heading',{name:'Đơn mang về của bạn',exact:true})).toBeVisible();}
}
