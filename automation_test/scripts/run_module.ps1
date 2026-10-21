param(
  [Parameter(Mandatory=$true)]
  [string]$ModuleName
)

Write-Host "=== Running Automation Test for Module: $ModuleName ===" -ForegroundColor Cyan
npx playwright test "automation_test/features/$ModuleName/test"
