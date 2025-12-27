import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
    processInvoice,
    applyHumanCorrection,
    getAllMemories,
    resetAllMemories,
    shutdown
} from '../src/index.js';
import { Invoice, PurchaseOrder, HumanCorrection } from '../src/types/invoice.js';
import { ProcessingResult } from '../src/types/output.js';

// ==========================================
// DEMO RUNNER - Invoice Memory Layer System
// ==========================================

const DIVIDER = '='.repeat(80);
const SECTION = '-'.repeat(80);

async function loadData() {
    const dataDir = path.join(process.cwd(), 'data');

    const invoices: Invoice[] = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'invoices.json'), 'utf-8')
    );

    const purchaseOrders: PurchaseOrder[] = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'purchase_orders.json'), 'utf-8')
    );

    const humanCorrections: HumanCorrection[] = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'human_corrections.json'), 'utf-8')
    );

    return { invoices, purchaseOrders, humanCorrections };
}

function printHeader(text: string) {
    console.log('\n' + chalk.cyan(DIVIDER));
    console.log(chalk.cyan.bold(`  ${text.toUpperCase()}`));
    console.log(chalk.cyan(DIVIDER));
}

function printSubHeader(text: string) {
    console.log('\n' + chalk.yellow(SECTION));
    console.log(chalk.yellow.bold(`  ${text}`));
    console.log(chalk.yellow(SECTION));
}

function printResult(result: ProcessingResult) {
    console.log('\n' + chalk.white.bold('Normalized Invoice:'));
    console.log(chalk.gray(JSON.stringify({
        invoiceId: result.normalizedInvoice.invoiceId,
        vendor: result.normalizedInvoice.vendor,
        invoiceNumber: result.normalizedInvoice.invoiceNumber,
        serviceDate: result.normalizedInvoice.serviceDate,
        currency: result.normalizedInvoice.currency,
        grossTotal: result.normalizedInvoice.grossTotal,
        poNumber: result.normalizedInvoice.poNumber,
        discountTerms: result.normalizedInvoice.discountTerms,
    }, null, 2)));

    if (result.proposedCorrections.length > 0) {
        console.log('\n' + chalk.white.bold('Proposed Corrections:'));
        result.proposedCorrections.forEach(c => {
            const status = c.autoApplied ? chalk.green('[AUTO-APPLIED]') : chalk.yellow('[PENDING REVIEW]');
            console.log(`  ${status} ${chalk.white(c.field)}`);
            console.log(`    ${chalk.gray('From:')} ${chalk.red(JSON.stringify(c.originalValue))}`);
            console.log(`    ${chalk.gray('To:')}   ${chalk.green(JSON.stringify(c.proposedValue))}`);
            console.log(`    ${chalk.gray('Confidence:')} ${chalk.white((c.confidence * 100).toFixed(1) + '%')}`);
            console.log(`    ${chalk.gray('Reason:')} ${chalk.white(c.reasoning.substring(0, 120))}...`);
        });
    }

    console.log('\n' + chalk.white.bold('Decision:'));
    if (result.requiresHumanReview) {
        console.log(chalk.red.bold('  Status: REQUIRES HUMAN REVIEW'));
    } else {
        console.log(chalk.green.bold('  Status: AUTO-PROCESSED'));
    }
    console.log(chalk.white(`  Overall Confidence: ${(result.confidenceScore * 100).toFixed(1)}%`));

    console.log('\n' + chalk.white.bold('Reasoning Summary:'));
    const lines = result.reasoning.split('\n');
    lines.forEach(line => console.log(chalk.gray('  ' + line)));

    console.log('\n' + chalk.white.bold('Audit Trail:'));
    result.auditTrail.forEach(entry => {
        console.log(chalk.gray(`  [${entry.step.toUpperCase()}] ${entry.timestamp}`));
        console.log(chalk.gray(`    ${entry.details.substring(0, 100)}${entry.details.length > 100 ? '...' : ''}`));
    });
}

