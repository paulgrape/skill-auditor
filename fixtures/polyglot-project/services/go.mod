module example.com/polyglot/services

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/redis/go-redis/v9 v9.5.5
	golang.org/x/sync v0.7.0
)

require github.com/stretchr/testify v1.9.0

require (
	github.com/cespare/xxhash/v2 v2.2.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
)

replace github.com/gin-gonic/gin => ../forks/gin
