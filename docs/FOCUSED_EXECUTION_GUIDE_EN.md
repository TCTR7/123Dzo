# Focused Execution Guide (123Dzô — Small Pub Edition)

Apply these rules to every agent (Builder and Reviewer). Do not create extra processes, audit trails, or documents.

## 1. Respect the Target Scale (Small Pub < 10 Staff)

- Build and review for a **small local pub (< 10 staff, ~20–30 tables)**, NOT a bank or enterprise distributed system.
- Keep Admin strictly focused on the **5 Core Modules**:
  1. `/admin` (KPI Dashboard)
  2. `/admin/bills` (Cashier & Bills)
  3. `/admin/menu` (Menu & 86ing)
  4. `/admin/inventory` (Inventory & Logs)
  5. `/admin/staff` (Zones, Tables & Staff)
- **Never introduce:**
  - `private.operation_requests` or `localStorage` pending journals that lock UI buttons until "reconciled".
  - Thousands of lines of PL/pgSQL RPCs for basic CRUD operations. Use direct Supabase table queries (`supabase.from(...).select/insert/update/delete`) in Next.js server routes/components, keeping only the 5 KPI SQL Views & 5 KPI RPCs in `supabase/schema.sql`.
  - Extra technical admin pages (`/admin/release`, `/admin/notifications`, `/admin/payments`).
  - Extra tables or columns outside the 8 core tables in Section 12 of `docs/PRD_SPEC.md`.

## 2. Work Toward the Objective

Before starting an activity, identify which acceptance criterion or product output in `docs/PRD_SPEC.md` it completes, or which actual bug it fixes. If none applies, do not do it.

## 3. Analyze Until You Can Act

- Read to answer a specific question. Do not inspect the entire repository before each change.
- Once the expected behavior, cause, and affected scope are clear, implement the simplest direct solution.
- Do not expand the design to handle speculative edge cases outside `docs/PRD_SPEC.md`.

## 4. Keep Verification Focused

- Reviewers must verify that pages load cleanly, buttons work immediately without locking, and queries match the 8 core tables in `docs/PRD_SPEC.md`.
- Do not turn optional enterprise hardening into blockers or new amendments.
- Do not create new markdown audit/plan/handoff files in `docs/`.
