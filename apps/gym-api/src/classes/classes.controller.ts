import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  addDays,
  addisDateString,
  addisStartOfDay,
  assignmentSchema,
  attendanceSchema,
  bookingCreateSchema,
  classTemplateSchema,
  classTemplateUpdateSchema,
  dateStringSchema,
  personalSessionSchema,
  reasonSchema,
  trainerCreateSchema,
} from "@platform/shared";
import { CLOCK, CurrentUser, Roles, zod, type AuthUser, type Clock } from "@platform/nest-common";
import { Inject } from "@nestjs/common";
import { DESK, EVERYONE, MANAGERS, ROLE, STAFF } from "../access";
import { ClassesService } from "./classes.service";

const rangeQuery = z.object({ from: dateStringSchema.optional(), days: z.coerce.number().int().min(1).max(62).default(7) });
const cancelBookingSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });
const personalStatusSchema = z.object({ status: z.enum(["BOOKED", "DONE", "CANCELLED", "NO_SHOW"]) });

@Controller()
export class ClassesController {
  constructor(
    private readonly classes: ClassesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private range(q: z.infer<typeof rangeQuery>) {
    const from = q.from ?? addisDateString(this.clock.now());
    return { from: addisStartOfDay(from), to: addisStartOfDay(addDays(from, q.days)) };
  }

  // ---------- Trainers ----------
  @Get("trainers")
  @Roles(...STAFF)
  async trainers() {
    return { items: await this.classes.listTrainers() };
  }

  @Post("trainers")
  @Roles(...MANAGERS)
  async createTrainer(@CurrentUser() user: AuthUser, @Body(zod(trainerCreateSchema)) body: z.infer<typeof trainerCreateSchema>) {
    return { trainer: await this.classes.createTrainer(user, body) };
  }

  @Post("trainer-assignments")
  @Roles(...MANAGERS)
  async assign(@CurrentUser() user: AuthUser, @Body(zod(assignmentSchema)) body: z.infer<typeof assignmentSchema>) {
    return { assignment: await this.classes.assign(user, body.trainerId, body.memberId) };
  }

  @Delete("trainer-assignments")
  @Roles(...MANAGERS)
  @HttpCode(200)
  async unassign(@CurrentUser() user: AuthUser, @Body(zod(assignmentSchema)) body: z.infer<typeof assignmentSchema>) {
    await this.classes.unassign(user, body.trainerId, body.memberId);
    return { ok: true };
  }

  @Get("trainers/me/members")
  @Roles(ROLE.TRAINER)
  async myMembers(@CurrentUser() user: AuthUser) {
    return { items: await this.classes.assignedMembers(user.id) };
  }

  @Get("trainers/me/schedule")
  @Roles(ROLE.TRAINER)
  async mySchedule(@CurrentUser() user: AuthUser, @Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    const { from, to } = this.range(q);
    return { classes: await this.classes.listSessions(from, to, user.id), personal: await this.classes.listPersonal(user, from, to) };
  }

  // ---------- Class templates ----------
  @Get("class-templates")
  @Roles(...STAFF)
  async templates() {
    return { items: await this.classes.listTemplates() };
  }

  @Post("class-templates")
  @Roles(...MANAGERS)
  async createTemplate(@CurrentUser() user: AuthUser, @Body(zod(classTemplateSchema)) body: z.infer<typeof classTemplateSchema>) {
    return { template: await this.classes.createTemplate(user, body) };
  }

  @Patch("class-templates/:id")
  @Roles(...MANAGERS)
  async updateTemplate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(classTemplateUpdateSchema)) body: z.infer<typeof classTemplateUpdateSchema>) {
    return { template: await this.classes.updateTemplate(user, id, body) };
  }

  // ---------- Sessions (timetable) ----------
  @Get("sessions")
  @Roles(...EVERYONE)
  async sessions(@Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    const { from, to } = this.range(q);
    return { items: await this.classes.listSessions(from, to) };
  }

  @Post("sessions/:id/cancel")
  @Roles(...MANAGERS)
  @HttpCode(200)
  async cancelSession(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(reasonSchema)) body: z.infer<typeof reasonSchema>) {
    return { session: await this.classes.cancelSession(user, id, body.reason) };
  }

  @Get("sessions/:id/roster")
  @Roles(...STAFF)
  roster(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.classes.roster(user, id);
  }

  @Post("sessions/:id/attendance")
  @Roles(ROLE.TRAINER, ...MANAGERS)
  @HttpCode(200)
  attendance(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(attendanceSchema)) body: z.infer<typeof attendanceSchema>) {
    return this.classes.markAttendance(user, id, body.bookingIds);
  }

  // ---------- Bookings ----------
  @Post("bookings")
  @Roles(...DESK, ROLE.MEMBER)
  async book(@CurrentUser() user: AuthUser, @Body(zod(bookingCreateSchema)) body: z.infer<typeof bookingCreateSchema>) {
    return { booking: await this.classes.book(user, body.sessionId, body.memberId) };
  }

  @Post("bookings/:id/cancel")
  @Roles(...DESK, ROLE.MEMBER)
  @HttpCode(200)
  async cancelBooking(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(cancelBookingSchema)) body: z.infer<typeof cancelBookingSchema>) {
    return { booking: await this.classes.cancelBooking(user, id, body.reason) };
  }

  // ---------- Personal training ----------
  @Get("personal-sessions")
  @Roles(ROLE.TRAINER, ...MANAGERS)
  async personal(@CurrentUser() user: AuthUser, @Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    const { from, to } = this.range(q);
    return { items: await this.classes.listPersonal(user, from, to) };
  }

  @Post("personal-sessions")
  @Roles(ROLE.TRAINER, ...MANAGERS)
  async createPersonal(@CurrentUser() user: AuthUser, @Body(zod(personalSessionSchema)) body: z.infer<typeof personalSessionSchema>) {
    return { session: await this.classes.createPersonal(user, body) };
  }

  @Patch("personal-sessions/:id")
  @Roles(ROLE.TRAINER, ...MANAGERS)
  async personalStatus(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(zod(personalStatusSchema)) body: z.infer<typeof personalStatusSchema>) {
    return { session: await this.classes.setPersonalStatus(user, id, body.status) };
  }
}
