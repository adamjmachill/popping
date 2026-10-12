"""Groq provider: OpenAI-compatible chat completions at Groq's URL."""

from __future__ import annotations

from app.llm.openai import OpenAIProvider


class GroqProvider(OpenAIProvider):
    name = "groq"

    def _default_base_url(self) -> str:
        return "https://api.groq.com/openai/v1"
