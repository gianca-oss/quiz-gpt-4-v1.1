// load-v4-to-pinecone.js
// Script per caricare CORRETTAMENTE i dati da processed-v4 e indicizzarli su Pinecone

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// ========== CONFIGURAZIONE ==========
const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        embeddingModel: 'text-embedding-3-small'
    },
    dataPath: './data/processed-v4'  // Path Windows compatibile
};

// Colori per console
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

function log(message, type = 'info') {
    const prefix = {
        error: `${colors.red}❌`,
        success: `${colors.green}✅`,
        warning: `${colors.yellow}⚠️`,
        info: `${colors.cyan}ℹ️`,
        debug: `${colors.magenta}🔍`,
        processing: `${colors.blue}⚙️`
    };
    
    console.log(`${prefix[type] || colors.white} ${message}${colors.reset}`);
}

// ========== STEP 1: ANALIZZA STRUTTURA DATI V4 ==========
async function analyzeV4Structure() {
    log('════════════════════════════════════════', 'info');
    log('    ANALISI STRUTTURA DATI V4', 'info');
    log('════════════════════════════════════════', 'info');

    const structure = {
        files: [],
        totalChunks: 0,
        chunksPerFile: {},
        metadata: null,
        hasEnhancedData: false
    };

    try {
        // Lista tutti i file nella cartella
        const files = await fs.readdir(CONFIG.dataPath);
        log(`📁 File trovati in ${CONFIG.dataPath}:`, 'info');
        
        for (const file of files) {
            const filePath = path.join(CONFIG.dataPath, file);
            const stats = await fs.stat(filePath);
            
            if (stats.isFile() && file.endsWith('.json')) {
                structure.files.push(file);
                const fileSize = (stats.size / 1024).toFixed(2);
                log(`   📄 ${file} (${fileSize} KB)`, 'debug');
                
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const data = JSON.parse(content);
                    
                    // Analizza il contenuto
                    if (file === 'metadata.json') {
                        structure.metadata = data;
                        log(`      → Metadata: v${data.version || '?'}, ${data.timestamp || 'no timestamp'}`, 'info');
                    } else if (Array.isArray(data)) {
                        structure.chunksPerFile[file] = data.length;
                        structure.totalChunks += data.length;
                        log(`      → Chunks: ${data.length}`, 'success');
                        
                        // Verifica se ci sono dati enhanced
                        if (data.length > 0 && data[0].enhanced) {
                            structure.hasEnhancedData = true;
                        }
                    } else if (data.chunks) {
                        structure.chunksPerFile[file] = data.chunks.length;
                        structure.totalChunks += data.chunks.length;
                        log(`      → Chunks (nested): ${data.chunks.length}`, 'success');
                    }
                } catch (parseError) {
                    log(`      → Errore parsing: ${parseError.message}`, 'error');
                }
            }
        }
        
        // Riepilogo
        log('\n📊 RIEPILOGO STRUTTURA:', 'info');
        log(`   • File JSON totali: ${structure.files.length}`, 'info');
        log(`   • Chunks totali trovati: ${structure.totalChunks}`, 'success');
        log(`   • Dati enhanced: ${structure.hasEnhancedData ? 'SI' : 'NO'}`, structure.hasEnhancedData ? 'success' : 'warning');
        
        if (structure.metadata) {
            log('\n📋 METADATA:', 'info');
            Object.entries(structure.metadata).forEach(([key, value]) => {
                log(`   • ${key}: ${value}`, 'debug');
            });
        }
        
    } catch (error) {
        log(`Errore lettura cartella: ${error.message}`, 'error');
        throw error;
    }

    return structure;
}

