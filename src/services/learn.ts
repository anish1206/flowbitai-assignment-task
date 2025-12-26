import { Invoice, HumanCorrection, FieldCorrection } from '../types/invoice.js';
import { MemoryUpdate, CorrectionType } from '../types/memory.js';
import { AuditEntry } from '../types/output.js';
import {
    updateFieldMapping,
    updateTaxBehavior,
    updateDefaultCurrency,
    updateSkuMapping,
    updatePaymentTerms,
    getVendorMemory,
    createVendorMemory
} from '../memory/vendorMemory.js';
import {
    recordCorrection,
    reinforceCorrection,
    weakenCorrection,
    findMatchingCorrection
} from '../memory/correctionMemory.js';
import { recordResolution } from '../memory/resolutionMemory.js';
import { recordProcessedInvoice } from '../utils/duplicateDetection.js';
import { createAuditEntry } from '../utils/auditTrail.js';

export interface LearnResult {
    memoryUpdates: MemoryUpdate[];
    auditEntry: AuditEntry;
}

/**
 * Learn Service - Stores new insights from human corrections and reinforces/weakens existing memories
 */
export async function learn(
    invoice: Invoice,
    humanCorrection: HumanCorrection
): Promise<LearnResult> {
    const memoryUpdates: MemoryUpdate[] = [];
    const details: string[] = [];
    const vendorName = invoice.vendor;

    // Ensure vendor memory exists
    let vendorMemory = await getVendorMemory(vendorName);
    if (!vendorMemory) {
        vendorMemory = await createVendorMemory(vendorName);
        memoryUpdates.push({
            type: 'vendor',
            action: 'create',
            details: `Created new vendor memory for "${vendorName}"`,
            memoryId: vendorMemory.id,
        });
        details.push(`Created vendor memory for "${vendorName}"`);
    }

    // Process each correction
    for (const correction of humanCorrection.corrections) {
        const correctionResult = await processCorrection(
            invoice,
            vendorName,
            correction,
            humanCorrection.finalDecision
        );

        memoryUpdates.push(...correctionResult.updates);
        details.push(...correctionResult.details);
    }

    // Record the resolution
    for (const correction of humanCorrection.corrections) {
        await recordResolution(
            invoice.invoiceId,
            vendorName,
            correction.field,
            correction.from,
            correction.to,
            humanCorrection.finalDecision,
            correction.reason
        );
    }

    // Record this invoice as processed (for duplicate detection)
    await recordProcessedInvoice(invoice);
    details.push(`Recorded invoice ${invoice.invoiceId} as processed`);

    const auditEntry = createAuditEntry('learn', details.join('; '));

    return {
        memoryUpdates,
        auditEntry,
    };
}

