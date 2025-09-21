// scripts/preprocess-hybrid-optimized.js
// Processing IBRIDO: Testo con GPT-4o + Vision per contenuti visuali

import { config } from 'dotenv';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse-fork';
import fs from 'fs/promises';
import path from 'path';

config();

// ============ CONFIGURAZIONE ============
const CONFIG = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        textModel: 'gpt-4o', // Massima qualità per processing testo
        visionModel: 'gpt-4o', // Stesso modello, gestisce anche immagini
        embeddingModel: 'text-embedding-3-small',
        temperature: 0.1
    },
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision',
        dimension: 1536 // per text-embedding-3-small
    },
    processing: {
        chunkSize: 1000,        // Caratteri per chunk
        chunkOverlap: 200,      // Overlap tra chunks
        batchSize: 10,          // Chunks per batch
        visionThreshold: {      // Criteri per usare Vision
            minTextLength: 200,  // Se < 200 chars, probabile immagine
            tableIndicators: ['|', '┌', '─', '│'], // Indicatori di tabelle
            mathIndicators: ['∑', '∫', '∂', '∇', '×', '÷', '√'],
            codeIndicators: ['function', 'class', 'def', 'import', '{', '}']
        }
    },
    paths: {
        sourceDir: './data/source/',
        processedDir: './data/processed-v4/',
        visionCache: './data/processed-v4/vision_cache.json'
    }
};

