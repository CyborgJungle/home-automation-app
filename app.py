"""Vercel FastAPI entry point; also supports uvicorn app:app locally."""

from home_automation.web import app

__all__ = ["app"]
