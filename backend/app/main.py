from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import backup, dashboard, debts, pnl
from .routers import settings as settings_router

app = FastAPI(title="Debt Freedom Tracker API", version="1.0.0")

origins = ["*"] if settings.cors_origins.strip() == "*" else [
    o.strip() for o in settings.cors_origins.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(settings_router.router)
app.include_router(debts.router)
app.include_router(pnl.router)
app.include_router(backup.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
