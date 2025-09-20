// advanced-text-preprocessing.js - Preprocessing ottimizzato per massima accuratezza

const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');

const INPUT_PDF = './data/source/corso_completo.pdf';
const OUTPUT_DIR = './data/processed-v3';
const CHUNK_SIZE = 1500; // Aumentato per contesto migliore
const CHUNK_OVERLAP = 300; // Overlap maggiore per non perdere informazioni

/**
 * Pulisce e normalizza il testo
 */
function cleanText(text) {
    return text
        .replace(/\s+/g, ' ') // Normalizza spazi
        .replace(/\n{3,}/g, '\n\n') // Rimuovi troppi a capo
        .replace(/[^\S\r\n]+/g, ' ') // Spazi multipli
        .trim();
}

/**
 * Estrae keyword importanti per l'indicizzazione
 */
function extractKeywords(text) {
    const stopWords = new Set([
        'il', 'la', 'di', 'che', 'e', 'a', 'un', 'in', 'con', 'per', 'da', 'su',
        'i', 'le', 'del', 'della', 'dei', 'delle', 'al', 'alla', 'dal', 'dalla',
        'nel', 'nella', 'sul', 'sulla', 'è', 'sono', 'questo', 'questa'
    ]);
    
    const words = text.toLowerCase()
        .replace(/[^\w\sàèéìòù]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word));
    
    // Conta frequenza
    const freq = {};
    words.forEach(word => {
        freq[word] = (freq[word] || 0) + 1;
    });
    
    // Ritorna top keywords
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word]) => word);
}

/**
 * Identifica sezioni e capitoli
 */
function identifySections(text) {
    const sections = [];
    const patterns = [
        /^capitolo\s+\d+/gim,
        /^sezione\s+\d+/gim,
        /^\d+\.\d+\s+[A-Z]/gm,
        /^parte\s+[IVX]+/gim
    ];
    
    patterns.forEach(pattern => {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            sections.push({
                title: match[0],
                position: match.index
            });
        }
    });
    
    return sections.sort((a, b) => a.position - b.position);
}

/**
 * Crea chunks intelligenti
 */
function createSmartChunks(pages) {
    const chunks = [];
    let currentChunk = '';
    let currentPages = [];
    let chunkTopics = new Set();
    
    for (const page of pages) {
        const pageText = `\n[Pagina ${page.page}]\n${page.text}\n`;
        
        // Identifica topic della pagina
        const pageKeywords = extractKeywords(page.text);
        pageKeywords.forEach(kw => chunkTopics.add(kw));
        
        // Verifica se creare nuovo chunk
        if (currentChunk.length + pageText.length > CHUNK_SIZE && currentChunk.length > 0) {
            // Salva chunk corrente
            chunks.push({
                id: `chunk_${chunks.length}`,
                text: currentChunk.trim(),
                pages: [...currentPages],
                startPage: currentPages[0],
                endPage: currentPages[currentPages.length - 1],
                topics: Array.from(chunkTopics).slice(0, 10),
                keywords: extractKeywords(currentChunk),
                length: currentChunk.length
            });
            
            // Inizia nuovo chunk con overlap
            const overlapText = currentChunk.slice(-CHUNK_OVERLAP);
            currentChunk = overlapText + pageText;
            currentPages = [page.page];
            chunkTopics = new Set(pageKeywords);
        } else {
            currentChunk += pageText;
            currentPages.push(page.page);
        }
    }
    
    // Aggiungi ultimo chunk
    if (currentChunk.trim()) {
        chunks.push({
            id: `chunk_${chunks.length}`,
            text: currentChunk.trim(),
            pages: [...currentPages],
            startPage: currentPages[0],
            endPage: currentPages[currentPages.length - 1],
            topics: Array.from(chunkTopics).slice(0, 10),
            keywords: extractKeywords(currentChunk),
            length: currentChunk.length
        });
    }
    
    return chunks;
}

/**
 * Crea indice semantico avanzato
 */
