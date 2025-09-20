// scripts/advanced-preprocess.js
// Preprocessing avanzato con analisi semantica - Versione stabile

const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');

// Configurazione
const CONFIG = {
    CHUNK_SIZE: 2000,
    CHUNK_OVERLAP: 300,
    MIN_WORD_LENGTH: 3,
    CHUNKS_PER_FILE: 50,
    MAX_INDEX_WORDS: 15000
};

// Pattern per riconoscimento strutture importanti
const PATTERNS = {
    definition: /(?:è|sono|significa|definisce|consiste|rappresenta|indica|chiamiamo|definiamo)/i,
    formula: /(?:[A-Za-z]+\s*=\s*[^,;.]+|\d+\s*[\+\-\*\/]\s*\d+)/,
    list: /(?:^\s*[\d\-\•]\s+|(?:primo|secondo|terzo|seguenti|inoltre))/im,
    important: /(?:importante|fondamentale|essenziale|chiave|principale|notare|ricorda|attenzione)/i,
    example: /(?:esempio|es\.|per esempio|come|tale che)/i,
    question: /(?:\?|come|quando|dove|perché|quale|quanto|cosa|chi)/i
};

/**
 * Preprocessing avanzato del PDF
 */
async function advancedPreprocess(pdfPath, outputDir) {
    console.log('🚀 Avvio preprocessing avanzato...');
    console.log(`📄 File: ${pdfPath}`);
    console.log(`📁 Output: ${outputDir}`);
    
    // Crea directory output
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Carica PDF
    const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    // Strutture dati principali
    const allChunks = [];
    const semanticIndex = {
        definitions: {},      // Termine -> definizione
        concepts: {},        // Concetto -> chunks correlati
        formulas: [],        // Formule trovate
        examples: [],        // Esempi
        important: [],       // Sezioni importanti
        questions: [],       // Domande trovate nel testo
        crossRefs: {}       // Collegamenti tra concetti
    };
    
    console.log(`📊 Pagine totali: ${pdf.numPages}`);
    
    // Processa ogni pagina
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Estrai testo completo della pagina
            const pageText = extractPageText(textContent.items);
            
            if (pageText.length > 50) {
                // Crea chunks intelligenti
                const pageChunks = createSmartChunks(pageText, pageNum);
                
                // Analizza ogni chunk
                for (const chunk of pageChunks) {
                    // Aggiungi analisi semantica
                    analyzeChunk(chunk, semanticIndex);
                    
                    // Aggiungi metadati
                    chunk.metadata = {
                        hasDefinition: PATTERNS.definition.test(chunk.text),
                        hasFormula: PATTERNS.formula.test(chunk.text),
                        hasList: PATTERNS.list.test(chunk.text),
                        hasExample: PATTERNS.example.test(chunk.text),
                        importance: calculateImportance(chunk.text),
                        keywords: extractKeywords(chunk.text)
                    };
                    
                    allChunks.push(chunk);
                }
            }
            
            // Progress
            if (pageNum % 50 === 0 || pageNum === pdf.numPages) {
                const progress = Math.round((pageNum / pdf.numPages) * 100);
                console.log(`⏳ Elaborazione: ${progress}% (${pageNum}/${pdf.numPages} pagine)`);
            }
            
        } catch (error) {
            console.warn(`⚠️ Errore pagina ${pageNum}: ${error.message}`);
        }
    }
    
    // Post-processing: crea collegamenti
    console.log('🔗 Creazione cross-references...');
    createCrossReferences(allChunks, semanticIndex);
    
    // Ottimizza indice
    console.log('📊 Ottimizzazione indice...');
    const optimizedIndex = optimizeIndex(semanticIndex, allChunks);
    
    // Salva tutti i dati
    console.log('💾 Salvataggio dati...');
    saveProcessedData(outputDir, {
        chunks: allChunks,
        semanticIndex,
        optimizedIndex,
        metadata: {
            version: '2.0',
            created: new Date().toISOString(),
            source: path.basename(pdfPath),
            totalPages: pdf.numPages,
            totalChunks: allChunks.length,
            config: CONFIG
        }
    });
    
    // Report finale
    console.log('\n✅ Preprocessing avanzato completato!');
    console.log(`📊 Statistiche:`);
    console.log(`  - Chunks creati: ${allChunks.length}`);
    console.log(`  - Definizioni trovate: ${Object.keys(semanticIndex.definitions).length}`);
    console.log(`  - Formule identificate: ${semanticIndex.formulas.length}`);
    console.log(`  - Esempi estratti: ${semanticIndex.examples.length}`);
    console.log(`  - Sezioni importanti: ${semanticIndex.important.length}`);
    console.log(`  - Concetti indicizzati: ${Object.keys(semanticIndex.concepts).length}`);
    
    return optimizedIndex;
}

