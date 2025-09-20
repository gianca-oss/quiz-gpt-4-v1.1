// scripts/upload-to-pinecone.js
// Script per caricare i dati processati da GPT-4 Vision in Pinecone

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Carica variabili d'ambiente
dotenv.config();

const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision',
        dimension: 1536 // Dimensione per text-embedding-3-small
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        embeddingModel: 'text-embedding-3-small'
    }
};

// Inizializza client
const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });

// Funzione per creare l'indice se non esiste
async function createIndexIfNeeded() {
    try {
        const indexes = await pc.listIndexes();
        const indexExists = indexes.indexes?.some(idx => idx.name === CONFIG.pinecone.indexName);
        
        if (!indexExists) {
            console.log(`📝 Creazione indice ${CONFIG.pinecone.indexName}...`);
            await pc.createIndex({
                name: CONFIG.pinecone.indexName,
                dimension: CONFIG.pinecone.dimension,
                metric: 'cosine',
                spec: {
                    serverless: {
                        cloud: 'aws',
                        region: 'us-east-1'
                    }
                }
            });
            
            // Attendi che l'indice sia pronto
            console.log('⏳ Attesa creazione indice...');
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30 secondi
        } else {
            console.log(`✅ Indice ${CONFIG.pinecone.indexName} già esistente`);
        }
        
        return pc.index(CONFIG.pinecone.indexName);
    } catch (error) {
        console.error('❌ Errore creazione indice:', error);
        throw error;
    }
}

// Funzione per generare embedding
async function generateEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: CONFIG.openai.embeddingModel,
            input: text
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error('❌ Errore generazione embedding:', error);
        return null;
    }
}

// Funzione per processare un chunk
async function processChunk(chunk, sourceFile, chunkIndex, totalChunks) {
    try {
        // Crea un ID univoco per il chunk
        const chunkId = `${sourceFile}_chunk_${chunkIndex}`;
        
        // Prepara il testo per l'embedding
        let textContent = '';
        if (chunk.text) {
            textContent = chunk.text;
        } else if (chunk.content) {
            textContent = chunk.content;
        } else if (typeof chunk === 'string') {
            textContent = chunk;
        }
        
        if (!textContent || textContent.length < 10) {
            console.log(`⚠️ Chunk ${chunkIndex} vuoto o troppo corto, saltato`);
            return null;
        }
        
        // Genera embedding
        console.log(`🔄 Generazione embedding per chunk ${chunkIndex + 1}/${totalChunks}...`);
        const embedding = await generateEmbedding(textContent);
        
        if (!embedding) {
            console.log(`⚠️ Impossibile generare embedding per chunk ${chunkIndex}`);
            return null;
        }
        
        // Prepara metadata
        const metadata = {
            text: textContent.substring(0, 3000), // Pinecone ha limite su metadata
            source: sourceFile,
            chunk_index: chunkIndex,
            timestamp: new Date().toISOString()
        };
        
        // Se il chunk ha metadata aggiuntivi, includili
        if (chunk.page) metadata.page = chunk.page;
        if (chunk.slide) metadata.slide = chunk.slide;
        if (chunk.topic) metadata.topic = chunk.topic;
        if (chunk.type) metadata.type = chunk.type;
        
        return {
            id: chunkId,
            values: embedding,
            metadata: metadata
        };
    } catch (error) {
        console.error(`❌ Errore processamento chunk ${chunkIndex}:`, error);
        return null;
    }
}