// ============ CLASSE PRINCIPALE ============
class HybridProcessor {
    constructor() {
        this.openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });
        this.pinecone = null;
        this.pineconeIndex = null;
        this.processedChunks = [];
        this.visionAnalysis = [];
        this.stats = {
            totalPages: 0,
            textProcessed: 0,
            visionProcessed: 0,
            chunksCreated: 0,
            tokensUsed: 0,
            estimatedCost: 0
        };
    }

    async initialize() {
        console.log('🚀 Inizializzazione servizi...\n');
        console.log('📋 Configurazione modelli:');
        console.log(`  Text Model: ${CONFIG.openai.textModel}`);
        console.log(`  Vision Model: ${CONFIG.openai.visionModel}\n`);
        
        // Inizializza Pinecone
        this.pinecone = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
        
        // Verifica/crea indice
        const indexes = await this.pinecone.listIndexes();
        const indexExists = indexes.indexes?.some(idx => idx.name === CONFIG.pinecone.indexName);
        
        if (!indexExists) {
            console.log('📦 Creazione indice Pinecone...');
            await this.pinecone.createIndex({
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
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
        
        this.pineconeIndex = this.pinecone.index(CONFIG.pinecone.indexName);
        console.log('✅ Servizi pronti\n');
    }

    // ============ ESTRAZIONE PDF ============
    async extractPDF(pdfPath) {
        console.log(`📄 Estrazione PDF: ${pdfPath}\n`);
        
        try {
            // Leggi il file PDF
            const pdfBuffer = await fs.readFile(pdfPath);
            
            // Estrai testo con pdf-parse-fork (silenzia i warning TT)
            console.log(`🔄 Estrazione testo in corso (ignorare eventuali warning TT)...\n`);
            
            // Opzioni per ridurre i warning
            const options = {
                max: 0, // Processa tutte le pagine
                // Silenzia console per i warning TT
                pagerender: (pageData) => {
                    const render_options = {
                        normalizeWhitespace: true,
                        disableCombineTextItems: false
                    };
                    return pageData.getTextContent(render_options)
                        .then(textContent => {
                            let text = '';
                            for (const item of textContent.items) {
                                text += item.str + ' ';
                            }
                            return text;
                        });
                }
            };
            
            const pdfData = await pdfParse(pdfBuffer, options);
            
            const numPages = pdfData.numpages;
            this.stats.totalPages = numPages;
            
            console.log(`\n✅ Estrazione completata!`);
            console.log(`📊 Pagine trovate: ${numPages}`);
            console.log(`📝 Caratteri estratti: ${pdfData.text.length}\n`);
            
            // Dividi il testo in pagine (approssimativo)
            const pages = pdfData.text.split(/\f|\n{3,}/); // Form feed o 3+ newlines
            
            const processedPages = [];
            
            // Se le pagine non corrispondono, ridistribuisci il testo
            const charsPerPage = Math.ceil(pdfData.text.length / numPages);
            
            console.log(`🔍 Analisi contenuto pagine...\n`);
            
            for (let i = 0; i < numPages; i++) {
                let pageText = '';
                
                if (pages[i]) {
                    pageText = pages[i];
                } else {
                    // Fallback: dividi il testo uniformemente
                    const start = i * charsPerPage;
                    const end = Math.min(start + charsPerPage, pdfData.text.length);
                    pageText = pdfData.text.substring(start, end);
                }
                
                const textLength = pageText.trim().length;
                const pageInfo = {
                    pageNumber: i + 1,
                    text: pageText.trim(),
                    requiresVision: this.shouldUseVision(pageText),
                    chunks: [],
                    analysis: null
                };
                
                processedPages.push(pageInfo);
                
                // Log dettagliato
                if ((i + 1) % 10 === 0 || i === 0) {
                    const visionStatus = pageInfo.requiresVision ? '👁️ Vision' : '📝 Testo';
                    console.log(`  Pagina ${i + 1}/${numPages}: ${textLength} caratteri [${visionStatus}]`);
                }
            }
            
            // Statistiche finali
            const textPages = processedPages.filter(p => !p.requiresVision).length;
            const visionPages = processedPages.filter(p => p.requiresVision).length;
            
            console.log(`\n📊 RIEPILOGO ESTRAZIONE:`);
            console.log(`  📝 Pagine testuali (GPT-4o): ${textPages}`);
            console.log(`  👁️ Pagine visuali (GPT-4o Vision): ${visionPages}`);
            console.log(`  📄 Totale pagine: ${numPages}\n`);
            
            return processedPages;
            
        } catch (error) {
            console.error('❌ Errore durante l\'estrazione PDF:', error.message);
            
            // Se pdf-parse fallisce, proviamo un approccio alternativo
            console.log('\n⚠️ Tentativo con metodo alternativo...\n');
            
            // Fallback: crea struttura base per processing con Vision
            const pdfBuffer = await fs.readFile(pdfPath);
            const stats = await fs.stat(pdfPath);
            const estimatedPages = Math.max(1, Math.floor(stats.size / 50000)); // Stima ~50KB per pagina
            
            const processedPages = [];
            for (let i = 1; i <= estimatedPages; i++) {
                processedPages.push({
                    pageNumber: i,
                    text: '',
                    requiresVision: true,
                    chunks: [],
                    analysis: null
                });
            }
            
            console.log(`📊 Creato fallback per ${estimatedPages} pagine (tutte Vision)\n`);
            return processedPages;
        }
    }

    // ============ DECISIONE VISION vs TEXT ============
    shouldUseVision(pageText) {
        const config = CONFIG.processing.visionThreshold;
        
        // Criteri per usare Vision
        if (pageText.length < config.minTextLength) return true;
        
        // Cerca indicatori di tabelle
        for (const indicator of config.tableIndicators) {
            if (pageText.includes(indicator)) return true;
        }
        
        // Cerca formule matematiche
        for (const mathSymbol of config.mathIndicators) {
            if (pageText.includes(mathSymbol)) return true;
        }
        
        // Cerca pattern di codice
        const codePatterns = config.codeIndicators;
        for (const pattern of codePatterns) {
            if (pageText.includes(pattern)) {
                // Verifica se è codice strutturato
                const lines = pageText.split('\n');
                const indentedLines = lines.filter(l => l.startsWith('  ') || l.startsWith('\t'));
                if (indentedLines.length > 3) return true;
            }
        }
        
        return false;
    }

    // ============ PROCESSING TESTO (GPT-3.5) ============
    async processTextPage(pageInfo) {
        const chunks = this.createTextChunks(pageInfo.text);
        const processedChunks = [];
        
        for (const chunk of chunks) {
            try {
                // Analisi semantica con GPT-3.5 (economico)
                const analysis = await this.analyzeTextChunk(chunk);
                
                // Genera embedding
                const embedding = await this.generateEmbedding(chunk.text);
                
                processedChunks.push({
                    id: `chunk_${this.stats.chunksCreated++}`,
                    pageNumber: pageInfo.pageNumber,
                    text: chunk.text,
                    analysis: analysis,
                    embedding: embedding,
                    metadata: {
                        type: 'text',
                        concepts: analysis.concepts || [],
                        topics: analysis.topics || [],
                        importance: analysis.importance || 5
                    }
                });
                
                this.stats.textProcessed++;
                
            } catch (error) {
                console.error(`  ⚠️ Errore processing chunk: ${error.message}`);
            }
        }
        
        return processedChunks;
    }

    // ============ PROCESSING VISION (GPT-4V) ============
    async processVisionPage(pageInfo, imagePath) {
        console.log(`  👁️ Analisi Vision per pagina ${pageInfo.pageNumber}...`);
        
        try {
            // Converti pagina in base64 (simulato - dovresti usare pdf2pic)
            const imageBase64 = await this.convertPageToImage(pageInfo.pageNumber, imagePath);
            
            // Analisi con GPT-4 Vision
            const response = await this.openai.chat.completions.create({
                model: CONFIG.openai.visionModel,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Analizza questa pagina accademica. Estrai:
1. TABELLE (struttura completa con headers e righe)
2. DIAGRAMMI/FLOWCHART (descrizione e relazioni)
3. FORMULE matematiche (in LaTeX se possibile)
4. CODICE (con linguaggio e sintassi)
5. GRAFICI (assi, valori, trend)
6. TESTO non catturato dall'OCR

Restituisci JSON:
{
  "contentType": "table|diagram|formula|code|mixed",
  "elements": [
    {
      "type": "tipo elemento",
      "content": "contenuto estratto",
      "description": "descrizione"
    }
  ],
  "extractedText": "testo aggiuntivo",
  "concepts": ["concetto1", "concetto2"],
  "importance": 1-10
}`
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageBase64}`,
                                detail: 'high'
                            }
                        }
                    ]
                }],
                max_tokens: 2000,
                temperature: 0.1
            });
            
            const visionResult = JSON.parse(response.choices[0].message.content);
            this.stats.visionProcessed++;
            
            // Combina testo OCR con Vision
            const enhancedText = pageInfo.text + '\n\n[Vision Enhanced]\n' + 
                                (visionResult.extractedText || '') + '\n' +
                                visionResult.elements.map(e => e.content).join('\n');
            
            // Crea chunks dal contenuto arricchito
            const chunks = this.createTextChunks(enhancedText);
            const processedChunks = [];
            
            for (const chunk of chunks) {
                const embedding = await this.generateEmbedding(chunk.text);
                
                processedChunks.push({
                    id: `chunk_${this.stats.chunksCreated++}`,
                    pageNumber: pageInfo.pageNumber,
                    text: chunk.text,
                    analysis: visionResult,
                    embedding: embedding,
                    metadata: {
                        type: 'vision-enhanced',
                        visionElements: visionResult.elements,
                        concepts: visionResult.concepts || [],
                        importance: visionResult.importance || 8
                    }
                });
            }
            
            // Salva analisi Vision per riferimento
            this.visionAnalysis.push({
                pageNumber: pageInfo.pageNumber,
                analysis: visionResult
            });
            
            return processedChunks;
            
        } catch (error) {
            console.error(`  ❌ Errore Vision: ${error.message}`);
            // Fallback al processing testuale
            return this.processTextPage(pageInfo);
        }
    }

    // ============ ANALISI SEMANTICA TESTO ============
    async analyzeTextChunk(chunk) {
        try {
            const response = await this.openai.chat.completions.create({
                model: CONFIG.openai.textModel, // Usa gpt-4o-mini
                messages: [
                    {
                        role: 'system',
                        content: 'Sei un esperto analizzatore di contenuti accademici. Estrai informazioni strutturate con alta precisione.'
                    },
                    {
                        role: 'user',
                        content: `Analizza questo testo accademico ed estrai TUTTI i concetti rilevanti.

Testo: "${chunk.text.substring(0, 800)}..."

Restituisci un JSON dettagliato:
{
  "concepts": ["lista completa dei concetti chiave identificati"],
  "topics": ["argomenti principali trattati"],
  "definitions": [
    {"term": "termine", "definition": "definizione precisa"}
  ],
  "keyPoints": ["punti chiave e informazioni critiche"],
  "formulas": ["formule o algoritmi menzionati"],
  "examples": ["esempi pratici"],
  "relationships": [
    {"concept1": "X", "concept2": "Y", "relation": "tipo di relazione"}
  ],
  "importance": 1-10,
  "summary": "riassunto dettagliato del contenuto"
}`
                    }
                ],
                temperature: 0.1,
                max_tokens: 800, // Aumentato per catturare più dettagli
                response_format: { type: "json_object" }
            });
            
            return JSON.parse(response.choices[0].message.content);
            
        } catch (error) {
            console.error('Errore analisi:', error.message);
            return {
                concepts: [],
                topics: [],
                definitions: [],
                importance: 5
            };
        }
    }

    // ============ UTILITIES ============
    createTextChunks(text) {
        const chunks = [];
        const chunkSize = CONFIG.processing.chunkSize;
        const overlap = CONFIG.processing.chunkOverlap;
        
        for (let i = 0; i < text.length; i += chunkSize - overlap) {
            const chunkText = text.substring(i, i + chunkSize);
            if (chunkText.trim().length > 50) {
                chunks.push({
                    text: chunkText,
                    start: i,
                    end: Math.min(i + chunkSize, text.length)
                });
            }
        }
        
        return chunks;
    }

    async generateEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: text.substring(0, 8000)
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error('Errore embedding:', error.message);
            return null;
        }
    }

    async convertPageToImage(pageNumber, pdfPath) {
        // Placeholder - dovresti implementare con pdf2pic o simile
        // Per ora restituisce una stringa vuota
        return "";
    }

    // ============ INDICIZZAZIONE PINECONE ============
    async indexChunks(chunks) {
        console.log('\n📤 Caricamento in Pinecone...\n');
        
        const batchSize = CONFIG.processing.batchSize;
        let indexed = 0;
        
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const vectors = [];
            
            for (const chunk of batch) {
                if (!chunk.embedding) continue;
                
                vectors.push({
                    id: chunk.id,
                    values: chunk.embedding,
                    metadata: {
                        text: chunk.text.substring(0, 1000),
                        pageNumber: chunk.pageNumber,
                        type: chunk.metadata.type,
                        concepts: chunk.metadata.concepts.join(', '),
                        importance: chunk.metadata.importance
                    }
                });
            }
            
            if (vectors.length > 0) {
                await this.pineconeIndex.upsert(vectors);
                indexed += vectors.length;
                console.log(`  Indicizzati ${indexed}/${chunks.length} chunks...`);
            }
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`✅ Indicizzati ${indexed} chunks totali\n`);
    }

    // ============ PIPELINE PRINCIPALE ============
    async processDocument(pdfPath) {
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║     PROCESSING IBRIDO: TESTO + VISION      ║');
        console.log('╚════════════════════════════════════════════╝\n');
        
        // 1. Estrai pagine dal PDF
        const pages = await this.extractPDF(pdfPath);
        
        // 2. Categorizza pagine
        const textPages = pages.filter(p => !p.requiresVision);
        const visionPages = pages.filter(p => p.requiresVision);
        
        console.log(`\n📊 Strategia di processing:`);
        console.log(`  📝 Pagine testuali (GPT-4o): ${textPages.length}`);
        console.log(`  👁️ Pagine visuali (GPT-4V): ${visionPages.length}`);
        console.log(`  💰 Costo stimato: ~$${this.estimateCost(textPages.length, visionPages.length)}\n`);
        
        // 3. Processa pagine testuali
        console.log('📝 Processing pagine testuali con GPT-4o...\n');
        for (const page of textPages) {
            const chunks = await this.processTextPage(page);
            this.processedChunks.push(...chunks);
        }
        
        // 4. Processa pagine con Vision (se necessario)
        if (visionPages.length > 0) {
            console.log('\n👁️ Processing pagine con Vision...\n');
            for (const page of visionPages) {
                const chunks = await this.processVisionPage(page, pdfPath);
                this.processedChunks.push(...chunks);
            }
        }
        
        // 5. Indicizza in Pinecone
        await this.indexChunks(this.processedChunks);
        
        // 6. Salva risultati
        await this.saveResults();
        
        // 7. Report finale
        this.printReport();
    }

    // ============ SALVATAGGIO RISULTATI ============
    async saveResults() {
        console.log('💾 Salvataggio risultati...\n');
        
        // Crea directory
        await fs.mkdir(CONFIG.paths.processedDir, { recursive: true });
        
        // Salva chunks (senza embeddings per risparmiare spazio)
        const chunksToSave = this.processedChunks.map(c => ({
            ...c,
            embedding: undefined
        }));
        
        await fs.writeFile(
            path.join(CONFIG.paths.processedDir, 'chunks_vision.json'),
            JSON.stringify(chunksToSave, null, 2)
        );
        
        // Salva analisi Vision
        if (this.visionAnalysis.length > 0) {
            await fs.writeFile(
                path.join(CONFIG.paths.processedDir, 'vision_analysis.json'),
                JSON.stringify(this.visionAnalysis, null, 2)
            );
        }
        
        // Salva metadata
        const metadata = {
            timestamp: new Date().toISOString(),
            stats: this.stats,
            config: {
                textModel: CONFIG.openai.textModel,
                visionModel: CONFIG.openai.visionModel,
                embeddingModel: CONFIG.openai.embeddingModel
            }
        };
        
        await fs.writeFile(
            path.join(CONFIG.paths.processedDir, 'metadata_vision.json'),
            JSON.stringify(metadata, null, 2)
        );
        
        console.log('✅ Risultati salvati\n');
    }

    // ============ UTILITIES ============
    estimateCost(textPages, visionPages) {
        // Costi aggiornati per gpt-4o
        const textCost = textPages * 0.005;  // ~$0.005 per pagina con gpt-4o
        const visionCost = visionPages * 0.015; // ~$0.015 per pagina con gpt-4o (vision)
        const embeddingCost = (textPages + visionPages) * 0.0001;
        return (textCost + visionCost + embeddingCost).toFixed(2);
    }

    printReport() {
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║            PROCESSING COMPLETATO            ║');
        console.log('╚════════════════════════════════════════════╝\n');
        
        console.log('📊 STATISTICHE FINALI:');
        console.log('━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  📄 Pagine totali: ${this.stats.totalPages}`);
        console.log(`  📝 Chunks testuali: ${this.stats.textProcessed}`);
        console.log(`  👁️ Pagine con Vision: ${this.stats.visionProcessed}`);
        console.log(`  🧩 Chunks totali: ${this.stats.chunksCreated}`);
        console.log(`  💰 Costo stimato: ~$${this.estimateCost(this.stats.textProcessed, this.stats.visionProcessed)}`);
        console.log(`  📁 Dati salvati in: ${CONFIG.paths.processedDir}`);
        console.log('\n✨ Il database vettoriale è pronto per il RAG!');
    }
}

