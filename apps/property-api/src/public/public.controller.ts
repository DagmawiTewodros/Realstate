import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { paginationSchema, publicInquirySchema, siteSettingsSchema, unitListQuerySchema } from "@platform/shared";
import { AppError, ClientIp, ConsentService, DB, Public, RateLimiter, SettingsService, notFound, zod, type Database, type Executor } from "@platform/nest-common";
import { documents, photos, projects, savedSearches, units } from "../db/schema";
import { CustomersService } from "../customers/customers.service";
import { LeadsService } from "../leads/leads.service";
import { UnitsService } from "../inventory/units.service";
import { MediaService } from "../inventory/media.service";

const listQuery = unitListQuerySchema.omit({ status: true }).merge(paginationSchema.extend({ pageSize: paginationSchema.shape.pageSize.default(12) }));

/** Fields a visitor may see. Never internal notes, landlord, or private documents. */
const publicUnitFields = {
  id: units.id,
  code: units.code,
  type: units.type,
  purpose: units.purpose,
  bedrooms: units.bedrooms,
  areaSqm: units.areaSqm,
  floor: units.floor,
  priceMinor: units.priceMinor,
  currency: units.currency,
  description: units.description,
  publishedAt: units.publishedAt,
  updatedAt: units.updatedAt,
  projectId: projects.id,
  projectName: projects.name,
  area: projects.area,
};

export const INQUIRY_LIMIT_PER_MINUTE = 5;

