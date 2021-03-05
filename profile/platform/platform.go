// Package platform is a profile for running a highly available Micro platform
package platform

import (
	"crypto/tls"
	"crypto/x509"
	"io/ioutil"
	"os"

	"github.com/micro/micro/v3/profile"
	"github.com/micro/micro/v3/service/auth"
	"github.com/micro/micro/v3/service/auth/jwt"
	"github.com/micro/micro/v3/service/broker"
	microBuilder "github.com/micro/micro/v3/service/build"
	"github.com/micro/micro/v3/service/build/golang"
	"github.com/micro/micro/v3/service/client"
	"github.com/micro/micro/v3/service/config"
	storeConfig "github.com/micro/micro/v3/service/config/store"
	"github.com/micro/micro/v3/service/events"
	evStore "github.com/micro/micro/v3/service/events/store"
	"github.com/micro/micro/v3/service/logger"
	"github.com/micro/micro/v3/service/metrics"
	"github.com/micro/micro/v3/service/registry"
	"github.com/micro/micro/v3/service/router"
	k8sRouter "github.com/micro/micro/v3/service/router/kubernetes"
	microRuntime "github.com/micro/micro/v3/service/runtime"
	"github.com/micro/micro/v3/service/runtime/kubernetes"
	"github.com/micro/micro/v3/service/store"
	"github.com/micro/micro/v3/service/store/s3"
	"github.com/urfave/cli/v2"

	// plugins
	"github.com/micro/micro/plugin/cockroach/v3"
	"github.com/micro/micro/plugin/etcd/v3"
	natsBroker "github.com/micro/micro/plugin/nats/broker/v3"
	natsStream "github.com/micro/micro/plugin/nats/stream/v3"
	"github.com/micro/micro/plugin/prometheus/v3"
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
		store.DefaultStore = cockroach.NewStore(store.Nodes(ctx.String("store_address")))
		config.DefaultConfig, _ = storeConfig.NewConfig(store.DefaultStore, "")
		profile.SetupBroker(natsBroker.NewBroker(broker.Addrs(ctx.String("broker_address"))))
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

		var err error
		events.DefaultStream, err = natsStream.NewStream(natsStreamOpts(ctx)...)
		if err != nil {
			logger.Fatalf("Error configuring stream: %v", err)
		}

		// set the events store's internal store
		events.DefaultStore = evStore.NewStore(evStore.WithStore(store.DefaultStore))

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

		// The platform runs on k8s with kata containers
		microRuntime.DefaultRuntime = kubernetes.NewRuntime(
			kubernetes.RuntimeClassName("kata-fc"),
		)

		// Build from source within the runtime
		// TODO: offload to a build service and run containers
		microBuilder.DefaultBuilder, err = golang.NewBuilder()
		if err != nil {
			logger.Fatalf("Error configuring golang builder: %v", err)
		}
		// Use k8s routing which is DNS based
		router.DefaultRouter = k8sRouter.NewRouter()
		client.DefaultClient.Init(client.Router(router.DefaultRouter))

		// default images run our own cell by default
		kubernetes.DefaultImage = "ghcr.io/m3o/cells:v3"
		return nil
	},
}

// natsStreamOpts returns a slice of options which should be used to configure nats
func natsStreamOpts(ctx *cli.Context) []natsStream.Option {
	opts := []natsStream.Option{
		natsStream.Address(ctx.String("broker_address")),
		natsStream.ClusterID("nats-streaming"),
	}

	// Parse event TLS certs
	if len(ctx.String("events_tls_cert")) > 0 || len(ctx.String("events_tls_key")) > 0 {
		cert, err := tls.LoadX509KeyPair(ctx.String("events_tls_cert"), ctx.String("events_tls_key"))
		if err != nil {
			logger.Fatalf("Error loading event TLS cert: %v", err)
		}

		// load custom certificate authority
		caCertPool := x509.NewCertPool()
		if len(ctx.String("events_tls_ca")) > 0 {
			crt, err := ioutil.ReadFile(ctx.String("events_tls_ca"))
			if err != nil {
				logger.Fatalf("Error loading event TLS certificate authority: %v", err)
			}
			caCertPool.AppendCertsFromPEM(crt)
		}

		cfg := &tls.Config{Certificates: []tls.Certificate{cert}, RootCAs: caCertPool}
		opts = append(opts, natsStream.TLSConfig(cfg))
	}

	return opts
}
