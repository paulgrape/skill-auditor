"""
Module docstring that mentions import flask so the scanner must ignore strings.
"""
import os
import sys as system
from fastapi import FastAPI, Depends
from pydantic import (
    BaseModel,
    Field as PydanticField,
)
from sqlalchemy.orm import Session
from app.settings import DATABASE_URL  # local package, not a dependency
from .routes import router  # relative import, ignored

# import requests  <- commented out, must not count

app = FastAPI()
app.include_router(router)


class Item(BaseModel):
    name: str = PydanticField(min_length=1)


@app.get("/items")
def list_items(db: Session = Depends(lambda: None)) -> list[Item]:
    print(os.environ.get("MODE"), system.version, DATABASE_URL)
    return []
