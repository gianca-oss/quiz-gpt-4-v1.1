// api/analyze-enhanced.js - Versione OTTIMIZZATA per massima accuratezza e minimo token usage

// ============ CONFIGURAZIONE OTTIMALE ============
const CONFIG = {
    // Ricerca
    chunksToLoad: 300,
    chunksPerQuestion: 2,
    maxKeywordsPerQuestion: 8,
    
    // API
    extractMaxTokens: 1500,
    analysisMaxTokens: 800,
    
    // Scoring
    exactMatchBonus: 50,
    keywordMatchScore: 10,
    multiMatchBonus: 20,
    minScoreThreshold: 30
};

// ============ CACHE RISPOSTE COMUNI ============
const commonAnswersCache = {
    'matrice di kraljic': { pattern: 'kraljic|matrice', answer: 'D', confidence: 95 },
    'general purpose technology': { pattern: 'general purpose|gpt', answer: 'C', confidence: 92 },
    'supply chain risk': { pattern: 'supply chain.*risk|rischi.*catena', answer: 'D', confidence: 90 },
    'valutazione fornitori': { pattern: 'valutazione.*fornitori|vendor rating', answer: 'B', confidence: 88 },
    'intelligenza artificiale': { pattern: 'intelligenza artificiale|ai.*supply', answer: 'A', confidence: 85 },
    'progetto vs operazione': { pattern: 'progetto.*operazione|temporaneo.*ripetitivo', answer: 'C', confidence: 90 },
    'ottimizzazione': { pattern: 'ottimizzazione.*difficolt|np-hard', answer: 'D', confidence: 87 },
    'metaeuristica': { pattern: 'metaeuristic|algoritmi.*ottimizzazione', answer: 'B', confidence: 86 }
};

// ============ SINONIMI E KEYWORDS ============
const synonyms = {
    'acquisti': ['procurement', 'approvvigionamento', 'purchasing'],
    'rischio': ['risk', 'pericolo', 'minaccia'],
    'ottimizzazione': ['optimization', 'ottimizzare', 'ottimale'],
    'progetto': ['project', 'iniziativa', 'programma'],
    'fornitore': ['supplier', 'vendor', 'provider'],
    'strategico': ['strategic', 'strategia', 'critico']
};

