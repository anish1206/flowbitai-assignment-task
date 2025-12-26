// Invoice Types
export interface LineItem {
    sku?: string | null;
    description?: string;
    qty: number;
    unitPrice: number;
    amount?: number;
    qtyDelivered?: number;
}

export interface InvoiceFields {
    invoiceNumber: string;
    invoiceDate: string;
    serviceDate?: string | null;
    currency?: string | null;
    poNumber?: string | null;
    netTotal: number;
    taxRate: number;
    taxTotal: number;
    grossTotal: number;
    lineItems: LineItem[];
    discountTerms?: string | null;
}

export interface Invoice {
    invoiceId: string;
    vendor: string;
    fields: InvoiceFields;
    confidence: number;
    rawText: string;
}

export interface PurchaseOrder {
    poNumber: string;
    vendor: string;
    date: string;
    lineItems: LineItem[];
}

export interface DeliveryNote {
    dnNumber: string;
    vendor: string;
    poNumber: string;
    date: string;
    lineItems: LineItem[];
}

export interface HumanCorrection {
    invoiceId: string;
    vendor: string;
    corrections: FieldCorrection[];
    finalDecision: 'approved' | 'rejected';
}

export interface FieldCorrection {
    field: string;
    from: unknown;
    to: unknown;
    reason: string;
}
