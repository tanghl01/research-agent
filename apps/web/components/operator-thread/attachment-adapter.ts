import type { Attachment, AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";

const DEFAULT_ATTACHMENT_MIME_TYPE = "application/octet-stream";

export class AnyFileAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  public async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: createAttachmentId(file),
      type: "file",
      name: file.name || "attachment",
      contentType: attachmentMimeType(file),
      file,
      status: { type: "requires-action", reason: "composer-send" }
    };
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const mimeType = attachmentMimeType(attachment.file);
    return {
      ...attachment,
      contentType: mimeType,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data: await readFileAsDataUrl(attachment.file, mimeType),
          mimeType
        }
      ]
    };
  }

  public async remove(_attachment: Attachment): Promise<void> {
    return undefined;
  }
}

function attachmentMimeType(file: File): string {
  return file.type || DEFAULT_ATTACHMENT_MIME_TYPE;
}

function createAttachmentId(file: File): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name || "attachment"}`;
}

async function readFileAsDataUrl(file: File, mimeType: string): Promise<string> {
  if (typeof FileReader === "undefined") {
    const buffer = await file.arrayBuffer();
    return `data:${mimeType};base64,${bytesToBase64(new Uint8Array(buffer))}`;
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read attachment"));
    reader.readAsDataURL(file);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: "base64"): string } } }).Buffer;
  if (bufferCtor) return bufferCtor.from(bytes).toString("base64");

  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
