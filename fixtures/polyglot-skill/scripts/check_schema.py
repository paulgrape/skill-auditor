"""Bundled helper: imports count as usage-tier references with a file location."""
import json
import httpx


def main() -> None:
    response = httpx.get("http://localhost:8000/openapi.json")
    print(json.dumps(response.json(), indent=2))


if __name__ == "__main__":
    main()
