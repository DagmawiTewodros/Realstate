/** Shapes returned by the property API, shared by several screens. */

export interface Lease {
  id: string;
  unitId: string;
  tenantId: string;
  landlordId: string | null;
  startDate: string;
  endDate: string;
  rentMinor: number;
  billingFrequency: string;
  depositMinor: number;
  depositStatus: string;
  status: string;
  terminationReason: string | null;
  notes: string | null;
  creditMinor: number;
  previousLeaseId: string | null;
}

export interface Charge {
  id: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: number;
  paidMinor: number;
  status: string;
}

export interface Payment {
  id: string;
  amountMinor: number;
  paidAt: string;
  method: string;
  reference: string | null;
  receiptNumber: string;
  status: string;
  voidReason: string | null;
  slipKey?: string | null;
}

export interface StatementFigures {
  month: string;
  rentChargedMinor: number;
  rentReceivedMinor: number;
  arrearsMinor: number;
  maintenanceCostMinor: number;
  netMinor: number;
  leases: Array<{ leaseId: string; unitCode: string; tenantName: string; chargedMinor: number; receivedMinor: number; arrearsMinor: number }>;
  maintenance: Array<{ requestId: string; unitCode: string; title: string; costMinor: number; closedAt: string }>;
}

export interface Statement {
  preview: boolean;
  figures: StatementFigures;
  version: number;
  issuedAt: string;
}