async function processCorrection(
    invoice: Invoice,
    vendorName: string,
    correction: FieldCorrection,
    decision: 'approved' | 'rejected'
): Promise<{ updates: MemoryUpdate[]; details: string[] }> {
    const updates: MemoryUpdate[] = [];
    const details: string[] = [];
    const isApproved = decision === 'approved';

    // Analyze the correction to determine what to learn
    const { field, from, to, reason } = correction;

    // 1. ServiceDate extraction from label (e.g., Leistungsdatum)
    if (field === 'serviceDate' && reason.toLowerCase().includes('leistungsdatum')) {
        await updateFieldMapping(vendorName, 'Leistungsdatum', 'serviceDate', isApproved);

        const corrMem = await recordCorrection(
            vendorName,
            'serviceDate',
            'Leistungsdatum',
            'extract_from_rawtext',
            to
        );

        updates.push({
            type: 'vendor',
            action: isApproved ? 'reinforce' : 'weaken',
            details: `${isApproved ? 'Learned' : 'Weakened'} field mapping: "Leistungsdatum" → serviceDate`,
        });
        updates.push({
            type: 'correction',
            action: 'create',
            details: `Recorded correction pattern: extract serviceDate from rawText`,
            memoryId: corrMem.id,
        });
        details.push(`Learned: "Leistungsdatum" = serviceDate for ${vendorName}`);
    }

    // 2. Tax/VAT recalculation (VAT inclusive)
    if (field === 'taxTotal' || field === 'grossTotal') {
        if (reason.toLowerCase().includes('vat') ||
            reason.toLowerCase().includes('mwst') ||
            reason.toLowerCase().includes('recalculated')) {

            await updateTaxBehavior(vendorName, true, invoice.fields.taxRate, isApproved);

            await recordCorrection(
                vendorName,
                field,
                'vat_inclusive',
                'recalculate_tax',
                { from, to }
            );

            updates.push({
                type: 'vendor',
                action: isApproved ? 'reinforce' : 'weaken',
                details: `${isApproved ? 'Learned' : 'Weakened'} VAT behavior: prices include VAT`,
            });
            updates.push({
                type: 'correction',
                action: 'create',
                details: `Recorded tax recalculation pattern`,
            });
            details.push(`Learned: ${vendorName} uses VAT-inclusive pricing`);
        }
    }

    // 3. Currency from rawText
    if (field === 'currency') {
        await updateDefaultCurrency(vendorName, to as string);

        await recordCorrection(
            vendorName,
            'currency',
            'missing_currency',
            'set_currency',
            to
        );

        updates.push({
            type: 'vendor',
            action: 'reinforce',
            details: `Learned default currency: ${to}`,
        });
        details.push(`Learned: ${vendorName} default currency = ${to}`);
    }

    // 4. PO matching
    if (field === 'poNumber') {
        await recordCorrection(
            vendorName,
            'poNumber',
            reason,
            'match_po',
            to
        );

        updates.push({
            type: 'correction',
            action: 'create',
            details: `Recorded PO matching pattern: ${reason}`,
        });
        details.push(`Learned: PO matching strategy for ${vendorName}`);
    }

    // 5. SKU mapping from description
    if (field.includes('sku') && field.includes('lineItems')) {
        const lineItemMatch = field.match(/lineItems\[(\d+)\]/);
        if (lineItemMatch) {
            const index = parseInt(lineItemMatch[1]);
            const lineItem = invoice.fields.lineItems[index];
            if (lineItem && lineItem.description) {
                await updateSkuMapping(vendorName, lineItem.description, to as string, isApproved);

                updates.push({
                    type: 'vendor',
                    action: isApproved ? 'reinforce' : 'weaken',
                    details: `${isApproved ? 'Learned' : 'Weakened'} SKU mapping: "${lineItem.description}" → ${to}`,
                });
                details.push(`Learned: "${lineItem.description}" = SKU ${to} for ${vendorName}`);
            }
        }
    }

    // 6. Payment/discount terms (Skonto)
    if (field === 'discountTerms') {
        await updatePaymentTerms(vendorName, to as string);

        await recordCorrection(
            vendorName,
            'discountTerms',
            'skonto',
            'set_payment_terms',
            to
        );

        updates.push({
            type: 'vendor',
            action: 'reinforce',
            details: `Learned payment terms: ${to}`,
        });
        details.push(`Learned: ${vendorName} offers ${to}`);
    }

    // Reinforce or weaken existing correction memories based on decision
    const existingCorrection = await findMatchingCorrection(vendorName, field);
    if (existingCorrection) {
        if (isApproved) {
            await reinforceCorrection(existingCorrection.id);
            updates.push({
                type: 'correction',
                action: 'reinforce',
                details: `Reinforced correction pattern for ${field} (success count increased)`,
                memoryId: existingCorrection.id,
            });
        } else {
            await weakenCorrection(existingCorrection.id);
            updates.push({
                type: 'correction',
                action: 'weaken',
                details: `Weakened correction pattern for ${field} (failure count increased)`,
                memoryId: existingCorrection.id,
            });
        }
    }

    return { updates, details };
}

/**
 * Apply learning from a batch of human corrections
 */
export async function learnFromBatch(
    invoices: Invoice[],
    corrections: HumanCorrection[]
): Promise<LearnResult[]> {
    const results: LearnResult[] = [];

    for (const correction of corrections) {
        const invoice = invoices.find(inv => inv.invoiceId === correction.invoiceId);
        if (invoice) {
            const result = await learn(invoice, correction);
            results.push(result);
        }
    }

    return results;
}