@Controller("public")
@Public()
export class PublicController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly units: UnitsService,
    private readonly media: MediaService,
    private readonly customers: CustomersService,
    private readonly leads: LeadsService,
    private readonly consent: ConsentService,
    private readonly settings: SettingsService,
    private readonly limiter: RateLimiter,
  ) {}

  private readonly visible = and(eq(units.isPublished, true), eq(units.status, "AVAILABLE"));

  @Get("units")
  async list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    const where = and(this.visible, ...this.units.filters({ ...q, status: undefined }));
    const rows = await this.db
      .select(publicUnitFields)
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .where(where)
      .orderBy(...this.units.order(q.sort))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ n }] = await this.db.select({ n: count() }).from(units).innerJoin(projects, eq(projects.id, units.projectId)).where(where);
    const first = await this.media.firstPhotos(rows.map((r) => r.id));
    return { items: rows.map((r) => ({ ...r, photoId: first.get(r.id) ?? null })), page: q.page, pageSize: q.pageSize, total: Number(n) };
  }

  @Get("featured")
  async featured() {
    const rows = await this.db
      .select(publicUnitFields)
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .where(this.visible)
      .orderBy(desc(units.publishedAt), asc(units.id))
      .limit(6);
    const first = await this.media.firstPhotos(rows.map((r) => r.id));
    return { items: rows.map((r) => ({ ...r, photoId: first.get(r.id) ?? null })) };
  }

  @Get("units/:id")
  async detail(@Param("id", ParseUUIDPipe) id: string) {
    const [unit] = await this.db
      .select({ ...publicUnitFields, projectDescription: projects.description })
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .where(and(eq(units.id, id), this.visible));
    if (!unit) throw notFound("UNIT_NOT_FOUND", "This property is not available");
    const unitPhotos = await this.db
      .select({ id: photos.id, width: photos.width, height: photos.height, altText: photos.altText })
      .from(photos)
      .where(eq(photos.unitId, id))
      .orderBy(asc(photos.sortOrder), asc(photos.createdAt));
    const docs = await this.db
      .select({ id: documents.id, name: documents.name, contentType: documents.contentType })
      .from(documents)
      .where(and(eq(documents.unitId, id), eq(documents.isPublic, true)));
    return { unit, photos: unitPhotos, documents: docs };
  }

  /** A photo is public only while its unit is published and available (or its project is published). */
  @Get("photos/:id")
  async photo(@Param("id", ParseUUIDPipe) id: string, @Query("size") size: string | undefined, @Res() res: Response) {
    const [row] = await this.db
      .select({ unitId: photos.unitId, projectId: photos.projectId })
      .from(photos)
      .where(eq(photos.id, id));
    if (!row) throw notFound("PHOTO_NOT_FOUND");
    let allowed = false;
    if (row.unitId) {
      const [u] = await this.db.select({ id: units.id }).from(units).where(and(eq(units.id, row.unitId), this.visible));
      allowed = Boolean(u);
    } else if (row.projectId) {
      const [p] = await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, row.projectId), eq(projects.isPublished, true)));
      allowed = Boolean(p);
    }
    if (!allowed) throw notFound("PHOTO_NOT_FOUND");
    const file = await this.media.photoFile(id, size === "thumb" ? "thumb" : "full");
    res.setHeader("content-type", file.contentType);
    res.setHeader("cache-control", "public, max-age=300");
    res.setHeader("cross-origin-resource-policy", "cross-origin");
    res.send(file.body);
  }

  @Get("documents/:id")
  async document(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const [row] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(units, eq(units.id, documents.unitId))
      .where(and(eq(documents.id, id), eq(documents.isPublic, true), this.visible));
    if (!row) throw notFound("DOCUMENT_NOT_FOUND");
    const file = await this.media.documentFile(id);
    res.setHeader("content-type", file.contentType);
    res.setHeader("content-disposition", `inline; filename="${file.row.name.replace(/[^\w.-]/g, "_")}"`);
    res.send(file.body);
  }

  @Get("sitemap")
  async sitemap() {
    const rows = await this.db.select({ id: units.id, updatedAt: units.updatedAt }).from(units).where(this.visible).orderBy(desc(units.updatedAt)).limit(5000);
    return { units: rows };
  }

  @Get("settings")
  settingsPublic() {
    return this.settings.get("site", siteSettingsSchema);
  }

  /**
   * Website inquiry: reuses the customer with the same phone, records the consent the visitor ticked,
   * and creates exactly one lead. Limited to 5 per minute per IP; the hidden "website" field must be empty.
   */
  @Post("inquiries")
  @HttpCode(201)
  async inquiry(@Body(zod(publicInquirySchema)) body: z.infer<typeof publicInquirySchema>, @ClientIp() ip: string) {
    this.limiter.enforce(`inquiry:${ip}`, INQUIRY_LIMIT_PER_MINUTE, 60_000);
    const links = (body.message ?? "").match(/https?:\/\//gi)?.length ?? 0;
    if (links > 2) throw new AppError(400, "LOOKS_LIKE_SPAM", "Please remove the links from your message");
    await this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      let unit: { id: string; purpose: string; type: string; area: string; priceMinor: number; bedrooms: number | null } | undefined;
      if (body.unitId) {
        [unit] = await tx
          .select({ id: units.id, purpose: units.purpose, type: units.type, area: projects.area, priceMinor: units.priceMinor, bedrooms: units.bedrooms })
          .from(units)
          .innerJoin(projects, eq(projects.id, units.projectId))
          .where(and(eq(units.id, body.unitId), this.visible));
        if (!unit) throw new AppError(400, "UNIT_NOT_AVAILABLE", "This property is no longer available");
      }
      const { customer } = await this.customers.findOrCreate(null, { name: body.name, phone: body.phone, email: body.email ?? null, locale: body.locale, source: "WEBSITE" }, tx);
      for (const channel of body.consentChannels) await this.consent.grant(customer.id, channel, { note: "Website inquiry form" }, tx);
      await this.leads.createFromWebsite(tx, { customerId: customer.id, unitId: unit?.id ?? null, message: body.message ?? null });
      if (body.notifySimilar && unit && body.consentChannels.length > 0) {
        await tx.insert(savedSearches).values({
          customerId: customer.id,
          purpose: unit.purpose,
          type: unit.type,
          area: unit.area,
          minPriceMinor: Math.round(unit.priceMinor * 0.8),
          maxPriceMinor: Math.round(unit.priceMinor * 1.2),
          bedrooms: unit.bedrooms,
        });
      }
    });
    return { ok: true };
  }

  /** "Stop alerts for this search" link in offer messages. Deactivates one saved search only. */
  @Post("saved-searches/remove/:token")
  @HttpCode(200)
  async removeSavedSearch(@Param("token") token: string, @ClientIp() ip: string) {
    this.limiter.enforce(`savedsearch:${ip}`, 30, 60_000);
    const id = this.consent.verifySignedToken("saved-search", token);
    if (!id) throw notFound("INVALID_LINK", "This link is not valid");
    await this.db.update(savedSearches).set({ isActive: false }).where(inArray(savedSearches.id, [id]));
    return { ok: true };
  }
}
