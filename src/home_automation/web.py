"""Private dashboard and read-only API for Vercel or a local ASGI server."""

import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from home_automation.evohome import (
    ConnectionProblem,
    EvohomeService,
    connection,
    demo_snapshot,
)

security = HTTPBasic(auto_error=False)


def require_owner(
    credentials: Annotated[HTTPBasicCredentials | None, Depends(security)],
):
    expected_password = os.environ.get("DASHBOARD_PASSWORD", "")
    expected_username = os.environ.get("DASHBOARD_USERNAME", "owner")
    if not expected_password:
        raise HTTPException(503, "Dashboard login has not been configured.")
    username = credentials.username if credentials else ""
    password = credentials.password if credentials else ""
    correct_username = secrets.compare_digest(
        username.encode(), expected_username.encode()
    )
    correct_password = secrets.compare_digest(
        password.encode(), expected_password.encode()
    )
    if not (credentials and correct_username and correct_password):
        raise HTTPException(
            401,
            "Sign in to your home dashboard.",
            headers={
                "WWW-Authenticate": 'Basic realm="Home automation", charset="UTF-8"'
            },
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    username = os.environ.get("EVOHOME_USERNAME", "").strip()
    password = os.environ.get("EVOHOME_PASSWORD", "")
    app.state.evohome = None
    if username and password:
        async with connection(username, password) as client:
            app.state.evohome = EvohomeService(client)
            yield
    else:
        yield


app = FastAPI(
    title="Home automation",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; "
        "base-uri 'none'; form-action 'self'"
    )
    return response


@app.get("/", dependencies=[Depends(require_owner)])
async def dashboard():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/evohome/status", dependencies=[Depends(require_owner)])
async def status(request: Request, demo: bool = False):
    if demo:
        return demo_snapshot()
    service = request.app.state.evohome
    if service is None:
        raise HTTPException(503, "Your Evohome account has not been connected yet.")
    try:
        return await service.status()
    except ConnectionProblem as error:
        raise HTTPException(502, str(error)) from None
