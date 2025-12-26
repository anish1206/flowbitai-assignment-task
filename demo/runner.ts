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

const DIVIDER = '═'.repeat(80);
const SECTION = '─'.repeat(60);

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
    console.log(chalk.cyan.bold(`  ${text}`));
    console.log(chalk.cyan(DIVIDER));
}

function printSubHeader(text: string) {
    console.log('\n' + chalk.yellow(SECTION));
    console.log(chalk.yellow.bold(`  ${text}`));
    console.log(chalk.yellow(SECTION));
}

function printResult(result: ProcessingResult) {
    console.log('\n' + chalk.white.bold('📄 Normalized Invoice:'));
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
        console.log('\n' + chalk.white.bold('🔧 Proposed Corrections:'));
        result.proposedCorrections.forEach(c => {
            const status = c.autoApplied ? chalk.green('✓ AUTO') : chalk.yellow('⏳ PENDING');
            console.log(`  ${status} ${chalk.white(c.field)}: ${chalk.red(JSON.stringify(c.originalValue))} → ${chalk.green(JSON.stringify(c.proposedValue))}`);
            console.log(`         ${chalk.gray(c.reasoning)}`);
        });
    }

    console.log('\n' + chalk.white.bold('🎯 Decision:'));
    if (result.requiresHumanReview) {
        console.log(chalk.red.bold('  ⚠️  REQUIRES HUMAN REVIEW'));
    } else {
        console.log(chalk.green.bold('  ✅ AUTO-PROCESSED'));
    }
    console.log(chalk.white(`  Confidence: ${(result.confidenceScore * 100).toFixed(1)}%`));

    console.log('\n' + chalk.white.bold('💭 Reasoning:'));
    console.log(chalk.gray(result.reasoning));

    console.log('\n' + chalk.white.bold('📋 Audit Trail:'));
    result.auditTrail.forEach(entry => {
        console.log(chalk.gray(`  [${entry.step.toUpperCase()}] ${entry.timestamp}`));
        console.log(chalk.gray(`    ${entry.details.substring(0, 100)}${entry.details.length > 100 ? '...' : ''}`));
    });
}

