---
name: polyglot-skill
description: Wires the FastAPI backend, the Gin service and the Rust worker together and explains where each piece of state lives.
metadata:
  categories: api, backend
---

# Full-stack conventions

## Backend endpoints

Every HTTP endpoint in the backend is a FastAPI route with a Pydantic model
describing its payload. Keep validation in the model, not the handler, so the
generated OpenAPI schema stays truthful and the handler stays a thin adapter.

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str

@app.post("/items")
def create(item: Item) -> Item:
    return item
```

## Go service

The edge service is a Gin router. Handlers return JSON through `gin.H` and
never write to the response body directly, which keeps middleware able to
wrap every response the same way.

```go
package main

import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	r.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	_ = r.Run()
}
```

## Worker

Background jobs are plain structs that derive Serde traits so the queue can
carry them as JSON, and the runtime is Tokio; do not introduce a second async
runtime for one task.

```rust
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Serialize, Deserialize)]
struct Job { name: String }

#[tokio::main]
async fn main() {
    let (tx, _rx) = mpsc::channel::<Job>(8);
    let _ = tx.send(Job { name: "x".into() }).await;
}
```

## Migrating away from Flask

Older services still look like the snippet below; treat any remaining Flask
route as legacy and port it to the FastAPI shape above before adding features.

```python
from flask import Flask

legacy = Flask(__name__)
```
