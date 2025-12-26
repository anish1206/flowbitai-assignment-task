import { Invoice } from '../types/invoice.js';
import { RecalledMemories } from '../types/memory.js';
import { AuditEntry } from '../types/output.js';
import { getVendorMemory } from '../memory/vendorMemory.js';
import { getCorrectionMemories } from '../memory/correctionMemory.js';
import { getResolutionMemories } from '../memory/resolutionMemory.js';
import { checkDuplicate } from '../utils/duplicateDetection.js';
import { createAuditEntry } from '../utils/auditTrail.js';

/**
 * Recall Service - Retrieves relevant memories for a given invoice
 */
export async function recallMemories(invoice: Invoice): Promise<{
    memories: RecalledMemories;
    auditEntry: AuditEntry;
}> {
    const vendorName = invoice.vendor;
    const memoryIds: string[] = [];
    const details: string[] = [];

    // 1. Fetch vendor-specific memories
    const vendorMemory = await getVendorMemory(vendorName);
    if (vendorMemory) {
        memoryIds.push(vendorMemory.id);
        details.push(`Found vendor memory for "${vendorName}" with ${vendorMemory.fieldMappings.length} field mappings, confidence: ${(vendorMemory.confidence * 100).toFixed(1)}%`);

        if (vendorMemory.taxBehavior) {
            details.push(`Tax behavior: ${vendorMemory.taxBehavior.isInclusive ? 'VAT inclusive' : 'VAT exclusive'}, confidence: ${(vendorMemory.taxBehavior.confidence * 100).toFixed(1)}%`);
        }

        if (vendorMemory.skuMappings.length > 0) {
            details.push(`SKU mappings available: ${vendorMemory.skuMappings.length}`);
        }

        if (vendorMemory.paymentTerms) {
            details.push(`Payment terms: ${vendorMemory.paymentTerms}`);
        }
    } else {
        details.push(`No existing memory for vendor "${vendorName}" - this is a new vendor or first invoice`);
    }

    // 2. Find applicable correction patterns
    const correctionMemories = await getCorrectionMemories(vendorName);
    if (correctionMemories.length > 0) {
        correctionMemories.forEach(cm => memoryIds.push(cm.id));
        const highConfidence = correctionMemories.filter(c => c.confidence >= 0.7);
        details.push(`Found ${correctionMemories.length} correction patterns (${highConfidence.length} high-confidence)`);
    }

    // 3. Check for similar past resolutions
    const resolutionMemories = await getResolutionMemories(vendorName);
    if (resolutionMemories.length > 0) {
        resolutionMemories.slice(0, 5).forEach(rm => memoryIds.push(rm.id));
        const approved = resolutionMemories.filter(r => r.resolution === 'approved').length;
        const rejected = resolutionMemories.filter(r => r.resolution === 'rejected').length;
        details.push(`Historical resolutions: ${approved} approved, ${rejected} rejected`);
    }

    // 4. Check for potential duplicate
    const potentialDuplicate = await checkDuplicate(invoice);
    if (potentialDuplicate) {
        details.push(`⚠️ POTENTIAL DUPLICATE: Invoice ${potentialDuplicate.invoiceNumber} from ${potentialDuplicate.vendorName} processed on ${potentialDuplicate.processedAt}`);
    }

    const auditEntry = createAuditEntry(
        'recall',
        details.join('; '),
        memoryIds.length > 0 ? memoryIds : undefined
    );

    return {
        memories: {
            vendorMemory: vendorMemory || undefined,
            correctionMemories,
            resolutionMemories,
            potentialDuplicate: potentialDuplicate || undefined,
        },
        auditEntry,
    };
}

/**
 * Apply confidence decay based on time since last use
 */
export function applyConfidenceDecay(confidence: number, lastUsed: string): number {
    const lastUsedDate = new Date(lastUsed);
    const now = new Date();
    const daysSinceLastUse = (now.getTime() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24);

    // Decay rate: 1% per day
    const decayFactor = Math.pow(0.99, daysSinceLastUse);

    return Math.max(0.1, confidence * decayFactor);
}
