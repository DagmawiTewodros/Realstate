import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { consentSchema, memberCreateSchema, memberUpdateSchema, paginationSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { DESK, ROLE, STAFF } from "../access";
import { MEMBER_PHOTO_MAX_BYTES, MembersService } from "./members.service";
import { MembershipsService } from "../memberships/memberships.service";

const listQuery = paginationSchema.extend({ q: z.string().trim().max(100).optional() });

@Controller("members")
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly memberships: MembershipsService,
  ) {}

  @Get()
  @Roles(...DESK)
  list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.members.list(q, q.q);
  }

  @Post()
  @Roles(...DESK)
  create(@CurrentUser() user: AuthUser, @Body(zod(memberCreateSchema)) body: z.infer<typeof memberCreateSchema>) {
    return this.members.create(user, body);
  }

  /** Desk staff see every member; a trainer only members assigned to them. */
  @Get(":id")
  @Roles(...STAFF)
  async get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const member = await this.members.getFor(user, id);
    const state = await this.memberships.currentState(id);
    const consent = user.role === ROLE.TRAINER ? undefined : await this.members.consentState(id);
    return { member, membership: state, consent };
  }

  @Patch(":id")
  @Roles(...DESK)
  update(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(memberUpdateSchema)) body: z.infer<typeof memberUpdateSchema>) {
    return this.members.update(user, id, body);
  }

  @Post(":id/consent")
  @Roles(...DESK)
  consent(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(consentSchema)) body: z.infer<typeof consentSchema>) {
    return this.members.setConsent(user, id, body.channel, body.granted, body.note);
  }

  @Post(":id/photo")
  @Roles(...DESK)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MEMBER_PHOTO_MAX_BYTES } }))
  async photo(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return { member: await this.members.setPhoto(user, id, file) };
  }

  @Get(":id/photo")
  @Roles(...STAFF)
  async getPhoto(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    await this.members.getFor(user, id);
    const file = await this.members.photo(id);
    res.setHeader("content-type", file.contentType);
    res.setHeader("cache-control", "private, max-age=600");
    res.send(file.body);
  }

  @Post(":id/qr/regenerate")
  @Roles(...DESK)
  @HttpCode(200)
  async regenerate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const member = await this.members.regenerateQr(user, id);
    return { qrVersion: member.qrVersion };
  }

  @Post(":id/invite")
  @Roles(...DESK)
  invite(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.members.invite(user, id);
  }

  @Get(":id/export")
  @Roles(ROLE.OWNER)
  export(@Param("id", ParseUUIDPipe) id: string) {
    return this.members.export(id);
  }

  @Post(":id/anonymise")
  @Roles(ROLE.OWNER)
  async anonymise(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return { member: await this.members.anonymise(user, id) };
  }
}
