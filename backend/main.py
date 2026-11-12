from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import FRONTEND_ORIGINS
from app.database import create_schema
from app.routers import assessment, auth, lexicon, session, users, vocab


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_schema()
    yield


app = FastAPI(
    title="LeesWijs API",
    description="Personalised Dutch reading practice: adaptive texts, word recommendations and flashcards.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(assessment.router, prefix="/api")
app.include_router(session.router, prefix="/api")
app.include_router(vocab.router, prefix="/api")
app.include_router(lexicon.router, prefix="/api")


@app.get("/", tags=["Health"])
def health():
    return {"status": "ok", "message": "LeesWijs API is running"}