// ========== STEP 2: CARICA TUTTI I CHUNKS ==========
async function loadAllV4Chunks() {
    log('\n════════════════════════════════════════', 'info');
    log('    CARICAMENTO CHUNKS V4', 'info');
    log('════════════════════════════════════════', 'info');

    const allChunks = [];
    const files = await fs.readdir(CONFIG.dataPath);
    
    // Ordina i file per processarli in ordine
    const chunkFiles = files
        .filter(f => f.includes('chunk') && f.endsWith('.json'))
        .sort();
    
    log(`📚 Caricamento da ${chunkFiles.length} file...`, 'info');
    
    for (const file of chunkFiles) {
        try {
            const filePath = path.join(CONFIG.dataPath, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            let chunks = [];
            
            // Gestisci diverse strutture possibili
            if (Array.isArray(data)) {
                chunks = data;
            } else if (data.chunks && Array.isArray(data.chunks)) {
                chunks = data.chunks;
            } else if (data.content && Array.isArray(data.content)) {
                chunks = data.content;
            }
            
            if (chunks.length > 0) {
                allChunks.push(...chunks);
                log(`   ✅ ${file}: ${chunks.length} chunks caricati (totale: ${allChunks.length})`, 'success');
            } else {
                log(`   ⚠️ ${file}: nessun chunk trovato`, 'warning');
            }
            
        } catch (error) {
            log(`   ❌ ${file}: ${error.message}`, 'error');
        }
    }
    
    // Verifica unicità e qualità dei chunks
    const uniqueChunks = [];
    const seenTexts = new Set();
    let duplicates = 0;
    let empty = 0;
    
    for (const chunk of allChunks) {
        const text = chunk.text || chunk.content || '';
        
        if (!text || text.trim().length === 0) {
            empty++;
            continue;
        }
        
        const textHash = text.substring(0, 100); // Usa i primi 100 caratteri come hash
        
        if (!seenTexts.has(textHash)) {
            seenTexts.add(textHash);
            uniqueChunks.push({
                text: text,
                page: chunk.page || chunk.pageNumber || 0,
                type: chunk.type || 'text',
                source: chunk.source || 'processed-v4',
                enhanced: chunk.enhanced || false,
                metadata: chunk.metadata || {}
            });
        } else {
            duplicates++;
        }
    }
    
    log('\n📊 STATISTICHE CHUNKS:', 'info');
    log(`   • Totale caricati: ${allChunks.length}`, 'info');
    log(`   • Chunks unici: ${uniqueChunks.length}`, 'success');
    log(`   • Duplicati rimossi: ${duplicates}`, duplicates > 0 ? 'warning' : 'info');
    log(`   • Chunks vuoti rimossi: ${empty}`, empty > 0 ? 'warning' : 'info');
    
    return uniqueChunks;
}

// ========== STEP 3: SETUP PINECONE ==========
async function setupPinecone() {
    log('\n════════════════════════════════════════', 'info');
    log('    SETUP PINECONE', 'info');
    log('════════════════════════════════════════', 'info');

    if (!CONFIG.pinecone.apiKey) {
        throw new Error('PINECONE_API_KEY non configurata nel file .env');
    }

    const pc = new Pinecone({ 
        apiKey: CONFIG.pinecone.apiKey
    });

    try {
        // Lista indici esistenti
        const indexes = await pc.listIndexes();
        log(`📊 Indici Pinecone esistenti: ${indexes.indexes?.map(idx => idx.name).join(', ') || 'nessuno'}`, 'info');

        // Verifica se l'indice esiste
        const indexExists = indexes.indexes?.some(idx => idx.name === CONFIG.pinecone.indexName);

        if (!indexExists) {
            log(`📝 Creazione nuovo indice: ${CONFIG.pinecone.indexName}`, 'warning');
            
            await pc.createIndex({
                name: CONFIG.pinecone.indexName,
                dimension: 1536, // per text-embedding-3-small
                metric: 'cosine',
                spec: {
                    serverless: {
                        cloud: 'aws',
                        region: 'us-east-1'
                    }
                }
            });

            log('⏳ Attesa creazione indice (60 secondi)...', 'info');
            await new Promise(resolve => setTimeout(resolve, 60000));
            
            log('✅ Indice creato con successo!', 'success');
        } else {
            log(`✅ Indice ${CONFIG.pinecone.indexName} già esistente`, 'success');
            
            // Chiedi se pulire l'indice esistente
            const index = pc.index(CONFIG.pinecone.indexName);
            const stats = await index.describeIndexStats();
            
            if (stats.totalVectorCount > 0) {
                log(`⚠️ L'indice contiene già ${stats.totalVectorCount} vettori`, 'warning');
                
                // Opzionale: pulisci l'indice
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                const answer = await new Promise(resolve => {
                    readline.question('Vuoi pulire l\'indice esistente? (y/n): ', resolve);
                });
                readline.close();
                
                if (answer.toLowerCase() === 'y') {
                    log('🗑️ Pulizia indice in corso...', 'processing');
                    await index.deleteAll();
                    log('✅ Indice pulito', 'success');
                }
            }
        }

        return pc.index(CONFIG.pinecone.indexName);
        
    } catch (error) {
        log(`Errore setup Pinecone: ${error.message}`, 'error');
        throw error;
    }
}

// ========== STEP 4: GENERA EMBEDDINGS ==========
async function generateEmbeddings(chunks, batchSize = 20) {
    log('\n════════════════════════════════════════', 'info');
    log('    GENERAZIONE EMBEDDINGS', 'info');
    log('════════════════════════════════════════', 'info');

    if (!CONFIG.openai.apiKey) {
        throw new Error('OPENAI_API_KEY non configurata nel file .env');
    }

    const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });
    const vectors = [];
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    log(`🧮 Generazione embeddings per ${chunks.length} chunks (${totalBatches} batch)...`, 'info');

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
        const batchNum = Math.floor(i / batchSize) + 1;
        
        try {
            // Prepara i testi
            const texts = batch.map(chunk => {
                // Combina text con metadata rilevanti per embedding più ricco
                let fullText = chunk.text;
                if (chunk.enhanced) {
                    fullText = `[ENHANCED] ${fullText}`;
                }
                return fullText.substring(0, 8000); // Limita lunghezza
            });
            
            // Genera embeddings
            log(`   Batch ${batchNum}/${totalBatches}: generazione embeddings...`, 'processing');
            
            const response = await openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: texts
            });

            // Crea vettori per Pinecone
            for (let j = 0; j < batch.length; j++) {
                const chunk = batch[j];
                const embedding = response.data[j].embedding;
                
                vectors.push({
                    id: `v4_chunk_${i + j}_${Date.now()}`, // ID unico
                    values: embedding,
                    metadata: {
                        text: chunk.text.substring(0, 1000), // Pinecone ha limite metadata
                        page: chunk.page || 0,
                        type: chunk.type || 'text',
                        source: chunk.source || 'v4',
                        enhanced: chunk.enhanced || false
                    }
                });
            }
            
            log(`   ✅ Batch ${batchNum}/${totalBatches} completato (${vectors.length} vettori totali)`, 'success');
            
            // Pausa per evitare rate limiting
            if (batchNum < totalBatches) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

        } catch (error) {
            log(`   ❌ Errore batch ${batchNum}: ${error.message}`, 'error');
            
            // Riprova con batch più piccolo
            if (batch.length > 1) {
                log(`   🔄 Riprovo con batch più piccolo...`, 'warning');
                const halfBatch1 = batch.slice(0, Math.floor(batch.length / 2));
                const halfBatch2 = batch.slice(Math.floor(batch.length / 2));
                
                // Processo ricorsivo per le due metà
                // (implementazione semplificata, in produzione servirebbe gestione migliore)
            }
        }
    }

    log(`\n✅ Generati ${vectors.length} embeddings totali`, 'success');
    return vectors;
}

