import * as k8s from "@pulumi/kubernetes";
import { letsEncryptCerts } from "../certmanager";
import * as ocean from "@pulumi/digitalocean";
import { internalChart } from "../nginx";
import { ObjectMeta } from "../crd/meta/v1";
import * as pulumi from "@pulumi/pulumi";
import { project, provider } from "../cluster";
import * as crd from "../crd";

const cf = new pulumi.Config("digitalocean");
const conf = new pulumi.Config("m3o");

export const namespace = new k8s.core.v1.Namespace(
  "cockroach",
  { metadata: { name: "cockroach" } },
  { provider }
);

export const bucket = new ocean.SpacesBucket(
  "cockroach-backups",
  {
    region: "ams3"
  },
  {
    parent: project
  }
);

export const serverTLS = new crd.certmanager.v1.Certificate(
  "cockroach-tls-server",
  {
    metadata: {
      name: "cockroach-tls-server",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "cockroach-tls-server",
      duration: "8760h", // 10 years
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "node",
      dnsNames: [
        "*.cockroach-cockroachdb.cockroach.svc.cluster.local",
        "cockroach-cockroachdb.cockroach",
        "*.cockroach-cockroachdb",
        "cockroach-cockroachdb"
      ],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const clientTLS = new crd.certmanager.v1.Certificate(
  "cockroach-tls-client",
  {
    metadata: {
      name: "cockroach-tls-client",
      namespace: "server"
    },
    spec: {
      secretName: "cockroach-tls-client",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "root",
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const clientTLSDefault = new crd.certmanager.v1.Certificate(
  "cockroach-tls-client-default",
  {
    metadata: {
      name: "cockroach-tls-client",
      namespace: "default"
    },
    spec: {
      secretName: "cockroach-tls-client",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "root",
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const clientTLSCockroach = new crd.certmanager.v1.Certificate(
  "cockroach-tls-client-cockroach",
  {
    metadata: {
      name: "cockroach-tls-client",
      namespace: "cockroach"
    },
    spec: {
      secretName: "cockroach-tls-client",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "root",
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const peerTLS = new crd.certmanager.v1.Certificate(
  "cockroach-tls-peer",
  {
    metadata: {
      name: "cockroach-tls-peer",
      namespace: namespace.metadata.name
    },
    spec: {
      secretName: "cockroach-tls-peer",
      subject: {
        organizations: ["m3o"]
      },
      isCA: false,
      privateKey: {
        algorithm: "ECDSA",
        size: 256
      },
      commonName: "root",
      dnsNames: ["*.cockroach-cockroachdb.cockroach.svc.cluster.local"],
      issuerRef: {
        name: "ca",
        kind: "ClusterIssuer"
      }
    }
  },
  { provider }
);

export const chart = new k8s.helm.v3.Chart(
  "cockroach",
  {
    namespace: namespace.metadata.name,
    chart: "cockroachdb",
    fetchOpts: { repo: "https://charts.cockroachdb.com/" },
    version: "5.0.0",
    values: {
      statefulset: {
        replicas: 3,
        updateStrategy: { type: "RollingUpdate" },
        podManagementPolicy: "Parallel",
        budget: { maxUnavailable: 1 },
        podAntiAffinity: { type: "soft", weight: 100 }
      },
      service: {
        discovery: { labels: { cluster: "micro" } }
      },
      tls: {
        enabled: true,
        certs: {
          provided: true,
          tlsSecret: true,
          clientRootSecret: (peerTLS.spec as any).secretName,
          nodeSecret: (serverTLS.spec as any).secretName
        }
      }
    },
    transformations: [
      // Remove prometheus annotations as it's TLS and can't be scraped normally
      (obj: any) => {
        if (obj.kind === "Service") {
          if (obj.metadata && obj.metadata.annotations) {
            obj.metadata.annotations["prometheus.io/scrape"] = "false";
          }
        }
      }
    ]
  },
  {
    provider
  }
);

const tlsVolumes = [
  {
    name: "certs",
    projected: {
      sources: [
        {
          secret: {
            name: (clientTLS.spec as any).secretName,
            items: [
              {
                key: "ca.crt",
                path: "ca.crt",
                mode: 256
              },
              {
                key: "tls.crt",
                path: "client.root.crt",

                mode: 256
              },
              {
                key: "tls.key",
                path: "client.root.key",
                mode: 256
              }
            ]
          }
        }
      ]
    }
  }
];

const appLabels = { app: "cockroach" };

const debugDeployment = new k8s.apps.v1.Deployment(
  "cockroach-debug",
  {
    metadata: { namespace: namespace.metadata.name },
    spec: {
      selector: { matchLabels: appLabels },
      replicas: 1,
      template: {
        metadata: { labels: appLabels },
        spec: {
          containers: [
            {
              name: "cockroach-debug",
              image: "cockroachdb/cockroach:v20.1.3",
              command: ["/bin/bash", "-c", "--"],
              args: ["while true; do sleep 30; done;"],
              volumeMounts: [{ name: "certs", mountPath: "/certs" }]
            }
          ],
          volumes: tlsVolumes
        }
      }
    }
  },
  { provider, dependsOn: clientTLSCockroach }
);

const cronBackupJob = new k8s.batch.v1beta1.CronJob(
  "cockroach-backup",
  {
    metadata: {
      name: "cockroach-backup",
      namespace: namespace.metadata.name
    },
    spec: {
      jobTemplate: {
        spec: {
          template: {
            metadata: { labels: appLabels },
            spec: {
              restartPolicy: "OnFailure",
              containers: [
                {
                  name: "cockroach-debug",
                  image: "cockroachdb/cockroach:v20.1.3",
                  command: [
                    "/bin/bash",
                    "-c",
                    pulumi.interpolate`./cockroach sql --certs-dir=/certs --host=cockroach-cockroachdb.cockroach -e "BACKUP TO 's3://${bucket.name}/\`date +%s\`/?AWS_ACCESS_KEY_ID=${cf.require(
                      "spacesAccessId"
                    )}&AWS_SECRET_ACCESS_KEY=${cf.require(
                      "spacesSecretKey"
                    )}&AWS_ENDPOINT=${
                      bucket.region
                    }.digitaloceanspaces.com';"`
                  ],
                  volumeMounts: [{ name: "certs", mountPath: "/certs" }]
                }
              ],
              volumes: tlsVolumes
            }
          }
        }
      },
      schedule: "0 * * * *"
    }
  },
  { provider }
);

export const ingress = new k8s.networking.v1beta1.Ingress(
  "cockroach-ingress",
  {
    metadata: {
      name: "grafana",
      namespace: namespace.metadata.name,
      annotations: {
        "kubernetes.io/ingress.class": "internal",
        "nginx.ingress.kubernetes.io/backend-protocol": "HTTPS",
        "cert-manager.io/cluster-issuer": (letsEncryptCerts.metadata as ObjectMeta)
          .name!
      }
    },
    spec: {
      tls: [
        {
          hosts: ["cockroach." + conf.require("internal-host")],
          secretName: "cockroach-tls"
        }
      ],
      rules: [
        {
          host: "cockroach." + conf.require("internal-host"),
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  serviceName: "cockroach-cockroachdb",
                  servicePort: 8080
                }
              }
            ]
          }
        }
      ]
    }
  },
  { provider, dependsOn: internalChart }
);

export default [
  namespace,
  peerTLS,
  serverTLS,
  clientTLS,
  clientTLSDefault,
  chart,
  debugDeployment,
  cronBackupJob
];
