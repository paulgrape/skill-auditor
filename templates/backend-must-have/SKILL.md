---
name: backend-must-have
description: Must-have checklist for a backend service covering web framework, ORM/database, validation, logging, and testing. Use when bootstrapping a backend service, reviewing its stack choices, or checking which core backend concerns the repo still lacks.
metadata:
  categories: web-framework, orm-db, validation, logging, testing
---

# Backend must-have checklist

Use this skill when bootstrapping or auditing a backend service. Match the libraries and idioms the repository actually declares and imports.

## Web framework

Define HTTP routes, dependency injection, and lifespan startup/shutdown hooks in one consistent framework layer.

```python
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

## ORM & database access

Keep queries parameterized and scoped to explicit session lifecycles.

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

def find_user_by_email(session: Session, email: str):
    stmt = select(User).where(User.email == email)
    return session.scalars(stmt).first()
```

## Request & payload validation

Validate external inputs at the boundary before passing data into domain logic.

```python
from pydantic import BaseModel, ConfigDict, field_validator

class CreateUserRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()
```

## Structured logging

Emit structured key-value logs with request correlation IDs rather than ad-hoc print statements.

```python
import structlog

logger = structlog.get_logger()
logger.info("user.created", user_id="u_123")
```

## Automated testing

Cover route handlers, validation edge cases, and database queries with repeatable tests.

```python
import pytest

@pytest.mark.anyio
async def test_health_endpoint(client):
    response = await client.get("/health")
    assert response.status_code == 200
```
