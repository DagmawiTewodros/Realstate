import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { EXTENSION, MB, MIME, StorageService, AuditService, DB, notFound, validateUpload, type AuthUser, type Database, type UploadedFile } from "@platform/nest-common";
import { documents, photos, projects, units } from "../db/schema";

export const PHOTO_MAX_BYTES = 10 * MB;
export const DOCUMENT_MAX_BYTES = 10 * MB;
const THUMB_WIDTH = 640;

/** Photos and documents for units and projects. Files are checked by content before they are stored. */
@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async addPhoto(user: AuthUser, owner: { unitId?: string; projectId?: string }, file: UploadedFile | undefined, altText?: string) {
    const kind = validateUpload(file, ["jpeg", "png", "webp"], PHOTO_MAX_BYTES);
    if (owner.unitId) {
      const [u] = await this.db.select({ id: units.id }).from(units).where(eq(units.id, owner.unitId));
      if (!u) throw notFound("UNIT_NOT_FOUND");
    }
    if (owner.projectId) {
      const [p] = await this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, owner.projectId));
      if (!p) throw notFound("PROJECT_NOT_FOUND");
    }
    const image = sharp(file!.buffer, { failOn: "error" }).rotate();
    const meta = await image.metadata();
    const thumb = await sharp(file!.buffer).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const prefix = owner.unitId ? `units/${owner.unitId}` : `projects/${owner.projectId}`;
    const storageKey = this.storage.newKey(prefix, EXTENSION[kind]);
    const thumbKey = this.storage.newKey(`${prefix}/thumbs`, "webp");
    await this.storage.put(storageKey, file!.buffer, MIME[kind]);
    await this.storage.put(thumbKey, thumb, "image/webp");
    const existing = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(owner.unitId ? eq(photos.unitId, owner.unitId) : eq(photos.projectId, owner.projectId!));
    const [row] = await this.db
      .insert(photos)
      .values({
        unitId: owner.unitId ?? null,
        projectId: owner.projectId ?? null,
        storageKey,
        thumbKey,
        contentType: MIME[kind],
        width: meta.width ?? null,
        height: meta.height ?? null,
        sortOrder: existing.length,
        altText: altText ?? null,
      })
      .returning();
    await this.audit.log({ userId: user.id, action: "photo.added", entityType: owner.unitId ? "unit" : "project", entityId: owner.unitId ?? owner.projectId });
    return row;
  }

  async reorderPhotos(unitId: string, ids: string[]) {
    const current = await this.db.select({ id: photos.id }).from(photos).where(eq(photos.unitId, unitId));
    const known = new Set(current.map((p) => p.id));
    if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
      throw notFound("PHOTO_LIST_MISMATCH", "Send every photo id of this unit exactly once");
    }
    await this.db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) await tx.update(photos).set({ sortOrder: index }).where(eq(photos.id, id));
    });
    return this.db.select().from(photos).where(eq(photos.unitId, unitId)).orderBy(asc(photos.sortOrder));
  }

  async deletePhoto(user: AuthUser, id: string) {
    const [row] = await this.db.delete(photos).where(eq(photos.id, id)).returning();
    if (!row) throw notFound("PHOTO_NOT_FOUND");
    await this.storage.delete(row.storageKey);
    await this.storage.delete(row.thumbKey);
    await this.audit.log({ userId: user.id, action: "photo.deleted", entityType: "unit", entityId: row.unitId ?? row.projectId });
  }

  async addDocument(user: AuthUser, unitId: string, file: UploadedFile | undefined, name: string, isPublic: boolean) {
    const kind = validateUpload(file, ["pdf", "jpeg", "png"], DOCUMENT_MAX_BYTES);
    const [u] = await this.db.select({ id: units.id }).from(units).where(eq(units.id, unitId));
    if (!u) throw notFound("UNIT_NOT_FOUND");
    const storageKey = this.storage.newKey(`units/${unitId}/docs`, EXTENSION[kind]);
    await this.storage.put(storageKey, file!.buffer, MIME[kind]);
    const [row] = await this.db
      .insert(documents)
      .values({ unitId, name: name.slice(0, 200) || file!.originalname?.slice(0, 200) || "Document", storageKey, contentType: MIME[kind], isPublic })
      .returning();
    await this.audit.log({ userId: user.id, action: "document.added", entityType: "unit", entityId: unitId, metadata: { isPublic } });
    return row;
  }

  async setDocumentPublic(id: string, isPublic: boolean) {
    const [row] = await this.db.update(documents).set({ isPublic }).where(eq(documents.id, id)).returning();
    if (!row) throw notFound("DOCUMENT_NOT_FOUND");
    return row;
  }

  async deleteDocument(user: AuthUser, id: string) {
    const [row] = await this.db.delete(documents).where(eq(documents.id, id)).returning();
    if (!row) throw notFound("DOCUMENT_NOT_FOUND");
    await this.storage.delete(row.storageKey);
    await this.audit.log({ userId: user.id, action: "document.deleted", entityType: "unit", entityId: row.unitId });
  }

  async photoFile(id: string, size: "full" | "thumb") {
    const [row] = await this.db.select().from(photos).where(eq(photos.id, id));
    if (!row) throw notFound("PHOTO_NOT_FOUND");
    const key = size === "thumb" ? row.thumbKey : row.storageKey;
    return { body: await this.storage.get(key), contentType: size === "thumb" ? "image/webp" : row.contentType, row };
  }

  async documentFile(id: string) {
    const [row] = await this.db.select().from(documents).where(eq(documents.id, id));
    if (!row) throw notFound("DOCUMENT_NOT_FOUND");
    return { body: await this.storage.get(row.storageKey), contentType: row.contentType, row };
  }

  /** Photo ids by unit, first photo first, for list cards. */
  async firstPhotos(unitIds: string[]): Promise<Map<string, string>> {
    if (!unitIds.length) return new Map();
    const rows = await this.db
      .select({ id: photos.id, unitId: photos.unitId })
      .from(photos)
      .where(and(inArray(photos.unitId, unitIds)))
      .orderBy(asc(photos.sortOrder), asc(photos.createdAt));
    const map = new Map<string, string>();
    for (const r of rows) if (r.unitId && !map.has(r.unitId)) map.set(r.unitId, r.id);
    return map;
  }
}