/**
 * Estrae testo dalla pagina preservando struttura
 */
function extractPageText(items) {
    let text = '';
    let prevY = null;
    
    items.forEach(item => {
        const str = item.str.trim();
        if (!str) return;
        
        // Detecta cambio di linea
        if (prevY !== null && Math.abs(item.transform[5] - prevY) > 10) {
            text += '\n';
        }
        
        text += str + ' ';
        prevY = item.transform[5];
    });
    
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Crea chunks intelligenti basati su contenuto
 */
function createSmartChunks(text, pageNum) {
    const chunks = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    let currentChunk = '';
    let chunkStart = 0;
    
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        
        // Verifica se aggiungere la frase supera il limite
        if (currentChunk.length + sentence.length > CONFIG.CHUNK_SIZE) {
            // Salva chunk corrente se abbastanza lungo
            if (currentChunk.length > 100) {
                chunks.push({
                    id: `p${pageNum}_c${chunks.length}`,
                    page: pageNum,
                    text: currentChunk.trim(),
                    start: chunkStart,
                    end: chunkStart + currentChunk.length,
                    length: currentChunk.length
                });
                
                // Inizia nuovo chunk con overlap
                const overlapSentences = sentences.slice(Math.max(0, i - 2), i);
                currentChunk = overlapSentences.join(' ') + ' ' + sentence;
                chunkStart += currentChunk.length - CONFIG.CHUNK_OVERLAP;
            } else {
                currentChunk += ' ' + sentence;
            }
        } else {
            currentChunk += ' ' + sentence;
        }
    }
    
    // Aggiungi ultimo chunk
    if (currentChunk.length > 100) {
        chunks.push({
            id: `p${pageNum}_c${chunks.length}`,
            page: pageNum,
            text: currentChunk.trim(),
            start: chunkStart,
            end: chunkStart + currentChunk.length,
            length: currentChunk.length
        });
    }
    
    return chunks;
}

/**
 * Analizza semanticamente un chunk
 */
function analyzeChunk(chunk, index) {
    const text = chunk.text.toLowerCase();
    
    // Cerca definizioni
    if (PATTERNS.definition.test(text)) {
        const definitions = extractDefinitions(text);
        definitions.forEach(def => {
            if (def.term && def.definition) {
                index.definitions[def.term] = {
                    definition: def.definition,
                    chunkId: chunk.id,
                    page: chunk.page
                };
                
                // Aggiungi anche ai concetti
                if (!index.concepts[def.term]) {
                    index.concepts[def.term] = [];
                }
                index.concepts[def.term].push(chunk.id);
            }
        });
    }
    
    // Cerca formule
    if (PATTERNS.formula.test(text)) {
        const formulas = extractFormulas(text);
        formulas.forEach(formula => {
            index.formulas.push({
                formula: formula,
                chunkId: chunk.id,
                page: chunk.page
            });
        });
    }
    
    // Cerca esempi
    if (PATTERNS.example.test(text)) {
        index.examples.push({
            text: chunk.text.substring(0, 200) + '...',
            chunkId: chunk.id,
            page: chunk.page
        });
    }
    
    // Identifica sezioni importanti
    if (PATTERNS.important.test(text)) {
        const importance = calculateImportance(text);
        if (importance > 50) {
            index.important.push({
                text: chunk.text.substring(0, 200) + '...',
                chunkId: chunk.id,
                page: chunk.page,
                score: importance
            });
        }
    }
    
    // Cerca domande nel testo
    if (PATTERNS.question.test(text)) {
        const questions = extractQuestions(text);
        questions.forEach(q => {
            index.questions.push({
                question: q,
                chunkId: chunk.id,
                page: chunk.page
            });
        });
    }
}