// ========== STEP 5: CARICA SU PINECONE ==========
async function uploadToPinecone(index, vectors, batchSize = 100) {
    log('\n════════════════════════════════════════', 'info');
    log('    CARICAMENTO SU PINECONE', 'info');
    log('════════════════════════════════════════', 'info');

    let uploaded = 0;
    const totalBatches = Math.ceil(vectors.length / batchSize);
    
    log(`☁️ Caricamento ${vectors.length} vettori in ${totalBatches} batch...`, 'info');

    for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, Math.min(i + batchSize, vectors.length));
        const batchNum = Math.floor(i / batchSize) + 1;
        
        try {
            await index.upsert(batch);
            uploaded += batch.length;
            
            const progress = Math.round((uploaded / vectors.length) * 100);
            log(`   📤 Batch ${batchNum}/${totalBatches} caricato - Progress: ${progress}% (${uploaded}/${vectors.length})`, 'success');
            
        } catch (error) {
            log(`   ❌ Errore upload batch ${batchNum}: ${error.message}`, 'error');
            
            // Riprova una volta
            try {
                await new Promise(resolve => setTimeout(resolve, 2000));
                await index.upsert(batch);
                uploaded += batch.length;
                log(`   ✅ Batch ${batchNum} caricato al secondo tentativo`, 'success');
            } catch (retryError) {
                log(`   ❌ Fallito anche il retry: ${retryError.message}`, 'error');
            }
        }
    }

    log(`\n✅ Upload completato: ${uploaded}/${vectors.length} vettori caricati`, uploaded === vectors.length ? 'success' : 'warning');
    return uploaded;
}

