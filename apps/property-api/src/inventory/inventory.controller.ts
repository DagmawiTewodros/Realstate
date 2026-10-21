import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import {
  buildingCreateSchema,
  buildingUpdateSchema,
  idSchema,
  paginationSchema,
  projectCreateSchema,
  projectUpdateSchema,
  unitCreateSchema,
  unitListQuerySchema,
  unitPublishSchema,
  unitStatusSchema,
  unitUpdateSchema,
} from "@platform/shared";
import { AuditService, CurrentUser, DB, Roles, conflict, notFound, zod, type AuthUser, type Database } from "@platform/nest-common";
import { buildings, projects, units } from "../db/schema";
import { SALES_MANAGERS, STAFF } from "../access";
import { UnitsService } from "./units.service";
import { DOCUMENT_MAX_BYTES, MediaService, PHOTO_MAX_BYTES } from "./media.service";

const unitListQuery = unitListQuerySchema.merge(paginationSchema);
const reorderSchema = z.object({ ids: z.array(idSchema).max(200) });
const documentMetaSchema = z.object({ name: z.string().trim().max(200).default(""), isPublic: z.enum(["true", "false"]).default("false") });
const documentPublicSchema = z.object({ isPublic: z.boolean() });
const photoMetaSchema = z.object({ altText: z.string().trim().max(300).optional() });