/**
 * Estrae definizioni dal testo
 */
function extractDefinitions(text) {
    const definitions = [];
    
    // Pattern: "X è/sono Y"
    const patterns = [
        /(\w+(?:\s+\w+)*)\s+(?:è|sono)\s+([^.]+)\./gi,
        /si definisce\s+(\w+(?:\s+\w+)*)\s+([^.]+)\./gi,
        /chiamiamo\s+(\w+(?:\s+\w+)*)\s+([^.]+)\./gi
    ];
    
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            definitions.push({
                term: match[1].trim(),
                definition: match[2].trim()
            });
        }
    });
    
    return definitions;
}

/**
 * Estrae formule matematiche
 */
function extractFormulas(text) {
    const formulas = [];
    
    // Pattern per formule
    const formulaRegex = /([a-zA-Z]+\s*=\s*[^,;.]+)/g;
    let match;
    
    while ((match = formulaRegex.exec(text)) !== null) {
        formulas.push(match[1].trim());
    }
    
    return formulas;
}

/**
 * Estrae domande dal testo
 */
function extractQuestions(text) {
    const questions = [];
    const sentences = text.split(/[.!?]/);
    
    sentences.forEach(sentence => {
        if (sentence.includes('?') || 
            /^(come|quando|dove|perché|quale|quanto|cosa|chi)/i.test(sentence.trim())) {
            questions.push(sentence.trim() + '?');
        }
    });
    
    return questions;
}

/**
 * Calcola importanza del testo
 */
function calculateImportance(text) {
    let score = 0;
    const lower = text.toLowerCase();
    
    // Keywords importanti
    const keywords = {
        'importante': 15,
        'fondamentale': 15,
        'essenziale': 12,
        'chiave': 10,
        'principale': 10,
        'notare': 8,
        'ricorda': 8,
        'attenzione': 8,
        'definizione': 5,
        'formula': 5,
        'teorema': 10,
        'legge': 8,
        'principio': 8
    };
    
    Object.entries(keywords).forEach(([word, value]) => {
        if (lower.includes(word)) {
            score += value;
        }
    });
    
    // Presenza di liste
    if (/\d+[\.\)]/g.test(text)) score += 5;
    
    // Presenza di formule
    if (PATTERNS.formula.test(text)) score += 10;
    
    // Lunghezza (contenuti lunghi spesso importanti)
    score += Math.min(text.length / 200, 10);
    
    return Math.min(score, 100);
}

/**
 * Estrae keywords principali
 */
function extractKeywords(text) {
    // Rimuovi stopwords comuni
    const stopwords = ['il', 'la', 'di', 'da', 'un', 'una', 'che', 'e', 'è', 'in', 'con', 'per', 'tra', 'fra'];
    
    const words = text.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > CONFIG.MIN_WORD_LENGTH && !stopwords.includes(w));
    
    // Conta frequenze
    const freq = {};
    words.forEach(word => {
        freq[word] = (freq[word] || 0) + 1;
    });
    
    // Ritorna top keywords
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
}

/**
 * Crea cross-references tra chunks
 */
function createCrossReferences(chunks, index) {
    // Per ogni concetto, trova chunks correlati
    Object.keys(index.concepts).forEach(concept => {
        const relatedChunks = [];
        
        chunks.forEach(chunk => {
            if (chunk.text.toLowerCase().includes(concept.toLowerCase())) {
                relatedChunks.push(chunk.id);
            }
        });
        
        index.crossRefs[concept] = [...new Set(relatedChunks)];
    });
}

/**
 * Ottimizza l'indice per ricerche veloci
 */
