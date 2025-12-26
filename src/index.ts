import { Invoice, PurchaseOrder, HumanCorrection } from './types/invoice.js';
import { ProcessingResult } from './types/output.js';
import { MemoryUpdate } from './types/memory.js';
import { recallMemories } from './services/recall.js';
import { applyMemories } from './services/apply.js';
import { makeDecision } from './services/decide.js';
import { learn } from './services/learn.js';
import { getDatabase, closeDatabase, resetDatabase, saveDatabase } from './db/connection.js';
import { getAllVendorMemories, getAllCorrectionMemories, getAllResolutionMemories } from './memory/index.js';

export interface InvoiceProcessorOptions {
    purchaseOrders?: PurchaseOrder[];
}

/**
 * Main Invoice Processor - Processes an invoice through the memory layer pipeline
 */
export async function processInvoice(
    invoice: Invoice,
    options: InvoiceProcessorOptions = {}
): Promise<ProcessingResult> {
    // Ensure database is initialized
    await getDatabase();

    // Step 1: RECALL - Retrieve relevant memories
    const recallResult = await recallMemories(invoice);

    // Step 2: APPLY - Normalize and suggest corrections
    const applyResult = await applyMemories(
        invoice,
        recallResult.memories,
        options.purchaseOrders
    );

    // Step 3: DECIDE - Make decision on action
    const decisionResult = makeDecision(
        applyResult.normalizedInvoice,
        applyResult.proposedCorrections,
        recallResult.memories,
        invoice.confidence
    );

    // Build audit trail
    const auditTrail = [
        recallResult.auditEntry,
        applyResult.auditEntry,
        decisionResult.auditEntry,
    ];

    // Build result
    const result: ProcessingResult = {
        normalizedInvoice: applyResult.normalizedInvoice,
        proposedCorrections: applyResult.proposedCorrections,
        requiresHumanReview: decisionResult.requiresHumanReview,
        reasoning: decisionResult.reasoning,
        confidenceScore: decisionResult.confidenceScore,
        memoryUpdates: [], // Will be populated after learning
        auditTrail,
    };

    // Save database after processing
    saveDatabase();

    return result;
}

/**
 * Apply human correction and learn from it
 */
export async function applyHumanCorrection(
    invoice: Invoice,
    correction: HumanCorrection
): Promise<MemoryUpdate[]> {
    const learnResult = await learn(invoice, correction);

    saveDatabase();

    return learnResult.memoryUpdates;
}

/**
 * Get current memory state for a vendor
 */
export async function getVendorMemoryState(vendorName: string) {
    const { getVendorMemory } = await import('./memory/vendorMemory.js');
    return getVendorMemory(vendorName);
}

/**
 * Get all memories in the system
 */
export async function getAllMemories() {
    await getDatabase();

    return {
        vendorMemories: await getAllVendorMemories(),
        correctionMemories: await getAllCorrectionMemories(),
        resolutionMemories: await getAllResolutionMemories(),
    };
}

/**
 * Reset all memories (for testing/demo)
 */
export function resetAllMemories(): void {
    resetDatabase();
}

/**
 * Close database connection
 */
export function shutdown(): void {
    closeDatabase();
}

// Export all types
export * from './types/index.js';
export { getDatabase, saveDatabase, closeDatabase, resetDatabase } from './db/connection.js';
