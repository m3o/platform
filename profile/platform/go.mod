module github.com/m3o/platform/profile/platform

go 1.15

require (
	github.com/HdrHistogram/hdrhistogram-go v1.1.0 // indirect
	github.com/go-redis/redis/v8 v8.9.0
	github.com/gogo/protobuf v1.3.1 // indirect
	github.com/micro/micro/plugin/etcd/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/postgres/v3 v3.0.0-20210526124831-f6d0c7a4730c
	github.com/micro/micro/plugin/prometheus/v3 v3.0.0-20201217215412-2f7ad18595ff
	github.com/micro/micro/plugin/redis/broker/v3 v3.0.0-20210607154842-ec8964031a93
	github.com/micro/micro/plugin/redis/stream/v3 v3.0.0-20210607154842-ec8964031a93
	github.com/micro/micro/plugin/s3/v3 v3.0.0-20210520160722-49fbecbd098d
	github.com/micro/micro/v3 v3.3.1-0.20210611161948-fd9821dd4f52
	github.com/opentracing/opentracing-go v1.2.0
	github.com/prometheus/procfs v0.2.0 // indirect
	github.com/uber/jaeger-client-go v2.29.1+incompatible // indirect
	github.com/uber/jaeger-lib v2.4.1+incompatible // indirect
	github.com/urfave/cli/v2 v2.3.0
)

replace google.golang.org/grpc => google.golang.org/grpc v1.26.0