function optimizeIndex(semanticIndex, chunks) {
    // Crea indice invertito per ricerca veloce
    const invertedIndex = {};
    
    chunks.forEach(chunk => {
        const keywords = chunk.metadata.keywords || [];
        keywords.forEach(keyword => {
            if (!invertedIndex[keyword]) {
                invertedIndex[keyword] = {
                    chunks: [],
                    frequency: 0,
                    importance: 0
                };
            }
            
            invertedIndex[keyword].chunks.push(chunk.id);
            invertedIndex[keyword].frequency++;
            invertedIndex[keyword].importance += chunk.metadata.importance || 0;
        });
    });
    
    // Ordina per rilevanza
    Object.keys(invertedIndex).forEach(keyword => {
        invertedIndex[keyword].chunks = [...new Set(invertedIndex[keyword].chunks)];
        invertedIndex[keyword].avgImportance = 
            invertedIndex[keyword].importance / invertedIndex[keyword].chunks.length;
    });
    
    return {
        invertedIndex,
        definitions: semanticIndex.definitions,
        concepts: semanticIndex.concepts,
        formulas: semanticIndex.formulas,
        examples: semanticIndex.examples,
        important: semanticIndex.important.sort((a, b) => b.score - a.score).slice(0, 100),
        questions: semanticIndex.questions
    };
}

/**
 * Salva i dati processati
 */
function saveProcessedData(outputDir, data) {
    // Salva metadata
    fs.writeFileSync(
        path.join(outputDir, 'metadata.json'),
        JSON.stringify(data.metadata, null, 2)
    );
    
    // Salva chunks in file multipli
    const { chunks } = data;
    for (let i = 0; i < chunks.length; i += CONFIG.CHUNKS_PER_FILE) {
        const batch = chunks.slice(i, i + CONFIG.CHUNKS_PER_FILE);
        const fileIndex = Math.floor(i / CONFIG.CHUNKS_PER_FILE);
        
        fs.writeFileSync(
            path.join(outputDir, `chunks_${fileIndex}.json`),
            JSON.stringify(batch, null, 2)
        );
    }
    
    // Salva indice semantico
    fs.writeFileSync(
        path.join(outputDir, 'semantic-index.json'),
        JSON.stringify(data.semanticIndex, null, 2)
    );
    
    // Salva indice ottimizzato
    fs.writeFileSync(
        path.join(outputDir, 'optimized-index.json'),
        JSON.stringify(data.optimizedIndex, null, 2)
    );
    
    // Crea search index per ricerca rapida
    const searchIndex = {
        version: '2.0',
        created: data.metadata.created,
        totalChunks: chunks.length,
        chunkLocations: {},
        topConcepts: Object.keys(data.semanticIndex.concepts).slice(0, 100)
    };
    
    // Mappa chunk locations
    chunks.forEach((chunk, idx) => {
        const fileIndex = Math.floor(idx / CONFIG.CHUNKS_PER_FILE);
        searchIndex.chunkLocations[chunk.id] = {
            file: `chunks_${fileIndex}.json`,
            index: idx % CONFIG.CHUNKS_PER_FILE
        };
    });
    
    fs.writeFileSync(
        path.join(outputDir, 'search-index.json'),
        JSON.stringify(searchIndex, null, 2)
    );
}

// Esecuzione
if (require.main === module) {
    const pdfPath = process.argv[2];
    const outputDir = process.argv[3] || path.join('data', 'processed-v2');
    
    if (!pdfPath) {
        console.log('Uso: node advanced-preprocess.js <pdf-path> [output-dir]');
        console.log('Esempio: node scripts/advanced-preprocess.js data/source/corso_completo.pdf data/processed-v2');
        process.exit(1);
    }
    
    if (!fs.existsSync(pdfPath)) {
        console.error(`❌ File non trovato: ${pdfPath}`);
        process.exit(1);
    }
    
    advancedPreprocess(pdfPath, outputDir)
        .then(() => {
            console.log('\n🎉 Processo completato con successo!');
            console.log(`📁 I file sono stati salvati in: ${outputDir}`);
        })
        .catch(error => {
            console.error('\n❌ Errore:', error);
            process.exit(1);
        });
}

module.exports = { advancedPreprocess };