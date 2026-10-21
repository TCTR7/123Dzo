# Script chạy toàn bộ Unit Test và Automation Test cho dự án 123Dzô
Write-Host "=== [1/2] Running Unit Tests (Vitest) ===" -ForegroundColor Amber
npx vitest run

Write-Host "`n=== [2/2] Running Automation E2E Tests (Playwright) ===" -ForegroundColor Amber
npx playwright test
