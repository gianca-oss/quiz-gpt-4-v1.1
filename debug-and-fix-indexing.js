// debug-and-fix-indexing.js
// Script per verificare e correggere l'indicizzazione dei dati

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Configurazione
const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        environment: 'us-east-1', // Cambia con il tuo environment
        indexName: 'quiz-course-v4-vision'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY
    },
    dataPath: './data/processed-v4'
};

// Colori per console
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, type = 'info') {
    const colorMap = {
        error: colors.red,
        success: colors.green,
        warning: colors.yellow,
        info: colors.cyan,
        debug: colors.magenta
    };
    console.log(`${colorMap[type]}[${type.toUpperCase()}]${colors.reset} ${message}`);
}

// ============ STEP 1: VERIFICA CONFIGURAZIONE ============
async function verifyConfiguration() {
    log('═══════════════════════════════════════', 'info');
    log('    VERIFICA CONFIGURAZIONE', 'info');
    log('═══════════════════════════════════════', 'info');

    const issues = [];

    // Verifica API Keys
    if (!process.env.PINECONE_API_KEY) {
        issues.push('❌ PINECONE_API_KEY mancante nel file .env');
    } else {
        log('✅ PINECONE_API_KEY trovata', 'success');
    }

    if (!process.env.OPENAI_API_KEY) {
        issues.push('❌ OPENAI_API_KEY mancante nel file .env');
    } else {
        log('✅ OPENAI_API_KEY trovata', 'success');
    }

    // Verifica cartella dati
    try {
        const dataExists = await fs.stat(CONFIG.dataPath).then(() => true).catch(() => false);
        if (!dataExists) {
            await fs.mkdir(CONFIG.dataPath, { recursive: true });
            log(`📁 Creata cartella ${CONFIG.dataPath}`, 'warning');
        } else {
            log(`✅ Cartella ${CONFIG.dataPath} esistente`, 'success');
        }
    } catch (error) {
        issues.push(`❌ Errore verifica cartella dati: ${error.message}`);
    }

    if (issues.length > 0) {
        log('\n⚠️  PROBLEMI TROVATI:', 'error');
        issues.forEach(issue => log(issue, 'error'));
        log('\nCorreggili prima di continuare!', 'warning');
        process.exit(1);
    }

    log('\n✅ Configurazione verificata con successo!', 'success');
    return true;
}

// ============ STEP 2: VERIFICA/CREA INDEX PINECONE ============
async function setupPinecone() {
    log('\n═══════════════════════════════════════', 'info');
    log('    SETUP PINECONE', 'info');
    log('═══════════════════════════════════════', 'info');

    try {
        const pc = new Pinecone({ 
            apiKey: CONFIG.pinecone.apiKey
        });

        // Lista gli indici esistenti
        const indexes = await pc.listIndexes();
        log(`📊 Indici esistenti: ${indexes.indexes?.map(idx => idx.name).join(', ') || 'nessuno'}`, 'info');

        // Verifica se l'indice esiste
        const indexExists = indexes.indexes?.some(idx => idx.name === CONFIG.pinecone.indexName);

        if (!indexExists) {
            log(`📝 Creazione nuovo indice: ${CONFIG.pinecone.indexName}`, 'warning');
            
            await pc.createIndex({
                name: CONFIG.pinecone.indexName,
                dimension: 1536, // dimensione per text-embedding-3-small
                metric: 'cosine',
                spec: {
                    serverless: {
                        cloud: 'aws',
                        region: 'us-east-1'
                    }
                }
            });

            // Attendi che l'indice sia pronto
            log('⏳ Attesa creazione indice (può richiedere 1-2 minuti)...', 'info');
            let ready = false;
            while (!ready) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                const description = await pc.describeIndex(CONFIG.pinecone.indexName);
                ready = description.status?.ready;
                if (!ready) {
                    process.stdout.write('.');
                }
            }
            log('\n✅ Indice creato con successo!', 'success');
        } else {
            log(`✅ Indice ${CONFIG.pinecone.indexName} già esistente`, 'success');
        }

        // Ottieni statistiche dell'indice
        const index = pc.index(CONFIG.pinecone.indexName);
        const stats = await index.describeIndexStats();
        log(`📈 Statistiche indice:`, 'info');
        log(`   - Vettori totali: ${stats.totalVectorCount || 0}`, 'info');
        log(`   - Dimensione: ${stats.dimension || 1536}`, 'info');

        return index;
    } catch (error) {
        log(`❌ Errore setup Pinecone: ${error.message}`, 'error');
        throw error;
    }
}

