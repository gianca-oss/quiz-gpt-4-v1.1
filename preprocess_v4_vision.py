# preprocess_v4_vision.py
# Preprocessing avanzato con GPT-4 Vision per contenuti visuali
# Ottimizzato per Windows 11

import os
import json
import time
import base64
import io
from typing import List, Dict, Any, Optional
from pathlib import Path

# Dipendenze esterne
from dotenv import load_dotenv
import openai
from openai import OpenAI
from pinecone import Pinecone
import PyPDF2
import tiktoken
from PIL import Image
from pdf2image import convert_from_path

# Carica configurazione da .env.local
load_dotenv('.env.local')

# ============ CONFIGURAZIONE ============
CONFIG = {
    'openai': {
        'api_key': os.getenv('OPENAI_API_KEY'),
        'model': 'gpt-3.5-turbo',
        'vision_model': 'gpt-4o',  # Modello Vision
        'embedding_model': 'text-embedding-3-small',
        'max_tokens': 500,
        'temperature': 0.1
    },
    'pinecone': {
        'api_key': os.getenv('PINECONE_API_KEY'),
        'environment': os.getenv('PINECONE_ENVIRONMENT', 'us-east-1'),
        'index_name': 'quiz-course-v4-vision',
        'dimension': 1536
    },
    'vision': {
        'enable': True,  # Abilita/disabilita Vision
        'dpi': 150,  # Risoluzione conversione PDF->immagine
        'max_pages': 300,  # Max pagine da analizzare con Vision
        'min_text_threshold': 200,  # Se meno caratteri, usa Vision
        'keywords': ['figura', 'diagramma', 'tabella', 'grafico', 'algoritmo', 'schema'],
        'cost_per_page': 0.01  # Stima costo per pagina
    },
    'processing': {
        'chunk_size': 1000,
        'chunk_overlap': 200,
        'max_chunks_to_process': None,  # None = processa tutto
        'batch_size': 10
    },
    'paths': {
        'pdf_source': r'data\source\corso_completo.pdf',
        'output_dir': r'data\processed-v4',
        'chunks_file': r'data\processed-v4\chunks_vision.json',
        'metadata_file': r'data\processed-v4\metadata_vision.json',
        'vision_cache': r'data\processed-v4\vision_cache'
    },
    'poppler': {
        'path': r'C:\poppler\Library\bin'  # Path di Poppler per Windows
    }
}

# Aggiungi Poppler al PATH se su Windows
if os.name == 'nt' and CONFIG['poppler']['path']:
    os.environ['PATH'] = CONFIG['poppler']['path'] + ';' + os.environ['PATH']

