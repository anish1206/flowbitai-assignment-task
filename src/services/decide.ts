import { RecalledMemories } from '../types/memory.js';
import { NormalizedInvoice, ProposedCorrection, AuditEntry } from '../types/output.js';
import { createAuditEntry } from '../utils/auditTrail.js';

// Confidence thresholds for decision making
const AUTO_ACCEPT_THRESHOLD = 0.85;
const AUTO_CORRECT_THRESHOLD = 0.60;
const ESCALATE_THRESHOLD = 0.40;

export interface DecisionResult {
    requiresHumanReview: boolean;
    reasoning: string;
    confidenceScore: number;
    auditEntry: AuditEntry;
    escalationReasons: string[];
}

/**
 * Decide Service - Determines whether to auto-accept, auto-correct, or escalate
 */
export function makeDecision(
    normalizedInvoice: NormalizedInvoice,
    proposedCorrections: ProposedCorrection[],
    memories: RecalledMemories,
    originalConfidence: number
): DecisionResult {
    const escalationReasons: string[] = [];
    const details: string[] = [];
    let requiresHumanReview = false;

    // 1. Check for duplicates (always escalate)
    if (memories.potentialDuplicate) {
        requiresHumanReview = true;
        escalationReasons.push(`Potential duplicate detected: Invoice ${memories.potentialDuplicate.invoiceNumber} was already processed on ${memories.potentialDuplicate.processedAt}`);
        details.push('ESCALATE: Duplicate invoice detected');
    }

    // 2. Check if this is a new vendor (limited memory)
    const isNewVendor = !memories.vendorMemory || memories.vendorMemory.usageCount < 2;
    if (isNewVendor) {
        requiresHumanReview = true;
        escalationReasons.push('New or low-history vendor - insufficient learning data for auto-decisions');
        details.push('ESCALATE: New vendor with limited history');
    }

    // 3. Check for low-confidence corrections
    const lowConfidenceCorrections = proposedCorrections.filter(c => c.confidence < ESCALATE_THRESHOLD);
    if (lowConfidenceCorrections.length > 0) {
        requiresHumanReview = true;
        lowConfidenceCorrections.forEach(c => {
            escalationReasons.push(`Low confidence correction for ${c.field}: ${(c.confidence * 100).toFixed(1)}%`);
        });
        details.push(`ESCALATE: ${lowConfidenceCorrections.length} low-confidence correction(s)`);
    }

    // 4. Check for medium-confidence corrections that weren't auto-applied
    const pendingCorrections = proposedCorrections.filter(c => !c.autoApplied && c.confidence >= ESCALATE_THRESHOLD);
    if (pendingCorrections.length > 0) {
        requiresHumanReview = true;
        pendingCorrections.forEach(c => {
            escalationReasons.push(`Pending correction for ${c.field} needs review (confidence: ${(c.confidence * 100).toFixed(1)}%)`);
        });
        details.push(`REVIEW: ${pendingCorrections.length} correction(s) pending approval`);
    }

    // 5. Check for conflicting memories
    if (hasConflictingMemories(memories)) {
        requiresHumanReview = true;
        escalationReasons.push('Conflicting patterns detected in memory - human judgment required');
        details.push('ESCALATE: Conflicting memory patterns');
    }

    // 6. Check for missing critical fields
    const missingFields = checkMissingFields(normalizedInvoice, proposedCorrections);
    if (missingFields.length > 0) {
        requiresHumanReview = true;
        missingFields.forEach(field => {
            escalationReasons.push(`Missing critical field: ${field}`);
        });
        details.push(`ESCALATE: Missing fields - ${missingFields.join(', ')}`);
    }

    // 7. Calculate overall confidence score
    const confidenceScore = calculateOverallConfidence(
        originalConfidence,
        memories,
        proposedCorrections
    );

    // 8. Final decision based on overall confidence
    if (!requiresHumanReview) {
        if (confidenceScore >= AUTO_ACCEPT_THRESHOLD) {
            details.push(`AUTO-ACCEPT: High confidence (${(confidenceScore * 100).toFixed(1)}%) - no issues detected`);
        } else if (confidenceScore >= AUTO_CORRECT_THRESHOLD) {
            details.push(`AUTO-CORRECT: Moderate confidence (${(confidenceScore * 100).toFixed(1)}%) - corrections applied automatically`);
        } else {
            requiresHumanReview = true;
            escalationReasons.push(`Overall confidence too low: ${(confidenceScore * 100).toFixed(1)}%`);
            details.push(`ESCALATE: Confidence below threshold (${(confidenceScore * 100).toFixed(1)}%)`);
        }
    }

    // Build reasoning summary
    const reasoning = buildReasoning(
        requiresHumanReview,
        escalationReasons,
        proposedCorrections,
        memories,
        confidenceScore
    );

    const auditEntry = createAuditEntry('decide', details.join('; '));

    return {
        requiresHumanReview,
        reasoning,
        confidenceScore,
        auditEntry,
        escalationReasons,
    };
}

