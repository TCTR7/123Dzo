# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: features\customer_dine_in\test\customer_dine_in.spec.ts >> Module: Customer Dine-In QR Ordering (/customer/order/[token]) >> 1. Chặn hoàn toàn nếu session_token không tồn tại hoặc bàn đã CLOSED (Anti-Fraud Mục 3.2)
- Location: automation_test\features\customer_dine_in\test\customer_dine_in.spec.ts:6:7

# Error details

```
Error: browserType.launch: Executable doesn't exist at C:\Users\Trung Tran\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```