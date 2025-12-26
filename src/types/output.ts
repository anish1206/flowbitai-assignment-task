import { InvoiceFields, LineItem } from './invoice.js';
import { MemoryUpdate } from './memory.js';

// Output Contract Types
export interface NormalizedInvoice {
    invoiceId: string;
    vendor: string;
    invoiceNumber: string;
    invoiceDate: string;
    serviceDate?: string;
    currency: string;
    poNumber?: string;
    netTotal: number;
    taxRate: number;
    taxTotal: number;
    grossTotal: number;
    lineItems: NormalizedLineItem[];
    discountTerms?: string;
}

export interface NormalizedLineItem {
    sku: string;
    description: string;
    qty: number;
    unitPrice: number;
    amount: number;
}

export interface ProposedCorrection {
    field: string;
    originalValue: unknown;
    proposedValue: unknown;
    confidence: number;
    reasoning: string;
    autoApplied: boolean;
}

export type AuditStep = 'recall' | 'apply' | 'decide' | 'learn';

export interface AuditEntry {
    step: AuditStep;
    timestamp: string;
    details: string;
    memoryIds?: string[];
}

export interface ProcessingResult {
    normalizedInvoice: NormalizedInvoice;
    proposedCorrections: ProposedCorrection[];
    requiresHumanReview: boolean;
    reasoning: string;
    confidenceScore: number;
    memoryUpdates: MemoryUpdate[];
    auditTrail: AuditEntry[];
}
