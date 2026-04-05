"""
Shared fixtures: in-memory SQLite and DB session override so tests never touch database/app.db.
"""

from __future__ import annotations

import bootstrap_sys_path  # noqa: F401 — shared with test modules (Run Python File)

import os

# In-memory DB for tests; keep USE_SQLITE=1 so behavior matches local .env. config.py honors sqlite: URLs.
os.environ["USE_SQLITE"] = "1"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from backend.models import Base
from backend.dependencies import get_db


@pytest.fixture
def db_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture
def db_session(db_engine) -> Session:
    SessionTesting = sessionmaker(autoflush=False, autocommit=False, bind=db_engine)
    session = SessionTesting()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_engine):
    """FastAPI TestClient with get_db bound to the test engine."""
    from fastapi.testclient import TestClient
    from backend.app import app

    SessionTesting = sessionmaker(autoflush=False, autocommit=False, bind=db_engine)

    def override_get_db():
        s = SessionTesting()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