function createSemanticIndex(chunks) {
    const index = {
        keywords: {},
        topics: {},
        pageToChunks: {},
        chunkRelations: {},
        statistics: {
            totalKeywords: 0,
            avgChunkSize: 0,
            topicDistribution: {}
        }
    };
    
    // Indicizza keywords
    chunks.forEach(chunk => {
        // Keywords
        chunk.keywords.forEach(keyword => {
            if (!index.keywords[keyword]) {
                index.keywords[keyword] = [];
            }
            index.keywords[keyword].push({
                chunkId: chunk.id,
                pages: chunk.pages,
                relevance: chunk.keywords.indexOf(keyword) + 1
            });
        });
        
        // Topics
        chunk.topics.forEach(topic => {
            if (!index.topics[topic]) {
                index.topics[topic] = [];
            }
            index.topics[topic].push(chunk.id);
            index.statistics.topicDistribution[topic] = 
                (index.statistics.topicDistribution[topic] || 0) + 1;
        });
        
        // Page mapping
        chunk.pages.forEach(page => {
            if (!index.pageToChunks[page]) {
                index.pageToChunks[page] = [];
            }
            index.pageToChunks[page].push(chunk.id);
        });
    });
    
    // Calcola statistiche
    index.statistics.totalKeywords = Object.keys(index.keywords).length;
    index.statistics.avgChunkSize = 
        chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length;
    
    // Trova chunks correlati (condividono keywords)
    chunks.forEach(chunk => {
        const related = new Map();
        
        chunk.keywords.forEach(keyword => {
            const relatedChunks = index.keywords[keyword] || [];
            relatedChunks.forEach(rc => {
                if (rc.chunkId !== chunk.id) {
                    related.set(rc.chunkId, (related.get(rc.chunkId) || 0) + 1);
                }
            });
        });
        
        // Salva top 5 chunks correlati
        index.chunkRelations[chunk.id] = Array.from(related.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, score]) => ({ id, score }));
    });
    
    return index;
}

/**
 * Main processing function
 */
