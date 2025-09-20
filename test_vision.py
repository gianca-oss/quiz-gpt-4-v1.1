from openai import OpenAI
import os
from dotenv import load_dotenv

load_dotenv('.env.local')

client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# Test semplice con un'immagine di test
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Cosa vedi?"},
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/320px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"
                }
            }
        ]
    }],
    max_tokens=300
)

print(response.choices[0].message.content)