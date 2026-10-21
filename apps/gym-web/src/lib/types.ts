/** Shapes returned by the gym API, shared by several screens. */

export interface Member {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  telegramChatId: string | null;
  locale: "am" | "en";
  birthDate: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  photoKey: string | null;
  status: "ACTIVE" | "INACTIVE";
  joinedAt: string;
  anonymizedAt: string | null;
}

export interface Plan {
  id: string;
  name: string;
  kind: string;
  durationMonths: number;
  priceMinor: number;
  isActive: boolean;
}

export interface Membership {
  id: string;
  planId: string;
  planName: string;
  startDate: string;
  endDate: string;
  status: string;
  priceMinor: number;
  complimentaryReason: string | null;
  cancelReason: string | null;
}

export interface MembershipState {
  status: "ACTIVE" | "FROZEN" | "EXPIRED" | "CANCELLED" | "NONE";
  membership: Membership | null;
  daysLeft: number | null;
  freeze: { startDate: string; endDate: string } | null;
  next: Membership | null;
}

export interface GymPayment {
  id: string;
  membershipId: string | null;
  amountMinor: number;
  paidAt: string;
  method: string;
  reference: string | null;
  receiptNumber: string;
  status: string;
  voidReason: string | null;
}

export interface ClassSession {
  id: string;
  templateId: string;
  trainerId: string;
  name: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  status: string;
  cancelReason: string | null;
  trainerName: string;
  booked: number;
  spotsLeft: number;
}
