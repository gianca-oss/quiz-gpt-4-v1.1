// api/analyze-simple.js
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Gestione OPTIONS per CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
            timestamp: new Date().toISOString()
        });
    }
    
    if (req.method === 'POST') {
        try {
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurata' });
            }
            
            // Log per debug
            console.log('Ricevuta richiesta POST');
            
            // Inoltra direttamente a Claude
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(req.body)
            });
            
            // Controlla se la risposta è ok
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Errore da Claude:', response.status, errorText);
                return res.status(response.status).json({ 
                    error: `Claude API error: ${response.status}`,
                    details: errorText 
                });
            }
            
            const data = await response.json();
            return res.status(200).json(data);
            
        } catch (error) {
            console.error('Errore nel handler:', error);
            return res.status(500).json({ 
                error: error.message || 'Errore interno'
            });
        }
    }
    
    // Metodo non supportato
    return res.status(405).json({ error: 'Metodo non supportato' });
}