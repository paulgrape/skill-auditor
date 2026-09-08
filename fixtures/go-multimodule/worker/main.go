package main

import (
	"example.com/worker/internal/jobs"
	cron "github.com/robfig/cron/v3"
)

func main() {
	c := cron.New()
	_, _ = c.AddFunc("@hourly", jobs.Sweep)
	c.Start()
}