async function processDocument() {
    console.log('🚀 Preprocessing avanzato del documento...\n');
    
    try {
        // Carica PDF
        console.log('📖 Caricamento PDF...');
        const pdfBuffer = await fs.readFile(INPUT_PDF);
        const pdfData = await pdfParse(pdfBuffer, {
            max: 0, // Tutte le pagine
            version: 'v2.0.550' // Versione stabile
        });
        
        console.log(`✅ PDF caricato: ${pdfData.numpages} pagine\n`);
        
        // Estrai testo per pagina
        console.log('📄 Estrazione e pulizia testo...');
        const pages = [];
        const pageTexts = pdfData.text.split(/\f/);
        
        let processedPages = 0;
        let totalChars = 0;
        
        for (let i = 0; i < pageTexts.length; i++) {
            const cleanedText = cleanText(pageTexts[i]);
            
            if (cleanedText.length > 50) { // Ignora pagine quasi vuote
                pages.push({
                    page: i + 1,
                    text: cleanedText,
                    length: cleanedText.length,
                    sections: identifySections(cleanedText)
                });
                totalChars += cleanedText.length;
                processedPages++;
            }
            
            if ((i + 1) % 100 === 0) {
                console.log(`  Processate ${i + 1}/${pageTexts.length} pagine...`);
            }
        }
        
        console.log(`✅ Estratte ${processedPages} pagine con contenuto significativo`);
        console.log(`   Caratteri totali: ${totalChars.toLocaleString()}\n`);
        
        // Crea chunks intelligenti
        console.log('🔪 Creazione chunks ottimizzati...');
        const chunks = createSmartChunks(pages);
        console.log(`✅ Creati ${chunks.length} chunks\n`);
        
        // Crea indice semantico
        console.log('🧠 Creazione indice semantico...');
        const semanticIndex = createSemanticIndex(chunks);
        console.log(`✅ Indicizzate ${semanticIndex.statistics.totalKeywords} keywords uniche`);
        console.log(`   Dimensione media chunk: ${Math.round(semanticIndex.statistics.avgChunkSize)} caratteri\n`);
        
        // Crea directory output
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        
        // Salva chunks
        console.log('💾 Salvataggio chunks...');
        const CHUNKS_PER_FILE = 50; // Ridotto per file più piccoli
        const numFiles = Math.ceil(chunks.length / CHUNKS_PER_FILE);
        
        for (let i = 0; i < numFiles; i++) {
            const start = i * CHUNKS_PER_FILE;
            const end = Math.min(start + CHUNKS_PER_FILE, chunks.length);
            const fileChunks = chunks.slice(start, end);
            
            // Rimuovi info non necessarie per ridurre dimensione
            const compactChunks = fileChunks.map(chunk => ({
                id: chunk.id,
                text: chunk.text,
                page: chunk.startPage, // Singola pagina principale
                pages: chunk.pages,
                keywords: chunk.keywords.slice(0, 5) // Solo top 5 keywords
            }));
            
            const filename = path.join(OUTPUT_DIR, `chunks_${i}.json`);
            await fs.writeFile(filename, JSON.stringify(compactChunks, null, 2));
            
            const stats = await fs.stat(filename);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            console.log(`  ✅ Salvato chunks_${i}.json (${fileChunks.length} chunks, ${sizeMB}MB)`);
        }
        
        // Salva metadata
        console.log('\n💾 Salvataggio metadata...');
        const metadata = {
            version: '3.0-text-only',
            processedAt: new Date().toISOString(),
            document: INPUT_PDF,
            stats: {
                totalPages: pdfData.numpages,
                pagesWithContent: processedPages,
                totalChunks: chunks.length,
                totalCharacters: totalChars,
                avgChunkSize: Math.round(semanticIndex.statistics.avgChunkSize),
                totalKeywords: semanticIndex.statistics.totalKeywords,
                chunksPerFile: CHUNKS_PER_FILE,
                totalFiles: numFiles
            },
            config: {
                chunkSize: CHUNK_SIZE,
                chunkOverlap: CHUNK_OVERLAP,
                minPageLength: 50
            },
            topTopics: Object.entries(semanticIndex.statistics.topicDistribution)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([topic, count]) => ({ topic, count }))
        };
        
        await fs.writeFile(
            path.join(OUTPUT_DIR, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );
        
        // Salva indice semantico (compresso)
        console.log('💾 Salvataggio indice semantico...');
        const compactIndex = {
            keywords: Object.fromEntries(
                Object.entries(semanticIndex.keywords)
                    .slice(0, 1000) // Limita a top 1000 keywords
                    .map(([k, v]) => [k, v.slice(0, 10)]) // Max 10 chunks per keyword
            ),
            pageToChunks: semanticIndex.pageToChunks,
            statistics: semanticIndex.statistics
        };
        
        await fs.writeFile(
            path.join(OUTPUT_DIR, 'search-index.json'),
            JSON.stringify(compactIndex, null, 2)
        );
        
        // Report finale
        console.log('\n' + '='.repeat(60));
        console.log('✅ PREPROCESSING COMPLETATO CON SUCCESSO!');
        console.log('='.repeat(60));
        console.log('\n📊 RIEPILOGO:');
        console.log(`  📄 Pagine totali: ${pdfData.numpages}`);
        console.log(`  📝 Pagine con contenuto: ${processedPages}`);
        console.log(`  📦 Chunks creati: ${chunks.length}`);
        console.log(`  🔑 Keywords indicizzate: ${semanticIndex.statistics.totalKeywords}`);
        console.log(`  💾 File generati: ${numFiles} file chunks + metadata + indice`);
        console.log(`  📁 Output directory: ${OUTPUT_DIR}\n`);
        
        console.log('🎯 TOP 10 ARGOMENTI IDENTIFICATI:');
        metadata.topTopics.slice(0, 10).forEach((topic, i) => {
            console.log(`  ${i + 1}. ${topic.topic} (${topic.count} occorrenze)`);
        });
        
    } catch (error) {
        console.error('❌ Errore durante il processing:', error);
        console.error(error.stack);
    }
}

// Esegui
if (require.main === module) {
    processDocument().catch(console.error);
}

module.exports = { processDocument };