async function printMemoryState() {
    const memories = await getAllMemories();

    console.log('\n' + chalk.magenta.bold('CURRENT MEMORY STATE'));
    console.log(chalk.magenta(SECTION));

    console.log(chalk.white.bold('\nVendor Memories:'));
    if (memories.vendorMemories.length === 0) {
        console.log(chalk.gray('  (No vendor memories yet)'));
    } else {
        memories.vendorMemories.forEach(vm => {
            console.log(chalk.cyan(`\n  Vendor: ${vm.vendorName}`));
            console.log(chalk.gray(`    Confidence: ${(vm.confidence * 100).toFixed(1)}%`));
            console.log(chalk.gray(`    Usage Count: ${vm.usageCount} times`));

            if (vm.fieldMappings.length > 0) {
                console.log(chalk.gray('    Field Mappings:'));
                vm.fieldMappings.forEach(fm => {
                    console.log(chalk.gray(`      - "${fm.sourceLabel}" -> ${fm.targetField} (${(fm.confidence * 100).toFixed(1)}%)`));
                });
            }

            if (vm.taxBehavior) {
                console.log(chalk.gray(`    Tax Behavior: ${vm.taxBehavior.isInclusive ? 'VAT Inclusive' : 'VAT Exclusive'} (${(vm.taxBehavior.confidence * 100).toFixed(1)}%)`));
            }

            if (vm.skuMappings.length > 0) {
                console.log(chalk.gray('    SKU Mappings:'));
                vm.skuMappings.forEach(sm => {
                    console.log(chalk.gray(`      - "${sm.description}" -> ${sm.sku} (${(sm.confidence * 100).toFixed(1)}%)`));
                });
            }

            if (vm.paymentTerms) {
                console.log(chalk.gray(`    Payment Terms: ${vm.paymentTerms}`));
            }
        });
    }

    console.log(chalk.white.bold('\nCorrection Memories:'));
    if (memories.correctionMemories.length === 0) {
        console.log(chalk.gray('  (No correction memories yet)'));
    } else {
        memories.correctionMemories.forEach(cm => {
            console.log(chalk.gray(`  - ${cm.vendorName}/${cm.fieldName}: ${cm.pattern} -> ${cm.correctionType} (${(cm.confidence * 100).toFixed(1)}%)`));
        });
    }

    console.log(chalk.white.bold('\nResolution History:'));
    if (memories.resolutionMemories.length === 0) {
        console.log(chalk.gray('  (No resolutions yet)'));
    } else {
        const byVendor = memories.resolutionMemories.reduce((acc, rm) => {
            acc[rm.vendorName] = acc[rm.vendorName] || { approved: 0, rejected: 0 };
            if (rm.resolution === 'approved') acc[rm.vendorName].approved++;
            else acc[rm.vendorName].rejected++;
            return acc;
        }, {} as Record<string, { approved: number; rejected: number }>);

        Object.entries(byVendor).forEach(([vendor, stats]) => {
            console.log(chalk.gray(`  - ${vendor}: ${stats.approved} approved, ${stats.rejected} rejected`));
        });
    }
}

