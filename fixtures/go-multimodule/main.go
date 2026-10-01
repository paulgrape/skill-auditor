package main

import (
	"example.com/api/internal/handlers"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	r.GET("/ping", handlers.Ping)
	_ = r.Run()
}
