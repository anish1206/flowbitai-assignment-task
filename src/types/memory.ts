// Memory Types
export interface VendorMemory {
    id: string;
    vendorName: string;
    fieldMappings: FieldMapping[];
    taxBehavior?: TaxBehavior;
    defaultCurrency?: string;
    skuMappings: SkuMapping[];
    paymentTerms?: string;
    confidence: number;
    usageCount: number;
    lastUsed: string;
    createdAt: string;
    updatedAt: string;
}

export interface FieldMapping {
    sourceLabel: string;  // e.g., "Leistungsdatum"
    targetField: string;  // e.g., "serviceDate"
    confidence: number;
    successCount: number;
    failureCount: number;
}

export interface TaxBehavior {
    isInclusive: boolean;  // VAT included in prices
    defaultRate: number;
    confidence: number;
}

export interface SkuMapping {
    description: string;  // e.g., "Seefracht/Shipping"
    sku: string;          // e.g., "FREIGHT"
    confidence: number;
    usageCount: number;
}

export interface CorrectionMemory {
    id: string;
    vendorName: string;
    fieldName: string;
    pattern: string;         // Pattern that triggers this correction
    correctionType: CorrectionType;
    correctionValue?: unknown;
    confidence: number;
    successCount: number;
    failureCount: number;
    createdAt: string;
    updatedAt: string;
}

export type CorrectionType =
    | 'extract_from_rawtext'
    | 'recalculate_tax'
    | 'match_po'
    | 'map_sku'
    | 'set_currency'
    | 'set_payment_terms';

export interface ResolutionMemory {
    id: string;
    invoiceId: string;
    vendorName: string;
    discrepancyType: string;
    originalValue: unknown;
    correctedValue: unknown;
    resolution: 'approved' | 'rejected';
    humanFeedback?: string;
    createdAt: string;
}

export interface ProcessedInvoice {
    id: string;
    invoiceNumber: string;
    vendorName: string;
    invoiceDate: string;
    grossTotal: number;
    processedAt: string;
    hash: string;
}

export interface RecalledMemories {
    vendorMemory?: VendorMemory;
    correctionMemories: CorrectionMemory[];
    resolutionMemories: ResolutionMemory[];
    potentialDuplicate?: ProcessedInvoice;
}

export interface MemoryUpdate {
    type: 'vendor' | 'correction' | 'resolution';
    action: 'create' | 'reinforce' | 'weaken';
    details: string;
    memoryId?: string;
}
