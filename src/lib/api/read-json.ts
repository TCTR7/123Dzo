import 'server-only';

export class RequestBodyError extends Error {
  constructor(public readonly status: 400 | 413 | 415, message: string) { super(message); }
}

/** Bound the actual stream, not just the caller-controlled Content-Length. */
export async function readJson(req: Request, maxBytes = 8192): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestBodyError(415, 'Yêu cầu phải có định dạng JSON.');
  }
  const reader = req.body?.getReader();
  if (!reader) throw new RequestBodyError(400, 'Thiếu dữ liệu yêu cầu.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, 'Dữ liệu yêu cầu quá lớn.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, 'Dữ liệu JSON không hợp lệ.');
  } finally {
    reader.releaseLock();
  }
}
