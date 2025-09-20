// enhanced-document-processor.js - VERSIONE SEMPLIFICATA PER PRIMO TEST
// Rimuoviamo le dipendenze più pesanti per il primo test

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

// Configura PDF.js per Node.js
pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.js';

class EnhancedDocumentProcessor {
    constructor() {
        this.chunks = [];
        this.tables = [];
    }

    /**
     * Processa PDF con analisi di base (senza OCR ed embeddings per ora)
     */
    async processDocument(pdfBuffer) {
        console.log('📄 Inizio processamento documento (versione semplificata)...');
        
        try {
            // Carica il PDF
            const pdf = await pdfjs.getDocument({ data: pdfBuffer }).promise;
            const totalPages = pdf.numPages;
            console.log(`📖 Documento con ${totalPages} pagine`);

            const results = {
                textChunks: [],
                tables: [],
                images: [],
                embeddings: [], // Vuoto per ora
                metadata: {
                    totalPages,
                    tablesFound: 0,
                    imagesProcessed: 0,
                    ocrPagesProcessed: 0
                }
            };

            // Processa ogni pagina
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                if (pageNum % 50 === 0) {
                    console.log(`🔄 Processando pagina ${pageNum}/${totalPages}`);
                }
                
                const page = await pdf.getPage(pageNum);
                const pageResults = await this.processPage(page, pageNum);
                
                // Aggiungi risultati
                results.textChunks.push(...pageResults.textChunks);
                results.tables.push(...pageResults.tables);
                
                // Aggiorna metadata
                results.metadata.tablesFound += pageResults.tables.length;
            }

            console.log(`✅ Processamento completato:
  - ${results.textChunks.length} chunks di testo
  - ${results.tables.length} tabelle estratte`);

            return results;

        } catch (error) {
            console.error('❌ Errore processamento:', error);
            throw error;
        }
    }

    /**
     * Processa una singola pagina (versione semplificata)
     */
    async processPage(page, pageNum) {
        const results = {
            textChunks: [],
            tables: [],
            images: [],
            usedOCR: false
        };

        try {
            // 1. Estrazione testo standard
            const textContent = await page.getTextContent();
            let pageText = this.extractTextFromContent(textContent);

            // 2. Analisi tabelle semplificata
            const tables = await this.extractTables(page, pageNum);
            results.tables = tables;

            // 3. Chunking del testo
            if (pageText.trim().length > 0) {
                const chunks = this.chunkText(pageText, pageNum);
                results.textChunks = chunks;
            }

        } catch (error) {
            console.error(`❌ Errore pagina ${pageNum}:`, error);
        }

        return results;
    }

    /**
     * Estrae testo dal content di PDF.js
     */
    extractTextFromContent(textContent) {
        return textContent.items
            .map(item => item.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Estrae tabelle dalla pagina PDF (versione semplificata)
     */
    async extractTables(page, pageNum) {
        try {
            const textContent = await page.getTextContent();
            const tables = [];

            // Analizza posizioni del testo per identificare strutture tabulari
            const items = textContent.items.sort((a, b) => {
                if (Math.abs(a.transform[5] - b.transform[5]) < 2) {
                    return a.transform[4] - b.transform[4];
                }
                return b.transform[5] - a.transform[5];
            });

            // Raggruppa elementi per riga
            const rows = [];
            let currentRow = [];
            let currentY = null;
            const tolerance = 3;

            for (const item of items) {
                const y = item.transform[5];
                
                if (currentY === null || Math.abs(y - currentY) <= tolerance) {
                    currentRow.push(item);
                    currentY = y;
                } else {
                    if (currentRow.length > 0) {
                        rows.push([...currentRow]);
                    }
                    currentRow = [item];
                    currentY = y;
                }
            }
            
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }

            // Identifica potenziali tabelle
            const potentialTables = this.identifyTabularStructures(rows);
            
            for (const tableRows of potentialTables) {
                const table = {
                    page: pageNum,
                    type: 'table',
                    rows: tableRows.map(row => 
                        row.map(item => item.str.trim()).filter(text => text.length > 0)
                    ),
                    text: this.formatTableAsText(tableRows)
                };
                
                if (table.rows.length >= 2 && table.rows[0].length >= 2) {
                    tables.push(table);
                }
            }

            return tables;

        } catch (error) {
            console.error(`❌ Errore estrazione tabelle pagina ${pageNum}:`, error);
            return [];
        }
    }

    /**
     * Identifica strutture tabulari
     */
    identifyTabularStructures(rows) {
        const tables = [];
        let currentTable = [];
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            if (row.length >= 2) {
                const positions = row.map(item => item.transform[4]).sort((a, b) => a - b);
                let wellSpaced = true;
                
                for (let j = 1; j < positions.length; j++) {
                    if (positions[j] - positions[j-1] < 30) {
                        wellSpaced = false;
                        break;
                    }
                }
                
                if (wellSpaced) {
                    currentTable.push(row);
                } else {
                    if (currentTable.length >= 2) {
                        tables.push([...currentTable]);
                    }
                    currentTable = [];
                }
            } else {
                if (currentTable.length >= 2) {
                    tables.push([...currentTable]);
                }
                currentTable = [];
            }
        }
        
        if (currentTable.length >= 2) {
            tables.push(currentTable);
        }
        
        return tables;
    }

    /**
     * Formatta tabella come testo
     */
    formatTableAsText(tableRows) {
        return tableRows.map(row => 
            row.map(item => item.str.trim())
               .filter(text => text.length > 0)
               .join(' | ')
        ).join('\n');
    }

    /**
     * Divide il testo in chunks
     */
    chunkText(text, pageNum, maxChunkSize = 500) {
        const chunks = [];
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        
        let currentChunk = '';
        let chunkIndex = 0;

        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (!trimmedSentence) continue;

            if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk) {
                chunks.push({
                    id: `${pageNum}_${chunkIndex}`,
                    page: pageNum,
                    text: currentChunk.trim(),
                    type: 'text',
                    chunkIndex: chunkIndex++
                });
                currentChunk = trimmedSentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push({
                id: `${pageNum}_${chunkIndex}`,
                page: pageNum,
                text: currentChunk.trim(),
                type: 'text',
                chunkIndex: chunkIndex
            });
        }

        return chunks;
    }

    /**
     * Ricerca semplificata nelle tabelle
     */
    searchInTables(query, tables) {
        const results = [];
        const queryWords = query.toLowerCase().split(/\s+/);

        for (const table of tables) {
            let score = 0;
            const tableText = table.text.toLowerCase();
            
            for (const word of queryWords) {
                const matches = (tableText.match(new RegExp(word, 'g')) || []).length;
                score += matches;
            }

            if (score > 0) {
                results.push({
                    ...table,
                    score: score,
                    type: 'table'
                });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }
}

// Funzione semplificata per processare documento
export async function processDocumentAdvanced(pdfBuffer, options = {}) {
    const processor = new EnhancedDocumentProcessor();
    
    console.log('🚀 Avvio processamento documento (versione semplificata)');

    const results = await processor.processDocument(pdfBuffer);
    
    return {
        processor,
        results,
        search: {
            tables: (query) => processor.searchInTables(query, results.tables),
            // Per ora semantic search restituisce array vuoto
            semantic: (query, topK = 10) => Promise.resolve([]),
            combined: async (query, topK = 15) => {
                const tableResults = processor.searchInTables(query, results.tables);
                return {
                    semantic: [],
                    tables: tableResults,
                    combined: tableResults.slice(0, topK)
                };
            }
        }
    };
}

export { EnhancedDocumentProcessor };