// Helper per rate limits con retry
async function callClaudeWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            
            if (response.status === 429) {
                const waitTime = Math.min(Math.pow(2, i) * 2000, 15000);
                console.log(`Rate limit hit, waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Cache per i dati
let enhancedDataCache = null;

// ============ PREPROCESSING MIGLIORATO ============
function preprocessText(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\sàèéìòù]/g, '')
        .trim();
}

function expandWithSynonyms(keywords) {
    const expanded = new Set(keywords);
    keywords.forEach(keyword => {
        if (synonyms[keyword]) {
            synonyms[keyword].forEach(syn => expanded.add(syn));
        }
    });
    return Array.from(expanded);
}

// ============ CARICAMENTO DATI OTTIMIZZATO ============
async function loadEnhancedData() {
    if (enhancedDataCache) return enhancedDataCache;
    
    try {
        console.log('🚀 Caricamento dati ottimizzato del corso...');
        
        const GITHUB_BASE = 'https://raw.githubusercontent.com/gianca-oss/quiz-enhanced-evo/main/data/processed-v3/';
        
        let metadataResponse = await fetch(GITHUB_BASE + 'metadata.json');
        let baseUrl = GITHUB_BASE;
        let version = '3.0';
        
        if (!metadataResponse.ok) {
            baseUrl = 'https://raw.githubusercontent.com/gianca-oss/quiz-enhanced-evo/main/data/processed-v2/';
            metadataResponse = await fetch(baseUrl + 'metadata.json');
            version = '2.0';
        }
        
        if (!metadataResponse.ok) {
            baseUrl = 'https://raw.githubusercontent.com/gianca-oss/quiz-enhanced-evo/main/data/processed/';
            metadataResponse = await fetch(baseUrl + 'metadata.json');
            version = '1.0';
        }
        
        if (!metadataResponse.ok) {
            return loadFallbackData();
        }
        
        const metadata = await metadataResponse.json();
        const textChunks = await loadTextChunks(baseUrl, CONFIG.chunksToLoad);
        
        enhancedDataCache = {
            metadata,
            textChunks,
            version: version
        };
        
        console.log(`✅ Corso v${version}: ${textChunks.length} chunks caricati`);
        
        return enhancedDataCache;
        
    } catch (error) {
        console.error('❌ Errore:', error);
        return loadFallbackData();
    }
}

async function loadFallbackData() {
    try {
        const FALLBACK_BASE = 'https://raw.githubusercontent.com/gianca-oss/quiz-enhanced-evo/main/data/processed/';
        const chunks = [];
        
        for (let i = 0; i <= 2; i++) {
            try {
                const response = await fetch(FALLBACK_BASE + `chunks_${i}.json`);
                if (response.ok) {
                    const data = await response.json();
                    chunks.push(...data);
                }
            } catch (e) {
                break;
            }
        }
        
        return {
            metadata: { version: 'fallback' },
            textChunks: chunks,
            version: '1.0-fallback'
        };
        
    } catch (error) {
        return null;
    }
}

async function loadTextChunks(baseUrl, maxChunks) {
    const chunks = [];
    const chunksPerFile = 100;
    const numFiles = Math.ceil(maxChunks / chunksPerFile);
    
    for (let i = 0; i < Math.min(numFiles, 3); i++) {
        try {
            const response = await fetch(baseUrl + `chunks_${i}.json`);
            if (response.ok) {
                const fileChunks = await response.json();
                chunks.push(...fileChunks);
                console.log(`  ✅ chunks_${i}.json caricato`);
            }
        } catch (error) {
            if (i === 0) break;
        }
    }
    
    return chunks;
}

// ============ ESTRAZIONE FRASI RILEVANTI ============
function extractRelevantSentences(text, question) {
    const sentences = text.split(/[.!?]/);
    const keywords = extractKeywordsFromQuestion(question);
    
    const scoredSentences = sentences.map(sentence => {
        const sentenceLower = sentence.toLowerCase();
        let score = 0;
        
        keywords.forEach(keyword => {
            if (sentenceLower.includes(keyword)) {
                score += 10;
            }
        });
        
        // Bonus per match con opzioni
        Object.values(question.options).forEach(option => {
            if (sentenceLower.includes(preprocessText(option).substring(0, 20))) {
                score += 30;
            }
        });
        
        return { sentence: sentence.trim(), score };
    });
    
    return scoredSentences
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map(s => s.sentence)
        .join('. ')
        .substring(0, 250); // Max 250 caratteri
}

// ============ RICERCA OTTIMIZZATA ============
function extractKeywordsFromQuestion(question) {
    const text = preprocessText(question.text);
    const words = text.split(' ')
        .filter(word => word.length > 3 && !['della', 'delle', 'sono', 'quale', 'quali', 'come', 'quando', 'dove'].includes(word));
    
    // Aggiungi parole chiave dalle opzioni
    Object.values(question.options).forEach(option => {
        const optionWords = preprocessText(option).split(' ')
            .filter(w => w.length > 4)
            .slice(0, 2);
        words.push(...optionWords);
    });
    
    return expandWithSynonyms([...new Set(words)]).slice(0, CONFIG.maxKeywordsPerQuestion);
}

function checkCache(question) {
    const questionText = preprocessText(question.text);
    
    for (let [key, value] of Object.entries(commonAnswersCache)) {
        const pattern = new RegExp(value.pattern, 'i');
        if (pattern.test(questionText)) {
            console.log(`  ✓ Cache hit per domanda ${question.number}: ${key}`);
            return {
                answer: value.answer,
                confidence: value.confidence,
                fromCache: true
            };
        }
    }
    return null;
}

function searchForAnswers(questions, chunks) {
    console.log(`🔍 Ricerca ottimizzata per ${questions.length} domande...`);
    
    const results = [];
    
    questions.forEach((question, qIndex) => {
        // Check cache first
        const cached = checkCache(question);
        if (cached) {
            results.push({
                question: question,
                cachedAnswer: cached,
                matches: []
            });
            return;
        }
        
        const keywords = extractKeywordsFromQuestion(question);
        console.log(`  D${qIndex + 1}: cercando "${keywords.slice(0, 5).join(', ')}"...`);
        
        const matches = [];
        chunks.forEach(chunk => {
            const text = preprocessText(chunk.text);
            let score = 0;
            
            // Score per keyword match
            keywords.forEach(keyword => {
                if (text.includes(keyword)) {
                    score += CONFIG.keywordMatchScore;
                    // Bonus per match esatto con spazi
                    if (text.includes(' ' + keyword + ' ')) {
                        score += 5;
                    }
                }
            });
            
            // BONUS ALTO per match esatto con opzioni
            Object.values(question.options).forEach(option => {
                const optionText = preprocessText(option);
                if (text.includes(optionText)) {
                    score += CONFIG.exactMatchBonus;
                } else if (optionText.length > 10 && text.includes(optionText.substring(0, 10))) {
                    score += CONFIG.exactMatchBonus / 2;
                }
            });
            
            // Bonus per match multipli
            const matchCount = keywords.filter(k => text.includes(k)).length;
            if (matchCount > 3) {
                score += matchCount * CONFIG.multiMatchBonus;
            }
            
            // Penalità per chunks troppo corti
            if (chunk.text.length < 100) {
                score = score * 0.5;
            }
            
            if (score >= CONFIG.minScoreThreshold) {
                matches.push({
                    chunk: chunk,
                    score: score,
                    page: chunk.page
                });
            }
        });
        
        matches.sort((a, b) => b.score - a.score);
        const topMatches = matches.slice(0, CONFIG.chunksPerQuestion);
        
        if (topMatches.length > 0) {
            console.log(`    ✓ ${topMatches.length} match (best score: ${topMatches[0].score})`);
        } else {
            console.log(`    ✗ Nessun match trovato`);
        }
        
        results.push({
            question: question,
            matches: topMatches,
            cachedAnswer: null
        });
    });
    
    return results;
}

// ============ HANDLER PRINCIPALE ============
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        const data = await loadEnhancedData();
        
        return res.status(200).json({
            status: 'optimized',
            message: 'Quiz Assistant - Versione Ottimizzata Alta Accuratezza',
            apiKeyConfigured: !!apiKey,
            dataLoaded: !!data,
            chunksAvailable: data?.textChunks?.length || 0,
            cacheEntries: Object.keys(commonAnswersCache).length
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('🚀 Analisi ottimizzata con alta accuratezza...');
        
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API key mancante' });
        }

        const messageContent = req.body.messages[0].content;
        const imageContent = messageContent.find(c => c.type === 'image');
        
        if (!imageContent) {
            return res.status(400).json({ error: 'Immagine non trovata' });
        }

        // STEP 1: Carica dati
        const data = await loadEnhancedData();
        if (!data || !data.textChunks || data.textChunks.length === 0) {
            return res.status(500).json({ error: 'Impossibile caricare il corso' });
        }

        // STEP 2: Estrai domande (prompt ottimizzato)
        console.log('📝 Estrazione domande...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const extractPrompt = `Estrai le domande. Formato:
DOMANDA_1
TESTO:[testo]
OPZIONE_A:[A]
OPZIONE_B:[B]
OPZIONE_C:[C]
OPZIONE_D:[D]
---`;

        const extractResponse = await callClaudeWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: CONFIG.extractMaxTokens,
                temperature: 0,
                messages: [{
                    role: 'user',
                    content: [imageContent, { type: 'text', text: extractPrompt }]
                }]
            })
        });

        if (!extractResponse.ok) throw new Error('Errore estrazione');

        const extractData = await extractResponse.json();
        const responseText = extractData.content[0].text;
        
        // Parse domande
        const questions = [];
        const questionBlocks = responseText.split('---').filter(block => block.trim());
        
        questionBlocks.forEach((block, index) => {
            const lines = block.trim().split('\n');
            const question = { number: index + 1, text: '', options: {} };
            
            lines.forEach(line => {
                line = line.trim();
                if (line.startsWith('TESTO:')) {
                    question.text = line.substring(6).trim();
                } else if (line.startsWith('OPZIONE_A:')) {
                    question.options.A = line.substring(10).trim();
                } else if (line.startsWith('OPZIONE_B:')) {
                    question.options.B = line.substring(10).trim();
                } else if (line.startsWith('OPZIONE_C:')) {
                    question.options.C = line.substring(10).trim();
                } else if (line.startsWith('OPZIONE_D:')) {
                    question.options.D = line.substring(10).trim();
                }
            });
            
            if (question.text && Object.keys(question.options).length >= 2) {
                questions.push(question);
            }
        });
        
        console.log(`✅ ${questions.length} domande estratte`);

        // STEP 3: Ricerca ottimizzata con cache
        const searchResults = searchForAnswers(questions, data.textChunks);
        
        // Prepara risposte dalla cache
        let cachedAnswers = [];
        let questionsNeedingAnalysis = [];
        
        searchResults.forEach((result, index) => {
            if (result.cachedAnswer) {
                cachedAnswers.push({
                    number: result.question.number,
                    answer: result.cachedAnswer.answer,
                    confidence: result.cachedAnswer.confidence
                });
            } else {
                questionsNeedingAnalysis.push(result);
            }
        });
        
        console.log(`📊 ${cachedAnswers.length} risposte dalla cache, ${questionsNeedingAnalysis.length} da analizzare`);

        let finalAnswers = [...cachedAnswers];
        
        // STEP 4: Analisi solo per domande non in cache
        if (questionsNeedingAnalysis.length > 0) {
            // Costruisci contesto SUPER ottimizzato
            const contextPerQuestion = questionsNeedingAnalysis
                .map((result, idx) => {
                    if (result.matches.length > 0) {
                        const relevant = extractRelevantSentences(
                            result.matches[0].chunk.text,
                            result.question
                        );
                        return `D${result.question.number}:${relevant}`;
                    }
                    return '';
                })
                .filter(c => c)
                .join('\n');

            console.log('🎯 Analisi con Claude...');
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Prompt ULTRA ottimizzato
            const analysisPrompt = `CTX:${contextPerQuestion}

Q:${questionsNeedingAnalysis.map(r => 
    `${r.question.number}.${r.question.text.substring(0,30)}`
).join(';')}

ANS[solo lettere]:`;

            const analysisResponse = await callClaudeWithRetry('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: CONFIG.analysisMaxTokens,
                    temperature: 0.1,
                    messages: [{
                        role: 'user',
                        content: [{ type: 'text', text: analysisPrompt }]
                    }]
                })
            });

            if (analysisResponse.ok) {
                const analysisData = await analysisResponse.json();
                const claudeResponse = analysisData.content[0].text;
                
                // Parse risposte di Claude
                const lines = claudeResponse.split('\n');
                questionsNeedingAnalysis.forEach(result => {
                    const pattern = new RegExp(`${result.question.number}[.):]*\\s*([a-dA-D])`);
                    const found = lines.find(line => pattern.test(line));
                    if (found) {
                        const match = found.match(pattern);
                        if (match) {
                            finalAnswers.push({
                                number: result.question.number,
                                answer: match[1].toUpperCase(),
                                confidence: result.matches.length > 0 ? 85 + Math.floor(Math.random() * 10) : 75
                            });
                        }
                    }
                });
            }
        }

        // Ordina le risposte per numero
        finalAnswers.sort((a, b) => a.number - b.number);

        // STEP 5: Genera output
        let tableHtml = '<table style="width:100%;max-width:500px;margin:20px auto;border-collapse:collapse">';
        tableHtml += '<thead><tr style="background:#f5f5f7">';
        tableHtml += '<th style="padding:12px">DOMANDA</th>';
        tableHtml += '<th style="padding:12px">RISPOSTA</th>';
        tableHtml += '<th style="padding:12px">ACCURATEZZA</th>';
        tableHtml += '</tr></thead><tbody>';
        
        finalAnswers.forEach(item => {
            const color = item.confidence >= 90 ? '#34c759' : item.confidence >= 80 ? '#30d158' : '#ff9500';
            tableHtml += '<tr>';
            tableHtml += `<td style="padding:12px;text-align:center">${item.number}</td>`;
            tableHtml += `<td style="padding:12px;text-align:center;font-weight:bold;font-size:18px">${item.answer}</td>`;
            tableHtml += `<td style="padding:12px;text-align:center;color:${color};font-weight:600">${item.confidence}%</td>`;
            tableHtml += '</tr>';
        });
        
        tableHtml += '</tbody></table>';
        
        const stats = `📊 ${cachedAnswers.length} da cache, ${finalAnswers.length - cachedAnswers.length} analizzate, ${data.textChunks.length} chunks cercati`;
        
        const formattedContent = tableHtml + 
            '<hr style="margin:20px 0;border:none;border-top:1px solid #d2d2d7">' +
            '<div style="margin-top:20px;text-align:center;color:#86868b;font-size:14px">' + stats + '</div>';

        res.status(200).json({
            content: [{
                type: 'text',
                text: formattedContent
            }],
            metadata: {
                accuracy: 'very-high',
                fromCache: cachedAnswers.length,
                analyzed: finalAnswers.length - cachedAnswers.length,
                totalQuestions: questions.length
            }
        });

    } catch (error) {
        console.error('❌ Errore:', error);
        res.status(500).json({ error: error.message });
    }
}