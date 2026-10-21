import { AppError } from "./errors";

export type FileKind = "jpeg" | "png" | "webp" | "pdf";

export const MIME: Record<FileKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export const EXTENSION: Record<FileKind, string> = { jpeg: "jpg", png: "png", webp: "webp", pdf: "pdf" };

/** Detects the real file type from its first bytes. The file name and declared type are not trusted. */
export function detectFileKind(buf: Buffer): FileKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  return null;
}

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

/** Rejects a file before it reaches storage: missing, too large or not one of the allowed types. */
export function validateUpload(file: UploadedFile | undefined, allowed: FileKind[], maxBytes: number): FileKind {
  if (!file || !file.buffer?.length) throw new AppError(400, "FILE_REQUIRED", "Choose a file to upload");
  if (file.size > maxBytes) throw new AppError(413, "FILE_TOO_LARGE", `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const kind = detectFileKind(file.buffer);
  if (!kind || !allowed.includes(kind)) {
    throw new AppError(400, "INVALID_FILE_TYPE", `Allowed types: ${allowed.join(", ")}`);
  }
  return kind;
}

export const MB = 1024 * 1024;
