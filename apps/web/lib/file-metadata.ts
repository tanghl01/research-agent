export function extensionOf(value: string): string {
  const clean = value.split("?")[0]?.split("#")[0] ?? value;
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot).toLowerCase() : "";
}

export function mimeTypeFromFilename(filename: string, fallback = "application/octet-stream"): string {
  return mimeTypesByExtension[extensionOf(filename)] ?? fallback;
}

export function responseContentTypeFromFilename(filename: string): string {
  const mimeType = mimeTypeFromFilename(filename);
  return shouldUseUtf8Charset(mimeType) ? `${mimeType}; charset=utf-8` : mimeType;
}

const mimeTypesByExtension: Record<string, string | undefined> = {
  ".cad": "text/plain",
  ".css": "text/css",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".latex": "text/x-tex",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".step": "model/step",
  ".stp": "model/step",
  ".svg": "image/svg+xml",
  ".tex": "text/x-tex",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip"
};

function shouldUseUtf8Charset(mimeType: string): boolean {
  return (
    mimeType === "application/json" ||
    mimeType === "text/css" ||
    mimeType === "text/csv" ||
    mimeType === "text/html" ||
    mimeType === "text/markdown" ||
    mimeType === "text/plain"
  );
}