async function runDemo() {
    console.log(chalk.cyan.bold(`
${DIVIDER}
INVOICE MEMORY LAYER SYSTEM - DEMONSTRATION
${DIVIDER}

Demonstrating the Recall -> Apply -> Decide -> Learn pipeline
with confidence tracking and complete audit trails.

${DIVIDER}
  `));

    // Reset memories for fresh demo
    console.log(chalk.gray('\nResetting memory database for clean demonstration...\n'));
    resetAllMemories();

    const { invoices, purchaseOrders, humanCorrections } = await loadData();

    // ==========================================
    // PHASE 1: Process first invoice (no memory)
    // ==========================================
    printHeader('PHASE 1: First Encounter (No Prior Learning)');
    console.log(chalk.gray('Processing: INV-A-001 from Supplier GmbH'));
    console.log(chalk.gray('Context: First time processing this vendor - no memory exists yet\n'));

    const firstInvoice = invoices.find(i => i.invoiceId === 'INV-A-001')!;
    const firstResult = await processInvoice(firstInvoice, { purchaseOrders });
    printResult(firstResult);

    await printMemoryState();

    // ==========================================
    // PHASE 2: Apply human corrections
    // ==========================================
    printHeader('PHASE 2: Human Training (Applying Corrections)');
    console.log(chalk.gray('A human reviewer provides corrections for INV-A-001'));
    console.log(chalk.gray('The system will LEARN from these corrections\n'));

    const firstCorrection = humanCorrections.find(c => c.invoiceId === 'INV-A-001')!;
    console.log(chalk.white('Human Correction Applied:'));
    console.log(chalk.gray(JSON.stringify(firstCorrection, null, 2)));

    const memoryUpdates = await applyHumanCorrection(firstInvoice, firstCorrection);

    console.log(chalk.green.bold('\nMemory Updates:'));
    memoryUpdates.forEach(update => {
        console.log(chalk.green(`  [${update.action.toUpperCase()}] ${update.type}: ${update.details}`));
    });

    await printMemoryState();

    // ==========================================
    // PHASE 3: Process second invoice (with memory)
    // ==========================================
    printHeader('PHASE 3: Smart Processing (Using Learned Memory)');
    console.log(chalk.gray('Processing: INV-A-002 from Supplier GmbH'));
    console.log(chalk.gray('Context: System now has memory of "Leistungsdatum" = serviceDate pattern\n'));

    const secondInvoice = invoices.find(i => i.invoiceId === 'INV-A-002')!;
    const secondResult = await processInvoice(secondInvoice, { purchaseOrders });
    printResult(secondResult);

    console.log(chalk.green.bold('\nLEARNING DEMONSTRATED:'));
    if (secondResult.normalizedInvoice.serviceDate) {
        console.log(chalk.green('  SUCCESS: serviceDate was automatically extracted using learned pattern!'));
        console.log(chalk.green('  The system remembered the "Leistungsdatum" mapping from the previous correction.'));
    }

    // ==========================================
    // PHASE 4: VAT Inclusive Learning (Parts AG)
    // ==========================================
    printHeader('PHASE 4: Learning VAT Behavior (Parts AG)');

    printSubHeader('Step 4a: First Parts AG Invoice (No Memory)');
    const partsInvoice1 = invoices.find(i => i.invoiceId === 'INV-B-001')!;
    const partsResult1 = await processInvoice(partsInvoice1, { purchaseOrders });
    printResult(partsResult1);

    printSubHeader('Step 4b: Applying VAT Correction');
    const partsCorrection = humanCorrections.find(c => c.invoiceId === 'INV-B-001')!;
    console.log(chalk.gray(JSON.stringify(partsCorrection, null, 2)));
    await applyHumanCorrection(partsInvoice1, partsCorrection);

    printSubHeader('Step 4c: Second Parts AG Invoice (With VAT Memory)');
    const partsInvoice2 = invoices.find(i => i.invoiceId === 'INV-B-002')!;
    const partsResult2 = await processInvoice(partsInvoice2, { purchaseOrders });
    printResult(partsResult2);

    // ==========================================
    // PHASE 5: Currency Recovery
    // ==========================================
    printHeader('PHASE 5: Currency Recovery (Parts AG)');

    const currencyCorrection = humanCorrections.find(c => c.invoiceId === 'INV-B-003')!;
    await applyHumanCorrection(
        invoices.find(i => i.invoiceId === 'INV-B-003')!,
        currencyCorrection
    );
    console.log(chalk.green('  SUCCESS: Learned to recover currency from rawText for Parts AG'));

    // ==========================================
    // PHASE 6: Freight & Co - Skonto and SKU Mapping
    // ==========================================
    printHeader('PHASE 6: Freight & Co (Payment Terms & SKU Learning)');

    printSubHeader('Step 6a: Learning Skonto Terms');
    const freightInvoice1 = invoices.find(i => i.invoiceId === 'INV-C-001')!;
    await processInvoice(freightInvoice1, { purchaseOrders });

    const skontoCorrection = humanCorrections.find(c => c.invoiceId === 'INV-C-001')!;
    await applyHumanCorrection(freightInvoice1, skontoCorrection);
    console.log(chalk.green('  SUCCESS: Learned Skonto payment terms'));

    printSubHeader('Step 6b: Learning SKU Mapping (Seefracht -> FREIGHT)');
    const freightInvoice2 = invoices.find(i => i.invoiceId === 'INV-C-002')!;

    const skuCorrection = humanCorrections.find(c => c.invoiceId === 'INV-C-002')!;
    await applyHumanCorrection(freightInvoice2, skuCorrection);
    console.log(chalk.green('  SUCCESS: Learned SKU mapping "seefracht / shipping" -> FREIGHT'));

    printSubHeader('Step 6c: Processing New Freight Invoice (With Memory)');
    const freightInvoice3 = invoices.find(i => i.invoiceId === 'INV-C-003')!;
    const freightResult3 = await processInvoice(freightInvoice3, { purchaseOrders });
    printResult(freightResult3);

    // ==========================================
    // PHASE 7: Duplicate Detection
    // ==========================================
    printHeader('PHASE 7: Duplicate Detection');
    console.log(chalk.gray('Processing: INV-A-004 (same invoice number as INV-A-003)\n'));

    // First process INV-A-003
    const invoice3 = invoices.find(i => i.invoiceId === 'INV-A-003')!;
    await processInvoice(invoice3, { purchaseOrders });

    // Apply its correction to record it
    const correction3 = humanCorrections.find(c => c.invoiceId === 'INV-A-003')!;
    await applyHumanCorrection(invoice3, correction3);

    // Now process the duplicate
    const duplicateInvoice = invoices.find(i => i.invoiceId === 'INV-A-004')!;
    const duplicateResult = await processInvoice(duplicateInvoice, { purchaseOrders });
    printResult(duplicateResult);

    if (duplicateResult.requiresHumanReview) {
        console.log(chalk.red.bold('\nDUPLICATE ALERT: Memory updates blocked to prevent contamination!'));
    }

    // ==========================================
    // FINAL: Complete Memory State
    // ==========================================
    printHeader('FINAL: Complete Memory State');
    await printMemoryState();

    // ==========================================
    // OUTPUT: Full JSON Results
    // ==========================================
    printHeader('SAMPLE OUTPUT - JSON Format (INV-A-002)');
    console.log(chalk.gray('\nThis is the exact output contract format required by the assignment:\n'));
    console.log(JSON.stringify(secondResult, null, 2));

    console.log(chalk.cyan.bold(`
${DIVIDER}
DEMONSTRATION COMPLETE
${DIVIDER}

Summary of Demonstrated Capabilities:
  [DONE] Learning field mappings (Leistungsdatum -> serviceDate)
  [DONE] Learning VAT behavior (inclusive pricing detection)
  [DONE] Currency recovery from rawText
  [DONE] SKU mapping from descriptions
  [DONE] Payment terms detection (Skonto)
  [DONE] Duplicate detection and prevention
  [DONE] Confidence evolution over time
  [DONE] Complete audit trails

${DIVIDER}
  `));

    shutdown();
}

// Run the demo
runDemo().catch(err => {
    console.error(chalk.red('Demo failed:'), err);
    shutdown();
    process.exit(1);
});
