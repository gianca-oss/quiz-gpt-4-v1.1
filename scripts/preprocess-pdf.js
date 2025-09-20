// scripts/preprocess-pdf.js
// Script avanzato per preprocessare PDF e creare indice searchable

const fs = require('fs');
const path = require('path');

// Configurazione pdfjs-dist per Node.js
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');

// Configurazione
const CONFIG = {
    CHUNK_SIZE: 1500,        // Caratteri per chunk
    CHUNK_OVERLAP: 200,      // Overlap tra chunks
    MIN_WORD_LENGTH: 3,      // Lunghezza minima parole per indice
    CHUNKS_PER_FILE: 50,     // Chunks per file JSON
    MAX_INDEX_WORDS: 10000   // Limite parole nell'indice
};

/**
 * Preprocessa un PDF creando chunks e indice
 */
async function preprocessPDF(pdfPath, outputDir) {
    console.log(' Avvio preprocessing PDF...');
    console.log(` File: ${pdfPath}`);
    console.log(` Output: ${outputDir}`);
    
    // Verifica che il file esista
    if (!fs.existsSync(pdfPath)) {
        throw new Error(`File PDF non trovato: ${pdfPath}`);
    }
    
    // Crea directory output se non esiste
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Carica il PDF
    const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    // Inizializza metadata
    const metadata = {
        version: '2.0',
        created: new Date().toISOString(),
        source: path.basename(pdfPath),
        totalPages: pdf.numPages,
        totalChunks: 0,
        chunkFiles: [],
        index: {},
        topics: {},
        config: CONFIG
    };
    
    console.log(`📊 Pagine totali: ${metadata.totalPages}`);
    
    // Array per tutti i chunks
    const allChunks = [];
    
    // Processa ogni pagina
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Estrai testo con posizioni
            const pageText = textContent.items
                .map(item => item.str)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            if (pageText.length > 0) {
                // Crea chunks con overlap
                const pageChunks = createChunks(pageText, pageNum);
                
                pageChunks.forEach(chunk => {
                    // Aggiungi chunk
                    allChunks.push(chunk);
                    
                    // Aggiorna indice
                    updateIndex(metadata.index, chunk);
                    
                    // Estrai topics
                    extractTopics(metadata.topics, chunk);
                });
            }
            
            // Progress
            if (pageNum % 10 === 0 || pageNum === pdf.numPages) {
                const progress = Math.round((pageNum / pdf.numPages) * 100);
                console.log(` Elaborazione: ${progress}% (${pageNum}/${pdf.numPages} pagine)`);
            }
            
        } catch (error) {
            console.warn(`⚠ Errore pagina ${pageNum}:`, error.message);
        }
    }
    
    metadata.totalChunks = allChunks.length;
    
    // Salva chunks in file multipli
    console.log(` Salvataggio ${allChunks.length} chunks...`);
    
    for (let i = 0; i < allChunks.length; i += CONFIG.CHUNKS_PER_FILE) {
        const fileIndex = Math.floor(i / CONFIG.CHUNKS_PER_FILE);
        const chunkBatch = allChunks.slice(i, i + CONFIG.CHUNKS_PER_FILE);
        const fileName = `chunks_${fileIndex}.json`;
        const filePath = path.join(outputDir, fileName);
        
        fs.writeFileSync(filePath, JSON.stringify(chunkBatch, null, 2));
        metadata.chunkFiles.push(fileName);
    }
    
    // Ottimizza e salva indice
    console.log('🔍 Ottimizzazione indice...');
    metadata.index = optimizeIndex(metadata.index);
    
    // Salva metadata principale
    const metadataPath = path.join(outputDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    // Crea file di ricerca rapida
    createSearchIndex(outputDir, metadata, allChunks);
    
    // Report finale
    console.log('\n Preprocessing completato!');
    console.log(`   Statistiche:`);
    console.log(`    - Pagine processate: ${metadata.totalPages}`);
    console.log(`    - Chunks creati: ${metadata.totalChunks}`);
    console.log(`    - File chunks: ${metadata.chunkFiles.length}`);
    console.log(`    - Parole indicizzate: ${Object.keys(metadata.index).length}`);
    console.log(`    - Topics estratti: ${Object.keys(metadata.topics).length}`);
    console.log(`\n File creati in: ${outputDir}`);
    
    return metadata;
}

/**
 * Crea chunks con overlap
 */
