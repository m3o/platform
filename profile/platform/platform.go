// Package platform is a profile for running a highly available Micro platform
package platform

import (
	"os"

	"github.com/go-redis/redis/v8"
	"github.com/micro/micro/plugin/postgres/v3"
	"github.com/micro/micro/plugin/s3/v3"
	"github.com/micro/micro/v3/profile"
	"github.com/micro/micro/v3/service/auth"
	"github.com/micro/micro/v3/service/auth/jwt"
	"github.com/micro/micro/v3/service/broker"
	microBuilder "github.com/micro/micro/v3/service/build"
	"github.com/micro/micro/v3/service/build/golang"
	"github.com/micro/micro/v3/service/config"
	storeConfig "github.com/micro/micro/v3/service/config/store"
	"github.com/micro/micro/v3/service/events"
	evStore "github.com/micro/micro/v3/service/events/store"
	"github.com/micro/micro/v3/service/logger"
	"github.com/micro/micro/v3/service/metrics"
	"github.com/micro/micro/v3/service/registry"
	microRuntime "github.com/micro/micro/v3/service/runtime"
	"github.com/micro/micro/v3/service/runtime/kubernetes"
	"github.com/micro/micro/v3/service/store"
	"github.com/urfave/cli/v2"

	// plugins
	"github.com/micro/micro/plugin/etcd/v3"
	"github.com/micro/micro/plugin/prometheus/v3"
	redisBroker "github.com/micro/micro/plugin/redis/broker/v3"
	redisstream "github.com/micro/micro/plugin/redis/stream/v3"
)

func init() {
	profile.Register("platform", Profile)
}

// Profile is for running the micro platform
var Profile = &profile.Profile{
	Name: "platform",
	Setup: func(ctx *cli.Context) error {
		auth.DefaultAuth = jwt.NewAuth()
		// the cockroach store will connect immediately so the address must be passed
		// when the store is created. The cockroach store address contains the location
		// of certs so it can't be defaulted like the broker and registry.
		store.DefaultStore = postgres.NewStore(store.Nodes(ctx.String("store_address")))
		config.DefaultConfig, _ = storeConfig.NewConfig(store.DefaultStore, "")
		profile.SetupBroker(redisBroker.NewBroker(broker.Addrs(ctx.String("broker_address"))))
		profile.SetupRegistry(etcd.NewRegistry(registry.Addrs(ctx.String("registry_address"))))
		profile.SetupJWT(ctx)
		profile.SetupConfigSecretKey(ctx)

		// Set up a default metrics reporter (being careful not to clash with any that have already been set):
		if !metrics.IsSet() {
			prometheusReporter, err := prometheus.New()
			if err != nil {
				return err
			}
			metrics.SetDefaultMetricsReporter(prometheusReporter)
		}

		if ctx.Args().Get(1) == "events" {
			var err error
			events.DefaultStream, err = redisstream.NewStream(redisStreamOpts(ctx)...)
			if err != nil {
				logger.Fatalf("Error configuring stream: %v", err)
			}
		}

		// only configure the blob store for the store and runtime services
		if ctx.Args().Get(1) == "runtime" || ctx.Args().Get(1) == "store" {
			opts := []s3.Option{
				s3.Credentials(
					os.Getenv("MICRO_BLOB_STORE_ACCESS_KEY"),
					os.Getenv("MICRO_BLOB_STORE_SECRET_KEY"),
				),
				s3.Endpoint(os.Getenv("MICRO_BLOB_STORE_ENDPOINT")),
				s3.Region(os.Getenv("MICRO_BLOB_STORE_REGION")),
				s3.Bucket(os.Getenv("MICRO_BLOB_STORE_BUCKET")),
			}
			if val := os.Getenv("MICRO_BLOB_STORE_INSECURE"); len(val) > 0 {
				opts = append(opts, s3.Insecure())
			}

			store.DefaultBlobStore, err = s3.NewBlobStore(opts...)
			if err != nil {
				logger.Fatalf("Error configuring s3 blob store: %v", err)
			}
		}

		microRuntime.DefaultRuntime = kubernetes.NewRuntime(
			kubernetes.RuntimeClassName("kata-fc"),
		)
		microBuilder.DefaultBuilder, err = golang.NewBuilder()
		if err != nil {
			logger.Fatalf("Error configuring golang builder: %v", err)
		}
		events.DefaultStore = evStore.NewStore(evStore.WithStore(store.DefaultStore))

		kubernetes.DefaultImage = "ghcr.io/m3o/cells:v3"
		return nil
	},
}

// natsStreamOpts returns a slice of options which should be used to configure nats
func redisStreamOpts(ctx *cli.Context) []redisstream.Option {
	fullAddr := ctx.String("broker_address")
	o, err := redis.ParseURL(fullAddr)
	if err != nil {
		logger.Fatalf("Error configuring redis connection, failed to parse %s", fullAddr)
	}

	opts := []redisstream.Option{
		redisstream.Address(o.Addr),
		redisstream.User(o.Username),
		redisstream.Password(o.Password),
	}
	if o.TLSConfig != nil {
		opts = append(opts, redisstream.TLSConfig(o.TLSConfig))
	}

	return opts
}
