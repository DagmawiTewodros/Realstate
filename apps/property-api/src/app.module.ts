import { DynamicModule, Module } from "@nestjs/common";
import { AUTOMATION_RULES, CONTACT_RESOLVER, PlatformModule, type Clock, type MessageTransport } from "@platform/nest-common";
import type { PropertyConfig } from "./config";
import { propertyOptions } from "./options";
import { PROPERTY_TEMPLATES } from "./automation/templates";
import { CustomerContactResolver } from "./automation/contacts";
import { CustomersController } from "./customers/customers.controller";
import { CustomersService } from "./customers/customers.service";
import { LeadsController } from "./leads/leads.controller";
import { LeadsService } from "./leads/leads.service";
import { StaffController } from "./staff/staff.controller";
import { InventoryController } from "./inventory/inventory.controller";
import { UnitsService } from "./inventory/units.service";
import { MediaService } from "./inventory/media.service";
import { ImportsController } from "./imports/imports.controller";
import { ImportsService } from "./imports/imports.service";
import { PublicController } from "./public/public.controller";
import { SiteSettingsController } from "./public/site-settings.controller";
import { ReportsController } from "./reports/reports.controller";
import { ReportsService } from "./reports/reports.service";
import { RentalReportsController } from "./reports/rental-reports.controller";
import { LeasesController } from "./rentals/leases.controller";
import { LeasesService } from "./rentals/leases.service";
import { LandlordsController } from "./rentals/landlords.controller";
import { RentController } from "./rentals/rent.controller";
import { RentService } from "./rentals/rent.service";
import { ReceiptsService } from "./rentals/receipts.service";
import { MaintenanceController } from "./rentals/maintenance.controller";
import { MaintenanceService } from "./rentals/maintenance.service";
import { StatementsService } from "./portals/statements.service";
import { StatementsController } from "./portals/statements.controller";
import { PortalController } from "./portals/portal.controller";
import { InvitesController } from "./portals/invites.controller";
import { PropertyAutomationRules } from "./automation/rules";
import { OfferMatcher } from "./automation/offers";
import { ReminderScheduler } from "./automation/scheduler";
import { AutomationController } from "./automation/automation.controller";
import { ViewingsService } from "./automation/viewings.service";
import { Recipients } from "./automation/recipients";

export interface AppModuleOptions {
  config: PropertyConfig;
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
          options: propertyOptions(opts.config.NODE_ENV),
          templates: PROPERTY_TEMPLATES,
          clock: opts.clock,
          transports: opts.transports,
          providers: [
            { provide: CONTACT_RESOLVER, useClass: CustomerContactResolver },
          ],
        }),
      ],
      controllers: [
        CustomersController,
        LeadsController,
        StaffController,
        InventoryController,
        ImportsController,
        PublicController,
        SiteSettingsController,
        ReportsController,
        RentalReportsController,
        LandlordsController,
        LeasesController,
        RentController,
        MaintenanceController,
        StatementsController,
        PortalController,
        InvitesController,
        AutomationController,
      ],
      providers: [
        CustomersService,
        LeadsService,
        UnitsService,
        MediaService,
        ImportsService,
        ReportsService,
        LeasesService,
        RentService,
        ReceiptsService,
        MaintenanceService,
        StatementsService,
        OfferMatcher,
        ReminderScheduler,
        ViewingsService,
        Recipients,
        { provide: AUTOMATION_RULES, useClass: PropertyAutomationRules },
      ],
    };
  }
}