@Controller()
export class InventoryController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly units: UnitsService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Projects ----------
  @Get("projects")
  @Roles(...STAFF)
  async listProjects() {
    const rows = await this.db
      .select({ project: projects, unitCount: count(units.id) })
      .from(projects)
      .leftJoin(units, eq(units.projectId, projects.id))
      .groupBy(projects.id)
      .orderBy(asc(projects.name));
    return { items: rows.map((r) => ({ ...r.project, unitCount: Number(r.unitCount) })) };
  }

  @Post("projects")
  @Roles(...SALES_MANAGERS)
  async createProject(@CurrentUser() user: AuthUser, @Body(zod(projectCreateSchema)) body: z.infer<typeof projectCreateSchema>) {
    const [row] = await this.db.insert(projects).values(body).returning();
    await this.audit.log({ userId: user.id, action: "project.created", entityType: "project", entityId: row.id });
    return { project: row };
  }

  @Get("projects/:id")
  @Roles(...STAFF)
  async getProject(@Param("id", ParseUUIDPipe) id: string) {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id));
    if (!project) throw notFound("PROJECT_NOT_FOUND");
    const projectBuildings = await this.db.select().from(buildings).where(eq(buildings.projectId, id)).orderBy(asc(buildings.name));
    return { project, buildings: projectBuildings };
  }

  @Patch("projects/:id")
  @Roles(...SALES_MANAGERS)
  async updateProject(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(projectUpdateSchema)) body: z.infer<typeof projectUpdateSchema>) {
    const [row] = await this.db
      .update(projects)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw notFound("PROJECT_NOT_FOUND");
    await this.audit.log({ userId: user.id, action: "project.updated", entityType: "project", entityId: id });
    return { project: row };
  }

  @Post("projects/:id/photos")
  @Roles(...SALES_MANAGERS)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_MAX_BYTES } }))
  async addProjectPhoto(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body(zod(photoMetaSchema)) body: z.infer<typeof photoMetaSchema>) {
    return { photo: await this.media.addPhoto(user, { projectId: id }, file, body.altText) };
  }

  // ---------- Buildings ----------
  @Post("buildings")
  @Roles(...SALES_MANAGERS)
  async createBuilding(@CurrentUser() user: AuthUser, @Body(zod(buildingCreateSchema)) body: z.infer<typeof buildingCreateSchema>) {
    const [project] = await this.db.select({ id: projects.id }).from(projects).where(eq(projects.id, body.projectId));
    if (!project) throw notFound("PROJECT_NOT_FOUND");
    const [existing] = await this.db
      .select({ id: buildings.id })
      .from(buildings)
      .where(and(eq(buildings.projectId, body.projectId), eq(buildings.name, body.name)));
    if (existing) throw conflict("BUILDING_NAME_TAKEN", "This project already has a building with this name");
    const [row] = await this.db.insert(buildings).values(body).returning();
    await this.audit.log({ userId: user.id, action: "building.created", entityType: "building", entityId: row.id });
    return { building: row };
  }

  @Patch("buildings/:id")
  @Roles(...SALES_MANAGERS)
  async updateBuilding(@Param("id", ParseUUIDPipe) id: string, @Body(zod(buildingUpdateSchema)) body: z.infer<typeof buildingUpdateSchema>) {
    const [row] = await this.db.update(buildings).set(body).where(eq(buildings.id, id)).returning();
    if (!row) throw notFound("BUILDING_NOT_FOUND");
    return { building: row };
  }

  // ---------- Units ----------
  @Get("units")
  @Roles(...STAFF)
  listUnits(@Query(zod(unitListQuery)) q: z.infer<typeof unitListQuery>) {
    return this.units.list(q, q);
  }

  @Post("units")
  @Roles(...STAFF)
  async createUnit(@CurrentUser() user: AuthUser, @Body(zod(unitCreateSchema)) body: z.infer<typeof unitCreateSchema>) {
    return { unit: await this.units.create(user, body) };
  }

  @Get("units/:id")
  @Roles(...STAFF)
  getUnit(@Param("id", ParseUUIDPipe) id: string) {
    return this.units.detail(id);
  }

  @Patch("units/:id")
  @Roles(...STAFF)
  async updateUnit(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(unitUpdateSchema)) body: z.infer<typeof unitUpdateSchema>) {
    return { unit: await this.units.update(user, id, body) };
  }

  @Post("units/:id/status")
  @Roles(...STAFF)
  @HttpCode(200)
  async setStatus(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(unitStatusSchema)) body: z.infer<typeof unitStatusSchema>) {
    return { unit: await this.units.setStatus(user, id, body.status) };
  }

  @Post("units/:id/publish")
  @Roles(...STAFF)
  @HttpCode(200)
  async publish(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(unitPublishSchema)) body: z.infer<typeof unitPublishSchema>) {
    return { unit: await this.units.setPublished(user, id, body.isPublished) };
  }

  @Post("units/:id/photos")
  @Roles(...STAFF)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_MAX_BYTES } }))
  async addPhoto(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body(zod(photoMetaSchema)) body: z.infer<typeof photoMetaSchema>) {
    return { photo: await this.media.addPhoto(user, { unitId: id }, file, body.altText) };
  }

  @Patch("units/:id/photos/order")
  @Roles(...STAFF)
  async reorder(@Param("id", ParseUUIDPipe) id: string, @Body(zod(reorderSchema)) body: z.infer<typeof reorderSchema>) {
    return { photos: await this.media.reorderPhotos(id, body.ids) };
  }

  @Delete("photos/:id")
  @Roles(...STAFF)
  @HttpCode(200)
  async deletePhoto(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.media.deletePhoto(user, id);
    return { ok: true };
  }

  @Post("units/:id/documents")
  @Roles(...STAFF)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: DOCUMENT_MAX_BYTES } }))
  async addDocument(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body(zod(documentMetaSchema)) body: z.infer<typeof documentMetaSchema>) {
    return { document: await this.media.addDocument(user, id, file, body.name, body.isPublic === "true") };
  }

  @Patch("documents/:id")
  @Roles(...STAFF)
  async setDocumentPublic(@Param("id", ParseUUIDPipe) id: string, @Body(zod(documentPublicSchema)) body: z.infer<typeof documentPublicSchema>) {
    return { document: await this.media.setDocumentPublic(id, body.isPublic) };
  }

  @Delete("documents/:id")
  @Roles(...STAFF)
  @HttpCode(200)
  async deleteDocument(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.media.deleteDocument(user, id);
    return { ok: true };
  }

  // ---------- Private files for staff ----------
  @Get("files/photos/:id")
  @Roles(...STAFF)
  async photoFile(@Param("id", ParseUUIDPipe) id: string, @Query("size") size: string | undefined, @Res() res: Response) {
    const file = await this.media.photoFile(id, size === "thumb" ? "thumb" : "full");
    res.setHeader("content-type", file.contentType);
    res.setHeader("cache-control", "private, max-age=3600");
    res.send(file.body);
  }

  @Get("files/documents/:id")
  @Roles(...STAFF)
  async documentFile(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.media.documentFile(id);
    res.setHeader("content-type", file.contentType);
    res.setHeader("content-disposition", `inline; filename="${file.row.name.replace(/[^\w.-]/g, "_")}"`);
    res.send(file.body);
  }
}