// Funzione principale per caricare i dati
async function uploadToVectorDB() {
    console.log('🚀 Inizio caricamento dati in Pinecone...\n');
    
    try {
        // Crea o ottieni l'indice
        const index = await createIndexIfNeeded();
        
        // Cartella con i dati processati
        const dataDir = path.join(process.cwd(), 'data', 'processed-v4');
        
        // Leggi tutti i file JSON nella cartella
        const files = await fs.readdir(dataDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        if (jsonFiles.length === 0) {
            console.error('❌ Nessun file JSON trovato in data/processed-v4/');
            return;
        }
        
        console.log(`📁 Trovati ${jsonFiles.length} file da processare\n`);
        
        let totalVectors = 0;
        let successfulVectors = 0;
        
        // Processa ogni file
        for (const file of jsonFiles) {
            console.log(`\n📄 Processamento ${file}...`);
            
            const filePath = path.join(dataDir, file);
            const fileContent = await fs.readFile(filePath, 'utf-8');
            
            let data;
            try {
                data = JSON.parse(fileContent);
            } catch (error) {
                console.error(`❌ Errore parsing ${file}:`, error.message);
                continue;
            }
            
            // Estrai chunks dal file
            let chunks = [];
            
            // Supporta diversi formati di dati
            if (data.chunks && Array.isArray(data.chunks)) {
                chunks = data.chunks;
            } else if (data.vision_chunks && Array.isArray(data.vision_chunks)) {
                chunks = data.vision_chunks;
            } else if (data.content && Array.isArray(data.content)) {
                chunks = data.content;
            } else if (Array.isArray(data)) {
                chunks = data;
            } else if (data.text) {
                // Se è un singolo documento, dividilo in chunks
                const text = data.text;
                const chunkSize = 1000;
                for (let i = 0; i < text.length; i += chunkSize) {
                    chunks.push({
                        text: text.substring(i, i + chunkSize),
                        index: Math.floor(i / chunkSize)
                    });
                }
            }
            
            if (chunks.length === 0) {
                console.log(`⚠️ Nessun chunk trovato in ${file}`);
                continue;
            }
            
            console.log(`  📊 ${chunks.length} chunks da processare`);
            
            // Processa i chunks in batch
            const batchSize = 10;
            const vectors = [];
            
            for (let i = 0; i < chunks.length; i++) {
                const vector = await processChunk(
                    chunks[i], 
                    file.replace('.json', ''), 
                    i, 
                    chunks.length
                );
                
                if (vector) {
                    vectors.push(vector);
                    successfulVectors++;
                }
                totalVectors++;
                
                // Carica in batch
                if (vectors.length >= batchSize || i === chunks.length - 1) {
                    if (vectors.length > 0) {
                        try {
                            console.log(`  📤 Caricamento batch di ${vectors.length} vectors...`);
                            await index.upsert(vectors);
                            console.log(`  ✅ Batch caricato con successo`);
                            vectors.length = 0; // Svuota l'array
                        } catch (error) {
                            console.error(`  ❌ Errore caricamento batch:`, error.message);
                        }
                    }
                }
                
                // Pausa per evitare rate limiting
                if (i % 10 === 0 && i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 RIEPILOGO CARICAMENTO:');
        console.log(`  ✅ Vectors caricati: ${successfulVectors}/${totalVectors}`);
        console.log(`  📁 File processati: ${jsonFiles.length}`);
        console.log('='.repeat(50));
        
        // Verifica lo stato dell'indice
        const stats = await index.describeIndexStats();
        console.log('\n📈 STATISTICHE INDICE:');
        console.log(`  Total vectors: ${stats.totalRecordCount || 0}`);
        console.log(`  Dimension: ${stats.dimension || CONFIG.pinecone.dimension}`);
        
    } catch (error) {
        console.error('\n❌ Errore generale:', error);
        console.error(error.stack);
    }
}

// Funzione helper per pulire l'indice (opzionale)
async function clearIndex() {
    console.log('🗑️ Pulizia indice...');
    try {
        const index = pc.index(CONFIG.pinecone.indexName);
        await index.deleteAll();
        console.log('✅ Indice pulito');
    } catch (error) {
        console.error('❌ Errore pulizia indice:', error);
    }
}

// Main
async function main() {
    // Verifica configurazione
    if (!CONFIG.pinecone.apiKey || !CONFIG.openai.apiKey) {
        console.error('❌ ERRORE: Configura PINECONE_API_KEY e OPENAI_API_KEY nel file .env');
        process.exit(1);
    }
    
    console.log('='.repeat(50));
    console.log('  CARICAMENTO DATI IN PINECONE V4');
    console.log('='.repeat(50));
    
    // Chiedi se pulire l'indice prima
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
        rl.question('\n🔄 Vuoi pulire l\'indice prima di caricare? (s/N): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() === 's') {
        await clearIndex();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Carica i dati
    await uploadToVectorDB();
    
    console.log('\n✨ Processo completato!');
    console.log('Ora puoi usare il sistema RAG v4 per rispondere alle domande.');
}

// Esegui
main().catch(console.error);