function hasConflictingMemories(memories: RecalledMemories): boolean {
    // Check for conflicting resolution patterns (many rejections)
    if (memories.resolutionMemories.length >= 3) {
        const approved = memories.resolutionMemories.filter(r => r.resolution === 'approved').length;
        const rejected = memories.resolutionMemories.filter(r => r.resolution === 'rejected').length;

        // If rejection rate is > 40%, there might be conflicting patterns
        if (rejected / (approved + rejected) > 0.4) {
            return true;
        }
    }

    // Check for low-confidence correction patterns that might be wrong
    const problematicCorrections = memories.correctionMemories.filter(c =>
        c.failureCount > c.successCount
    );

    return problematicCorrections.length > 0;
}

function checkMissingFields(invoice: NormalizedInvoice, corrections: ProposedCorrection[]): string[] {
    const missing: string[] = [];

    // Check critical fields
    if (!invoice.currency && !corrections.find(c => c.field === 'currency')) {
        missing.push('currency');
    }

    // Check if line items have SKUs (especially for freight/service invoices)
    const itemsWithoutSKU = invoice.lineItems.filter(i => i.sku === 'UNKNOWN');
    const skuCorrections = corrections.filter(c => c.field.startsWith('lineItems') && c.field.includes('sku'));
    if (itemsWithoutSKU.length > 0 && skuCorrections.length < itemsWithoutSKU.length) {
        // Only flag if we can't map all SKUs
        // Don't flag as missing if we have proposed corrections
    }

    return missing;
}

function calculateOverallConfidence(
    originalConfidence: number,
    memories: RecalledMemories,
    corrections: ProposedCorrection[]
): number {
    let score = originalConfidence;

    // Boost from vendor memory
    if (memories.vendorMemory) {
        const memoryBoost = memories.vendorMemory.confidence * 0.1;
        score = Math.min(1.0, score + memoryBoost);
    }

    // Boost from high-confidence corrections
    const autoAppliedCorrections = corrections.filter(c => c.autoApplied);
    if (autoAppliedCorrections.length > 0) {
        const avgCorrectionConfidence = autoAppliedCorrections.reduce((sum, c) => sum + c.confidence, 0) / autoAppliedCorrections.length;
        score = (score + avgCorrectionConfidence) / 2;
    }

    // Penalty for pending corrections
    const pendingCorrections = corrections.filter(c => !c.autoApplied);
    if (pendingCorrections.length > 0) {
        score *= 0.9; // 10% penalty for each pending decision
    }

    // Penalty for duplicate
    if (memories.potentialDuplicate) {
        score *= 0.5; // Major penalty for potential duplicate
    }

    // Penalty for missing vendor history
    if (!memories.vendorMemory || memories.vendorMemory.usageCount < 2) {
        score *= 0.8;
    }

    return Math.max(0.1, Math.min(1.0, score));
}

function buildReasoning(
    requiresHumanReview: boolean,
    escalationReasons: string[],
    corrections: ProposedCorrection[],
    memories: RecalledMemories,
    confidence: number
): string {
    const parts: string[] = [];

    // Decision summary
    if (requiresHumanReview) {
        parts.push(`⚠️ REQUIRES HUMAN REVIEW (Overall confidence: ${(confidence * 100).toFixed(1)}%)`);
    } else {
        parts.push(`✅ AUTO-PROCESSED (Overall confidence: ${(confidence * 100).toFixed(1)}%)`);
    }

    // Memory usage summary
    if (memories.vendorMemory) {
        parts.push(`\n📚 Memory: Using ${memories.vendorMemory.usageCount} prior interactions with "${memories.vendorMemory.vendorName}"`);
    } else {
        parts.push(`\n📚 Memory: No prior history for this vendor`);
    }

    // Corrections summary
    const autoApplied = corrections.filter(c => c.autoApplied);
    const proposed = corrections.filter(c => !c.autoApplied);

    if (autoApplied.length > 0) {
        parts.push(`\n✨ Auto-applied ${autoApplied.length} correction(s):`);
        autoApplied.forEach(c => {
            parts.push(`   - ${c.field}: ${c.reasoning}`);
        });
    }

    if (proposed.length > 0) {
        parts.push(`\n🔍 Proposed ${proposed.length} correction(s) for review:`);
        proposed.forEach(c => {
            parts.push(`   - ${c.field}: ${JSON.stringify(c.originalValue)} → ${JSON.stringify(c.proposedValue)}`);
        });
    }

    // Escalation reasons
    if (escalationReasons.length > 0) {
        parts.push(`\n⚡ Escalation reasons:`);
        escalationReasons.forEach(reason => {
            parts.push(`   - ${reason}`);
        });
    }

    // Duplicate warning
    if (memories.potentialDuplicate) {
        parts.push(`\n🚨 DUPLICATE WARNING: This invoice may be a duplicate of a previously processed invoice`);
    }

    return parts.join('');
}