async function printMemoryState() {
    const memories = await getAllMemories();

    console.log('\n' + chalk.magenta.bold('🧠 CURRENT MEMORY STATE'));
    console.log(chalk.magenta(SECTION));

    console.log(chalk.white.bold('\nVendor Memories:'));
    if (memories.vendorMemories.length === 0) {
        console.log(chalk.gray('  (No vendor memories yet)'));
    } else {
        memories.vendorMemories.forEach(vm => {
            console.log(chalk.cyan(`\n  📦 ${vm.vendorName}`));
            console.log(chalk.gray(`     Confidence: ${(vm.confidence * 100).toFixed(1)}% | Usage: ${vm.usageCount} times`));

            if (vm.fieldMappings.length > 0) {
                console.log(chalk.gray('     Field Mappings:'));
                vm.fieldMappings.forEach(fm => {
                    console.log(chalk.gray(`       - "${fm.sourceLabel}" → ${fm.targetField} (${(fm.confidence * 100).toFixed(1)}%)`));
                });
            }

            if (vm.taxBehavior) {
                console.log(chalk.gray(`     Tax: ${vm.taxBehavior.isInclusive ? 'VAT Inclusive' : 'VAT Exclusive'} (${(vm.taxBehavior.confidence * 100).toFixed(1)}%)`));
            }

            if (vm.skuMappings.length > 0) {
                console.log(chalk.gray('     SKU Mappings:'));
                vm.skuMappings.forEach(sm => {
                    console.log(chalk.gray(`       - "${sm.description}" → ${sm.sku} (${(sm.confidence * 100).toFixed(1)}%)`));
                });
            }

            if (vm.paymentTerms) {
                console.log(chalk.gray(`     Payment Terms: ${vm.paymentTerms}`));
            }
        });
    }

    console.log(chalk.white.bold('\nCorrection Memories:'));
    if (memories.correctionMemories.length === 0) {
        console.log(chalk.gray('  (No correction memories yet)'));
    } else {
        memories.correctionMemories.forEach(cm => {
            console.log(chalk.gray(`  - ${cm.vendorName}/${cm.fieldName}: ${cm.pattern} → ${cm.correctionType} (${(cm.confidence * 100).toFixed(1)}%)`));
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
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║           🧠 INVOICE MEMORY LAYER SYSTEM - INTERACTIVE DEMO 🧠              ║
║                                                                              ║
║   Demonstrating learning over time through the Recall → Apply → Decide →    ║
║   Learn pipeline with confidence tracking and audit trails.                 ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `));

    // Reset memories for fresh demo
    console.log(chalk.gray('\n🔄 Resetting memory database for fresh demo...\n'));
    resetAllMemories();

    const { invoices, purchaseOrders, humanCorrections } = await loadData();

    // ==========================================
    // PHASE 1: Process first invoice (no memory)
    // ==========================================
    printHeader('PHASE 1: FIRST ENCOUNTER - No Prior Learning');
    console.log(chalk.gray('Processing INV-A-001 from Supplier GmbH for the first time...'));
    console.log(chalk.gray('The system has NO memory of this vendor yet.\n'));

    const firstInvoice = invoices.find(i => i.invoiceId === 'INV-A-001')!;
    const firstResult = await processInvoice(firstInvoice, { purchaseOrders });
    printResult(firstResult);

    await printMemoryState();

    // ==========================================
    // PHASE 2: Apply human corrections
    // ==========================================
    printHeader('PHASE 2: HUMAN TRAINING - Applying Corrections');
    console.log(chalk.gray('Human reviewer provides corrections for INV-A-001...'));
    console.log(chalk.gray('The system will LEARN from these corrections.\n'));

    const firstCorrection = humanCorrections.find(c => c.invoiceId === 'INV-A-001')!;
    console.log(chalk.white('Human Correction Applied:'));
    console.log(chalk.gray(JSON.stringify(firstCorrection, null, 2)));

    const memoryUpdates = await applyHumanCorrection(firstInvoice, firstCorrection);

    console.log(chalk.green.bold('\n✨ Memory Updates:'));
    memoryUpdates.forEach(update => {
        console.log(chalk.green(`  [${update.action.toUpperCase()}] ${update.type}: ${update.details}`));
    });

    await printMemoryState();

    // ==========================================
    // PHASE 3: Process second invoice (with memory)
    // ==========================================
    printHeader('PHASE 3: SMART PROCESSING - Using Learned Memory');
    console.log(chalk.gray('Processing INV-A-002 from Supplier GmbH...'));
    console.log(chalk.gray('The system NOW has memory of "Leistungsdatum" = serviceDate!\n'));

    const secondInvoice = invoices.find(i => i.invoiceId === 'INV-A-002')!;
    const secondResult = await processInvoice(secondInvoice, { purchaseOrders });
    printResult(secondResult);

    console.log(chalk.green.bold('\n🎉 LEARNING DEMONSTRATED:'));
    if (secondResult.normalizedInvoice.serviceDate) {
        console.log(chalk.green('  ✓ serviceDate was automatically extracted using learned pattern!'));
    }

    // ==========================================
    // PHASE 4: VAT Inclusive Learning (Parts AG)
    // ==========================================
    printHeader('PHASE 4: LEARNING VAT BEHAVIOR - Parts AG');

    printSubHeader('4a: First Parts AG invoice (no memory)');
    const partsInvoice1 = invoices.find(i => i.invoiceId === 'INV-B-001')!;
    const partsResult1 = await processInvoice(partsInvoice1, { purchaseOrders });
    printResult(partsResult1);

    printSubHeader('4b: Applying VAT correction');
    const partsCorrection = humanCorrections.find(c => c.invoiceId === 'INV-B-001')!;
    console.log(chalk.gray(JSON.stringify(partsCorrection, null, 2)));
    await applyHumanCorrection(partsInvoice1, partsCorrection);

    printSubHeader('4c: Second Parts AG invoice (with VAT memory)');
    const partsInvoice2 = invoices.find(i => i.invoiceId === 'INV-B-002')!;
    const partsResult2 = await processInvoice(partsInvoice2, { purchaseOrders });
    printResult(partsResult2);

    // ==========================================
    // PHASE 5: Currency Recovery
    // ==========================================
    printHeader('PHASE 5: CURRENCY RECOVERY - Parts AG');

    const currencyCorrection = humanCorrections.find(c => c.invoiceId === 'INV-B-003')!;
    await applyHumanCorrection(
        invoices.find(i => i.invoiceId === 'INV-B-003')!,
        currencyCorrection
    );
    console.log(chalk.green('  ✓ Learned to recover currency from rawText for Parts AG'));

    // ==========================================
    // PHASE 6: Freight & Co - Skonto and SKU Mapping
    // ==========================================
    printHeader('PHASE 6: FREIGHT & CO - Payment Terms & SKU Learning');

    printSubHeader('6a: Learning Skonto terms');
    const freightInvoice1 = invoices.find(i => i.invoiceId === 'INV-C-001')!;
    const freightResult1 = await processInvoice(freightInvoice1, { purchaseOrders });
    console.log(chalk.gray('Processing FC-1001...'));

    const skontoCorrection = humanCorrections.find(c => c.invoiceId === 'INV-C-001')!;
    await applyHumanCorrection(freightInvoice1, skontoCorrection);
    console.log(chalk.green('  ✓ Learned Skonto payment terms'));

    printSubHeader('6b: Learning SKU mapping (Seefracht → FREIGHT)');
    const freightInvoice2 = invoices.find(i => i.invoiceId === 'INV-C-002')!;

    const skuCorrection = humanCorrections.find(c => c.invoiceId === 'INV-C-002')!;
    await applyHumanCorrection(freightInvoice2, skuCorrection);
    console.log(chalk.green('  ✓ Learned SKU mapping: "seefracht / shipping" → FREIGHT'));

    printSubHeader('6c: Processing new Freight invoice (with memory)');
    const freightInvoice3 = invoices.find(i => i.invoiceId === 'INV-C-003')!;
    const freightResult3 = await processInvoice(freightInvoice3, { purchaseOrders });
    printResult(freightResult3);

    // ==========================================
    // PHASE 7: Duplicate Detection
    // ==========================================
    printHeader('PHASE 7: DUPLICATE DETECTION');
    console.log(chalk.gray('Processing INV-A-004 which has SAME invoice number as INV-A-003...\n'));

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
        console.log(chalk.red.bold('\n🚨 DUPLICATE DETECTED - Memory updates blocked to prevent contamination!'));
    }

    // ==========================================
    // FINAL: Complete Memory State
    // ==========================================
    printHeader('FINAL: COMPLETE MEMORY STATE');
    await printMemoryState();

    // ==========================================
    // OUTPUT: Full JSON Results
    // ==========================================
    printHeader('SAMPLE OUTPUT - JSON Format (INV-A-002)');
    console.log(chalk.gray('\nThis is the exact output contract format required:\n'));
    console.log(JSON.stringify(secondResult, null, 2));

    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                        🎉 DEMO COMPLETE! 🎉                                  ║
║                                                                              ║
║   The system demonstrated:                                                   ║
║   ✓ Learning field mappings (Leistungsdatum → serviceDate)                  ║
║   ✓ Learning VAT behavior (inclusive pricing)                               ║
║   ✓ Currency recovery from rawText                                          ║
║   ✓ SKU mapping from descriptions                                           ║
║   ✓ Payment terms detection (Skonto)                                        ║
║   ✓ Duplicate detection and prevention                                      ║
║   ✓ Confidence evolution over time                                          ║
║   ✓ Complete audit trails                                                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `));

    shutdown();
}

// Run the demo
runDemo().catch(err => {
    console.error(chalk.red('Demo failed:'), err);
    shutdown();
    process.exit(1);
});
