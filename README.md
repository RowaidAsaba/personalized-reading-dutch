# LeesWijs

LeesWijs is a personalised Dutch reading app for second-language learners. Every text is generated for one reader: at their level, about their interests, and built around the words they are learning. Readers tap any word for a translation, add words to a review deck, and rate each text when they end it. Those ratings, reviews and look-ups feed back into the next text and the next batch of recommended words.

## What it does

- **Sign up with email and password or continue with Google.**
- **Onboarding**: a short profile (age, city, job, background, languages, purpose, optional gender), interests, and a two-batch word check that estimates the CEFR level and marks known words.
- **Reading**: generate a text, continue the story as often as you like, then end it. Ending shows a quick pop-up (difficulty on a five-point scale, plus stars for interesting, relevant and worth your time) that can be skipped. Ended readings stay in the searchable history.
- **Words in texts**: new target words (blue) and words from your review deck (yellow) are woven into every text. Tap any word for its translation, open its details, add it to your deck or mark it known.
- **Flashcards**: *Review* shows words that are due with spaced repetition; once nothing is due, *Review again* starts a practice round with all your learning words without touching the schedule. *Discover* always offers new words chosen for your profile and interests.
- **Dashboard, profile and settings**: level, words known, reading time; edit the whole profile, interests and the text-difficulty setting at any time.

## How personalisation works

- **Text styles**: every text gets one of six rotating styles (short story, mystery explainer, true profile, scene, day in the life, interview). The style of the last two texts is never repeated, and the style of a text you rated "not interesting" is skipped next time. Continuations keep the style of their text.
- **Text generation** (Gemini) uses: your effective level (assessed CEFR plus a difficulty offset), a topic rolled from your interests with learned topic scores, two sampled profile traits for the angle, your gender only to make people in the text relatable (never topics, difficulty or words), one to three new words from your recommendation reservoir, two to four learning words with the lowest mastery, and the adaptation built from your last feedbacks.
- **Feedback** (End reading): the average difficulty of the last three ratings sets harder, same or simpler; low interest or relevance in the last two ratings forces the next topic to come from your interests; low worth-your-time makes the next text shorter and more practical. Three ratings on the same side of "Normal" move the difficulty offset one step. Each rating also raises or lowers the score of the topic that was used.
- **Recommendations** (KRS): a reservoir of about 50 unseen words per user, requested from Gemini with your profile, interests, level and mother tongue, matched against the lexicon and topped up from the lexicon at your level when needed. It refills automatically when it runs low or when your profile changes.
- **Vocabulary vector**: every word you meet gets a row with a status (encountered, learning, mastered), a mastery score, exposure count, look-up count and review schedule. Reviews, add-to-learn, mark-known and look-ups while reading all update it; repeated look-ups of a "known" word move it back into the review deck. In a practice round "I remember" changes nothing, while "I forgot" still lowers mastery and makes the card due again.

## Tech stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind, Zustand, React Router (in `frontend/leeswijs`)
- **Backend**: FastAPI, SQLAlchemy 2, Pydantic 2 (in `backend`)
- **Database**: SQLite locally, Postgres (Neon) in production via `psycopg` 3
- **LLM**: Google Gemini (`google-genai`)
- **Auth**: JWT bearer tokens (`python-jose`), password hashing (`werkzeug`), Google ID tokens (`google-auth`)
- **API prefix**: `/api` (interactive docs at `/docs`)

## Repository structure

```text
backend/
  main.py                 FastAPI app, creates the schema on startup
  seed.py                 creates tables and loads the lexicon
  lexicon_data.py         seeded Dutch lexicon (word, translation, CEFR, examples)
  requirements.txt
  .env.example
  app/
    config.py             environment variables
    database.py           engine, session, create_schema()
    models.py             tables (users, user_topics, lexicon, user_vocabulary_vector,
                          recommended_vocabulary, reading_sessions, reading_feedback)
    schemas.py            request/response models
    security.py           password hashing, JWT, get_current_user
    gemini.py             Gemini client helper (JSON mode, retries)
    krs_service.py        word recommendation reservoir
    adaptation.py         feedback -> signals, topic scores, difficulty offset
    session_generator.py  text generation and continuation prompts
    routers/              auth, users, assessment, session, vocab, lexicon

frontend/leeswijs/
  src/pages/              Login, Register, Onboarding, Home, Reading, ReadingSession,
                          Flashcards, Profile, Settings
  src/components/         reading (text, tooltip, word modal, end-reading modal), auth, shared
  src/services/api.ts     typed API client (bearer token added automatically)
  src/store/index.ts      persisted auth state
  src/types/index.ts
  .env.example
```

