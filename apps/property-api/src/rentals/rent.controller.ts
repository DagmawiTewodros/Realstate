import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { PAYMENT_METHODS, dateStringSchema, reasonSchema } from "@platform/shared";
import { CurrentUser, Roles, zod, type AuthUser } from "@platform/nest-common";
import { RENTALS } from "../access";
import { RentService, SLIP_MAX_BYTES } from "./rent.service";
import { ReceiptsService } from "./receipts.service";

/** Multipart form fields arrive as strings, so the payment form is parsed here. */
const paymentFormSchema = z.object({
  amountMinor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(200).optional().nullable(),
  paidAt: dateStringSchema,
});

@Controller()
@Roles(...RENTALS)
export class RentController {
  constructor(
    private readonly rent: RentService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get("leases/:id/ledger")
  ledger(@Param("id", ParseUUIDPipe) id: string) {
    return this.rent.ledger(id);
  }

  @Post("leases/:id/payments")
  @UseInterceptors(FileInterceptor("slip", { limits: { fileSize: SLIP_MAX_BYTES } }))
  async record(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zod(paymentFormSchema)) body: z.infer<typeof paymentFormSchema>,
    @UploadedFile() slip?: Express.Multer.File,
  ) {
    return { payment: await this.rent.recordPayment(user, id, body, slip) };
  }

  @Post("payments/:id/void")
  @HttpCode(200)
  async void(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return { payment: await this.rent.voidPayment(user, id, body.reason) };
  }

  @Get("payments/:id/receipt.pdf")
  async receipt(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.receipts.receiptPdf(id);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.body);
  }

  @Get("payments/:id/slip")
  async slip(@Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.rent.slip(id);
    res.setHeader("content-type", file.contentType);
    res.send(file.body);
  }

  @Get("arrears")
  arrears() {
    return this.rent.arrears();
  }
}
