module github.com/m3o/platform/profile/platform

go 1.15

require (
	github.com/go-redis/redis/v8 v8.8.3
	github.com/micro/micro/plugin/cockroach/v3 v3.0.0-20210510144512-ae06e7171156
	github.com/micro/micro/plugin/etcd/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/prometheus/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/redis/broker/v3 v3.0.0-20210520154319-853ad92b19fd
	github.com/micro/micro/plugin/redis/stream/v3 v3.0.0-20210520154319-853ad92b19fd
	github.com/micro/micro/plugin/s3/v3 v3.0.0-20210520154319-853ad92b19fd
	github.com/micro/micro/v3 v3.2.2-0.20210520102855-29bcd2c72a6a
	github.com/urfave/cli/v2 v2.3.0
)

replace google.golang.org/grpc => google.golang.org/grpc v1.26.0
