package main

/*
import "github.com/should/not/count"
*/

import (
	"fmt"
	"net/http"

	"example.com/polyglot/services/internal/store"
	"github.com/gin-gonic/gin"
	redis "github.com/redis/go-redis/v9"
	_ "golang.org/x/sync/errgroup"
)

// import "github.com/also/ignored"

func main() {
	r := gin.Default()
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "pong"})
	})
	_ = redis.NewClient(&redis.Options{})
	fmt.Println(store.Name)
	_ = r.Run()
}
