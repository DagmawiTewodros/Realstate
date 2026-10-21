import type { TemplateSet } from "@platform/nest-common";

/**
 * Message templates in Amharic and English. {{name}} is always the recipient's name.
 * Customer messages get an opt-out line added automatically.
 * Amharic texts should be reviewed by a native speaker (listed in docs/DECISIONS.md).
 */
export const PROPERTY_TEMPLATES: TemplateSet = {
  // ---- Staff ----
  "staff.lead_created": {
    en: { subject: "New lead: {{customerName}}", text: "Hello {{name}}, a new lead came in from {{source}}: {{customerName}}.\nOpen it: {{link}}" },
    am: { subject: "አዲስ ደንበኛ፦ {{customerName}}", text: "ሰላም {{name}}፣ ከ{{source}} አዲስ ደንበኛ መጥቷል፦ {{customerName}}።\nይክፈቱ፦ {{link}}" },
  },
  "staff.lead_assigned": {
    en: { subject: "Lead assigned to you: {{customerName}}", text: "Hello {{name}}, {{customerName}} is now your lead. Contact them soon.\n{{link}}" },
    am: { subject: "ደንበኛ ተመድቦልዎታል፦ {{customerName}}", text: "ሰላም {{name}}፣ {{customerName}} አሁን የእርስዎ ደንበኛ ነው። በቅርቡ ያነጋግሩ።\n{{link}}" },
  },
  "staff.followup_overdue": {
    en: { subject: "Follow-up overdue: {{customerName}}", text: "Hello {{name}}, the next step for {{customerName}} is overdue ({{reason}}).\n{{link}}" },
    am: { subject: "የዘገየ ክትትል፦ {{customerName}}", text: "ሰላም {{name}}፣ ለ{{customerName}} የሚቀጥለው እርምጃ ዘግይቷል ({{reason}})።\n{{link}}" },
  },
  "staff.viewing_reminder": {
    en: { subject: "Viewing tomorrow: {{customerName}}", text: "Hello {{name}}, you have a viewing with {{customerName}} on {{when}} for {{unit}}." },
    am: { subject: "ነገ ቤት ማሳያ፦ {{customerName}}", text: "ሰላም {{name}}፣ ከ{{customerName}} ጋር በ{{when}} ለ{{unit}} የቤት ማሳያ አለዎት።" },
  },
  "staff.rent_overdue": {
    en: { subject: "Rent overdue: {{tenantName}}", text: "Hello {{name}}, rent of {{amount}} for {{unit}} was due on {{dueDate}} and is {{days}} days overdue." },
    am: { subject: "የዘገየ ኪራይ፦ {{tenantName}}", text: "ሰላም {{name}}፣ ለ{{unit}} {{amount}} ኪራይ በ{{dueDate}} መከፈል ነበረበት፤ {{days}} ቀን ዘግይቷል።" },
  },
  "staff.lease_expiring": {
    en: { subject: "Lease ending on {{endDate}}: {{unit}}", text: "Hello {{name}}, the lease for {{unit}} ({{tenantName}}) ends on {{endDate}}. Plan the renewal or a new tenant." },
    am: { subject: "ውል በ{{endDate}} ያበቃል፦ {{unit}}", text: "ሰላም {{name}}፣ የ{{unit}} ({{tenantName}}) ውል በ{{endDate}} ያበቃል። እድሳት ወይም አዲስ ተከራይ ያቅዱ።" },
  },
  "staff.maintenance_created": {
    en: { subject: "New repair request: {{title}}", text: "Hello {{name}}, a new {{priority}} repair request was reported for {{unit}}: {{title}}." },
    am: { subject: "አዲስ የጥገና ጥያቄ፦ {{title}}", text: "ሰላም {{name}}፣ ለ{{unit}} አዲስ {{priority}} የጥገና ጥያቄ ቀርቧል፦ {{title}}።" },
  },
  "staff.invitation": {
    en: { subject: "Your account at {{company}}", text: "Hello {{name}}, set your password to open your account: {{link}}\nThe link works once and expires on {{expires}}." },
    am: { subject: "በ{{company}} ያለዎት መለያ", text: "ሰላም {{name}}፣ መለያዎን ለመክፈት የይለፍ ቃል ያዘጋጁ፦ {{link}}\nሊንኩ አንድ ጊዜ ብቻ ይሰራል፤ በ{{expires}} ያበቃል።" },
  },
  // ---- Customers ----
  "customer.viewing_booked": {
    en: { subject: "Your viewing is booked", text: "Hello {{name}}, your viewing of {{unit}} is booked for {{when}}. Reply or call us to change it." },
    am: { subject: "የቤት ማሳያ ቀጠሮዎ ተይዟል", text: "ሰላም {{name}}፣ የ{{unit}} ማሳያ ቀጠሮዎ ለ{{when}} ተይዟል። ለመቀየር ያግኙን።" },
  },
  "customer.viewing_reminder": {
    en: { subject: "Reminder: viewing tomorrow", text: "Hello {{name}}, this is a reminder of your viewing of {{unit}} on {{when}}." },
    am: { subject: "ማስታወሻ፦ ነገ የቤት ማሳያ", text: "ሰላም {{name}}፣ የ{{unit}} ማሳያ ቀጠሮዎ በ{{when}} መሆኑን እናስታውሳለን።" },
  },
  "customer.rent_due_soon": {
    en: { subject: "Rent due on {{dueDate}}", text: "Hello {{name}}, your rent of {{amount}} for {{unit}} is due on {{dueDate}}." },
    am: { subject: "ኪራይ በ{{dueDate}} ይከፈላል", text: "ሰላም {{name}}፣ ለ{{unit}} የ{{amount}} ኪራይዎ በ{{dueDate}} መከፈል አለበት።" },
  },
  "customer.rent_overdue": {
    en: { subject: "Rent overdue", text: "Hello {{name}}, your rent of {{amount}} for {{unit}} was due on {{dueDate}} and is {{days}} days overdue. Please pay or contact us." },
    am: { subject: "ኪራይ ዘግይቷል", text: "ሰላም {{name}}፣ ለ{{unit}} የ{{amount}} ኪራይዎ በ{{dueDate}} መከፈል ነበረበት፤ {{days}} ቀን ዘግይቷል። እባክዎ ይክፈሉ ወይም ያግኙን።" },
  },
  "customer.new_offer": {
    en: { subject: "{{event}}: {{unit}}", text: "Hello {{name}}, a property that matches your search: {{unit}} in {{area}}, {{price}}.\n{{link}}\nStop alerts for this search: {{removeLink}}" },
    am: { subject: "{{event}}፦ {{unit}}", text: "ሰላም {{name}}፣ ከፍለጋዎ ጋር የሚመሳሰል ንብረት፦ {{unit}} በ{{area}}፣ {{price}}።\n{{link}}\nለዚህ ፍለጋ ማሳወቂያ ለማቆም፦ {{removeLink}}" },
  },
  "customer.offer_digest": {
    en: { subject: "{{count}} properties that match your search", text: "Hello {{name}}, here are new properties that match your search:\n{{list}}" },
    am: { subject: "ከፍለጋዎ ጋር የሚመሳሰሉ {{count}} ንብረቶች", text: "ሰላም {{name}}፣ ከፍለጋዎ ጋር የሚመሳሰሉ አዳዲስ ንብረቶች፦\n{{list}}" },
  },
  "landlord.lease_expiring": {
    en: { subject: "Lease ending on {{endDate}}", text: "Hello {{name}}, the lease for your unit {{unit}} ends on {{endDate}}. We will contact you about renewal." },
    am: { subject: "ውል በ{{endDate}} ያበቃል", text: "ሰላም {{name}}፣ የ{{unit}} ውል በ{{endDate}} ያበቃል። ስለ እድሳቱ እናነጋግርዎታለን።" },
  },
};

export const OFFER_EVENT_LABEL: Record<string, Record<"am" | "en", string>> = {
  "unit.published.v1": { en: "New listing", am: "አዲስ ንብረት" },
  "unit.price_dropped.v1": { en: "Price drop", am: "የዋጋ ቅናሽ" },
  "unit.released.v1": { en: "Available again", am: "እንደገና ተገኝቷል" },
};