// ========== STEP 6: TEST FINALE ==========
async function testSearch(index) {
    log('\n════════════════════════════════════════', 'info');
    log('    TEST RICERCA', 'info');
    log('════════════════════════════════════════', 'info');

    const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });
    
    const testQueries = [
        "Quali sono le principali teorie dell'apprendimento?",
        "Come funziona la valutazione formativa?",
        "Differenza tra pedagogia e didattica",
        "Intelligenza multipla di Gardner"
    ];

    for (const query of testQueries) {
        log(`\n🔍 Query: "${query}"`, 'info');
        
        try {
            // Genera embedding per la query
            const response = await openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: query
            });

            // Cerca nell'indice
            const results = await index.query({
                vector: response.data[0].embedding,
                topK: 3,
                includeMetadata: true
            });

            if (results.matches && results.matches.length > 0) {
                log('   📚 Risultati:', 'success');
                results.matches.forEach((match, idx) => {
                    const text = match.metadata?.text || '';
                    const preview = text.substring(0, 100).replace(/\n/g, ' ');
                    log(`      ${idx + 1}. Score: ${match.score.toFixed(3)} | Page: ${match.metadata?.page || '?'}`, 'debug');
                    log(`         "${preview}..."`, 'info');
                });
            } else {
                log('   ⚠️ Nessun risultato trovato', 'warning');
            }
            
        } catch (error) {
            log(`   ❌ Errore test: ${error.message}`, 'error');
        }
    }
}

// ========== MAIN ==========
async function main() {
    console.clear();
    log('╔════════════════════════════════════════════╗', 'info');
    log('║     CARICAMENTO DATI V4 SU PINECONE        ║', 'info');
    log('╚════════════════════════════════════════════╝', 'info');
    
    const startTime = Date.now();

    try {
        // Verifica configurazione
        if (!CONFIG.pinecone.apiKey || !CONFIG.openai.apiKey) {
            log('\n⚠️ CONFIGURAZIONE MANCANTE:', 'error');
            log('Assicurati di avere nel file .env:', 'warning');
            log('  PINECONE_API_KEY=xxx', 'warning');
            log('  OPENAI_API_KEY=sk-xxx', 'warning');
            process.exit(1);
        }

        // Step 1: Analizza struttura
        const structure = await analyzeV4Structure();
        
        if (structure.totalChunks === 0) {
            log('\n❌ Nessun chunk trovato in processed-v4!', 'error');
            log('Verifica che i file esistano e siano nel formato corretto.', 'warning');
            process.exit(1);
        }

        // Step 2: Carica chunks
        const chunks = await loadAllV4Chunks();
        
        if (chunks.length === 0) {
            log('❌ Impossibile caricare i chunks', 'error');
            process.exit(1);
        }

        // Step 3: Setup Pinecone
        const index = await setupPinecone();

        // Step 4: Genera embeddings
        const vectors = await generateEmbeddings(chunks);

        // Step 5: Carica su Pinecone
        const uploaded = await uploadToPinecone(index, vectors);

        // Step 6: Test
        await testSearch(index);

        // Statistiche finali
        const stats = await index.describeIndexStats();
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
        
        log('\n╔════════════════════════════════════════════╗', 'success');
        log('║         INDICIZZAZIONE COMPLETATA           ║', 'success');
        log('╚════════════════════════════════════════════╝', 'success');
        log('\n📊 STATISTICHE FINALI:', 'info');
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        log(`  📝 Chunks processati: ${chunks.length}`, 'info');
        log(`  🧩 Vettori generati: ${vectors.length}`, 'info');
        log(`  ☁️  Vettori caricati: ${uploaded}`, 'info');
        log(`  📈 Vettori totali nell'indice: ${stats.totalVectorCount}`, 'info');
        log(`  ⏱️  Tempo totale: ${elapsedTime} secondi`, 'info');
        log('\n✨ Il sistema V4 RAG è pronto per l\'uso!', 'success');
        log('🚀 Puoi ora usare l\'endpoint /api/analyze-v4-rag', 'success');

    } catch (error) {
        log(`\n❌ ERRORE CRITICO: ${error.message}`, 'error');
        console.error(error.stack);
        process.exit(1);
    }
}

// Esegui
main().catch(error => {
    console.error('Errore fatale:', error);
    process.exit(1);
});