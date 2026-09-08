module example.com/polyglot/services

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/redis/go-redis/v9 v9.5.1
	golang.org/x/sync v0.7.0 // indirect
)

require github.com/stretchr/testify v1.9.0

replace github.com/gin-gonic/gin => ../forks/gin
