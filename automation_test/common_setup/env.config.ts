export const TEST_ENV = {
  baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3123',
  sampleTableToken: process.env.TEST_SESSION_TOKEN || 'demo-table-session-token',
  samplePhone: '0901234567',
  routes: {
    home: '/',
    customerDineIn: (token: string) => `/customer/order/${token}`,
    customerTakeaway: '/customer/takeaway',
    staffPortal: '/staff',
    kitchenKds: '/kitchen',
    adminReports: '/admin',
    adminMenu: '/admin/menu',
    adminInventory: '/admin/inventory',
    adminStaff: '/admin/staff',
    adminBills: '/admin/bills',
  },
} as const;