// ============ STEP 3: CARICA DATI DAL PDF PROCESSATO ============
async function loadProcessedData() {
    log('\n═══════════════════════════════════════', 'info');
    log('    CARICAMENTO DATI', 'info');
    log('═══════════════════════════════════════', 'info');

    try {
        // Cerca file JSON nella cartella processed-v3 (fallback)
        const v3Path = './data/processed-v3';
        const v3Exists = await fs.stat(v3Path).then(() => true).catch(() => false);
        
        if (v3Exists) {
            log(`📁 Trovata cartella ${v3Path}`, 'info');
            
            const chunks = [];
            // Carica tutti i file chunks_*.json
            for (let i = 0; i < 10; i++) {
                const chunkFile = path.join(v3Path, `chunks_${i}.json`);
                try {
                    const fileData = await fs.readFile(chunkFile, 'utf-8');
                    const fileChunks = JSON.parse(fileData);
                    chunks.push(...fileChunks);
                    log(`   ✅ Caricato chunks_${i}.json: ${fileChunks.length} chunks`, 'success');
                } catch (err) {
                    if (i === 0) {
                        log(`   ⚠️ Nessun file chunks trovato in ${v3Path}`, 'warning');
                    }
                    break;
                }
            }
            
            if (chunks.length > 0) {
                log(`\n📊 Totale chunks caricati: ${chunks.length}`, 'info');
                return chunks;
            }
        }

        // Se non ci sono dati, crea dati di esempio
        log('⚠️ Nessun dato esistente trovato. Creazione dati di esempio...', 'warning');
        return createSampleData();

    } catch (error) {
        log(`❌ Errore caricamento dati: ${error.message}`, 'error');
        throw error;
    }
}

// ============ STEP 4: GENERA EMBEDDINGS ============
async function generateEmbeddings(chunks, batchSize = 50) {
    log('\n═══════════════════════════════════════', 'info');
    log('    GENERAZIONE EMBEDDINGS', 'info');
    log('═══════════════════════════════════════', 'info');

    const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });
    const vectors = [];

    log(`🔄 Processing ${chunks.length} chunks in batches of ${batchSize}...`, 'info');

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(chunks.length / batchSize);
        
        log(`   Batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`, 'debug');

        try {
            // Genera embeddings per il batch
            const texts = batch.map(chunk => chunk.text || chunk.content || '');
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: texts
            });

            // Crea vettori per Pinecone
            for (let j = 0; j < batch.length; j++) {
                const chunk = batch[j];
                const embedding = response.data[j].embedding;
                
                vectors.push({
                    id: `chunk_${i + j}`,
                    values: embedding,
                    metadata: {
                        text: chunk.text || chunk.content || '',
                        page: chunk.page || (i + j),
                        source: chunk.source || 'document',
                        type: chunk.type || 'text'
                    }
                });
            }

            // Piccola pausa per evitare rate limiting
            if (i + batchSize < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

        } catch (error) {
            log(`   ❌ Errore batch ${batchNum}: ${error.message}`, 'error');
            // Continua con il prossimo batch
        }
    }

    log(`✅ Generati ${vectors.length} embeddings`, 'success');
    return vectors;
}

// ============ STEP 5: CARICA SU PINECONE ============
async function uploadToPinecone(index, vectors, batchSize = 100) {
    log('\n═══════════════════════════════════════', 'info');
    log('    CARICAMENTO SU PINECONE', 'info');
    log('═══════════════════════════════════════', 'info');

    let uploaded = 0;

    for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, Math.min(i + batchSize, vectors.length));
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(vectors.length / batchSize);
        
        try {
            await index.upsert(batch);
            uploaded += batch.length;
            log(`   ✅ Batch ${batchNum}/${totalBatches} caricato (${uploaded}/${vectors.length} vettori)`, 'success');
        } catch (error) {
            log(`   ❌ Errore batch ${batchNum}: ${error.message}`, 'error');
        }
    }

    log(`\n✅ Caricamento completato: ${uploaded}/${vectors.length} vettori`, 'success');
    return uploaded;
}

