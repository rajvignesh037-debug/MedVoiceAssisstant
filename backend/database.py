"""
database
PostgreSQL via SQLAlchemy — stores registered users. One table, no migrations
tooling (kept simple for a portfolio project).

Requires a running Postgres instance and a DATABASE_URL in .env, e.g.:
  DATABASE_URL=postgresql://user:password@localhost:5432/medvoice

For local dev, the simplest options are:
  - Install Postgres locally (or run it via Docker)
  - Use a free hosted Postgres (Render's free Postgres, Neon, Supabase) even
    during development, so you never have to think about it again later —
    this also means the same DATABASE_URL will work once deployed.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, ForeignKey, Integer, String, Text, JSON, DateTime
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.sql import func

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to backend/.env, e.g.\n"
        "DATABASE_URL=postgresql://user:password@localhost:5432/medvoice"
    )

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

    records = relationship("PatientRecord", back_populates="owner", cascade="all, delete-orphan")


class PatientRecord(Base):
    __tablename__ = "patient_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    patient_name = Column(String, nullable=True)
    age = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    clinical_summary = Column(Text, nullable=True)
    chief_complaints = Column(JSON, nullable=True)   # list[str]
    symptoms = Column(JSON, nullable=True)            # list[str]
    clinical_impression = Column(Text, nullable=True)
    raw_transcript = Column(Text, nullable=True)       # stored for reference, not shown in History UI

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="records")


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency — yields a DB session, always closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()