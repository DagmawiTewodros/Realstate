import { Controller, Get, Inject, Param, ParseUUIDPipe, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { CurrentUser, DB, Roles, notFound, type AuthUser, type Database } from "@platform/nest-common";
import { bookings, classSessions, gymPayments } from "../db/schema";
import { ROLE } from "../access";
import { MembersService } from "../members/members.service";
import { MembershipsService } from "../memberships/memberships.service";
import { PaymentsService } from "../memberships/payments.service";
import { CheckinsService } from "../checkins/checkins.service";
import { QrService } from "../members/qr.service";

/** The member's own view: membership, check-in code, visits, payments, bookings. Only ever their own records. */
@Controller("me")
@Roles(ROLE.MEMBER)
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly members: MembersService,
    private readonly memberships: MembershipsService,
    private readonly payments: PaymentsService,
    private readonly checkins: CheckinsService,
    private readonly qr: QrService,
  ) {}

  private memberId(user: AuthUser): string {
    if (!user.linkedEntityId) throw notFound("MEMBER_NOT_FOUND", "No member record is linked to this login");
    return user.linkedEntityId;
  }

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const member = await this.members.get(this.memberId(user));
    const state = await this.memberships.currentState(member.id);
    return {
      member: { id: member.id, name: member.name, locale: member.locale, hasPhoto: Boolean(member.photoKey) },
      membership: {
        status: state.status,
        planName: state.membership?.planName ?? null,
        endDate: state.membership?.endDate ?? null,
        daysLeft: state.daysLeft,
        freeze: state.freeze,
        next: state.next ? { planName: state.next.planName, startDate: state.next.startDate, endDate: state.next.endDate } : null,
      },
    };
  }

  @Get("qr")
  async qrToken(@CurrentUser() user: AuthUser) {
    const member = await this.members.get(this.memberId(user));
    return { token: this.qr.token(member.id, member.qrVersion) };
  }

  @Get("qr.svg")
  async qrSvg(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const member = await this.members.get(this.memberId(user));
    const svg = await QRCode.toString(this.qr.token(member.id, member.qrVersion), { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    res.setHeader("content-type", "image/svg+xml");
    res.setHeader("cache-control", "no-store");
    res.send(svg);
  }

  @Get("checkins")
  async visits(@CurrentUser() user: AuthUser) {
    return { items: await this.checkins.forMember(this.memberId(user)) };
  }

  @Get("payments")
  async myPayments(@CurrentUser() user: AuthUser) {
    const items = await this.db.select().from(gymPayments).where(eq(gymPayments.memberId, this.memberId(user))).orderBy(desc(gymPayments.createdAt));
    return { items };
  }

  @Get("payments/:id/receipt.pdf")
  async receipt(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Res() res: Response) {
    const [own] = await this.db
      .select({ id: gymPayments.id })
      .from(gymPayments)
      .where(and(eq(gymPayments.id, id), eq(gymPayments.memberId, this.memberId(user))));
    if (!own) throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
    const pdf = await this.payments.receiptPdf(id);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  }

  @Get("bookings")
  async myBookings(@CurrentUser() user: AuthUser) {
    const items = await this.db
      .select({ booking: bookings, session: classSessions })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(eq(bookings.memberId, this.memberId(user)))
      .orderBy(desc(classSessions.startsAt));
    return { items: items.map((r) => ({ ...r.booking, session: r.session })) };
  }
}
