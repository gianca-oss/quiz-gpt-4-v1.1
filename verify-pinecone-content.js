// verify-pinecone-content.js
// Script per verificare il contenuto di Pinecone e capire perché non trova risultati

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        embeddingModel: 'text-embedding-3-small'
    }
};

// Colori console
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// ========== VERIFICA CONTENUTO PINECONE ==========
async function verifyPineconeContent() {
    log('\n════════════════════════════════════════', 'cyan');
    log('    VERIFICA CONTENUTO PINECONE', 'cyan');
    log('════════════════════════════════════════', 'cyan');

    try {
        const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
        const index = pc.index(CONFIG.pinecone.indexName);
        
        // Ottieni statistiche
        const stats = await index.describeIndexStats();
        log('\n📊 STATISTICHE INDICE:', 'cyan');
        log(`   • Nome: ${CONFIG.pinecone.indexName}`, 'blue');
        log(`   • Vettori totali: ${stats.totalVectorCount || 0}`, 'blue');
        log(`   • Dimensione: ${stats.dimension || 0}`, 'blue');
        
        if (stats.totalVectorCount === 0) {
            log('\n❌ L\'indice è VUOTO!', 'red');
            log('   Devi prima eseguire: node load-v4-to-pinecone.js', 'yellow');
            return null;
        }

        // Fetch alcuni vettori casuali per vedere il contenuto
        log('\n🔍 ANALISI CONTENUTO (campione):', 'cyan');
        
        // Metodo 1: Query con vettore random per vedere cosa c'è
        const randomVector = new Array(1536).fill(0).map(() => Math.random());
        const sampleResults = await index.query({
            vector: randomVector,
            topK: 5,
            includeMetadata: true
        });

        if (sampleResults.matches && sampleResults.matches.length > 0) {
            log('\n📚 Esempi di contenuto trovato:', 'green');
            sampleResults.matches.forEach((match, idx) => {
                const text = match.metadata?.text || 'N/A';
                const preview = text.substring(0, 150).replace(/\n/g, ' ');
                log(`\n${idx + 1}. ID: ${match.id}`, 'blue');
                log(`   Page: ${match.metadata?.page || '?'} | Type: ${match.metadata?.type || '?'}`, 'cyan');
                log(`   Testo: "${preview}..."`, 'yellow');
            });
        }

        return stats;

    } catch (error) {
        log(`❌ Errore: ${error.message}`, 'red');
        return null;
    }
}

// ========== TEST RICERCA SPECIFICHE ==========
async function testSpecificSearches() {
    log('\n════════════════════════════════════════', 'cyan');
    log('    TEST RICERCHE SPECIFICHE', 'cyan');
    log('════════════════════════════════════════', 'cyan');

    const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
    const index = pc.index(CONFIG.pinecone.indexName);
    const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });

    // Query basate sulle domande del quiz che non funzionano
    const testQueries = [
        "matrice di confusione machine learning",
        "quarta rivoluzione industriale industria 4.0",
        "processo produttivo giorni settimana turni",
        "paradigma produzione personalizzazione massa",
        "customizer produttore cambia prodotto",
        "overfitting underfitting machine learning"
    ];

    log('\n🔍 Test query specifiche del quiz:', 'cyan');

    for (const query of testQueries) {
        log(`\n📝 Query: "${query}"`, 'blue');
        
        try {
            // Genera embedding
            const embeddingResponse = await openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: query
            });

            // Cerca
            const results = await index.query({
                vector: embeddingResponse.data[0].embedding,
                topK: 3,
                includeMetadata: true,
                includeValues: false
            });

            if (results.matches && results.matches.length > 0) {
                const relevantMatches = results.matches.filter(m => m.score > 0.7);
                
                if (relevantMatches.length > 0) {
                    log(`   ✅ ${relevantMatches.length} risultati rilevanti (score > 0.7)`, 'green');
                    relevantMatches.forEach((match, idx) => {
                        const text = match.metadata?.text || '';
                        log(`      ${idx + 1}. Score: ${match.score.toFixed(3)}`, 'cyan');
                        log(`         "${text.substring(0, 100)}..."`, 'yellow');
                    });
                } else {
                    log(`   ⚠️ ${results.matches.length} risultati ma con score basso (<0.7)`, 'yellow');
                    log(`      Migliore: ${results.matches[0].score.toFixed(3)}`, 'yellow');
                }
            } else {
                log(`   ❌ Nessun risultato`, 'red');
            }
            
        } catch (error) {
            log(`   ❌ Errore: ${error.message}`, 'red');
        }
    }
}

