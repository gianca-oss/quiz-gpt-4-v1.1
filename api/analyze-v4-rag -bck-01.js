// api/analyze-v4-rag.js
// Endpoint che usa i dati preprocessati con Pinecone

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const CONFIG = {
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        indexName: 'quiz-course-v4-vision'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-3.5-turbo',
        embeddingModel: 'text-embedding-3-small'
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY_EVO
    }
};

// Inizializza servizi
let pineconeIndex = null;
let openaiClient = null;

async function initServices() {
    // Verifica le chiavi API
    if (!CONFIG.pinecone.apiKey) {
        throw new Error('PINECONE_API_KEY non configurata');
    }
    if (!CONFIG.openai.apiKey) {
        throw new Error('OPENAI_API_KEY non configurata');
    }
    if (!CONFIG.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY_EVO non configurata');
    }
    
    if (!pineconeIndex) {
        const pc = new Pinecone({ apiKey: CONFIG.pinecone.apiKey });
        pineconeIndex = pc.index(CONFIG.pinecone.indexName);
    }
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: CONFIG.openai.apiKey });
    }
}

// Cerca nel database vettoriale
async function searchKnowledge(questionText, options) {
    try {
        // Genera embedding della domanda
        const queryText = questionText + ' ' + Object.values(options).join(' ');
        
        const embeddingResponse = await openaiClient.embeddings.create({
            model: CONFIG.openai.embeddingModel,
            input: queryText
        });
        
        // Verifica risposta embedding
        if (!embeddingResponse?.data?.[0]?.embedding) {
            console.error('Invalid embedding response:', embeddingResponse);
            return '';
        }
        
        // Cerca in Pinecone
        const results = await pineconeIndex.query({
            vector: embeddingResponse.data[0].embedding,
            topK: 5,
            includeMetadata: true
        });
        
        // Estrai contesto rilevante
        const context = results.matches
            .filter(m => m.score > 0.7)
            .map(m => m.metadata?.text || '')
            .filter(text => text.length > 0)
            .join('\n\n');
        
        return context;
    } catch (error) {
        console.error('Error in searchKnowledge:', error);
        return '';
    }
}

