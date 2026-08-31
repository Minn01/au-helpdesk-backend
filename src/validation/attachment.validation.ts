import path from "node:path";
import { HttpError } from "../errors/http-error.js";

export const MAX_ATTACHMENT_BYTES = 13 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REQUEST = 5;
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain",
] as const;

const allowedTypes = new Set<string>(ALLOWED_ATTACHMENT_MIME_TYPES);
const dangerousExtensions = new Set([
  ".bat", ".cmd", ".com", ".exe", ".html", ".htm", ".js", ".mjs", ".php", ".ps1", ".sh", ".svg",
]);

export const sanitizeFileName = (originalName: string): string => {
  const base = path.basename(originalName).normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return base || "attachment";
};

const detectedMimeType = (body: Buffer): string | undefined => {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (body.length >= 5 && body.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (!body.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(body);
      return "text/plain";
    } catch { /* not valid UTF-8 text */ }
  }
  return undefined;
};

export const validateAttachmentFile = (file: Express.Multer.File) => {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "FILE_TOO_LARGE", "Each attachment must be 13 MB or smaller");
  if (!allowedTypes.has(file.mimetype)) throw new HttpError(415, "UNSUPPORTED_FILE_TYPE", "This attachment type is not allowed");
  const fileName = sanitizeFileName(file.originalname);
  if (dangerousExtensions.has(path.extname(fileName).toLowerCase())) {
    throw new HttpError(415, "UNSUPPORTED_FILE_TYPE", "Executable or script attachments are not allowed");
  }
  if (detectedMimeType(file.buffer) !== file.mimetype) {
    throw new HttpError(415, "UNSUPPORTED_FILE_TYPE", "Attachment content does not match its declared type");
  }
  return { fileName, mimeType: file.mimetype, sizeBytes: file.size, body: file.buffer };
};

export const isAllowedDeclaredMimeType = (mimeType: string) => allowedTypes.has(mimeType);