// ========== DIAGNOSI PROBLEMA ==========
async function diagnoseProblem() {
    log('\n════════════════════════════════════════', 'cyan');
    log('    DIAGNOSI DEL PROBLEMA', 'cyan');
    log('════════════════════════════════════════', 'cyan');

    const stats = await verifyPineconeContent();
    
    if (!stats || stats.totalVectorCount === 0) {
        log('\n🔴 PROBLEMA: Indice vuoto', 'red');
        log('\nSOLUZIONE:', 'yellow');
        log('1. Esegui: node load-v4-to-pinecone.js', 'yellow');
        log('2. Assicurati che carichi TUTTI i chunks dal corso giusto', 'yellow');
        return;
    }

    await testSpecificSearches();

    log('\n════════════════════════════════════════', 'cyan');
    log('    ANALISI RISULTATI', 'cyan');
    log('════════════════════════════════════════', 'cyan');

    log('\n🔍 POSSIBILI CAUSE DEL PROBLEMA:', 'yellow');
    log('\n1. CORSO SBAGLIATO:', 'cyan');
    log('   I chunks indicizzati potrebbero essere di un corso diverso', 'yellow');
    log('   (es. pedagogia invece di industria 4.0/ML)', 'yellow');
    
    log('\n2. EMBEDDINGS NON CORRISPONDENTI:', 'cyan');
    log('   Gli embeddings potrebbero essere stati generati male', 'yellow');
    
    log('\n3. THRESHOLD TROPPO ALTO:', 'cyan');
    log('   Il filtro score > 0.7 potrebbe essere troppo restrittivo', 'yellow');

    log('\n✅ SOLUZIONI CONSIGLIATE:', 'green');
    log('\n1. VERIFICA IL CORSO:', 'cyan');
    log('   Controlla che i file in data/processed-v4 siano del corso giusto', 'yellow');
    
    log('\n2. RE-INDICIZZA CON IL CORSO CORRETTO:', 'cyan');
    log('   a) Metti il PDF del corso giusto in data/corso_completo.pdf', 'yellow');
    log('   b) Riprocessa: node process-course-v4.js', 'yellow');
    log('   c) Indicizza: node load-v4-to-pinecone.js', 'yellow');
    
    log('\n3. ABBASSA LA THRESHOLD:', 'cyan');
    log('   Nel file api/analyze-v4-rag.js, cambia:', 'yellow');
    log('   Da: .filter(m => m.score > 0.7)', 'yellow');
    log('   A:  .filter(m => m.score > 0.5)', 'yellow');
}

// ========== PULIZIA INDICE ==========
async function cleanIndex() {
    log('\n════════════════════════════════════════', 'cyan');
    log('    PULIZIA INDICE', 'cyan');
    log('════════════════════════════════════════', 'cyan');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise(resolve => {
        rl.question('\n⚠️ Vuoi PULIRE completamente l\'indice? (y/n): ', resolve);
    });

    if (answer.toLowerCase() === 'y') {
        try {
            const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
            const index = pc.index(CONFIG.pinecone.indexName);
            
            log('\n🗑️ Pulizia in corso...', 'yellow');
            await index.deleteAll();
            log('✅ Indice pulito!', 'green');
            log('\nOra puoi re-indicizzare con: node load-v4-to-pinecone.js', 'yellow');
            
        } catch (error) {
            log(`❌ Errore pulizia: ${error.message}`, 'red');
        }
    }

    rl.close();
}

// ========== TEST MANUALE ==========
async function manualTest() {
    log('\n════════════════════════════════════════', 'cyan');
    log('    TEST MANUALE QUERY', 'cyan');
    log('════════════════════════════════════════', 'cyan');

    const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
    const index = pc.index(CONFIG.pinecone.indexName);
    const openai = new OpenAI({ apiKey: CONFIG.openai.apiKey });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    log('\nInserisci query di test (o "exit" per uscire):', 'cyan');

    const askQuestion = async () => {
        const query = await new Promise(resolve => {
            rl.question('\n> ', resolve);
        });

        if (query.toLowerCase() === 'exit') {
            rl.close();
            return;
        }

        try {
            const embeddingResponse = await openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: query
            });

            const results = await index.query({
                vector: embeddingResponse.data[0].embedding,
                topK: 5,
                includeMetadata: true
            });

            if (results.matches && results.matches.length > 0) {
                log('\n📚 Risultati:', 'green');
                results.matches.forEach((match, idx) => {
                    const text = match.metadata?.text || '';
                    log(`\n${idx + 1}. Score: ${match.score.toFixed(3)}`, 'cyan');
                    log(`   ${text.substring(0, 200)}...`, 'yellow');
                });
            } else {
                log('❌ Nessun risultato', 'red');
            }
        } catch (error) {
            log(`❌ Errore: ${error.message}`, 'red');
        }

        await askQuestion();
    };

    await askQuestion();
}

// ========== MAIN ==========
async function main() {
    console.clear();
    log('╔════════════════════════════════════════╗', 'cyan');
    log('║   VERIFICA CONTENUTO PINECONE          ║', 'cyan');
    log('╚════════════════════════════════════════╝', 'cyan');

    // Verifica configurazione
    if (!CONFIG.pinecone.apiKey || !CONFIG.openai.apiKey) {
        log('\n❌ Configurazione mancante!', 'red');
        log('Assicurati di avere nel .env:', 'yellow');
        log('  PINECONE_API_KEY=...', 'yellow');
        log('  OPENAI_API_KEY=sk-...', 'yellow');
        return;
    }

    // Menu
    log('\n📋 OPZIONI:', 'cyan');
    log('1. Diagnosi automatica completa', 'yellow');
    log('2. Test ricerca manuale', 'yellow');
    log('3. Pulisci indice completamente', 'yellow');
    log('4. Esci', 'yellow');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const choice = await new Promise(resolve => {
        rl.question('\nScelta (1-4): ', resolve);
    });
    rl.close();

    switch(choice) {
        case '1':
            await diagnoseProblem();
            break;
        case '2':
            await manualTest();
            break;
        case '3':
            await cleanIndex();
            break;
        case '4':
            log('\n👋 Ciao!', 'cyan');
            break;
        default:
            log('\n❌ Scelta non valida', 'red');
    }
}

// Esegui
main().catch(console.error);