// Analizza domanda con RAG
async function analyzeQuestionWithRAG(question, context) {
    const prompt = `Basandoti ESCLUSIVAMENTE sul seguente contesto del corso, rispondi alla domanda.

CONTESTO:
${context || 'Nessun contesto disponibile'}

DOMANDA: ${question.text}
OPZIONI:
${Object.entries(question.options).map(([k, v]) => `${k}: ${v}`).join('\n')}

Quale è la risposta corretta? Rispondi SOLO con la lettera (A, B, C o D).`;

    const response = await openaiClient.chat.completions.create({
        model: CONFIG.openai.model,
        messages: [
            { role: 'system', content: 'Rispondi basandoti solo sul contesto fornito.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 10
    });
    
    // Gestisci risposta
    const answer = response?.choices?.[0]?.message?.content?.trim().toUpperCase() || 'N/A';
    return answer.match(/^[ABCD]$/) ? answer : 'N/A';
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ready',
            version: 'v4-rag',
            services: {
                pinecone: !!CONFIG.pinecone.apiKey,
                openai: !!CONFIG.openai.apiKey,
                anthropic: !!CONFIG.anthropic.apiKey
            }
        });
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        console.log('🚀 Analisi con RAG v4...');
        
        // Inizializza servizi
        await initServices();
        
        // Validazione request body
        if (!req.body?.messages?.[0]?.content) {
            return res.status(400).json({ 
                error: 'Invalid request body',
                details: 'Expected messages with content' 
            });
        }
        
        const messageContent = req.body.messages[0].content;
        const imageContent = messageContent.find(c => c.type === 'image');
        
        if (!imageContent) {
            return res.status(400).json({ 
                error: 'No image found',
                details: 'Image is required for analysis' 
            });
        }
        
        // Estrai domande con Claude - PROMPT MIGLIORATO
        console.log('Calling Claude API...');
        const extractResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.anthropic.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 3000,
                temperature: 0,
                messages: [{
                    role: 'user',
                    content: [
                        imageContent,
                        { 
                            type: 'text', 
                            text: `Analyze this quiz/test image very carefully. I need you to extract ALL quiz questions visible in the image.

Look for:
- Questions numbered as 1, 2, 3, etc. OR 1., 2., 3., etc. OR Q1, Q2, Q3, etc.
- Multiple choice questions with options like A, B, C, D OR a), b), c), d)
- Any text that appears to be a quiz or test question
- Questions may be in Italian or English

For EACH question you find, extract:
1. The question number (as shown in the image)
2. The COMPLETE question text (every word)
3. ALL answer options with their complete text

IMPORTANT: 
- Extract questions EXACTLY as they appear in the image
- Include ALL visible questions, even if partially visible
- If options use letters (A,B,C,D) or (a,b,c,d), normalize them to A,B,C,D

Return ONLY this JSON structure with NO additional text:
{
  "questions": [
    {
      "number": 1,
      "text": "full question text exactly as shown",
      "options": {
        "A": "complete text of option A",
        "B": "complete text of option B",
        "C": "complete text of option C",
        "D": "complete text of option D"
      }
    }
  ]
}

If no questions are found, return: {"questions": []}

Remember: ONLY return the JSON, nothing else.`
                        }
                    ]
                }]
            })
        });
        
        if (!extractResponse.ok) {
            const errorText = await extractResponse.text();
            console.error('Claude API error:', extractResponse.status, errorText);
            return res.status(500).json({ 
                error: 'Claude API error',
                status: extractResponse.status,
                details: errorText 
            });
        }
        
        const extractData = await extractResponse.json();
        console.log('Claude response received');
        
        // Log completo per debug
        console.log('Full Claude response structure:', JSON.stringify(extractData, null, 2));
        
        // Trova il contenuto testuale nella risposta
        let questionsText = '';
        if (extractData?.content) {
            for (const content of extractData.content) {
                if (content.type === 'text' && content.text) {
                    questionsText = content.text;
                    break;
                }
            }
        }
        
        if (!questionsText) {
            console.error('No text found in Claude response:', extractData);
            return res.status(500).json({ 
                error: 'No text in Claude response',
                details: 'Could not extract questions from image'
            });
        }
        
        // Log del testo raw per debug
        console.log('Raw text from Claude:', questionsText);
        
        // Parse JSON con pulizia
        let questions;
        try {
            // Pulisci il testo da eventuali caratteri extra
            questionsText = questionsText.trim();
            
            // Rimuovi eventuali markdown code blocks
            if (questionsText.includes('```')) {
                questionsText = questionsText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
            }
            
            // Rimuovi eventuali spazi o newline all'inizio e alla fine
            questionsText = questionsText.trim();
            
            // Parse del JSON
            const parsed = JSON.parse(questionsText);
            questions = parsed.questions || [];
            
            console.log(`Successfully parsed ${questions.length} questions`);
        } catch (parseError) {
            console.error('JSON parse error:', parseError.message);
            console.error('Text that failed to parse:', questionsText);
            
            // Tentativo di recovery: cerca un JSON valido nel testo
            try {
                const jsonMatch = questionsText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    questions = parsed.questions || [];
                    console.log(`Recovery successful: found ${questions.length} questions`);
                } else {
                    throw parseError;
                }
            } catch (recoveryError) {
                return res.status(500).json({ 
                    error: 'Failed to parse questions',
                    details: parseError.message,
                    rawText: questionsText.substring(0, 500) // Solo i primi 500 caratteri per debug
                });
            }
        }
        
        console.log(`✅ Extracted ${questions.length} questions`);
        
        // Se non ci sono domande
        if (questions.length === 0) {
            return res.status(200).json({
                content: [{
                    type: 'text',
                    text: '<div style="text-align:center;padding:20px;color:#86868b;">Nessuna domanda trovata nell\'immagine. Assicurati che l\'immagine contenga domande di quiz ben visibili.</div>'
                }],
                metadata: {
                    questionsAnalyzed: 0,
                    method: 'rag-v4-vision'
                }
            });
        }
        
        // Log delle domande estratte per debug
        questions.forEach((q, i) => {
            console.log(`Question ${i+1}: ${q.text?.substring(0, 50)}...`);
        });
        
        // Analizza ogni domanda con RAG
        const results = [];
        for (const question of questions) {
            try {
                const context = await searchKnowledge(question.text, question.options || {});
                const answer = await analyzeQuestionWithRAG(question, context);
                
                results.push({
                    number: question.number || results.length + 1,
                    answer: answer,
                    confidence: context && context.length > 100 ? 95 : 80
                });
                
                console.log(`Q${question.number}: ${answer} (context: ${context.length} chars)`);
            } catch (err) {
                console.error(`Error processing question ${question.number}:`, err);
                results.push({
                    number: question.number || results.length + 1,
                    answer: 'ERROR',
                    confidence: 0
                });
            }
        }
        
        // Formatta risposta HTML
        let html = '<table style="width:100%;max-width:500px;margin:20px auto;border-collapse:collapse">';
        html += '<thead><tr style="background:#f5f5f7">';
        html += '<th style="padding:12px">DOMANDA</th>';
        html += '<th style="padding:12px">RISPOSTA</th>';
        html += '<th style="padding:12px">CONFIDENZA</th>';
        html += '</tr></thead><tbody>';
        
        for (const result of results) {
            const color = result.confidence >= 90 ? '#34c759' : result.confidence === 0 ? '#ff3b30' : '#ff9500';
            html += '<tr>';
            html += `<td style="padding:12px;text-align:center">${result.number}</td>`;
            html += `<td style="padding:12px;text-align:center;font-weight:bold;font-size:18px">${result.answer}</td>`;
            html += `<td style="padding:12px;text-align:center;color:${color}">${result.confidence}%</td>`;
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        html += '<div style="margin-top:20px;text-align:center;color:#86868b;font-size:12px">';
        html += '✨ Powered by RAG v4 with Vision-enhanced knowledge base';
        html += '</div>';
        
        return res.status(200).json({
            content: [{
                type: 'text',
                text: html
            }],
            metadata: {
                questionsAnalyzed: questions.length,
                method: 'rag-v4-vision',
                accuracy: results.filter(r => r.confidence > 0).length > 0 ? 'very-high' : 'low'
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Stack:', error.stack);
        return res.status(500).json({ 
            error: error.message || 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.stack : 'Check server logs for details'
        });
    }
}