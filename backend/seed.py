"""Create the database schema and load the Dutch lexicon.

Safe to run repeatedly: tables are created only if missing and lexicon
entries are updated in place. Works for SQLite and Postgres (DATABASE_URL).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal, create_schema
from app.models import Lexicon
from lexicon_data import LEXICON_DATA


def main() -> None:
    print("Creating tables...")
    create_schema()
    print("  tables ready")

    db = SessionLocal()
    try:
        print("Seeding lexicon...")
        existing = {row.word: row for row in db.query(Lexicon).all()}
        added = 0
        for entry in LEXICON_DATA:
            word = entry["word"].strip().lower()
            row = existing.get(word)
            if row:
                row.translation = entry["translation"]
                row.cefr_level = entry["cefr_level"]
                row.examples = entry.get("examples")
                row.use_cases = entry.get("use_cases")
            else:
                db.add(Lexicon(
                    word=word,
                    translation=entry["translation"],
                    cefr_level=entry["cefr_level"],
                    examples=entry.get("examples"),
                    use_cases=entry.get("use_cases"),
                ))
                added += 1
        db.commit()
        print(f"  {len(LEXICON_DATA)} words processed ({added} new)")
    finally:
        db.close()

    print("\nSeed complete. Sign up in the app to create your account.")


if __name__ == "__main__":
    main()