// ============ MAIN ============
async function main() {
    console.log('🚀 Avvio script...\n');
    
    try {
        console.log('📋 Caricamento configurazione...');
        console.log('  OpenAI API Key:', process.env.OPENAI_API_KEY ? '✅ Configurata' : '❌ Mancante');
        console.log('  Pinecone API Key:', process.env.PINECONE_API_KEY ? '✅ Configurata' : '❌ Mancante');
        
        const processor = new HybridProcessor();
        console.log('\n🔧 Inizializzazione servizi...');
        await processor.initialize();
        
        // Cerca specificamente corso_completo.pdf
        const sourceDir = CONFIG.paths.sourceDir;
        const pdfPath = path.join(sourceDir, 'corso_completo.pdf');
        
        console.log(`\n📁 Cercando PDF in: ${path.resolve(pdfPath)}`);
        
        // Verifica che il file esista
        try {
            const stats = await fs.stat(pdfPath);
            console.log(`✅ Trovato: corso_completo.pdf (${(stats.size / 1024 / 1024).toFixed(2)} MB)\n`);
        } catch (error) {
            console.error(`❌ File non trovato: ${pdfPath}`);
            console.error(`\nAssicurati che 'corso_completo.pdf' sia nella cartella:`);
            console.error(`   ${path.resolve(sourceDir)}\n`);
            
            // Mostra i file presenti nella cartella
            try {
                const files = await fs.readdir(sourceDir);
                console.log('📂 File trovati in data/source/:');
                files.forEach(f => console.log(`   - ${f}`));
            } catch (e) {
                console.log('❌ La cartella data/source/ non esiste!');
            }
            
            process.exit(1);
        }
        
        // Processa il documento
        console.log('🚀 Avvio processing del documento...\n');
        await processor.processDocument(pdfPath);
        
        console.log('\n✅ Script completato con successo!');
        
    } catch (error) {
        console.error('\n❌ Errore durante l\'esecuzione:');
        console.error('  Messaggio:', error.message);
        console.error('  Stack:', error.stack);
        process.exit(1);
    }
}

// Esegui immediatamente
console.log('================================');
console.log('  HYBRID PDF PROCESSOR v1.0');
console.log('================================\n');

main().catch(error => {
    console.error('❌ Errore fatale:', error);
    process.exit(1);
});