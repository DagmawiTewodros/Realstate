import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Roles, type AuthUser } from "@platform/nest-common";
import { RENTALS } from "../access";
import { StatementsService } from "./statements.service";
import { ReceiptsService } from "../rentals/receipts.service";

@Controller("landlords/:landlordId/statements")
@Roles(...RENTALS)
export class StatementsController {
  constructor(
    private readonly statements: StatementsService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get()
  async list(@Param("landlordId", ParseUUIDPipe) landlordId: string) {
    return { items: await this.statements.listSaved(landlordId) };
  }

  @Get(":month")
  get(@CurrentUser() user: AuthUser, @Param("landlordId", ParseUUIDPipe) landlordId: string, @Param("month") month: string) {
    return this.statements.get(landlordId, month, user);
  }

  @Post(":month/reissue")
  @HttpCode(200)
  reissue(@CurrentUser() user: AuthUser, @Param("landlordId", ParseUUIDPipe) landlordId: string, @Param("month") month: string) {
    return this.statements.reissue(user, landlordId, month);
  }

  @Get(":month/pdf")
  async pdf(@CurrentUser() user: AuthUser, @Param("landlordId", ParseUUIDPipe) landlordId: string, @Param("month") month: string, @Res() res: Response) {
    const s = await this.statements.get(landlordId, month, user);
    const pdf = await this.receipts.statementPdf({ landlordId, figures: s.figures, issuedAt: new Date(s.issuedAt), version: s.version });
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.body);
  }
}
