// multipart/form-data framing that streams the file body instead of buffering it.
const encoder = new TextEncoder();

export function safeHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, '_');
}

export function buildMultipart(
  fields: Record<string, string>,
  file: { fieldName: string; name: string; contentType: string; body: ReadableStream<Uint8Array> },
): { body: ReadableStream<Uint8Array>; boundary: string } {
  const boundary = `----mediabot${crypto.randomUUID().replace(/-/g, '')}`;
  let head = '';
  for (const [key, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
  }
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${safeHeaderValue(file.name)}"\r\n`;
  head += `Content-Type: ${file.contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;

  const reader = file.body.getReader();
  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(tail);
  let sentHead = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentHead) {
        sentHead = true;
        controller.enqueue(headBytes);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(tailBytes);
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return { body, boundary };
}
