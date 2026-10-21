import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  MAINTENANCE_STATUSES,
  PRIORITIES,
  commentSchema,
  dateStringSchema,
  idSchema,
  maintenanceAssignSchema,
  maintenanceCreateSchema,
  maintenanceStatusSchema,
} from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { RENTALS } from "../access";
import { MAINTENANCE_PHOTO_MAX_BYTES, MaintenanceService } from "./maintenance.service";

const listQuery = z.object({
  unitId: idSchema.optional(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});
const costQuery = z.object({ from: dateStringSchema, to: dateStringSchema });

@Controller()
@Roles(...RENTALS)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get("maintenance")
  list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.maintenance.list(q);
  }

  @Post("maintenance")
  async create(@CurrentUser() user: AuthUser, @Body(zod(maintenanceCreateSchema)) body: z.infer<typeof maintenanceCreateSchema>) {
    return { request: await this.maintenance.create(user, body) };
  }

  @Get("maintenance/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.maintenance.detail(id);
  }

  @Post("maintenance/:id/assign")
  async assign(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(maintenanceAssignSchema)) body: z.infer<typeof maintenanceAssignSchema>) {
    return { request: await this.maintenance.assign(user, id, body) };
  }

  @Patch("maintenance/:id/status")
  async status(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(maintenanceStatusSchema)) body: z.infer<typeof maintenanceStatusSchema>) {
    return { request: await this.maintenance.setStatus(user, id, body) };
  }

  @Post("maintenance/:id/comments")
  async comment(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(commentSchema)) body: z.infer<typeof commentSchema>) {
    return { comment: await this.maintenance.comment(user, id, body.text) };
  }

  @Post("maintenance/:id/photos")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAINTENANCE_PHOTO_MAX_BYTES } }))
  async photo(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return { photo: await this.maintenance.addPhoto(user, id, file) };
  }

  @Get("files/maintenance-photos/:id")
  async photoFile(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.maintenance.photoFile(id);
    res.setHeader("content-type", file.row.contentType);
    res.send(file.body);
  }

  @Get("units/:id/maintenance-cost")
  cost(@Param("id", ParseUUIDPipe) id: string, @Query(zod(costQuery)) q: z.infer<typeof costQuery>) {
    return this.maintenance.costForUnit(id, q.from, q.to);
  }
}
