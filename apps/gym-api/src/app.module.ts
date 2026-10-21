import { DynamicModule, Module } from "@nestjs/common";
import { AUTOMATION_RULES, CONTACT_RESOLVER, PlatformModule, type Clock, type MessageTransport } from "@platform/nest-common";
import type { GymConfig } from "./config";
import { gymOptions } from "./options";
import { GYM_TEMPLATES } from "./templates";
import { MemberContactResolver } from "./contacts";
import { MembersController } from "./members/members.controller";
import { MembersService } from "./members/members.service";
import { QrService } from "./members/qr.service";
import { MembershipsController } from "./memberships/memberships.controller";
import { MembershipsService } from "./memberships/memberships.service";
import { PaymentsService } from "./memberships/payments.service";
import { CheckinsController } from "./checkins/checkins.controller";
import { CheckinsService } from "./checkins/checkins.service";
import { MeController } from "./me/me.controller";
import { ClassesController } from "./classes/classes.controller";
import { ClassesService } from "./classes/classes.service";
import { GymAutomationRules } from "./automation/rules";
import { GymScheduler } from "./automation/scheduler";
import { CampaignsService } from "./automation/campaigns.service";
import { AutomationController } from "./automation/automation.controller";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { StaffController } from "./staff.controller";

export interface AppModuleOptions {
  config: GymConfig;
  clock?: Clock;
  transports?: MessageTransport[];
}

@Module({})
export class AppModule {
  static register(opts: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot({
          config: opts.config,
          options: gymOptions(opts.config.NODE_ENV),
          templates: GYM_TEMPLATES,
          clock: opts.clock,
          transports: opts.transports,
          providers: [
            { provide: CONTACT_RESOLVER, useClass: MemberContactResolver },
          ],
        }),
      ],
      controllers: [
        MembersController,
        MembershipsController,
        CheckinsController,
        MeController,
        ClassesController,
        AutomationController,
        DashboardController,
        StaffController,
      ],
      providers: [
        { provide: AUTOMATION_RULES, useClass: GymAutomationRules },
        MembersService,
        QrService,
        MembershipsService,
        PaymentsService,
        CheckinsService,
        ClassesService,
        GymScheduler,
        CampaignsService,
        DashboardService,
      ],
    };
  }
}