function createChunks(text, pageNum) {
    const chunks = [];
    const { CHUNK_SIZE, CHUNK_OVERLAP } = CONFIG;
    
    for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        const start = i;
        const end = Math.min(i + CHUNK_SIZE, text.length);
        const chunkText = text.substring(start, end);
        
        // Cerca di terminare il chunk a fine frase
        let adjustedEnd = end;
        if (end < text.length) {
            const lastPeriod = chunkText.lastIndexOf('.');
            if (lastPeriod > CHUNK_SIZE * 0.8) {
                adjustedEnd = start + lastPeriod + 1;
            }
        }
        
        const finalText = text.substring(start, adjustedEnd).trim();
        
        if (finalText.length > 50) { // Ignora chunks troppo piccoli
            chunks.push({
                id: `p${pageNum}_c${chunks.length}`,
                page: pageNum,
                text: finalText,
                start: start,
                end: adjustedEnd,
                length: finalText.length,
                hash: simpleHash(finalText)
            });
        }
        
        if (adjustedEnd >= text.length) break;
    }
    
    return chunks;
}

/**
 * Aggiorna indice con parole del chunk
 */
function updateIndex(index, chunk) {
    const words = extractWords(chunk.text);
    
    words.forEach(word => {
        if (word.length >= CONFIG.MIN_WORD_LENGTH) {
            if (!index[word]) {
                index[word] = {
                    chunks: [],
                    frequency: 0
                };
            }
            
            if (!index[word].chunks.includes(chunk.id)) {
                index[word].chunks.push(chunk.id);
            }
            index[word].frequency++;
        }
    });
}

/**
 * Estrae topics rilevanti
 */
function extractTopics(topics, chunk) {
    // Estrai frasi importanti (semplificato)
    const sentences = chunk.text.split(/[.!?]+/);
    
    sentences.forEach(sentence => {
        // Cerca pattern di definizioni
        const defPattern = /(?:è|sono|significa|definisce|consiste)/i;
        if (defPattern.test(sentence) && sentence.length > 30 && sentence.length < 200) {
            const topic = sentence.trim();
            const key = topic.substring(0, 50).toLowerCase();
            
            if (!topics[key]) {
                topics[key] = {
                    text: topic,
                    chunks: []
                };
            }
            topics[key].chunks.push(chunk.id);
        }
    });
}

/**
 * Ottimizza indice rimuovendo parole troppo comuni
 */
function optimizeIndex(index) {
    const entries = Object.entries(index);
    
    // Calcola frequenza media
    const avgFrequency = entries.reduce((sum, [_, data]) => 
        sum + data.frequency, 0) / entries.length;
    
    // Filtra parole troppo comuni o troppo rare
    const optimized = {};
    entries.forEach(([word, data]) => {
        if (data.frequency > 2 && data.frequency < avgFrequency * 10) {
            optimized[word] = data;
        }
    });
    
    // Limita a MAX_INDEX_WORDS parole più rilevanti
    const sorted = Object.entries(optimized)
        .sort((a, b) => b[1].chunks.length - a[1].chunks.length)
        .slice(0, CONFIG.MAX_INDEX_WORDS);
    
    return Object.fromEntries(sorted);
}

/**
 * Crea file di ricerca rapida
 */
function createSearchIndex(outputDir, metadata, chunks) {
    // Crea mapping per ricerca veloce
    const searchIndex = {
        version: metadata.version,
        created: metadata.created,
        totalChunks: metadata.totalChunks,
        
        // Mappa chunk ID -> file
        chunkLocations: {},
        
        // Top keywords
        topKeywords: Object.entries(metadata.index)
            .sort((a, b) => b[1].frequency - a[1].frequency)
            .slice(0, 100)
            .map(([word, data]) => ({
                word,
                frequency: data.frequency,
                chunks: data.chunks.slice(0, 10) // Primi 10 chunks
            }))
    };
    
    // Mappa dove trovare ogni chunk
    chunks.forEach((chunk, index) => {
        const fileIndex = Math.floor(index / CONFIG.CHUNKS_PER_FILE);
        searchIndex.chunkLocations[chunk.id] = {
            file: `chunks_${fileIndex}.json`,
            index: index % CONFIG.CHUNKS_PER_FILE
        };
    });
    
    const searchPath = path.join(outputDir, 'search-index.json');
    fs.writeFileSync(searchPath, JSON.stringify(searchIndex, null, 2));
}

/**
 * Estrae parole pulite dal testo
 */
function extractWords(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\sàèéìòù]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 0);
}

/**
 * Hash semplice per identificare chunks duplicati
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Esecuzione da command line
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Uso: node preprocess-pdf.js <pdf-path> [output-dir]');
        console.log('Esempio: node scripts/preprocess-pdf.js data/source/libro.pdf data/processed');
        process.exit(1);
    }
    
    const pdfPath = args[0];
    const outputDir = args[1] || path.join('data', 'processed');
    
    preprocessPDF(pdfPath, outputDir)
        .then(() => {
            console.log('\n Processo completato con successo!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n Errore:', error.message);
            process.exit(1);
        });
}

module.exports = { preprocessPDF };