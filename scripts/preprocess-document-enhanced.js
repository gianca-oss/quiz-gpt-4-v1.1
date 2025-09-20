// scripts/preprocess-document-enhanced.js - VERSIONE SEMPLIFICATA
// Script per preprocessare il documento PDF con funzionalità di base

import { processDocumentAdvanced } from '../api/enhanced-document-processor.js';
import fs from 'fs/promises';
import path from 'path';

async function preprocessDocument() {
    try {
        console.log('🚀 Avvio preprocessamento documento semplificato...');
        
        // Percorso del PDF originale
        const pdfPath = './data/source/documento-corso.pdf';
        const outputDir = './data/processed-v4';
        
        // Verifica esistenza file
        try {
            await fs.access(pdfPath);
        } catch {
            console.error('❌ File PDF non trovato:', pdfPath);
            console.log('💡 Assicurati di avere il file PDF in:', path.resolve(pdfPath));
            return;
        }
        
        // Leggi il PDF
        console.log('📖 Lettura file PDF...');
        const pdfBuffer = await fs.readFile(pdfPath);
        console.log(`✅ File caricato: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        
        // Crea directory output
        await fs.mkdir(outputDir, { recursive: true });
        
        // Processa il documento con funzionalità di base
        console.log('⚙️ Processamento con estrazione tabelle...');
        const { processor, results } = await processDocumentAdvanced(pdfBuffer, {
            enableOCR: false,        // Disabilitato per ora
            enableTables: true,      // Estrazione tabelle attiva
            enableEmbeddings: false, // Disabilitato per ora
            chunkSize: 500
        });
        
        console.log('\n📊 RIEPILOGO PROCESSAMENTO:');
        console.log(`- Pagine totali: ${results.metadata.totalPages}`);
        console.log(`- Chunks di testo: ${results.textChunks.length}`);
        console.log(`- Tabelle estratte: ${results.tables.length}`);
        
        // Salva tutti i dati elaborati
        await saveProcessedData(results, outputDir);
        
        // Genera report
        await generateSimpleReport(results, outputDir);
        
        console.log('\n✅ PROCESSAMENTO COMPLETATO!');
        console.log(`📁 Output salvato in: ${outputDir}`);
        console.log('🚀 Ora puoi testare l\'API con i dati processati');
        
        // Mostra statistiche utili
        showStatistics(results);
        
    } catch (error) {
        console.error('❌ Errore durante il preprocessamento:', error);
        process.exit(1);
    }
}

/**
 * Salva i dati processati
 */
async function saveProcessedData(results, outputDir) {
    console.log('\n💾 Salvataggio dati processati...');
    
    const chunksPerFile = 100;
    
    // 1. Salva metadata
    const metadata = {
        version: '4.0-simplified',
        createdAt: new Date().toISOString(),
        capabilities: ['tables', 'text-chunks'],
        totalChunks: results.textChunks.length,
        totalTables: results.tables.length,
        ...results.metadata
    };
    
    await fs.writeFile(
        path.join(outputDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
    );
    console.log('✅ Metadata salvati');
    
    // 2. Salva chunks di testo
    for (let i = 0; i < results.textChunks.length; i += chunksPerFile) {
        const chunk = results.textChunks.slice(i, i + chunksPerFile);
        const fileIndex = Math.floor(i / chunksPerFile);
        
        await fs.writeFile(
            path.join(outputDir, `text_chunks_${fileIndex}.json`),
            JSON.stringify(chunk, null, 2)
        );
        console.log(`✅ Salvato text_chunks_${fileIndex}.json (${chunk.length} chunks)`);
    }
    
    // 3. Salva tabelle
    await fs.writeFile(
        path.join(outputDir, 'tables.json'),
        JSON.stringify(results.tables, null, 2)
    );
    console.log(`✅ Salvate ${results.tables.length} tabelle`);
    
    // 4. Crea indice di ricerca
    const searchIndex = {
        version: '4.0-simplified',
        totalDocuments: results.textChunks.length + results.tables.length,
        capabilities: ['keyword', 'table'],
        createdAt: new Date().toISOString()
    };
    
    await fs.writeFile(
        path.join(outputDir, 'search-index.json'),
        JSON.stringify(searchIndex, null, 2)
    );
    console.log('✅ Indice di ricerca creato');
}

/**
 * Genera report semplificato
 */
async function generateSimpleReport(results, outputDir) {
    console.log('\n📋 Generazione report...');
    
    const report = {
        generatedAt: new Date().toISOString(),
        version: '4.0-simplified',
        
        overview: {
            totalPages: results.metadata.totalPages,
            totalChunks: results.textChunks.length,
            averageChunkSize: results.textChunks.length > 0 
                ? Math.round(results.textChunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / results.textChunks.length)
                : 0,
            totalTables: results.tables.length
        },
        
        tableAnalysis: {
            tablesFound: results.tables.length,
            pagesWithTables: [...new Set(results.tables.map(t => t.page))].length,
            averageRowsPerTable: results.tables.length > 0
                ? Math.round(results.tables.reduce((sum, table) => sum + table.rows.length, 0) / results.tables.length)
                : 0
        },
        
        pageDistribution: results.textChunks.reduce((acc, chunk) => {
            acc[chunk.page] = (acc[chunk.page] || 0) + 1;
            return acc;
        }, {}),
        
        nextSteps: [
            '✅ Estrazione testo e tabelle completata',
            '🔄 Prossimo: aggiungi OCR per pagine scansionate',
            '🧠 Prossimo: aggiungi embeddings per ricerca semantica'
        ]
    };
    
    await fs.writeFile(
        path.join(outputDir, 'simple-report.json'),
        JSON.stringify(report, null, 2)
    );
    
    // Report leggibile
    const readableReport = `# Report Processamento Semplificato

**Data:** ${new Date().toLocaleString('it-IT')}

## Panoramica
- **Pagine:** ${report.overview.totalPages}
- **Chunks testo:** ${report.overview.totalChunks}
- **Dimensione media chunk:** ${report.overview.averageChunkSize} caratteri
- **Tabelle:** ${report.overview.totalTables}

## Tabelle
- **Trovate:** ${report.tableAnalysis.tablesFound}
- **Pagine con tabelle:** ${report.tableAnalysis.pagesWithTables}
- **Righe medie per tabella:** ${report.tableAnalysis.averageRowsPerTable}

## Prossimi Passi
${report.nextSteps.map(step => `- ${step}`).join('\n')}
`;
    
    await fs.writeFile(
        path.join(outputDir, 'REPORT.md'),
        readableReport
    );
    
    console.log('✅ Report generato');
}

/**
 * Mostra statistiche utili
 */
function showStatistics(results) {
    console.log('\n📈 STATISTICHE:');
    
    // Top 5 pagine con più contenuto
    const pageStats = results.textChunks.reduce((acc, chunk) => {
        acc[chunk.page] = (acc[chunk.page] || 0) + chunk.text.length;
        return acc;
    }, {});
    
    const topPages = Object.entries(pageStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5);
        
    console.log('📄 Top 5 pagine per contenuto:');
    topPages.forEach(([page, chars]) => {
        console.log(`   Pagina ${page}: ${chars} caratteri`);
    });
    
    // Pagine con tabelle
    if (results.tables.length > 0) {
        const tablesPerPage = results.tables.reduce((acc, table) => {
            acc[table.page] = (acc[table.page] || 0) + 1;
            return acc;
        }, {});
        
        console.log('\n📊 Pagine con tabelle:');
        Object.entries(tablesPerPage)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .forEach(([page, count]) => {
                console.log(`   Pagina ${page}: ${count} tabelle`);
            });
    }
}

// Esegui se chiamato direttamente
if (import.meta.url === `file://${process.argv[1]}`) {
    preprocessDocument()
        .then(() => {
            console.log('\n🎉 Preprocessamento semplificato completato!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Errore:', error);
            process.exit(1);
        });
}

export { preprocessDocument };