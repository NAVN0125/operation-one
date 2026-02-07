"""
OpenRouter Analysis Service
"""
import httpx
from typing import Optional
from app.core.config import settings


class AnalysisService:
    """Service for call analysis using OpenRouter API."""

    def __init__(self):
        self.api_key = settings.openrouter_api_key
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"

    async def analyze_call(
        self,
        transcript: str,
        user_interpretation: str,
        model: str = "stepfun/step-3.5-flash:free",
    ) -> Optional[str]:
        """
        Analyze a call transcript with user interpretation context.
        
        Args:
            transcript: The call transcript text.
            user_interpretation: User's guidance on how to interpret the call.
            model: The model to use for analysis.
        
        Returns:
            Analysis result.
        """
        if not self.api_key:
            raise ValueError("OpenRouter API key not configured")

        system_prompt = """You are a call analysis assistant. Analyze the provided call transcript 
based on the user's interpretation guidelines. Provide:
1. A brief summary of the call
2. Key points and action items
3. Sentiment analysis
4. Any notable patterns or concerns

Format your response in clear sections with markdown formatting."""

        user_prompt = f"""## User's Interpretation Guidelines
{user_interpretation}

## Call Transcript
{transcript}

Please analyze this call according to the interpretation guidelines provided."""

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                },
                timeout=60.0,
            )

            if response.status_code != 200:
                raise Exception(f"OpenRouter API error: {response.text}")

            data = response.json()
            return data["choices"][0]["message"]["content"]


analysis_service = AnalysisService()