## Environment variables

Backend (`backend/.env`):

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `sqlite:///./dev.db` locally; `postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require` for Neon |
| `FRONTEND_ORIGINS` | yes | Comma-separated origins allowed by CORS |
| `GOOGLE_API_KEY` | for generation | Gemini API key. Without it the app runs, but texts, recommendations and dictionary look-ups fail with a clear error |
| `GEMINI_MODEL` | no | Model for every Gemini call, with the model's default thinking. Defaults to `gemini-3-flash-preview` |
| `GEMINI_FALLBACK_MODEL` | no | Tried once per call when the main model fails with a model, timeout or rate-limit error. Defaults to `gemini-2.5-flash-lite`; empty disables the fallback |
| `GEMINI_TIMEOUT_SECONDS` | no | Per-call timeout before falling back, default 90 |
| `AUTH_SECRET_KEY` | yes in production | Secret used to sign login tokens. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | Login validity, default 14 days |
| `GOOGLE_CLIENT_ID` | for Google login | OAuth 2.0 Web client ID; empty hides the Google button |

Frontend (`frontend/leeswijs/.env.local`):

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Backend API base, e.g. `http://localhost:8000/api` |
| `VITE_GOOGLE_CLIENT_ID` | Same client ID as the backend; empty hides the Google button |

### Setting up "Continue with Google"

1. In Google Cloud Console create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add your frontend origins (for example `http://localhost:5173` and your production domain) to **Authorised JavaScript origins**. No redirect URI is needed (the app uses the Google Identity Services pop-up).
3. Put the client ID in both `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend).

A Google account with the same email as an existing email/password account is linked to that account on first use.

## Local setup

Requirements: Python 3.11+, Node 20+, a Gemini API key.

Quickest: from the repository root run

```bash
chmod +x run_local.sh
./run_local.sh
```

and open `http://127.0.0.1:5173`. The script installs dependencies, creates `backend/.env` from the example if needed, seeds the lexicon and starts both servers.

Manual steps:

```bash
# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                                     # then fill in GOOGLE_API_KEY and AUTH_SECRET_KEY
python seed.py                                           # creates tables, loads the lexicon
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# frontend (second terminal)
cd frontend/leeswijs
npm install
cp .env.example .env.local
npm run dev -- --host 127.0.0.1 --port 5173
```

Then create an account in the app. There are no preloaded accounts.

## Fresh production database (Neon)

1. Create an empty Neon Postgres database and copy its connection string in the form `postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require`.
2. Set `DATABASE_URL` to it (plus `AUTH_SECRET_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLIENT_ID`, `FRONTEND_ORIGINS`) in the backend environment.
3. Run `python seed.py` once with that `DATABASE_URL` to create the tables and load the lexicon. The API also creates missing tables on startup, but the lexicon only comes from `seed.py`.

There are no migrations: the schema is created from `app/models.py`. For an existing database with an older layout, drop its tables first.

## Troubleshooting

- **Backend cannot find packages**: activate the virtual environment again and rerun `pip install -r requirements.txt`.
- **Frontend cannot reach the backend**: check the backend is running at `http://127.0.0.1:8000/` and that `VITE_API_BASE_URL` in `.env.local` points to it. Restart the dev server after changing `.env.local`.
- **"Text generation is not configured"**: add `GOOGLE_API_KEY` to `backend/.env` and restart the backend.
- **Texts are slow or a model error appears in the log**: the backend log prints one `[gemini] model=… 7.2s` line per call and a warning when it falls back to `GEMINI_FALLBACK_MODEL`. Point `GEMINI_MODEL` at a model your key can use.
- **Google button missing**: set `VITE_GOOGLE_CLIENT_ID` (frontend) and `GOOGLE_CLIENT_ID` (backend) and restart both.
- **Logged out unexpectedly**: tokens expire after `ACCESS_TOKEN_EXPIRE_MINUTES`, and changing `AUTH_SECRET_KEY` invalidates all existing logins.