class PDFProcessor:
    """Gestisce l'estrazione e il processing del PDF"""
    
    def __init__(self):
        self.text = ""
        self.metadata = {}
        self.pages = []
        self.vision_candidates = []
    
    def extract_pdf(self, pdf_path: str) -> str:
        """Estrae testo dal PDF e identifica pagine per Vision"""
        print(f"📚 Estrazione PDF: {pdf_path}")
        
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF non trovato: {pdf_path}")
        
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            
            self.metadata = {
                'total_pages': len(pdf_reader.pages),
                'info': pdf_reader.metadata if pdf_reader.metadata else {}
            }
            
            print(f"  📄 Totale pagine: {self.metadata['total_pages']}")
            
            # Estrai testo e identifica candidati per Vision
            for i, page in enumerate(pdf_reader.pages):
                page_text = page.extract_text()
                page_data = {
                    'page_num': i + 1,
                    'text': page_text,
                    'char_count': len(page_text),
                    'needs_vision': self._should_use_vision(page_text, i + 1)
                }
                
                self.pages.append(page_data)
                self.text += page_text + "\n\n"
                
                if page_data['needs_vision']:
                    self.vision_candidates.append(i + 1)
                
                if (i + 1) % 50 == 0:
                    print(f"  ✓ Processate {i + 1}/{self.metadata['total_pages']} pagine")
        
        print(f"✅ Estratti {len(self.text)} caratteri totali")
        print(f"👁️ {len(self.vision_candidates)} pagine candidate per Vision\n")
        
        return self.text
    
    def _should_use_vision(self, page_text: str, page_num: int) -> bool:
        """Determina se una pagina necessita analisi Vision"""
        if not CONFIG['vision']['enable']:
            return False
        
        # Criteri per usare Vision
        text_lower = page_text.lower()
        
        # 1. Poco testo (probabilmente immagini/diagrammi)
        if len(page_text.strip()) < CONFIG['vision']['min_text_threshold']:
            return True
        
        # 2. Keywords che indicano contenuto visuale
        for keyword in CONFIG['vision']['keywords']:
            if keyword in text_lower:
                return True
        
        # 3. Presenza di tabelle (molti pipe |)
        if page_text.count('|') > 10:
            return True
        
        # 4. Possibili blocchi di codice
        if '```' in page_text or page_text.count('    ') > 20:
            return True
        
        # 5. Pattern di formule matematiche
        if any(symbol in page_text for symbol in ['∑', '∫', '√', 'Δ', 'α', 'β', 'γ']):
            return True
        
        return False
    
    def create_chunks(self, text: str) -> List[Dict]:
        """Divide il testo in chunks intelligenti"""
        print("🧩 Creazione chunks semantici...")
        
        chunks = []
        chunk_size = CONFIG['processing']['chunk_size']
        overlap = CONFIG['processing']['chunk_overlap']
        
        paragraphs = text.split('\n\n')
        current_chunk = ""
        chunk_id = 0
        current_page = 1
        
        for para in paragraphs:
            # Stima pagina corrente
            char_position = self.text.find(para)
            for page in self.pages:
                if char_position < sum(p['char_count'] for p in self.pages[:page['page_num']]):
                    current_page = page['page_num']
                    break
            
            if len(current_chunk) + len(para) > chunk_size and current_chunk:
                chunks.append({
                    'id': f'chunk_{chunk_id}',
                    'text': current_chunk.strip(),
                    'char_count': len(current_chunk),
                    'chunk_index': chunk_id,
                    'page_num': current_page,
                    'needs_vision': current_page in self.vision_candidates
                })
                chunk_id += 1
                
                # Overlap
                sentences = current_chunk.split('. ')
                if len(sentences) > 2:
                    overlap_text = '. '.join(sentences[-2:])[:overlap]
                    current_chunk = overlap_text + " " + para
                else:
                    current_chunk = para
            else:
                current_chunk += "\n\n" + para if current_chunk else para
        
        # Aggiungi ultimo chunk
        if current_chunk.strip():
            chunks.append({
                'id': f'chunk_{chunk_id}',
                'text': current_chunk.strip(),
                'char_count': len(current_chunk),
                'chunk_index': chunk_id,
                'page_num': current_page,
                'needs_vision': current_page in self.vision_candidates
            })
        
        vision_chunks = sum(1 for c in chunks if c.get('needs_vision'))
        print(f"✅ Creati {len(chunks)} chunks")
        print(f"   di cui {vision_chunks} richiedono Vision\n")
        
        return chunks

