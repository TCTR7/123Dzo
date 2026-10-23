export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function assertAllowed(condition: unknown, message = 'Không có quyền thực hiện thao tác này.', status = 403): asserts condition {
  if (!condition) throw new ApiError(message, status);
}
export function objectBody(value: unknown): Record<string, unknown> {
  assertAllowed(value && typeof value === 'object' && !Array.isArray(value), 'JSON không hợp lệ.', 400);
  return value as Record<string, unknown>;
}