// ============ STEP 6: SALVA METADATA LOCALE ============
async function saveMetadata(chunks, vectors) {
    log('\n═══════════════════════════════════════', 'info');
    log('    SALVATAGGIO METADATA', 'info');
    log('═══════════════════════════════════════', 'info');

    const metadata = {
        version: '4.0',
        timestamp: new Date().toISOString(),
        chunks_count: chunks.length,
        vectors_count: vectors.length,
        index_name: CONFIG.pinecone.indexName,
        embedding_model: 'text-embedding-3-small'
    };

    try {
        await fs.writeFile(
            path.join(CONFIG.dataPath, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );
        log('✅ Metadata salvati', 'success');

        // Salva anche una copia di backup dei chunks
        await fs.writeFile(
            path.join(CONFIG.dataPath, 'chunks_backup.json'),
            JSON.stringify(chunks.slice(0, 100), null, 2) // Solo primi 100 per backup
        );
        log('✅ Backup chunks salvato', 'success');

    } catch (error) {
        log(`⚠️ Errore salvataggio metadata: ${error.message}`, 'warning');
    }
}

// ============ FUNZIONE DI TEST QUERY ============
async function testQuery(index, query = "Quali sono le principali teorie dell'apprendimento?") {
    log('\n═══════════════════════════════════════', 'info');
    log('    TEST QUERY', 'info');
    log('═══════════════════════════════════════', 'info');

    try {
        const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });
        
        // Genera embedding per la query
        log(`📝 Query: "${query}"`, 'info');
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query
        });

        // Cerca nell'indice
        const results = await index.query({
            vector: response.data[0].embedding,
            topK: 5,
            includeMetadata: true
        });

        if (results.matches && results.matches.length > 0) {
            log('\n🔍 Risultati trovati:', 'success');
            results.matches.forEach((match, idx) => {
                log(`\n   ${idx + 1}. Score: ${match.score.toFixed(3)}`, 'info');
                const text = match.metadata?.text || '';
                log(`      Testo: ${text.substring(0, 100)}...`, 'debug');
            });
        } else {
            log('⚠️ Nessun risultato trovato', 'warning');
        }

    } catch (error) {
        log(`❌ Errore test query: ${error.message}`, 'error');
    }
}

// ============ FUNZIONE PER CREARE DATI DI ESEMPIO ============
function createSampleData() {
    log('📝 Creazione dati di esempio per test...', 'info');
    
    return [
        {
            text: "Le teorie dell'apprendimento principali includono il comportamentismo, il cognitivismo e il costruttivismo. Il comportamentismo si concentra sui comportamenti osservabili.",
            page: 1,
            type: 'text'
        },
        {
            text: "La pedagogia moderna enfatizza l'importanza dell'apprendimento attivo e del coinvolgimento degli studenti nel processo educativo.",
            page: 2,
            type: 'text'
        },
        {
            text: "La valutazione formativa è un processo continuo che fornisce feedback agli studenti durante l'apprendimento, non solo alla fine.",
            page: 3,
            type: 'text'
        },
        {
            text: "Le tecnologie digitali hanno trasformato l'educazione, permettendo nuove modalità di insegnamento e apprendimento online.",
            page: 4,
            type: 'text'
        },
        {
            text: "L'intelligenza multipla di Gardner suggerisce che esistono diversi tipi di intelligenza: linguistica, logico-matematica, spaziale, musicale, corporeo-cinestetica, interpersonale, intrapersonale e naturalistica.",
            page: 5,
            type: 'text'
        }
    ];
}

// ============ MAIN EXECUTION ============
async function main() {
    console.clear();
    log('╔════════════════════════════════════════════╗', 'info');
    log('║     DEBUG & FIX INDEXING SCRIPT V1.0       ║', 'info');
    log('╚════════════════════════════════════════════╝', 'info');

    try {
        // Step 1: Verifica configurazione
        await verifyConfiguration();

        // Step 2: Setup Pinecone
        const index = await setupPinecone();

        // Step 3: Carica dati
        const chunks = await loadProcessedData();

        if (chunks.length === 0) {
            log('❌ Nessun dato da indicizzare', 'error');
            return;
        }

        // Step 4: Genera embeddings
        const vectors = await generateEmbeddings(chunks);

        // Step 5: Carica su Pinecone
        const uploaded = await uploadToPinecone(index, vectors);

        // Step 6: Salva metadata
        await saveMetadata(chunks, vectors);

        // Step 7: Test query
        await testQuery(index);

        // Statistiche finali
        log('\n╔════════════════════════════════════════════╗', 'success');
        log('║            INDICIZZAZIONE COMPLETATA        ║', 'success');
        log('╚════════════════════════════════════════════╝', 'success');
        log('\n📊 STATISTICHE FINALI:', 'info');
        log('━━━━━━━━━━━━━━━━━━━━━', 'info');
        log(`  📝 Chunks processati: ${chunks.length}`, 'info');
        log(`  🧩 Vettori generati: ${vectors.length}`, 'info');
        log(`  ☁️  Vettori caricati: ${uploaded}`, 'info');
        log(`  📁 Dati salvati in: ${CONFIG.dataPath}`, 'info');
        log('\n✨ Il database vettoriale è pronto per il RAG!', 'success');

    } catch (error) {
        log(`\n❌ ERRORE CRITICO: ${error.message}`, 'error');
        console.error(error.stack);
        process.exit(1);
    }
}

// Esegui il main
main().catch(console.error);