class VisionAnalyzer:
    """Analisi pagine PDF con GPT-4 Vision"""
    
    def __init__(self, openai_client: OpenAI):
        self.client = openai_client
        self.vision_model = CONFIG['openai']['vision_model']
        self.cache_dir = Path(CONFIG['paths']['vision_cache'])
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.vision_calls = 0
        self.vision_cost = 0.0
    
    def convert_pdf_page_to_image(self, pdf_path: str, page_num: int) -> Optional[str]:
        """Converte una pagina PDF in base64"""
        cache_file = self.cache_dir / f"page_{page_num}.txt"
        
        # Usa cache se disponibile
        if cache_file.exists():
            print(f"    📁 Usando cache per pagina {page_num}")
            return cache_file.read_text()
        
        try:
            # Converte PDF in immagine
            images = convert_from_path(
                pdf_path,
                first_page=page_num,
                last_page=page_num,
                dpi=CONFIG['vision']['dpi'],
                poppler_path=CONFIG['poppler']['path'] if os.name == 'nt' else None
            )
            
            if images:
                img = images[0]
                
                # Riduci dimensione se troppo grande
                max_size = (2000, 2000)
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                
                # Converti in base64
                buffer = io.BytesIO()
                img.save(buffer, format='PNG', optimize=True)
                img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                
                # Salva in cache
                cache_file.write_text(img_base64)
                
                return img_base64
        except Exception as e:
            print(f"    ❌ Errore conversione pagina {page_num}: {e}")
            return None
    
    def analyze_page_with_vision(self, page_image_base64: str, page_text: str, page_num: int) -> Optional[Dict]:
        """Analizza una pagina con GPT-4 Vision"""
        try:
            print(f"    🔍 Analisi Vision pagina {page_num}...")
            
            response = self.client.chat.completions.create(
                model=self.vision_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": """Analizza questa pagina di un corso di informatica.

Identifica elementi visuali e testo importante.

Rispondi SOLO con un JSON valido in questo formato esatto:
{
  "visual_elements": [],
  "extracted_text": "",
  "tables": [],
  "code_blocks": [],
  "key_concepts": [],
  "importance": 5,
  "summary": "riassunto breve"
}"""
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{page_image_base64}",
                                "detail": "high"
                            }
                        }
                    ]
                }],
                max_tokens=1500,
                temperature=0
            )
            
            # Estrai e pulisci la risposta
            response_text = response.choices[0].message.content
            
            # Rimuovi eventuali markdown o testo extra
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0]
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0]
            
            # Pulisci spazi e newline
            response_text = response_text.strip()
            
            # Prova a parsare il JSON
            try:
                result = json.loads(response_text)
            except json.JSONDecodeError as je:
                print(f"    ⚠️ JSON non valido, uso default. Errore: {je}")
                # Ritorna struttura default
                result = {
                    "visual_elements": [],
                    "extracted_text": "",
                    "tables": [],
                    "code_blocks": [],
                    "key_concepts": [],
                    "importance": 5,
                    "summary": "Pagina analizzata"
                }
            
            self.vision_calls += 1
            self.vision_cost += CONFIG['vision']['cost_per_page']
            
            elements_count = len(result.get('visual_elements', []))
            print(f"    ✅ Vision completata: {elements_count} elementi trovati")
            
            return result
            
        except Exception as e:
            print(f"    ⚠️ Errore Vision: {e}")
            # Ritorna struttura base invece di None
            return {
                "visual_elements": [],
                "extracted_text": "",
                "tables": [],
                "code_blocks": [],
                "key_concepts": [],
                "importance": 5,
                "summary": f"Errore analisi pagina {page_num}"
            }
    
    def process_vision_pages(self, pdf_path: str, pages_to_analyze: List[int], pages_data: List[Dict] = None) -> Dict[int, Dict]:
        """Processa tutte le pagine che richiedono Vision"""
        results = {}
        
        # Limita numero di pagine per costi
        max_pages = min(len(pages_to_analyze), CONFIG['vision']['max_pages'])
        if max_pages < len(pages_to_analyze):
            print(f"⚠️ Limitato a {max_pages} pagine per Vision (costo stimato: ${max_pages * CONFIG['vision']['cost_per_page']:.2f})")
            pages_to_analyze = pages_to_analyze[:max_pages]
        
        print(f"👁️ Analisi Vision di {len(pages_to_analyze)} pagine...")
        
        for i, page_num in enumerate(pages_to_analyze):
            print(f"  [{i+1}/{len(pages_to_analyze)}] Pagina {page_num}")
            
            # Converti pagina in immagine
            img_base64 = self.convert_pdf_page_to_image(pdf_path, page_num)
            
            if img_base64:
                # Ottieni testo OCR base se disponibile
                page_text = ""
                if pages_data:
                    for page in pages_data:
                        if page['page_num'] == page_num:
                            page_text = page['text']
                            break
                
                # Analizza con Vision
                vision_result = self.analyze_page_with_vision(img_base64, page_text, page_num)
                
                if vision_result:
                    results[page_num] = vision_result
            
            # Pausa per evitare rate limiting
            if (i + 1) % 5 == 0 and i < len(pages_to_analyze) - 1:
                time.sleep(2)
        
        print(f"✅ Vision completata: {self.vision_calls} chiamate, costo stimato: ${self.vision_cost:.2f}\n")
        
        return results

class SemanticAnalyzer:
    """Analisi semantica con OpenAI"""
    
    def __init__(self):
        self.client = OpenAI(api_key=CONFIG['openai']['api_key'])
        self.encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
    
    def analyze_chunk(self, chunk: Dict, vision_data: Optional[Dict] = None) -> Dict:
        """Analizza semanticamente un chunk, integrando dati Vision se disponibili"""
        try:
            # Prepara testo arricchito se abbiamo dati Vision
            enriched_text = chunk['text']
            
            if vision_data:
                # Aggiungi testo estratto da Vision
                if vision_data.get('extracted_text'):
                    enriched_text += f"\n\n[VISION ENHANCED]\n{vision_data['extracted_text']}"
                
                # Aggiungi descrizioni di elementi visuali
                for element in vision_data.get('visual_elements', []):
                    enriched_text += f"\n[{element['type'].upper()}]: {element.get('description', '')}"
            
            prompt = f"""Analizza questo estratto di un corso di informatica.
            
{'[ARRICCHITO CON VISION]' if vision_data else ''}

Testo:
{enriched_text[:2500]}

Estrai:
1. L'argomento principale
2. I concetti chiave (max 7)
3. Il tipo di contenuto
4. L'importanza (1-10)

Rispondi in JSON:
{{
  "topic": "argomento principale",
  "concepts": ["concetto1", "concetto2"],
  "content_type": "theory|practice|example|definition|visual",
  "importance": 1-10,
  "has_visual": {str(vision_data is not None).lower()},
  "summary": "riassunto in una frase"
}}"""

            response = self.client.chat.completions.create(
                model=CONFIG['openai']['model'],
                messages=[{"role": "user", "content": prompt}],
                temperature=CONFIG['openai']['temperature'],
                max_tokens=CONFIG['openai']['max_tokens'],
                response_format={"type": "json_object"}
            )
            
            analysis = json.loads(response.choices[0].message.content)
            
            # Integra concetti da Vision
            if vision_data and vision_data.get('key_concepts'):
                existing = set(analysis.get('concepts', []))
                existing.update(vision_data['key_concepts'])
                analysis['concepts'] = list(existing)[:7]
            
            # Aumenta importanza se ha contenuti visuali importanti
            if vision_data and vision_data.get('importance', 0) > 7:
                analysis['importance'] = max(analysis.get('importance', 5), vision_data['importance'])
            
            return analysis
            
        except Exception as e:
            print(f"  ⚠️ Errore analisi: {e}")
            return {
                'topic': 'Unknown',
                'concepts': vision_data.get('key_concepts', []) if vision_data else [],
                'content_type': 'visual' if vision_data else 'text',
                'importance': vision_data.get('importance', 5) if vision_data else 5,
                'has_visual': vision_data is not None,
                'summary': chunk['text'][:100]
            }
    
    def generate_embedding(self, text: str, vision_enhanced: bool = False) -> Optional[List[float]]:
        """Genera embedding per il testo"""
        try:
            # Usa modello diverso per testi con Vision?
            model = CONFIG['openai']['embedding_model']
            
            response = self.client.embeddings.create(
                model=model,
                input=text[:8000]
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"  ⚠️ Errore embedding: {e}")
            return None

class VectorIndexer:
    """Gestisce l'indicizzazione in Pinecone"""
    
    def __init__(self):
        self.pc = Pinecone(api_key=CONFIG['pinecone']['api_key'])
        self.index_name = CONFIG['pinecone']['index_name']
        self.index = None
        self._setup_index()
    
    def _setup_index(self):
        """Crea o connette all'indice Pinecone"""
        print("🔗 Configurazione Pinecone...")
        
        existing_indexes = [idx.name for idx in self.pc.list_indexes()]
        
        if self.index_name not in existing_indexes:
            print(f"  📦 Creazione nuovo indice '{self.index_name}'...")
            self.pc.create_index(
                name=self.index_name,
                dimension=CONFIG['pinecone']['dimension'],
                metric='cosine',
                spec={
                    'serverless': {
                        'cloud': 'aws',
                        'region': 'us-east-1'
                    }
                }
            )
            print("  ⏳ Attesa inizializzazione (30 secondi)...")
            time.sleep(30)
        
        self.index = self.pc.Index(self.index_name)
        stats = self.index.describe_index_stats()
        print(f"✅ Indice pronto: {stats['total_vector_count']} vettori esistenti\n")
    
    def index_chunks(self, chunks: List[Dict]) -> int:
        """Indicizza i chunks in Pinecone"""
        print("🚀 Indicizzazione in Pinecone...")
        
        indexed = 0
        vision_enhanced = 0
        batch_size = CONFIG['processing']['batch_size']
        
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            vectors = []
            
            for chunk in batch:
                if chunk.get('embedding'):
                    metadata = {
                        'text': chunk['text'][:500],
                        'topic': chunk.get('analysis', {}).get('topic', 'Unknown'),
                        'concepts': ', '.join(chunk.get('analysis', {}).get('concepts', [])),
                        'importance': chunk.get('analysis', {}).get('importance', 5),
                        'chunk_index': chunk['chunk_index'],
                        'page_num': chunk.get('page_num', 0),
                        'has_vision': chunk.get('vision_enhanced', False),
                        'content_type': chunk.get('analysis', {}).get('content_type', 'text')
                    }
                    
                    # Aggiungi metadata Vision se presente
                    if chunk.get('vision_data'):
                        metadata['vision_elements'] = len(chunk['vision_data'].get('visual_elements', []))
                        vision_enhanced += 1
                    
                    vectors.append({
                        'id': chunk['id'],
                        'values': chunk['embedding'],
                        'metadata': metadata
                    })
            
            if vectors:
                try:
                    self.index.upsert(vectors)
                    indexed += len(vectors)
                    print(f"  ✓ Indicizzati {indexed} chunks ({vision_enhanced} con Vision)")
                except Exception as e:
                    print(f"  ❌ Errore batch: {e}")
        
        print(f"✅ Indicizzazione completata: {indexed} vettori")
        print(f"   di cui {vision_enhanced} arricchiti con Vision\n")
        
        return indexed

class PreprocessingPipeline:
    """Pipeline completa di preprocessing con Vision"""
    
    def __init__(self):
        self.pdf_processor = PDFProcessor()
        self.semantic_analyzer = SemanticAnalyzer()
        self.vector_indexer = VectorIndexer()
        self.vision_analyzer = None
        self.vision_results = {}
        
    def run(self):
        """Esegue il preprocessing completo con Vision"""
        print("╔════════════════════════════════════════╗")
        print("║   PREPROCESSING v4 + VISION            ║")
        print("╚════════════════════════════════════════╝\n")
        
        start_time = time.time()
        
        try:
            # 1. Estrai PDF e identifica pagine per Vision
            pdf_text = self.pdf_processor.extract_pdf(CONFIG['paths']['pdf_source'])
            
            # 2. Analisi Vision delle pagine candidate
            if CONFIG['vision']['enable'] and self.pdf_processor.vision_candidates:
                self.vision_analyzer = VisionAnalyzer(self.semantic_analyzer.client)
                self.vision_results = self.vision_analyzer.process_vision_pages(
                    CONFIG['paths']['pdf_source'],
                    self.pdf_processor.vision_candidates,
                    self.pdf_processor.pages  # Passa i dati delle pagine
                )
            
            # 3. Crea chunks
            chunks = self.pdf_processor.create_chunks(pdf_text)
            
            # Limita chunks per test se configurato
            max_chunks = CONFIG['processing'].get('max_chunks_to_process')
            if max_chunks and len(chunks) > max_chunks:
                print(f"⚠️ Limitato a {max_chunks} chunks per test\n")
                chunks = chunks[:max_chunks]
            
            # 4. Analisi semantica con integrazione Vision
            print("🧠 Analisi semantica con OpenAI...")
            analyzed_chunks = []
            
            for i, chunk in enumerate(chunks):
                print(f"\r  Analisi chunk {i+1}/{len(chunks)}...", end='')
                
                # Recupera dati Vision se disponibili per questa pagina
                vision_data = self.vision_results.get(chunk.get('page_num'))
                
                # Se abbiamo dati Vision, arricchisci il chunk
                if vision_data:
                    chunk['vision_enhanced'] = True
                    chunk['vision_data'] = vision_data
                    
                    # Aggiungi testo estratto da Vision
                    if vision_data.get('extracted_text'):
                        chunk['text'] += f"\n\n{vision_data['extracted_text']}"
                
                # Analisi semantica (con o senza Vision)
                analysis = self.semantic_analyzer.analyze_chunk(chunk, vision_data)
                chunk['analysis'] = analysis
                
                # Genera embedding del testo arricchito
                embedding = self.semantic_analyzer.generate_embedding(
                    chunk['text'], 
                    vision_enhanced=chunk.get('vision_enhanced', False)
                )
                chunk['embedding'] = embedding
                
                analyzed_chunks.append(chunk)
                
                # Pausa per evitare rate limiting
                if (i + 1) % 10 == 0:
                    time.sleep(1)
            
            print(f"\n✅ Analizzati {len(analyzed_chunks)} chunks\n")
            
            # 5. Indicizza in Pinecone
            indexed = self.vector_indexer.index_chunks(analyzed_chunks)
            
            # 6. Salva dati locali
            self._save_data(analyzed_chunks, indexed)
            
            # Report finale
            elapsed = time.time() - start_time
            self._print_report(len(chunks), indexed, elapsed)
            
        except Exception as e:
            print(f"\n❌ ERRORE: {e}")
            import traceback
            traceback.print_exc()
            print("\nVerifica:")
            print("1. Le API keys in .env.local")
            print("2. Il file corso_completo.pdf in data\\source\\")
            print("3. Poppler installato (per Vision)")
            print("4. La connessione internet")
    
    def _save_data(self, chunks: List[Dict], indexed: int):
        """Salva i dati processati"""
        print("💾 Salvataggio dati locali...")
        
        output_dir = Path(CONFIG['paths']['output_dir'])
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Prepara chunks per salvataggio (rimuovi embeddings)
        chunks_to_save = []
        vision_enhanced_count = 0
        
        for chunk in chunks:
            chunk_copy = chunk.copy()
            chunk_copy.pop('embedding', None)
            
            if chunk_copy.get('vision_enhanced'):
                vision_enhanced_count += 1
            
            chunks_to_save.append(chunk_copy)
        
        # Salva chunks
        chunks_file = Path(CONFIG['paths']['chunks_file'])
        with open(chunks_file, 'w', encoding='utf-8') as f:
            json.dump(chunks_to_save, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Chunks salvati: {chunks_file}")
        
        # Salva metadata
        metadata = {
            'version': '4.0-vision',
            'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'pdf_metadata': self.pdf_processor.metadata,
            'vision': {
                'enabled': CONFIG['vision']['enable'],
                'pages_analyzed': len(self.vision_results) if self.vision_analyzer else 0,
                'vision_calls': self.vision_analyzer.vision_calls if self.vision_analyzer else 0,
                'estimated_cost': self.vision_analyzer.vision_cost if self.vision_analyzer else 0,
                'enhanced_chunks': vision_enhanced_count
            },
            'processing': {
                'total_chunks': len(chunks),
                'indexed_vectors': indexed,
                'chunk_size': CONFIG['processing']['chunk_size'],
                'model': CONFIG['openai']['model'],
                'vision_model': CONFIG['openai']['vision_model'],
                'embedding_model': CONFIG['openai']['embedding_model']
            },
            'topics': list(set(c.get('analysis', {}).get('topic', '') 
                             for c in chunks if c.get('analysis', {}).get('topic')))
        }
        
        metadata_file = Path(CONFIG['paths']['metadata_file'])
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Metadata salvato: {metadata_file}\n")
    
    def _print_report(self, total_chunks: int, indexed: int, elapsed: float):
        """Stampa report finale"""
        print("╔════════════════════════════════════════╗")
        print("║     PREPROCESSING COMPLETATO CON VISION  ║")
        print("╚════════════════════════════════════════╝\n")
        
        print(f"📊 RISULTATI:")
        print(f"  • Chunks processati: {total_chunks}")
        print(f"  • Vettori indicizzati: {indexed}")
        
        if self.vision_analyzer:
            print(f"\n👁️ VISION:")
            print(f"  • Pagine analizzate: {self.vision_analyzer.vision_calls}")
            print(f"  • Costo Vision: ${self.vision_analyzer.vision_cost:.2f}")
            print(f"  • Elementi visuali trovati: {sum(len(v.get('visual_elements', [])) for v in self.vision_results.values())}")
        
        print(f"\n⏱️ PERFORMANCE:")
        print(f"  • Tempo totale: {elapsed:.1f} secondi ({elapsed/60:.1f} minuti)")
        print(f"  • Tempo per chunk: {elapsed/total_chunks:.2f} secondi")
        
        print(f"\n💾 OUTPUT:")
        print(f"  • Dati salvati in: {CONFIG['paths']['output_dir']}")
        print(f"  • Cache Vision in: {CONFIG['paths']['vision_cache']}")
        
        total_cost = self.vision_analyzer.vision_cost if self.vision_analyzer else 0
        total_cost += total_chunks * 0.002  # Stima costo GPT-3.5
        print(f"\n💰 COSTO STIMATO TOTALE: ${total_cost:.2f}")
        
        print(f"\n✨ Il corso è pronto per l'analisi semantica avanzata dei quiz!")

def check_dependencies():
    """Verifica dipendenze necessarie"""
    print("🔍 Verifica dipendenze...")
    
    errors = []
    
    # Verifica API keys
    if not CONFIG['openai']['api_key']:
        errors.append("❌ OPENAI_API_KEY mancante in .env.local")
    
    if not CONFIG['pinecone']['api_key']:
        errors.append("❌ PINECONE_API_KEY mancante in .env.local")
    
    # Verifica Poppler su Windows
    if os.name == 'nt' and CONFIG['vision']['enable']:
        poppler_path = Path(CONFIG['poppler']['path'])
        if not poppler_path.exists():
            errors.append(f"⚠️ Poppler non trovato in {CONFIG['poppler']['path']}")
            errors.append("  Scarica da: https://github.com/oschwartz10612/poppler-windows/releases")
            errors.append("  Estrai in C:\\poppler\\")
    
    # Verifica file PDF
    if not Path(CONFIG['paths']['pdf_source']).exists():
        errors.append(f"❌ PDF non trovato: {CONFIG['paths']['pdf_source']}")
    
    if errors:
        print("\n".join(errors))
        return False
    
    print("✅ Tutte le dipendenze presenti\n")
    return True

def main():
    """Funzione principale"""
    if not check_dependencies():
        print("\n⚠️ Risolvi i problemi sopra prima di continuare")
        return
    
    # Chiedi conferma per Vision
    if CONFIG['vision']['enable']:
        print("👁️ VISION ABILITATO")
        print(f"  Costo stimato: ${CONFIG['vision']['max_pages'] * CONFIG['vision']['cost_per_page']:.2f}")
        response = input("\nProcedere con Vision? (s/n): ")
        if response.lower() != 's':
            CONFIG['vision']['enable'] = False
            print("Vision disabilitato per questa sessione\n")
    
    # Esegui pipeline
    pipeline = PreprocessingPipeline()
    pipeline.run()

if __name__ == "__main__":
    main()