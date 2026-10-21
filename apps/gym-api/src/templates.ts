import type { TemplateSet } from "@platform/nest-common";

/**
 * Gym message templates in Amharic and English. {{name}} is always the recipient's name.
 * Member messages get an opt-out line added automatically by MessageService.
 */
export const GYM_TEMPLATES: TemplateSet = {
  "staff.alert": {
    en: { subject: "Gym alert", text: "Hello {{name}}, {{message}}" },
    am: { subject: "የጂም ማሳወቂያ", text: "ሰላም {{name}}፣ {{message}}" },
  },
  "member.renewal_reminder": {
    en: { subject: "Your membership ends on {{endDate}}", text: "Hello {{name}}, your {{plan}} membership ends on {{endDate}}. Renew at the front desk to keep training without a break." },
    am: { subject: "አባልነትዎ በ{{endDate}} ያበቃል", text: "ሰላም {{name}}፣ የ{{plan}} አባልነትዎ በ{{endDate}} ያበቃል። ያለማቋረጥ ለመለማመድ በእንግዳ መቀበያ ያድሱ።" },
  },
  "member.expired": {
    en: { subject: "Your membership has ended", text: "Hello {{name}}, your {{plan}} membership ended on {{endDate}}. We would love to see you back; renew at the front desk." },
    am: { subject: "አባልነትዎ አብቅቷል", text: "ሰላም {{name}}፣ የ{{plan}} አባልነትዎ በ{{endDate}} አብቅቷል። ተመልሰው ቢመጡ ደስ ይለናል፤ በእንግዳ መቀበያ ያድሱ።" },
  },
  "member.we_miss_you": {
    en: { subject: "We miss you at the gym", text: "Hello {{name}}, we have not seen you for {{days}} days. Come back this week; your membership is still active." },
    am: { subject: "ናፍቀኸናል/ናፍቀሽናል", text: "ሰላም {{name}}፣ ለ{{days}} ቀናት አላየንዎትም። በዚህ ሳምንት ይምጡ፤ አባልነትዎ አሁንም ንቁ ነው።" },
  },
  "member.birthday": {
    en: { subject: "Happy birthday, {{name}}!", text: "Happy birthday from all of us at the gym. Enjoy your day!" },
    am: { subject: "መልካም ልደት፣ {{name}}!", text: "ከጂሙ ቤተሰብ በሙሉ መልካም ልደት እንመኝልዎታለን!" },
  },
  "member.announcement": {
    en: { subject: "{{title}}", text: "Hello {{name}}, {{messageEn}}" },
    am: { subject: "{{title}}", text: "ሰላም {{name}}፣ {{messageAm}}" },
  },
  "member.session_cancelled": {
    en: { subject: "Class cancelled: {{className}}", text: "Hello {{name}}, the {{className}} class on {{when}} is cancelled. Sorry for the change." },
    am: { subject: "ክፍለ ጊዜ ተሰርዟል፦ {{className}}", text: "ሰላም {{name}}፣ በ{{when}} የነበረው የ{{className}} ክፍለ ጊዜ ተሰርዟል። ስለለውጡ ይቅርታ እንጠይቃለን።" },
  },
  "member.invitation": {
    en: { subject: "Your gym account", text: "Hello {{name}}, set your password to see your membership and your check-in code: {{link}}\nThe link works once and expires on {{expires}}." },
    am: { subject: "የጂም መለያዎ", text: "ሰላም {{name}}፣ አባልነትዎንና የመግቢያ ኮድዎን ለማየት የይለፍ ቃል ያዘጋጁ፦ {{link}}\nሊንኩ አንድ ጊዜ ብቻ ይሰራል፤ በ{{expires}} ያበቃል።" },
  },
};
